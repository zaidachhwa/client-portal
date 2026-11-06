"use server";
import { createHash, randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isValidObjectId, Types } from "mongoose";
import { db, tx } from "@/lib/db";
import { atLeast, canAccessProject, grantableRoles, projectAccess } from "@/lib/data";
import {
  AuditLog, Client, ClientContact, CommunicationThread, Document, DocumentRequirement, DocumentReview, DocumentTemplate, DocumentType, DocumentVersion, Invitation, LoginAttempt, Notification,
  Membership, Message, Organization, PhaseInstance, Project, ProjectMember, ProjectWorkflow, Role, Session as SessionModel, Task, TaskComment, User, WorkflowExecution, WorkflowTemplate, WorkflowVersion,
} from "@/lib/models";
import { GSTIN, PAN, gstinMatchesState, isState } from "@/lib/india";
import { hashPassword, verifyPassword } from "@/lib/password";
import { appUrl, audit, nextNumber, requestMeta, requireSession, type S } from "@/lib/guard";
import { can, endSession, sha256, startSession } from "@/lib/session";
import { sendMail } from "@/lib/mail";
import { notify, projectPeople } from "@/lib/notify";
import { raiseDue } from "@/lib/schedules";
import { putFile, storageKey } from "@/lib/storage";

// ---- Auth (§6)

export async function login(_: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "").slice(0, 200);
  if (!email || !password) return { error: "Enter your email and password." };

  await db();
  if (await tooManyAttempts(email)) return { error: "Too many attempts. Try again in 15 minutes." };
  const user = await User.findOne({ email, status: "active" }).select("+passwordHash").lean();
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await recordFailure(email);
    return { error: "That email and password don't match." };
  }
  await LoginAttempt.deleteMany({ key: `email:${email}` });

  // Reopen the organization used last; otherwise the oldest membership.
  const last = await SessionModel.findOne({ userId: user._id }).sort({ createdAt: -1 }).lean();
  const membership =
    (last && (await Membership.findOne({ _id: last.membershipId, userId: user._id, status: "active" }).lean())) ||
    (await Membership.findOne({ userId: user._id, status: "active" }).sort({ joinedAt: 1 }).lean());
  if (!membership) {
    const suspended = await Membership.exists({ userId: user._id, status: "suspended" });
    return { error: suspended ? "Your access has been suspended. Ask your account manager to restore it." : "Your account isn't linked to an organization yet." };
  }

  await startSession(user._id, membership);
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  redirect("/");
}

// Throttle password guesses: 5 failures per email or 30 per IP in 15 minutes (the TTL index clears them).
const WINDOW_MS = 15 * 60 * 1000;
const clientIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();

async function tooManyAttempts(email: string) {
  const since = new Date(Date.now() - WINDOW_MS);
  const ip = await clientIp();
  const [byEmail, byIp] = await Promise.all([
    LoginAttempt.countDocuments({ key: `email:${email}`, createdAt: { $gt: since } }),
    ip ? LoginAttempt.countDocuments({ key: `ip:${ip}`, createdAt: { $gt: since } }) : 0,
  ]);
  return byEmail >= 5 || byIp >= 30;
}

async function recordFailure(email: string) {
  const ip = await clientIp();
  await LoginAttempt.insertMany([{ key: `email:${email}` }, ...(ip ? [{ key: `ip:${ip}` }] : [])]);
}

export async function switchOrg(membershipId: string) {
  const s = await requireSession();
  if (!isValidObjectId(membershipId) || membershipId === s.membershipId) return;
  const m = await Membership.findOne({ _id: membershipId, userId: s.userId, status: "active" }).lean();
  if (!m) return;
  await endSession();
  await startSession(m.userId, m);
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

// ---- Notifications (§14.2)

// One notification, or (no id) the whole inbox. Only ever the signed-in user's own.
export async function markRead(notificationId?: string) {
  const s = await requireSession();
  if (notificationId !== undefined && !isValidObjectId(notificationId)) return;
  await Notification.updateMany(
    { organizationId: s.orgId, recipientUserId: s.userId, channel: "in_app", readAt: null, ...(notificationId && { _id: notificationId }) },
    { readAt: new Date() },
  );
  refresh();
}

// Per-person email preference; in-app notifications are unaffected.
export async function setEmailNotifications(on: boolean) {
  const s = await requireSession();
  await User.updateOne({ _id: s.userId }, { emailNotifications: on === true });
  refresh();
}

// ---- Messages and tasks

export async function sendMessage(projectId: string, text: string) {
  const s = await requireSession();
  const body = String(text).trim().slice(0, 2000);
  if (!body || !can(s, "messages.send") || !isValidObjectId(projectId) || !(await canAccessProject(s, projectId))) return;

  let thread = await CommunicationThread.findOne({ organizationId: s.orgId, projectId });
  if (!thread) {
    const p = await Project.findById(projectId).lean();
    thread = await CommunicationThread.create({ organizationId: s.orgId, projectId, clientId: p!.clientId, subject: p!.name });
  }
  await Message.create({ organizationId: s.orgId, threadId: thread._id, senderId: s.userId, message: body });
  const base = await appUrl();
  after(async () =>
    notify(s.orgId, await projectPeople(s.orgId, projectId, "all", s.userId), {
      title: `${s.name} in ${thread.subject ?? "your project"}`, message: body.length > 140 ? `${body.slice(0, 139)}…` : body,
      resourceType: "thread", resourceId: thread._id, link: `/chat?project=${projectId}`, collapse: true,
    }, base),
  );
  refresh();
}

export async function toggleTask(taskId: string) {
  const s = await requireSession();
  if (!isValidObjectId(taskId)) return;
  const t = await Task.findOne({ _id: taskId, organizationId: s.orgId });
  // Clients may only tick off their own tasks; staff need tasks.update.
  const allowed = s.isStaff ? can(s, "tasks.update") : String(t?.assignedTo) === s.userId;
  if (!t || !allowed || !(await canAccessProject(s, t.projectId, "edit"))) return;
  const done = t.status !== "completed";
  // A task waiting on others can't be completed until they are (§9.1).
  if (done && t.dependencies?.length && (await Task.exists({ _id: { $in: t.dependencies }, status: { $ne: "completed" } }))) return;
  t.status = done ? "completed" : "todo";
  t.completedAt = done ? new Date() : undefined;
  await t.save();
  refresh();
}

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// Priority and dependencies (§9.1). Dependencies must be other tasks in the same project, without cycles.
export async function updateTask(taskId: string, priority: string, dependencies: string[]) {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "tasks.update") || !isValidObjectId(taskId)) return { error: "You can't change this task." };
  const t = await Task.findOne({ _id: taskId, organizationId: s.orgId });
  if (!t || !(await canAccessProject(s, t.projectId, "edit"))) return { error: "You can't change this task." };
  if (!PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) return { error: "Pick a priority." };
  const deps = [...new Set((Array.isArray(dependencies) ? dependencies : []).map(String))].filter((d) => d !== taskId).slice(0, 50);
  if (!deps.every(isValidObjectId)) return { error: "Unknown task." };

  const siblings = await Task.find({ organizationId: s.orgId, projectId: t.projectId }).select("dependencies").lean();
  if (!deps.every((d) => siblings.some((x) => String(x._id) === d))) return { error: "Dependencies must be tasks in this project." };
  // Cycle check: walking the new graph from each dependency must never reach this task.
  const next = (id: string) => (id === taskId ? deps : (siblings.find((x) => String(x._id) === id)?.dependencies ?? []).map(String));
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return { error: "That would make tasks wait on each other in a loop." };
    if (!seen.has(id)) {
      seen.add(id);
      stack.push(...next(id));
    }
  }

  const before = { priority: t.priority, dependencies: (t.dependencies ?? []).map(String).sort() };
  t.priority = priority as (typeof PRIORITIES)[number];
  t.dependencies = deps.map((d) => new Types.ObjectId(d));
  await t.save();
  await audit(s, "task.updated", "task", t._id, before, { priority, dependencies: [...deps].sort() });
  refresh();
  return {};
}

// Comments on a task (§9.2). Anyone on the project can comment; only staff can make a note internal.
export async function addTaskComment(taskId: string, text: string, internal: boolean) {
  const s = await requireSession();
  const message = String(text).trim().slice(0, 2000);
  if (!message) return { error: "Write a comment first." };
  if (!can(s, "messages.send") || !isValidObjectId(taskId)) return { error: "You can't comment here." };
  const t = await Task.findOne({ _id: taskId, organizationId: s.orgId }).lean();
  if (!t || !(await canAccessProject(s, t.projectId))) return { error: "Task not found." };
  const visibility = s.isStaff && internal === true ? "internal" : "client";
  const [c] = await TaskComment.insertMany([{ organizationId: s.orgId, taskId: t._id, authorId: s.userId, message, visibility }]);

  // Tell the assignee, the project manager and everyone who commented before; never clients about internal notes.
  const base = await appUrl();
  after(async () => {
    const [project, earlier] = await Promise.all([
      Project.findById(t.projectId).lean(),
      TaskComment.find({ organizationId: s.orgId, taskId: t._id }).distinct("authorId"),
    ]);
    let people = [t.assignedTo, project?.projectManagerId, ...earlier].filter((u): u is Types.ObjectId => !!u && String(u) !== s.userId);
    if (visibility === "internal") {
      const staff = await Membership.find({ organizationId: s.orgId, userId: { $in: people }, membershipType: "employee", status: "active" }).distinct("userId");
      people = people.filter((u) => staff.some((x) => String(x) === String(u)));
    }
    await notify(s.orgId, people, {
      title: `${s.name} on “${t.title}”`, message: message.length > 140 ? `${message.slice(0, 139)}…` : message,
      resourceType: "task", resourceId: t._id, link: `/?project=${t.projectId}&task=${t._id}`, collapse: true,
    }, base);
  });
  await audit(s, "task.commented", "task", t._id, undefined, { commentId: c._id, visibility });
  refresh();
  return {};
}

// ---- Documents (§10)

const DEFAULT_TYPES = ["pdf", "png", "jpg", "jpeg", "webp", "svg", "doc", "docx", "xls", "xlsx", "txt", "zip", "mp3", "wav"];
const DEFAULT_MAX = 10 * 1024 * 1024;

export async function uploadDocument(_: { error?: string } | undefined, form: FormData) {
  const s = await requireSession();
  const projectId = String(form.get("projectId") ?? "");
  const requirementId = String(form.get("requirementId") ?? "");
  const file = form.get("file");
  if (!can(s, "documents.upload")) return { error: "You don't have permission to upload." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (!isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "edit"))) return { error: "You can't change this project." };

  const project = await Project.findOne({ _id: projectId, organizationId: s.orgId }).lean();
  const requirement = requirementId
    ? await DocumentRequirement.findOne({ _id: requirementId, organizationId: s.orgId, projectId })
    : null;
  if (requirementId && !requirement) return { error: "Requirement not found." };
  const type = requirement ? await DocumentType.findOne({ _id: requirement.documentTypeId, organizationId: s.orgId }).lean() : null;

  // Validate against the document type's rules (§10.2), falling back to safe defaults.
  const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "upload";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = type?.allowedExtensions?.length ? type.allowedExtensions : DEFAULT_TYPES;
  if (!allowed.includes(ext)) return { error: `Allowed file types: ${allowed.join(", ")}.` };
  if (file.size > (type?.maxFileSizeBytes ?? DEFAULT_MAX)) return { error: `File is too large (max ${Math.round((type?.maxFileSizeBytes ?? DEFAULT_MAX) / 1e6)} MB).` };

  // Re-uploading against a requirement adds a new version to the same document (§10.6).
  const doc =
    (requirement && (await Document.findOne({ organizationId: s.orgId, requirementId: requirement._id }))) ||
    new Document({
      organizationId: s.orgId, clientId: project!.clientId, projectId, requirementId: requirement?._id, documentTypeId: type?._id,
    });
  const last = await DocumentVersion.findOne({ organizationId: s.orgId, documentId: doc._id }).sort({ version: -1 }).lean();
  const version = (last?.version ?? 0) + 1;
  const data = Buffer.from(await file.arrayBuffer());
  const key = await putFile(storageKey(s.orgId, String(doc._id), version), data, ext);

  const v = await DocumentVersion.create({
    organizationId: s.orgId, documentId: doc._id, version, originalFileName: name, storageKey: key,
    mimeType: file.type || "application/octet-stream", fileSizeBytes: file.size,
    checksum: createHash("sha256").update(data).digest("hex"), uploadedBy: s.userId,
  });
  doc.currentVersionId = v._id;
  doc.status = type && !type.requiresVerification ? "approved" : "pending_review";
  await doc.save();
  if (requirement) {
    requirement.status = doc.status === "approved" ? "approved" : "submitted";
    if (doc.status === "approved") requirement.approvedDocumentId = doc._id;
    await requirement.save();
  }
  await audit(s, "document.uploaded", "document", doc._id, undefined, { version, name });
  if (doc.status === "pending_review" && !s.isStaff) {
    const base = await appUrl();
    after(async () =>
      notify(s.orgId, await projectPeople(s.orgId, projectId, "staff", s.userId), {
        title: `To review: ${name}`, message: `${s.name} uploaded ${version > 1 ? `version ${version} of ` : ""}“${name}” for ${project!.name}.`,
        resourceType: "document", resourceId: doc._id, link: `/files?project=${projectId}`,
      }, base),
    );
  }
  refresh();
  return {};
}

export async function reviewDocument(documentId: string, decision: "approved" | "rejected") {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "documents.approve") || !isValidObjectId(documentId) || !["approved", "rejected"].includes(decision)) return;
  const doc = await Document.findOne({ _id: documentId, organizationId: s.orgId, status: "pending_review" });
  if (!doc || !(await canAccessProject(s, doc.projectId!, "edit"))) return;

  // Approval and its state transition commit together (§16.4).
  await tx(async () => {
    await DocumentVersion.updateOne(
      { _id: doc.currentVersionId, organizationId: s.orgId },
      { verificationStatus: decision, verifiedBy: s.userId, verifiedAt: new Date() },
    );
    doc.status = decision;
    await doc.save();
    if (doc.requirementId) {
      await DocumentRequirement.updateOne(
        { _id: doc.requirementId, organizationId: s.orgId },
        decision === "approved" ? { status: "approved", approvedDocumentId: doc._id } : { status: "rejected" },
      );
    }
    await DocumentReview.insertMany([{
      organizationId: s.orgId, documentId: doc._id, documentVersionId: doc.currentVersionId, reviewerId: s.userId, decision,
    }]);
    await audit(s, `document.${decision}`, "document", doc._id, { status: "pending_review" }, { status: decision });
  });

  // Tell the uploader, after the response so approving stays instant.
  const base = await appUrl();
  after(async () => {
    const v = await DocumentVersion.findById(doc.currentVersionId).lean();
    if (!v || String(v.uploadedBy) === s.userId) return;
    const approved = decision === "approved";
    const message = approved
      ? `${s.name} approved “${v.originalFileName}”. Nothing else is needed for this document.`
      : `${s.name} couldn't accept “${v.originalFileName}”. Please upload a new version.`;
    await notify(s.orgId, [v.uploadedBy], {
      title: approved ? `Approved: ${v.originalFileName}` : `Please re-upload: ${v.originalFileName}`, message,
      resourceType: "document", resourceId: doc._id, link: `/files?project=${doc.projectId}`,
      email: { lines: [message], cta: "Open your dashboard" },
    }, base);
  });
  refresh();
}

// ---- Workflow (§8)

export async function completePhase(projectId: string) {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "workflows.advance")) return { error: "You don't have permission to advance workflows." };
  if (!isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "edit"))) return { error: "You can't change this project." };

  const wf = await ProjectWorkflow.findOne({ organizationId: s.orgId, projectId, status: "active" });
  const phase = wf && (await PhaseInstance.findOne({ _id: wf.currentPhaseInstanceId, organizationId: s.orgId }));
  if (!wf || !phase) return { error: "This project has no active phase." };

  // Check the completion conditions snapshotted when the phase was created (§8.4).
  const rules = (phase.completionConditionsSnapshot ?? {}) as { mandatoryTasks?: boolean; mandatoryDocuments?: boolean };
  const blockers: string[] = [];
  if (rules.mandatoryTasks) {
    const open = await Task.countDocuments({ organizationId: s.orgId, phaseInstanceId: phase._id, isMandatory: true, status: { $ne: "completed" } });
    if (open) blockers.push(`${open} required task${open > 1 ? "s" : ""} open`);
  }
  if (rules.mandatoryDocuments) {
    const missing = await DocumentRequirement.countDocuments({ organizationId: s.orgId, phaseInstanceId: phase._id, isMandatory: true, status: { $ne: "approved" } });
    if (missing) blockers.push(`${missing} required document${missing > 1 ? "s" : ""} not approved`);
  }

  if (blockers.length) {
    await WorkflowExecution.create({
      organizationId: s.orgId, workflowInstanceId: wf._id, phaseInstanceId: phase._id, eventType: "phase.complete",
      previousStatus: phase.status, newStatus: phase.status, triggeredBy: s.userId, executionResult: "failed", details: { blockers },
    });
    return { error: `Can't complete yet: ${blockers.join(", ")}.` };
  }

  // Phase completion and transition commit together (§16.5).
  await tx(async () => {
    const now = new Date();
    phase.status = "completed";
    phase.completedAt = now;
    await phase.save();
    const next = await PhaseInstance.findOne({ organizationId: s.orgId, workflowInstanceId: wf._id, sequence: { $gt: phase.sequence } }).sort({ sequence: 1 });
    if (next) {
      next.status = "active";
      next.startedAt = now;
      await next.save();
      wf.currentPhaseInstanceId = next._id;
    } else {
      wf.status = "completed";
      wf.completedAt = now;
    }
    await wf.save();
    await WorkflowExecution.insertMany([{
      organizationId: s.orgId, workflowInstanceId: wf._id, phaseInstanceId: phase._id, eventType: "phase.complete",
      previousStatus: "active", newStatus: "completed", triggeredBy: s.userId, executionResult: "success", details: { nextPhase: next?.phaseKey ?? null },
    }]);
    await audit(s, "workflow.phase_completed", "phase_instance", phase._id, { status: "active" }, { status: "completed" });
  });
  await raiseDue(s.orgId, projectId); // milestones billed on this phase become due (§11.2)
  const base = await appUrl();
  after(async () => {
    const next = wf.status === "completed" ? null : await PhaseInstance.findById(wf.currentPhaseInstanceId).lean();
    await notify(s.orgId, await projectPeople(s.orgId, projectId, "client"), {
      title: `${phase.phaseName} is complete`,
      message: next ? `Next up: ${next.phaseName}.` : "That was the last phase. Thank you for working with us!",
      resourceType: "phase_instance", resourceId: phase._id, link: `/?project=${projectId}`,
    }, base);
  });
  refresh();
  return {};
}

// ---- Invitations (§3.2)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InviteResult = { error?: string; link?: string; emailed?: boolean; mailError?: string };

export async function createInvite(_: InviteResult | undefined, form: FormData) {
  const s = await requireSession();
  return sendInvite(s, {
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    type: form.get("type") === "employee" ? "employee" : "client",
    roleId: String(form.get("roleId") ?? ""),
    projectId: String(form.get("projectId") ?? ""),
  });
}

// Invite a client contact to the selected project with the org's "Client" role.
export async function inviteContact(contactId: string, projectId: string): Promise<InviteResult> {
  const s = await requireSession();
  const contact = isValidObjectId(contactId) ? await ClientContact.findOne({ _id: contactId, organizationId: s.orgId, status: "active" }).lean() : null;
  if (!contact?.email) return { error: "Add an email for this contact first." };
  const project = isValidObjectId(projectId) ? await Project.findOne({ _id: projectId, organizationId: s.orgId, clientId: contact.clientId }).lean() : null;
  if (!project) return { error: "Project not found." };
  // ponytail: assumes one role named "Client"; add a role picker here if orgs define several client roles.
  const role = (await grantableRoles(s)).find((r) => r.name === "Client");
  if (!role) return { error: "Use the Invite card to pick a role." };
  return sendInvite(s, { email: contact.email, type: "client", roleId: role.id, projectId });
}

async function sendInvite(s: S, { email, type, roleId, projectId }: { email: string; type: "employee" | "client"; roleId: string; projectId: string }): Promise<InviteResult> {
  if (!s.isStaff || !can(s, "members.invite")) return { error: "You don't have permission to invite people." };
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  if (!(await grantableRoles(s)).some((r) => r.id === roleId)) return { error: "Pick a role you're allowed to grant." };
  if (type === "client" && !projectId) return { error: "Clients need a project." };
  if (projectId && (!isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "manage")))) return { error: "Only the project's managers can invite people to it." };

  const existing = await User.findOne({ email }).lean();
  if (existing && (await Membership.exists({ organizationId: s.orgId, userId: existing._id, status: "active" }))) {
    return { error: "That person is already a member." };
  }

  // A new invite to the same address replaces any pending one, so only the latest link works.
  await Invitation.updateMany({ organizationId: s.orgId, email, status: "pending" }, { status: "revoked" });
  const token = randomBytes(32).toString("base64url");
  const invite = await Invitation.create({
    organizationId: s.orgId, email, membershipType: type, roleIds: [roleId], projectId: projectId || undefined,
    tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: s.userId,
  });
  await audit(s, "invitation.created", "invitation", invite._id, undefined, { email, type });

  const link = `/invite/${token}`;
  const [org, project] = await Promise.all([
    Organization.findById(s.orgId).lean(),
    projectId ? Project.findById(projectId).lean() : null,
  ]);
  const mail = await sendMail(
    email,
    `${s.name} invited you to ${org?.name ?? "the client portal"}`,
    [
      `${s.name} invited you to join ${org?.name ?? "their workspace"}${project ? ` for “${project.name}”` : ""}.`,
      "Set a password and you're in. The link works once and expires in 7 days.",
    ],
    { label: "Accept invite", url: (await appUrl()) + link },
  );
  refresh();
  // The link is still returned once, so the inviter can share it another way if email fails.
  return { link, emailed: mail.sent, mailError: mail.sent ? undefined : mail.reason };
}

export async function revokeInvite(inviteId: string) {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "members.invite") || !isValidObjectId(inviteId)) return;
  const r = await Invitation.updateOne({ _id: inviteId, organizationId: s.orgId, status: "pending" }, { status: "revoked" });
  if (r.modifiedCount) await audit(s, "invitation.revoked", "invitation", new Types.ObjectId(inviteId));
  refresh();
}

export async function acceptInvite(token: string, _: { error?: string } | undefined, form: FormData) {
  await db();
  const invite = await Invitation.findOne({ tokenHash: sha256(String(token)), status: "pending", expiresAt: { $gt: new Date() } }).lean();
  if (!invite) return { error: "This invite is no longer valid. Ask for a new one." };

  const password = String(form.get("password") ?? "");
  const existing = await User.findOne({ email: invite.email }).select("+passwordHash");
  const firstName = String(form.get("firstName") ?? "").trim().slice(0, 80);
  const lastName = String(form.get("lastName") ?? "").trim().slice(0, 80);
  if (existing) {
    // Existing account: prove it's theirs before attaching a new organization.
    if (await tooManyAttempts(invite.email)) return { error: "Too many attempts. Try again in 15 minutes." };
    if (!verifyPassword(password, existing.passwordHash)) {
      await recordFailure(invite.email);
      return { error: "That password doesn't match your existing account." };
    }
  } else {
    if (!firstName) return { error: "Enter your first name." };
    if (password.length < 8 || password.length > 200) return { error: "Use a password of at least 8 characters." };
  }

  // Everything below commits together; if any step fails the invite stays usable.
  const USED = "invite-used";
  const result = await tx(async () => {
    // Claiming first makes a second use of the same link fail inside its own transaction.
    const claimed = await Invitation.findOneAndUpdate({ _id: invite._id, status: "pending" }, { status: "accepted", acceptedAt: new Date() });
    if (!claimed) throw new Error(USED);

    const [user] = existing
      ? [existing]
      : await User.insertMany([{ firstName, lastName, email: invite.email, passwordHash: hashPassword(password), emailVerifiedAt: new Date() }]);
    await Invitation.updateOne({ _id: invite._id }, { acceptedBy: user._id });

    const project = invite.projectId ? await Project.findOne({ _id: invite.projectId, organizationId: invite.organizationId }).lean() : null;
    const [role, client] = await Promise.all([
      Role.findOne({ _id: invite.roleIds[0], organizationId: invite.organizationId }).lean(),
      project ? Client.findById(project.clientId).lean() : null,
    ]);
    const membership = await Membership.findOneAndUpdate(
      { organizationId: invite.organizationId, userId: user._id },
      {
        status: "active", membershipType: invite.membershipType, roleIds: invite.roleIds, joinedAt: new Date(),
        title: invite.membershipType === "client" ? `Client · ${client?.displayName ?? ""}` : role?.name,
      },
      { upsert: true, returnDocument: "after" },
    );
    if (project) {
      await ProjectMember.updateOne(
        { organizationId: invite.organizationId, projectId: project._id, userId: user._id, status: "active" },
        { $setOnInsert: { role: invite.membershipType === "client" ? "client" : "member", accessLevel: "edit", assignedAt: new Date() } },
        { upsert: true },
      );
      // Client-side tasks are created unassigned (no portal user yet); the first client to join picks them up.
      if (invite.membershipType === "client") {
        await Task.updateMany({ organizationId: invite.organizationId, projectId: project._id, assignedTo: null }, { assignedTo: user._id });
      }
    }
    await AuditLog.insertMany([{
      organizationId: invite.organizationId, actorId: user._id, action: "invitation.accepted", resourceType: "invitation", resourceId: invite._id,
      after: { email: invite.email, type: invite.membershipType }, ...(await requestMeta()),
    }]);
    return { userId: user._id, membership };
  }).catch((e: Error) => {
    if (e.message === USED) return null;
    throw e;
  });
  if (!result?.membership) return { error: "This invite was already used." };

  await startSession(result.userId, result.membership);
  redirect("/");
}

// ---- Clients, contacts and projects (§7)

type Result = { error?: string; clientId?: string; projectId?: string };
const field = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Same rules for new and edited clients; the state must come from the list so GST splits correctly.
function taxError(gstin: string, pan: string, state: string) {
  if (state && !isState(state)) return "Pick a state from the list.";
  if (gstin && !GSTIN.test(gstin)) return "GSTIN should look like 27ABCDE1234F1Z5.";
  if (gstin && state && !gstinMatchesState(gstin, state)) return `That GSTIN is registered outside ${state}. Check the state or the number.`;
  if (pan && !PAN.test(pan)) return "PAN should look like ABCDE1234F.";
  return null;
}

async function isStaffMember(s: S, userId: string) {
  return isValidObjectId(userId) && !!(await Membership.exists({ organizationId: s.orgId, userId, membershipType: "employee", status: "active" }));
}

export async function createClient(_: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "clients.create")) return { error: "You don't have permission to add clients." };

  const type = form.get("clientType") === "individual" ? "individual" : "organization";
  const displayName = field(form, "displayName", 120);
  const gstin = field(form, "gstin", 15).toUpperCase();
  const pan = field(form, "pan", 10).toUpperCase();
  const contact = { name: field(form, "contactName", 120), email: field(form, "contactEmail").toLowerCase(), phone: field(form, "contactPhone", 30), designation: field(form, "contactDesignation", 80) };
  const managerId = field(form, "accountManagerId") || s.userId;

  if (!displayName) return { error: "Enter the client's name." };
  const invalid = taxError(gstin, pan, field(form, "state", 80));
  if (invalid) return { error: invalid };
  if (!contact.name) return { error: "Add a primary contact." };
  if (contact.email && !EMAIL.test(contact.email)) return { error: "Enter a valid contact email." };
  if (!(await isStaffMember(s, managerId))) return { error: "Pick an account manager from your team." };

  // Client, primary contact and the link between them commit together (§16.7).
  const client = await tx(async () => {
    const code = `CL-${String(await nextNumber(s.orgId, "client", () => Client.countDocuments({ organizationId: s.orgId }))).padStart(4, "0")}`;
    const [c] = await Client.insertMany([{
      organizationId: s.orgId, clientCode: code, clientType: type, displayName, accountManagerId: managerId,
      ...(type === "organization"
        ? { organizationDetails: { legalName: field(form, "legalName", 160) || displayName, gstin: gstin || undefined, pan: pan || undefined, cin: field(form, "cin", 21).toUpperCase() || undefined } }
        : { individualDetails: { firstName: contact.name.split(" ")[0], lastName: contact.name.split(" ").slice(1).join(" "), pan: pan || undefined } }),
      billingAddress: { city: field(form, "city", 80), state: field(form, "state", 80), country: field(form, "country", 80) || "India" },
    }]);
    const [primary] = await ClientContact.insertMany([{ organizationId: s.orgId, clientId: c._id, ...contact, isPrimary: true }]);
    c.primaryContactId = primary._id;
    await c.save();
    await audit(s, "client.created", "client", c._id, undefined, { code, displayName });
    return c;
  });
  refresh();
  return { clientId: String(client._id) };
}

// Archiving (§17): hidden from active lists and read-only, never deleted; restore anytime.
// A client can only be archived once all of its projects are archived, so no open work is orphaned.
export async function archiveClient(clientId: string, archived: boolean) {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "clients.update") || !isValidObjectId(clientId)) return { error: "You can't archive this client." };
  const client = await Client.findOne({ _id: clientId, organizationId: s.orgId });
  if (!client) return { error: "Client not found." };
  if (archived) {
    const open = await Project.countDocuments({ organizationId: s.orgId, clientId: client._id, status: { $ne: "archived" } });
    if (open) return { error: `Archive this client's ${open} open project${open > 1 ? "s" : ""} first.` };
  }
  const before = { status: client.status };
  client.status = archived ? "archived" : "active";
  await client.save();
  await audit(s, archived ? "client.archived" : "client.restored", "client", client._id, before, { status: client.status, displayName: client.displayName });
  refresh();
  return {};
}

export async function archiveProject(projectId: string, archived: boolean) {
  const s = await requireSession();
  if (!s.isStaff || !isValidObjectId(projectId) || !atLeast(await projectAccess(s, projectId, { ignoreArchive: true }), "manage")) {
    return { error: "Only the project's managers can archive it." };
  }
  const project = await Project.findOne({ _id: projectId, organizationId: s.orgId });
  if (!project) return { error: "Project not found." };
  if (!archived && (await Client.exists({ _id: project.clientId, status: "archived" }))) return { error: "Restore the client first." };
  const before = { status: project.status };
  project.status = archived ? "archived" : "active";
  project.archivedAt = archived ? new Date() : undefined; // document retention counts from here (§17)
  await project.save();
  await audit(s, archived ? "project.archived" : "project.restored", "project", project._id, before, { status: project.status, name: project.name });
  refresh();
  return {};
}

const contactFields = (form: FormData) => ({
  name: field(form, "name", 120), email: field(form, "email").toLowerCase(), phone: field(form, "phone", 30), designation: field(form, "designation", 80),
});

async function editableClient(s: S, clientId: string) {
  if (!s.isStaff || !can(s, "clients.update") || !isValidObjectId(clientId)) return null;
  return Client.findOne({ _id: clientId, organizationId: s.orgId });
}

export async function updateClient(clientId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const client = await editableClient(s, clientId);
  if (!client) return { error: "You can't edit this client." };

  const displayName = field(form, "displayName", 120);
  const gstin = field(form, "gstin", 15).toUpperCase();
  const pan = field(form, "pan", 10).toUpperCase();
  if (!displayName) return { error: "Enter the client's name." };
  const invalid = taxError(gstin, pan, field(form, "state", 80));
  if (invalid) return { error: invalid };

  const before = client.toObject();
  client.displayName = displayName;
  if (client.clientType === "organization") {
    client.set("organizationDetails.gstin", gstin || undefined);
    client.set("organizationDetails.pan", pan || undefined);
  } else {
    client.set("individualDetails.pan", pan || undefined);
  }
  client.set("billingAddress.city", field(form, "city", 80));
  client.set("billingAddress.state", field(form, "state", 80));
  await client.save();
  await audit(s, "client.updated", "client", client._id,
    { displayName: before.displayName, billingAddress: before.billingAddress, organizationDetails: before.organizationDetails, individualDetails: before.individualDetails },
    { displayName, billingAddress: client.billingAddress, organizationDetails: client.organizationDetails, individualDetails: client.individualDetails });
  refresh();
  return {};
}

// Add (no contactId) or edit a contact. Making one primary demotes the rest; the primary can't be un-made directly.
export async function saveContact(clientId: string, contactId: string | undefined, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const client = await editableClient(s, clientId);
  if (!client) return { error: "You don't have permission to edit this client." };
  const existing = contactId && isValidObjectId(contactId)
    ? await ClientContact.findOne({ _id: contactId, organizationId: s.orgId, clientId: client._id, status: "active" })
    : null;
  if (contactId && !existing) return { error: "Contact not found." };

  const contact = contactFields(form);
  const primary = form.get("primary") === "on" || !!existing?.isPrimary;
  if (!contact.name) return { error: "Enter the contact's name." };
  if (contact.email && !EMAIL.test(contact.email)) return { error: "Enter a valid email." };

  await tx(async () => {
    if (primary) await ClientContact.updateMany({ organizationId: s.orgId, clientId: client._id, _id: { $ne: existing?._id } }, { isPrimary: false });
    let saved;
    if (existing) {
      existing.set({ ...contact, isPrimary: primary });
      saved = await existing.save();
    } else {
      [saved] = await ClientContact.insertMany([{ organizationId: s.orgId, clientId: client._id, ...contact, isPrimary: primary }]);
    }
    if (primary) {
      client.primaryContactId = saved._id;
      await client.save();
    }
    await audit(s, existing ? "client.contact_updated" : "client.contact_added", "client", client._id, undefined, { contact: contact.name });
  });
  refresh();
  return {};
}

export async function removeContact(clientId: string, contactId: string): Promise<Result> {
  const s = await requireSession();
  const client = await editableClient(s, clientId);
  if (!client || !isValidObjectId(contactId)) return { error: "You don't have permission to edit this client." };
  const contact = await ClientContact.findOne({ _id: contactId, organizationId: s.orgId, clientId: client._id, status: "active" });
  if (!contact) return { error: "Contact not found." };
  if (contact.isPrimary) return { error: "Make someone else the primary contact first." };
  // Soft delete: past messages and invites still point at this record.
  contact.status = "inactive";
  await contact.save();
  await audit(s, "client.contact_removed", "client", client._id, { contact: contact.name }, undefined);
  refresh();
  return {};
}

export async function createProject(_: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!s.isStaff || !can(s, "projects.create")) return { error: "You don't have permission to create projects." };

  const clientId = field(form, "clientId");
  const name = field(form, "name", 120);
  const category = field(form, "category", 60);
  const managerId = field(form, "projectManagerId") || s.userId;
  const templateId = field(form, "workflowTemplateId");
  const start = field(form, "startDate", 10);
  const end = field(form, "expectedEndDate", 10);

  if (!name) return { error: "Enter a project name." };
  if (!DATE.test(start)) return { error: "Pick a start date." };
  if (end && (!DATE.test(end) || end < start)) return { error: "The end date must be after the start date." };
  const [client, template] = await Promise.all([
    isValidObjectId(clientId) ? Client.findOne({ _id: clientId, organizationId: s.orgId }).lean() : null,
    isValidObjectId(templateId) ? WorkflowTemplate.findOne({ _id: templateId, organizationId: s.orgId, status: "published" }).lean() : null,
  ]);
  if (!client || client.status === "archived") return { error: "Pick an active client." };
  if (!template?.currentPublishedVersionId) return { error: "Pick a published workflow." };
  if (!(await isStaffMember(s, managerId))) return { error: "Pick a project manager from your team." };
  const version = await WorkflowVersion.findOne({ _id: template.currentPublishedVersionId, organizationId: s.orgId, status: "published" }).lean();
  if (!version?.definition?.phases.length) return { error: "That workflow has no phases." };

  const startDate = new Date(`${start}T09:00:00`);
  const due = (days?: number | null) => (days == null ? undefined : new Date(startDate.getTime() + days * 86_400_000));

  // The project and everything it needs to run commit together (§16.7).
  const projectId = await tx(async () => {
    const n = await nextNumber(s.orgId, `project:${client._id}`, () => Project.countDocuments({ organizationId: s.orgId, clientId: client._id }));
    const [project] = await Project.insertMany([{
      organizationId: s.orgId, projectCode: `${client.clientCode}-${n}`, clientId: client._id, name, category: category || template.category,
      description: field(form, "description", 1000), projectManagerId: managerId, startDate, expectedEndDate: end ? new Date(`${end}T18:00:00`) : undefined,
    }]);
    const scope = { organizationId: s.orgId, projectId: project._id };
    await ProjectMember.insertMany(
      // The project manager manages it; the creator (if someone else) can edit.
      [...new Set([managerId, s.userId])].map((userId) => ({ ...scope, userId, role: userId === managerId ? "manager" : "member", accessLevel: userId === managerId ? "manage" : "edit" })),
    );

    // Instantiate the published workflow version; each phase snapshots its rules (§8.4).
    const [wf] = await ProjectWorkflow.insertMany([{ ...scope, workflowTemplateId: template._id, workflowVersionId: version._id, startedAt: startDate }]);
    const phases = await PhaseInstance.insertMany(
      version.definition!.phases.map((p, i) => ({
        ...scope, workflowInstanceId: wf._id, phaseKey: p.key, phaseName: p.name, sequence: i + 1,
        status: i === 0 ? "active" : "pending", startedAt: i === 0 ? startDate : undefined,
        completionConditionsSnapshot: p.completion, assignedUserIds: [managerId],
      })),
    );
    wf.currentPhaseInstanceId = phases[0]._id;
    await wf.save();

    const tasks = version.definition!.phases.flatMap((p, i) =>
      (p.tasks ?? []).map((t) => ({
        ...scope, phaseInstanceId: phases[i]._id, title: t.title, isMandatory: !!t.mandatory, dueDate: due(t.dueInDays),
        // Client tasks wait unassigned until the client accepts their invite.
        assignedTo: t.assignee === "manager" ? managerId : undefined,
      })),
    );
    if (tasks.length) await Task.insertMany(tasks);

    // Document requirements from every template matching this client type and category (§10.3).
    const projectCategory = project.category ?? "";
    const docTemplates = await DocumentTemplate.find({
      organizationId: s.orgId, status: "active",
      $and: [
        { $or: [{ clientTypes: { $size: 0 } }, { clientTypes: client.clientType }] },
        { $or: [{ projectCategories: { $size: 0 } }, { projectCategories: projectCategory }] },
      ],
    }).lean();
    const requirements = docTemplates.flatMap((t) =>
      t.requirements.map((r) => ({
        ...scope, clientId: client._id, documentTypeId: r.documentTypeId, isMandatory: r.isMandatory ?? true,
        phaseInstanceId: phases.find((p) => p.phaseKey === r.phaseKey)?._id ?? phases[0]._id, dueDate: due(7),
      })),
    );
    if (requirements.length) await DocumentRequirement.insertMany(requirements);

    await CommunicationThread.insertMany([{ ...scope, clientId: client._id, subject: name, participants: [managerId] }]);
    await audit(s, "project.created", "project", project._id, undefined, { code: project.projectCode, name });
    return String(project._id);
  });
  return { projectId };
}
