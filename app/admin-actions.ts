"use server";
import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { isValidObjectId, type Types } from "mongoose";
import { tx } from "@/lib/db";
import { appUrl, requestMeta } from "@/lib/guard";
import { sendMail } from "@/lib/mail";
import { AuditLog, Invitation, Organization, Role } from "@/lib/models";
import { requirePlatformAdmin } from "@/lib/platform";
import { provisionOrganization, slugify } from "@/lib/provision";
import { sha256 } from "@/lib/session";

// Platform admin actions. Each one is written to the affected organization's own activity log,
// so its owners can see what the platform did to their workspace.

type Result = { error?: string; link?: string; emailed?: boolean };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

async function log(orgId: Types.ObjectId, actorId: Types.ObjectId, action: string, before?: object, after?: object) {
  await AuditLog.create({ organizationId: orgId, actorId, action, resourceType: "organization", resourceId: orgId, before, after, ...(await requestMeta()) });
}

// Invites the organization's owner as its Account manager; any earlier pending owner invite stops working.
async function inviteOwner(orgId: Types.ObjectId, orgName: string, email: string, adminId: Types.ObjectId, adminName: string) {
  const role = await Role.findOne({ organizationId: orgId, name: "Account manager" }).lean();
  if (!role) return { error: "This organization has no Account manager role." };
  await Invitation.updateMany({ organizationId: orgId, membershipType: "employee", status: "pending" }, { status: "revoked" });
  const token = randomBytes(32).toString("base64url");
  await Invitation.create({
    organizationId: orgId, email, membershipType: "employee", roleIds: [role._id],
    tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedBy: adminId,
  });
  const link = `/invite/${token}`;
  const mail = await sendMail(email, `Your ${orgName} workspace on Zenova is ready`, [
    `${adminName} set up ${orgName} on Zenova, the client portal for agencies. You're its Account manager.`,
    "Set a password to get started. The link works once and expires in 7 days.",
  ], { label: "Set up your workspace", url: (await appUrl()) + link });
  // The link comes back once so the admin can share it another way if email fails.
  return { link, emailed: mail.sent };
}

export async function createOrganization(_: Result | undefined, form: FormData): Promise<Result> {
  const admin = await requirePlatformAdmin();
  const name = text(form, "name", 120);
  const email = text(form, "ownerEmail", 200).toLowerCase();
  if (name.length < 2) return { error: "Enter the organization's name." };
  if (!EMAIL.test(email)) return { error: "Enter the owner's email." };

  // Slugs are unique; add -2, -3… when the name is taken.
  const base = slugify(name);
  let slug = base;
  for (let n = 2; await Organization.exists({ slug }); n++) slug = `${base.slice(0, 36)}-${n}`;

  // The organization and its starter data commit together.
  const { org } = await tx(() => provisionOrganization(name, slug, admin.userId));
  await log(org._id, admin.userId, "organization.created", undefined, { name, slug, owner: email });
  const invite = await inviteOwner(org._id, name, email, admin.userId, admin.name);
  refresh();
  return invite;
}

export async function setOrganizationStatus(orgId: string, status: "active" | "suspended"): Promise<Result> {
  const admin = await requirePlatformAdmin();
  if (!isValidObjectId(orgId) || !["active", "suspended"].includes(status)) return { error: "Organization not found." };
  const org = await Organization.findById(orgId);
  if (!org) return { error: "Organization not found." };
  if (org.status === status) return {};
  const before = { status: org.status };
  org.status = status;
  await org.save();
  // Members are signed out on their next request: sessions check the organization's status every time.
  await log(org._id, admin.userId, status === "suspended" ? "organization.suspended" : "organization.reactivated", before, { status, name: org.name });
  refresh();
  return {};
}

export async function resendOwnerInvite(orgId: string): Promise<Result> {
  const admin = await requirePlatformAdmin();
  if (!isValidObjectId(orgId)) return { error: "Organization not found." };
  const [org, pending] = await Promise.all([
    Organization.findById(orgId).lean(),
    Invitation.findOne({ organizationId: orgId, membershipType: "employee", status: "pending" }).sort({ createdAt: -1 }).lean(),
  ]);
  if (!org || !pending) return { error: "There's no pending owner invite to resend." };
  const r = await inviteOwner(org._id, org.name, pending.email, admin.userId, admin.name);
  refresh();
  return r;
}
