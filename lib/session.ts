import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { Types } from "mongoose";
import { db } from "./db";
import { Membership, Permission, Role, RolePermission, Session as SessionModel, User } from "./models";

const COOKIE = "sid";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function permissionKeys(orgId: Types.ObjectId | string, roleIds: (Types.ObjectId | string)[]) {
  // Only active roles grant anything.
  const active = await Role.find({ organizationId: orgId, _id: { $in: roleIds }, status: "active" }).distinct("_id");
  const grants = await RolePermission.find({ organizationId: orgId, roleId: { $in: active } }).lean();
  return (await Permission.find({ _id: { $in: grants.map((g) => g.permissionId) } }).lean()).map((p) => p.key);
}

export type Session = Awaited<ReturnType<typeof getSession>>;

export async function getSession() {
  // Mongoose reads the clock; connection() defers that to request time (Cache Components).
  await connection();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  await db();

  const s = await SessionModel.findOne({ tokenHash: sha256(token), revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  if (!s) return null;
  // Membership is re-checked on every request, so suspending someone takes effect immediately.
  const [m, u] = await Promise.all([
    Membership.findOne({ _id: s.membershipId, userId: s.userId, status: "active" }).lean(),
    User.findOne({ _id: s.userId, status: "active" }).lean(),
  ]);
  if (!m || !u) return null;

  const permissions = await permissionKeys(m.organizationId, m.roleIds);

  return {
    orgId: String(m.organizationId),
    userId: String(u._id),
    membershipId: String(m._id),
    isStaff: m.membershipType === "employee",
    roleLabel: m.title ?? m.membershipType,
    permissions,
    firstName: u.firstName,
    emailNotifications: u.emailNotifications !== false,
    name: `${u.firstName} ${u.lastName ?? ""}`.trim(),
  };
}

export const can = (s: NonNullable<Session>, permission: string) => s.permissions.includes(permission);

export async function startSession(userId: Types.ObjectId, membership: { _id: Types.ObjectId; organizationId: Types.ObjectId }) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await SessionModel.create({
    userId,
    organizationId: membership.organizationId,
    membershipId: membership._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + TTL_MS),
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent")?.slice(0, 300),
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await SessionModel.updateOne({ tokenHash: sha256(token) }, { revokedAt: new Date() });
  jar.delete(COOKIE);
}
