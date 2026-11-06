import "server-only";
import mongoose, { type Types } from "mongoose";
import { AREAS, areaOf, changes, describe, isArea, linkFor } from "./activity";
import { financialYear } from "./money";
import { raiseDue } from "./schedules";
import { can, permissionKeys, sha256, type Session } from "./session";
import {
  AuditLog, Client, ClientContact, CommunicationThread, Document, DocumentRequirement, DocumentType, DocumentVersion, Invitation, Membership, Message, Organization,
  Permission, PhaseInstance, Project, ProjectMember, ProjectWorkflow, Role, RolePermission, Task, TaskComment, User, WorkflowTemplate,
  CreditNote, DebitNote, Invoice, InvoiceDraft, InvoiceSequence, Notification, PaymentSchedule, Payment, PaymentAllocation, PaymentMethod, Refund,
} from "./models";

type S = NonNullable<Session>;
type Id = Types.ObjectId | string;

const name = (u?: { firstName: string; lastName?: string | null } | null) =>
  u ? `${u.firstName} ${u.lastName ?? ""}`.trim() : "Unknown";
const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const same = (a: unknown, b: unknown) => String(a) === String(b);

// Every read is scoped by organizationId. Roles alone don't grant project access (§6.4):
// without projects.view_all you only see projects you're an active member of.
async function projectIds(s: S) {
  if (s.isStaff && can(s, "projects.view_all")) return null;
  const rows = await ProjectMember.find({ organizationId: s.orgId, userId: s.userId, status: "active" }).lean();
  return rows.map((r) => r.projectId);
}

// §6.4 Project access levels. Effective rights = role permission AND project access level.
export type Access = "view" | "edit" | "manage";
const RANK: Record<Access, number> = { view: 1, edit: 2, manage: 3 };
export const atLeast = (a: Access | null | undefined, need: Access) => !!a && RANK[a] >= RANK[need];
// Records created before access levels existed: project managers manage, everyone else edits.
export const levelOf = (m: { accessLevel?: string | null; role?: string | null }): Access =>
  (m.accessLevel as Access | undefined) ?? (m.role === "manager" ? "manage" : "edit");

// Archived projects are read-only for everyone (§17); `ignoreArchive` is only for restoring one.
export async function projectAccess(s: S, projectId: Id, { ignoreArchive = false } = {}): Promise<Access | null> {
  const project = mongoose.isValidObjectId(projectId) ? await Project.findOne({ _id: projectId, organizationId: s.orgId }).lean() : null;
  if (!project) return null;
  // Org-wide admins (projects.view_all) manage every project.
  const m = s.isStaff && can(s, "projects.view_all") ? null : await ProjectMember.findOne({ organizationId: s.orgId, projectId, userId: s.userId, status: "active" }).lean();
  const level: Access | null = s.isStaff && can(s, "projects.view_all") ? "manage" : m ? levelOf(m) : null;
  return level && project.status === "archived" && !ignoreArchive ? "view" : level;
}

export async function canAccessProject(s: S, projectId: Id, need: Access = "view") {
  return atLeast(await projectAccess(s, projectId), need);
}

export async function listProjects(s: S) {
  const ids = await projectIds(s);
  const projects = await Project.find({ organizationId: s.orgId, ...(ids && { _id: { $in: ids } }) })
    .sort({ createdAt: 1 })
    .lean();
  const [clients, counts] = await Promise.all([
    Client.find({ organizationId: s.orgId, _id: { $in: projects.map((p) => p.clientId) } }).lean(),
    Task.aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
      { $match: { organizationId: new mongoose.Types.ObjectId(s.orgId), projectId: { $in: projects.map((p) => p._id) } } },
      { $group: { _id: "$projectId", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } } } },
    ]),
  ]);
  return projects.map((p) => {
    const c = counts.find((x) => same(x._id, p._id));
    return {
      id: String(p._id),
      name: p.name,
      code: p.projectCode,
      clientName: clients.find((x) => same(x._id, p.clientId))?.displayName ?? "",
      progress: c?.total ? c.done / c.total : 0,
      status: p.status ?? "active",
      archived: p.status === "archived",
      category: p.category ?? "",
    };
  });
}

export async function getProjectView(s: S, projectId: string) {
  const access = await projectAccess(s, projectId);
  if (!access) return null;
  const scope = { organizationId: s.orgId, projectId };
  const [project, phases, tasks, docs, thread, requirements, workflow] = await Promise.all([
    Project.findById(projectId).lean(),
    PhaseInstance.find(scope).sort({ sequence: 1 }).lean(),
    Task.find(scope).sort({ dueDate: 1 }).lean(),
    Document.find({ ...scope, ...(!s.isStaff && { visibility: "client" }) }).sort({ updatedAt: -1 }).lean(),
    CommunicationThread.findOne(scope).lean(),
    DocumentRequirement.find(scope).lean(),
    ProjectWorkflow.findOne(scope).lean(),
  ]);
  if (!project) return null;

  const [client, versions, messages, members, types, comments] = await Promise.all([
    Client.findById(project.clientId).lean(),
    DocumentVersion.find({ organizationId: s.orgId, _id: { $in: docs.map((d) => d.currentVersionId) } }).lean(),
    thread
      ? Message.find({ organizationId: s.orgId, threadId: thread._id, ...(!s.isStaff && { visibility: "client" }) })
          .sort({ createdAt: 1 })
          .lean()
      : [],
    ProjectMember.find({ ...scope, status: "active" }).lean(),
    DocumentType.find({ organizationId: s.orgId, _id: { $in: requirements.map((r) => r.documentTypeId) } }).lean(),
    TaskComment.find({ organizationId: s.orgId, taskId: { $in: tasks.map((t) => t._id) }, ...(!s.isStaff && { visibility: "client" }) }).sort({ createdAt: 1 }).lean(),
  ]);
  const people = await User.find({
    _id: { $in: [...messages.map((m) => m.senderId), ...members.map((m) => m.userId), ...comments.map((c) => c.authorId), ...tasks.map((t) => t.assignedTo), project.projectManagerId] },
  }).lean();
  const person = (uid?: Id | null) => people.find((p) => same(p._id, uid));

  // Who "the other side" is: the account manager for clients, the client contact for staff.
  const counterpart = person(s.isStaff ? members.find((m) => m.role === "client")?.userId : project.projectManagerId);
  const onboarding = phases.find((p) => p.phaseKey === "onboarding");

  const toTask = (t: (typeof tasks)[number]) => ({
    id: String(t._id),
    title: t.title,
    description: t.description ?? "",
    status: t.status,
    dueDate: iso(t.dueDate),
    mine: same(t.assignedTo, s.userId),
    mandatory: !!t.isMandatory,
    priority: t.priority ?? "medium",
    dependsOn: (t.dependencies ?? []).map(String),
    // Open tasks this one waits on; it can't be completed until they are.
    blockedBy: tasks.filter((d) => (t.dependencies ?? []).some((x) => same(x, d._id)) && d.status !== "completed").map((d) => d.title),
    assignee: t.assignedTo ? name(person(t.assignedTo)) : null,
    comments: comments.filter((c) => same(c.taskId, t._id)).map((c) => ({
      id: String(c._id), author: name(person(c.authorId)), mine: same(c.authorId, s.userId), message: c.message, internal: c.visibility === "internal", at: iso(c.createdAt)!,
    })),
  });

  return {
    id: String(project._id),
    name: project.name,
    clientId: String(project.clientId),
    clientName: client?.displayName ?? "",
    access,
    archived: project.status === "archived",
    category: project.category ?? "",
    description: project.description ?? "",
    // Every task in the project, for picking dependencies.
    allTasks: tasks.map((t) => ({ id: String(t._id), title: t.title })),
    counterpart: { name: name(counterpart), firstName: counterpart?.firstName ?? "" },
    tasks: tasks.filter((t) => !same(t.phaseInstanceId, onboarding?._id)).map(toTask),
    onboarding: tasks.filter((t) => same(t.phaseInstanceId, onboarding?._id)).map(toTask),
    phases: phases.map((p) => ({
      id: String(p._id),
      name: p.phaseName ?? p.phaseKey,
      status: p.status,
      current: same(p._id, workflow?.currentPhaseInstanceId),
    })),
    workflowStatus: workflow?.status ?? null,
    requirements: requirements.map((r) => {
      const t = types.find((x) => same(x._id, r.documentTypeId));
      return {
        id: String(r._id),
        name: t?.name ?? "Document",
        accept: t?.allowedExtensions?.map((e) => `.${e}`).join(",") ?? "",
        mandatory: r.isMandatory,
        status: r.status,
      };
    }),
    files: docs.flatMap((d) => {
      const v = versions.find((x) => same(x._id, d.currentVersionId));
      return v
        ? [{ id: String(d._id), name: v.originalFileName, size: v.fileSizeBytes ?? 0, mime: v.mimeType ?? "", status: d.status, version: v.version }]
        : [];
    }),
    messages: messages.map((m) => ({
      id: String(m._id),
      text: m.message,
      at: iso(m.createdAt)!,
      mine: same(m.senderId, s.userId),
      sender: { name: name(person(m.senderId)) },
    })),
  };
}

export async function reviewQueue(s: S) {
  if (!s.isStaff || !can(s, "documents.approve")) return [];
  // Only projects where they can act on it: approving needs edit access (§6.4).
  const ids = can(s, "projects.view_all")
    ? null
    : (await ProjectMember.find({ organizationId: s.orgId, userId: s.userId, status: "active" }).lean()).filter((m) => atLeast(levelOf(m), "edit")).map((m) => m.projectId);
  const docs = await Document.find({ organizationId: s.orgId, status: "pending_review", ...(ids && { projectId: { $in: ids } }) })
    .sort({ updatedAt: 1 })
    .limit(20)
    .lean();
  const [versions, clients] = await Promise.all([
    DocumentVersion.find({ organizationId: s.orgId, _id: { $in: docs.map((d) => d.currentVersionId) } }).lean(),
    Client.find({ organizationId: s.orgId, _id: { $in: docs.map((d) => d.clientId) } }).lean(),
  ]);
  return docs.map((d) => {
    const v = versions.find((x) => same(x._id, d.currentVersionId));
    return {
      id: String(d._id),
      name: v?.originalFileName ?? "Untitled",
      size: v?.fileSizeBytes ?? 0,
      version: v?.version ?? 1,
      clientName: clients.find((c) => same(c._id, d.clientId))?.displayName ?? "",
      projectId: String(d.projectId),
    };
  });
}

export type ProjectView = NonNullable<Awaited<ReturnType<typeof getProjectView>>>;
export type ProjectSummary = Awaited<ReturnType<typeof listProjects>>[number];
export type ReviewItem = Awaited<ReturnType<typeof reviewQueue>>[number];
export type TaskItem = ProjectView["tasks"][number];
export type Requirement = ProjectView["requirements"][number];

// ---- Invitations (§3.2)

// Roles the inviter may grant: only those whose permissions they already hold (no privilege escalation).
export async function grantableRoles(s: S) {
  const roles = await Role.find({ organizationId: s.orgId, status: "active" }).sort({ name: 1 }).lean();
  const checked = await Promise.all(
    roles.map(async (r) => ({ r, keys: await permissionKeys(s.orgId, [r._id]) })),
  );
  return checked.filter(({ keys }) => keys.every((k) => s.permissions.includes(k))).map(({ r, keys }) => ({ id: String(r._id), name: r.name, permissions: keys.length }));
}

export async function inviteOptions(s: S) {
  if (!s.isStaff || !can(s, "members.invite")) return null;
  const [roles, invites] = await Promise.all([
    grantableRoles(s),
    Invitation.find({ organizationId: s.orgId, status: "pending", expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const [projects, roleNames] = await Promise.all([
    Project.find({ organizationId: s.orgId, _id: { $in: invites.map((i) => i.projectId) } }).lean(),
    Role.find({ organizationId: s.orgId, _id: { $in: invites.flatMap((i) => i.roleIds) } }).lean(),
  ]);
  return {
    roles,
    invites: invites.map((i) => ({
      id: String(i._id),
      email: i.email,
      type: i.membershipType,
      role: roleNames.filter((r) => i.roleIds.some((x) => same(x, r._id))).map((r) => r.name).join(", "),
      project: projects.find((p) => same(p._id, i.projectId))?.name ?? null,
      daysLeft: Math.max(1, Math.ceil((i.expiresAt.getTime() - Date.now()) / 86_400_000)),
    })),
  };
}

// Public lookup for the accept page: the token itself is the credential.
export async function getInvite(token: string) {
  const i = await Invitation.findOne({ tokenHash: sha256(token), status: "pending", expiresAt: { $gt: new Date() } }).lean();
  if (!i) return null;
  const [org, project, existing] = await Promise.all([
    Organization.findById(i.organizationId).lean(),
    i.projectId ? Project.findById(i.projectId).lean() : null,
    User.exists({ email: i.email }),
  ]);
  return { email: i.email, orgName: org?.name ?? "", projectName: project?.name ?? null, existingUser: !!existing };
}

export type InviteOptions = NonNullable<Awaited<ReturnType<typeof inviteOptions>>>;

// ---- Clients and projects (§7)

// Choices for the "New client / New project" forms.
export async function createOptions(s: S) {
  if (!s.isStaff || !(can(s, "clients.create") || can(s, "projects.create"))) return null;
  const [members, clients, templates] = await Promise.all([
    Membership.find({ organizationId: s.orgId, membershipType: "employee", status: "active" }).lean(),
    Client.find({ organizationId: s.orgId, status: "active" }).sort({ displayName: 1 }).lean(),
    WorkflowTemplate.find({ organizationId: s.orgId, status: "published", currentPublishedVersionId: { $ne: null } }).sort({ name: 1 }).lean(),
  ]);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
  return {
    canCreateClient: can(s, "clients.create"),
    canCreateProject: can(s, "projects.create"),
    staff: users.map((u) => ({ id: String(u._id), name: name(u) })),
    clients: clients.map((c) => ({ id: String(c._id), name: c.displayName })),
    templates: templates.map((t) => ({ id: String(t._id), name: t.name, category: t.category ?? "" })),
  };
}

export async function clientDetail(s: S, clientId: string) {
  if (!s.isStaff) return null;
  const [c, contacts] = await Promise.all([
    Client.findOne({ _id: clientId, organizationId: s.orgId }).lean(),
    ClientContact.find({ organizationId: s.orgId, clientId, status: "active" }).sort({ isPrimary: -1, name: 1 }).lean(),
  ]);
  if (!c) return null;
  const tax = c.clientType === "organization" ? c.organizationDetails : c.individualDetails;

  // Portal access per contact email: already a member, or a pending invite.
  const emails = contacts.map((x) => x.email).filter((e): e is string => !!e);
  const [invited, users] = await Promise.all([
    Invitation.find({ organizationId: s.orgId, email: { $in: emails }, status: "pending", expiresAt: { $gt: new Date() } }).lean(),
    User.find({ email: { $in: emails } }).lean(),
  ]);
  const members = await Membership.find({ organizationId: s.orgId, userId: { $in: users.map((u) => u._id) }, status: "active" }).lean();
  const access = (email?: string | null) =>
    !email ? null
    : members.some((m) => users.some((u) => u.email === email && same(u._id, m.userId))) ? ("member" as const)
    : invited.some((i) => i.email === email) ? ("invited" as const)
    : null;
  return {
    id: String(c._id),
    name: c.displayName,
    code: c.clientCode,
    type: c.clientType,
    gstin: c.organizationDetails?.gstin ?? null,
    pan: tax?.pan ?? null,
    city: [c.billingAddress?.city, c.billingAddress?.state].filter(Boolean).join(", ") || null,
    address: { city: c.billingAddress?.city ?? "", state: c.billingAddress?.state ?? "" },
    canEdit: can(s, "clients.update"),
    canInvite: can(s, "members.invite"),
    archived: c.status === "archived",
    contacts: contacts.map((x) => ({
      id: String(x._id), name: x.name, designation: x.designation ?? "", email: x.email ?? "", phone: x.phone ?? "", primary: !!x.isPrimary,
      access: access(x.email),
    })),
  };
}

// Organizations this user can switch to, for the account menu.
export async function myOrgs(s: S) {
  const ms = await Membership.find({ userId: s.userId, status: "active" }).lean();
  const orgs = await Organization.find({ _id: { $in: ms.map((m) => m.organizationId) }, status: { $in: ["active", "trial"] } }).lean();
  return ms.flatMap((m) => {
    const o = orgs.find((x) => same(x._id, m.organizationId));
    return o ? [{ membershipId: String(m._id), name: o.name, current: String(m._id) === s.membershipId }] : [];
  });
}

export type OrgOption = Awaited<ReturnType<typeof myOrgs>>[number];
export type CreateOptions = NonNullable<Awaited<ReturnType<typeof createOptions>>>;
export type ClientDetail = NonNullable<Awaited<ReturnType<typeof clientDetail>>>;

// ---- Billing (§11)

// Clients see their own project's billing; staff need a finance permission.
const seesBilling = (s: S) => !s.isStaff || can(s, "invoices.issue") || can(s, "payments.verify");

export async function billing(s: S, projectId: string) {
  const access = await projectAccess(s, projectId);
  if (!seesBilling(s) || !access) return null;
  const edits = atLeast(access, "edit");
  await raiseDue(s.orgId, projectId); // milestones whose date has passed become due (§11.2)
  const scope = { organizationId: s.orgId, projectId };
  const [invoices, payments, methods] = await Promise.all([
    Invoice.find(scope).sort({ invoiceDate: -1 }).lean(),
    Payment.find(scope).sort({ transactionDate: -1, createdAt: -1 }).lean(),
    PaymentMethod.find({ organizationId: s.orgId, status: "active" }).sort({ name: 1 }).lean(),
  ]);
  const staffView = s.isStaff;
  const [drafts, schedules, openPhases] = staffView
    ? await Promise.all([
        InvoiceDraft.find(scope).sort({ createdAt: -1 }).lean(),
        PaymentSchedule.find(scope).sort({ createdAt: 1 }).lean(),
        PhaseInstance.find({ ...scope, status: { $ne: "completed" } }).sort({ sequence: 1 }).lean(),
      ])
    : [[], [], []];
  const [refunds, org, project] = await Promise.all([
    Refund.find({ organizationId: s.orgId, paymentId: { $in: payments.map((p) => p._id) } }).lean(),
    Organization.findById(s.orgId).lean(),
    Project.findById(projectId).lean(),
  ]);
  const client = project && (await Client.findById(project.clientId).lean());
  const phasesById = new Map(
    (await PhaseInstance.find({ organizationId: s.orgId, _id: { $in: schedules.map((x) => x.phaseInstanceId).filter(Boolean) } }).lean()).map((p) => [String(p._id), p.phaseName ?? p.phaseKey]),
  );
  const sellerState = org?.address?.state?.trim().toLowerCase();
  const now = Date.now();
  return {
    canIssue: edits && s.isStaff && can(s, "invoices.issue"),
    canVerify: edits && s.isStaff && can(s, "payments.verify"),
    canSubmit: edits && !s.isStaff && can(s, "payments.submit"),
    // Mirrors issueInvoice so the form's live total matches what gets issued.
    intraState: !!sellerState && sellerState === client?.billingAddress?.state?.trim().toLowerCase(),
    outstanding: invoices.reduce((t, i) => t + i.outstandingAmount, 0),
    overdue: invoices.filter((i) => i.outstandingAmount > 0 && i.dueDate.getTime() < now).reduce((t, i) => t + i.outstandingAmount, 0),
    paid: invoices.reduce((t, i) => t + i.amountPaid, 0),
    credit: payments.reduce((t, p) => t + p.unappliedAmount, 0),
    methods: methods.map((m) => ({ id: String(m._id), name: m.name })),
    agreedValue: project?.financialSettings?.agreedValue ?? null,
    drafts: drafts.map((d) => ({
      id: String(d._id), note: d.note ?? "", due: d.dueDate ? iso(d.dueDate)!.slice(0, 10) : "",
      lines: d.lines.map((l) => ({ description: l.description ?? "", quantity: l.quantity ?? "1", unitPrice: l.unitPrice ?? "", rate: String(l.rate ?? 1800), discount: l.discount ?? "" })),
    })),
    schedules: schedules.map((sch) => {
      const inv = invoices.find((i) => same(i._id, sch.invoiceId));
      return {
        id: String(sch._id), title: sch.title, calculationType: sch.calculationType, amount: sch.amount, triggerType: sch.triggerType,
        when: sch.triggerType === "date" ? iso(sch.dueDate) : sch.triggerType === "phase_completion" ? (phasesById.get(String(sch.phaseInstanceId)) ?? "a phase") : null,
        // Paid once its invoice is fully paid; otherwise the stored state.
        status: inv?.status === "paid" ? "paid" : sch.status, invoiceNumber: inv?.invoiceNumber ?? null, hasDraft: !!sch.draftId,
      };
    }),
    phases: openPhases.map((p) => ({ id: String(p._id), name: p.phaseName ?? p.phaseKey })),
    invoices: invoices.map((i) => ({
      id: String(i._id), number: i.invoiceNumber, date: iso(i.invoiceDate)!, due: iso(i.dueDate)!, total: i.grandTotal + i.debitTotal - i.creditTotal,
      outstanding: i.outstandingAmount, status: i.status, overdue: i.outstandingAmount > 0 && i.dueDate.getTime() < now,
    })),
    payments: payments.map((p) => ({
      id: String(p._id), reference: p.paymentReference, date: iso(p.transactionDate)!, amount: p.amount, unapplied: p.unappliedAmount,
      method: methods.find((m) => same(m._id, p.paymentMethodId))?.name ?? "Payment", externalId: p.externalTransactionId ?? null,
      status: p.verificationStatus, hasProof: !!p.proofStorageKey,
      refunded: refunds.filter((r) => same(r.paymentId, p._id)).reduce((t, r) => t + r.amount, 0),
    })),
  };
}

export async function invoiceDetail(s: S, invoiceId: string) {
  if (!seesBilling(s) || !mongoose.isValidObjectId(invoiceId)) return null;
  const inv = await Invoice.findOne({ _id: invoiceId, organizationId: s.orgId }).lean();
  if (!inv || !(await canAccessProject(s, inv.projectId))) return null;
  const scope = { organizationId: s.orgId, invoiceId: inv._id };
  const [allocations, credits, debits] = await Promise.all([
    PaymentAllocation.find(scope).sort({ allocatedAt: 1 }).lean(),
    CreditNote.find(scope).sort({ issuedAt: 1 }).lean(),
    DebitNote.find(scope).sort({ issuedAt: 1 }).lean(),
  ]);
  const payments = await Payment.find({ organizationId: s.orgId, _id: { $in: allocations.map((a) => a.paymentId) } }).lean();
  const note = (kind: "Credit" | "Debit") => (n: (typeof credits)[number]) => ({
    kind, number: n.noteNumber, date: iso(n.issuedAt)!, reason: n.reason, taxable: n.taxableAmount, taxComponents: n.taxComponents, total: n.total,
  });
  const snap = inv.billingSnapshot as {
    seller: { name: string; gstin?: string; address?: Record<string, string> };
    buyer: { name: string; gstin?: string; address?: Record<string, string> };
    project: { code: string; name: string };
    placeOfSupply?: string;
  };
  return {
    id: String(inv._id), projectId: String(inv.projectId), number: inv.invoiceNumber, date: iso(inv.invoiceDate)!, due: iso(inv.dueDate)!, status: inv.status,
    currency: inv.currency, seller: snap.seller, buyer: snap.buyer, project: snap.project, placeOfSupply: snap.placeOfSupply ?? null,
    items: inv.lineItemsSnapshot.map((l) => ({ description: l.description ?? "", quantity: l.quantity ?? 0, unitPrice: l.unitPrice ?? 0, taxable: l.taxableAmount ?? 0, taxComponents: l.taxComponents, total: l.total ?? 0 })),
    taxSummary: inv.taxSummary.map((t) => ({ taxType: t.taxType ?? "", rateBp: t.rateBp ?? 0, amount: t.amount ?? 0 })),
    subtotal: inv.subtotal, taxTotal: inv.taxTotal, grandTotal: inv.grandTotal, creditTotal: inv.creditTotal, debitTotal: inv.debitTotal,
    amountPaid: inv.amountPaid, outstanding: inv.outstandingAmount, overdue: inv.outstandingAmount > 0 && inv.dueDate.getTime() < Date.now(),
    // One line per payment, even when it was applied in several steps.
    payments: payments.map((p) => ({
      reference: p.paymentReference, date: iso(p.transactionDate)!,
      amount: allocations.filter((a) => same(a.paymentId, p._id)).reduce((t, a) => t + a.allocatedAmount, 0),
    })).sort((a, b) => a.date.localeCompare(b.date)),
    notes: [...credits.map(note("Credit")), ...debits.map(note("Debit"))].sort((a, b) => a.date.localeCompare(b.date)),
    canAdjust: s.isStaff && can(s, "invoices.issue") && (await canAccessProject(s, inv.projectId, "edit")),
  };
}

// Proof files are only for staff who verify payments, and the client who can see the project.
export async function paymentProof(s: S, paymentId: string) {
  if (!seesBilling(s) || !mongoose.isValidObjectId(paymentId)) return null;
  const p = await Payment.findOne({ _id: paymentId, organizationId: s.orgId }).lean();
  if (!p?.proofStorageKey || !(await canAccessProject(s, p.projectId))) return null;
  return { key: p.proofStorageKey, name: p.proofFileName ?? "receipt" };
}

export type Billing = NonNullable<Awaited<ReturnType<typeof billing>>>;
export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof invoiceDetail>>>;

// ---- Organization settings (§5.2, §11.1)

export async function orgSettings(s: S) {
  if (!s.isStaff || !can(s, "organization.update")) return null;
  const fy = financialYear(new Date());
  const [org, methods, sequences] = await Promise.all([
    Organization.findById(s.orgId).lean(),
    PaymentMethod.find({ organizationId: s.orgId }).sort({ status: 1, name: 1 }).lean(),
    InvoiceSequence.find({ organizationId: s.orgId, financialYear: fy }).lean(),
  ]);
  if (!org) return null;
  const next = (type: "invoice" | "credit_note" | "debit_note", prefix: string) => {
    const seq = sequences.find((q) => q.documentType === type);
    return `${seq?.prefix ?? prefix}/${fy}/${String((seq?.currentSequence ?? 0) + 1).padStart(4, "0")}`;
  };
  return {
    profile: {
      name: org.name, legalName: org.legalName ?? "", email: org.email ?? "", phone: org.phone ?? "",
      line1: org.address?.line1 ?? "", line2: org.address?.line2 ?? "", city: org.address?.city ?? "", state: org.address?.state ?? "", postalCode: org.address?.postalCode ?? "",
      gstin: org.taxInformation?.gstin ?? "", pan: org.taxInformation?.pan ?? "", cin: org.taxInformation?.cin ?? "",
    },
    methods: methods.map((m) => ({ id: String(m._id), name: m.name, type: m.type, active: m.status === "active" })),
    retention: {
      auditYears: org.settings?.retention?.auditYears ?? 8,
      documentYearsAfterArchive: org.settings?.retention?.documentYearsAfterArchive ?? 3,
      financialYears: org.settings?.retention?.financialYears ?? 8,
    },
    numbering: { financialYear: fy, invoice: next("invoice", "INV"), creditNote: next("credit_note", "CN"), debitNote: next("debit_note", "DN") },
  };
}

export type OrgSettings = NonNullable<Awaited<ReturnType<typeof orgSettings>>>;

// ---- Notifications (§14.2)

const ago = (ms: number, at: Date) =>
  ms < 60_000 ? "now" : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : ms < 86_400_000 ? `${Math.floor(ms / 3_600_000)}h` : ms < 7 * 86_400_000 ? `${Math.floor(ms / 86_400_000)}d`
  : at.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export async function inbox(s: S) {
  const scope = { organizationId: s.orgId, recipientUserId: s.userId, channel: "in_app" as const };
  const [items, unread] = await Promise.all([
    Notification.find(scope).sort({ createdAt: -1 }).limit(20).lean(),
    Notification.countDocuments({ ...scope, readAt: null }),
  ]);
  const now = Date.now();
  return {
    unread,
    items: items.map((n) => ({ id: String(n._id), title: n.title, message: n.message ?? "", link: n.link ?? "/", read: !!n.readAt, ago: ago(now - n.createdAt.getTime(), n.createdAt) })),
  };
}

export type Inbox = Awaited<ReturnType<typeof inbox>>;

// ---- Activity log (§14.5)

export type ActivityFilter = { area?: string; actor?: string; before?: string };

// Newest first, filtered by area and person; `before` is a cursor (createdAt_id) for older pages.
export async function activity(s: S, f: ActivityFilter, limit = 50) {
  if (!s.isStaff || !can(s, "audit.view")) return null;
  const [at, id] = (f.before ?? "").split("_");
  const cursor = at && mongoose.isValidObjectId(id) && !Number.isNaN(Date.parse(at))
    ? { $or: [{ createdAt: { $lt: new Date(at) } }, { createdAt: new Date(at), _id: { $lt: new mongoose.Types.ObjectId(id) } }] }
    : {};
  const filter = {
    organizationId: s.orgId,
    ...(isArea(f.area) && { action: new RegExp(`^(${AREAS[f.area].prefixes.join("|")})\\.`) }),
    ...(mongoose.isValidObjectId(f.actor) && { actorId: f.actor }),
    ...cursor,
  };
  const [rows, members] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean(),
    Membership.find({ organizationId: s.orgId }).lean(),
  ]);
  const page = rows.slice(0, limit);
  const users = await User.find({ _id: { $in: [...page.map((r) => r.actorId), ...members.map((m) => m.userId)] } }).lean();
  const last = page.at(-1);
  return {
    entries: page.map((r) => {
      const actor = users.find((u) => same(u._id, r.actorId));
      return {
        id: String(r._id), at: iso(r.createdAt)!, action: r.action, area: areaOf(r.action) ?? null,
        actor: r.actorId ? name(actor) : "System", actorEmail: actor?.email ?? "",
        summary: describe(r.action, r.before as Record<string, unknown>, r.after as Record<string, unknown>),
        changes: changes(r.before as Record<string, unknown>, r.after as Record<string, unknown>),
        before: r.before ?? null, after: r.after ?? null,
        link: linkFor(r.resourceType, r.resourceId ? String(r.resourceId) : null),
        resourceType: r.resourceType ?? "", resourceId: r.resourceId ? String(r.resourceId) : "",
        ipAddress: r.ipAddress ?? "", requestId: r.requestId ?? "", userAgent: r.userAgent ?? "",
      };
    }),
    next: rows.length > limit && last ? `${last.createdAt.toISOString()}_${last._id}` : null,
    people: members
      .map((m) => ({ id: String(m.userId), name: name(users.find((u) => same(u._id, m.userId))), staff: m.membershipType === "employee" }))
      .sort((a, b) => Number(b.staff) - Number(a.staff) || a.name.localeCompare(b.name)),
  };
}

export type Activity = NonNullable<Awaited<ReturnType<typeof activity>>>;

// ---- Team, roles and permissions (§6)

export async function teamSettings(s: S) {
  if (!s.isStaff || !can(s, "roles.manage")) return null;
  const [roles, perms, grants, members] = await Promise.all([
    Role.find({ organizationId: s.orgId }).sort({ status: 1, name: 1 }).lean(),
    Permission.find().sort({ module: 1, key: 1 }).lean(),
    RolePermission.find({ organizationId: s.orgId }).lean(),
    Membership.find({ organizationId: s.orgId }).lean(),
  ]);
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
  const keysOf = (roleIds: unknown[]) =>
    perms.filter((p) => grants.some((g) => same(g.permissionId, p._id) && roleIds.some((r) => same(r, g.roleId)) && roles.some((x) => same(x._id, g.roleId) && x.status === "active"))).map((p) => p.key);
  const mine = new Set(s.permissions);
  // You may manage a member only if they hold nothing you don't (mirrors the server rule).
  const within = (keys: string[]) => keys.every((k) => mine.has(k));

  return {
    permissions: [...Map.groupBy(perms, (p) => p.module ?? "other")].map(([module, items]) => ({
      module, items: items.map((p) => ({ key: p.key, description: p.description ?? p.key, mine: mine.has(p.key) })),
    })),
    roles: roles.map((r) => {
      const keys = perms.filter((p) => grants.some((g) => same(g.roleId, r._id) && same(g.permissionId, p._id))).map((p) => p.key);
      return {
        id: String(r._id), name: r.name, description: r.description ?? "", system: !!r.isSystemRole, active: r.status === "active", permissions: keys,
        members: members.filter((m) => m.status !== "suspended" && m.roleIds.some((x) => same(x, r._id))).length, editable: within(keys),
      };
    }),
    members: members
      .map((m) => {
        const u = users.find((x) => same(x._id, m.userId));
        return {
          id: String(m._id), name: name(u), email: u?.email ?? "", type: m.membershipType, status: m.status, roleId: m.roleIds[0] ? String(m.roleIds[0]) : "",
          me: String(m._id) === s.membershipId, manageable: String(m._id) !== s.membershipId && within(keysOf(m.roleIds)),
        };
      })
      .sort((a, b) => Number(b.type === "employee") - Number(a.type === "employee") || a.name.localeCompare(b.name)),
  };
}

export type TeamSettings = NonNullable<Awaited<ReturnType<typeof teamSettings>>>;

// ---- Project team (§6.4)

export async function projectTeam(s: S, projectId: string) {
  const access = await projectAccess(s, projectId);
  if (!s.isStaff || !access) return null;
  const [project, rows, staff] = await Promise.all([
    Project.findById(projectId).lean(),
    ProjectMember.find({ organizationId: s.orgId, projectId, status: "active" }).lean(),
    Membership.find({ organizationId: s.orgId, membershipType: "employee", status: "active" }).lean(),
  ]);
  const users = await User.find({ _id: { $in: [...rows.map((r) => r.userId), ...staff.map((m) => m.userId)] } }).lean();
  const person = (id: unknown) => users.find((u) => same(u._id, id));
  return {
    canManage: atLeast(access, "manage"),
    // Archiving ignores the read-only cap, so a manager can still restore an archived project.
    canArchive: atLeast(await projectAccess(s, projectId, { ignoreArchive: true }), "manage"),
    archived: project?.status === "archived",
    members: rows
      .map((r) => ({
        id: String(r._id), userId: String(r.userId), name: name(person(r.userId)), email: person(r.userId)?.email ?? "",
        client: r.role === "client", manager: same(r.userId, project?.projectManagerId), access: levelOf(r), me: same(r.userId, s.userId),
      }))
      .sort((a, b) => Number(b.manager) - Number(a.manager) || Number(a.client) - Number(b.client) || a.name.localeCompare(b.name)),
    // Teammates who could be added.
    candidates: staff
      .filter((m) => !rows.some((r) => same(r.userId, m.userId)))
      .map((m) => ({ userId: String(m.userId), name: name(person(m.userId)) })),
  };
}

export type ProjectTeam = NonNullable<Awaited<ReturnType<typeof projectTeam>>>;
