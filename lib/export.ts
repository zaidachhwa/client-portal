import "server-only";
import mongoose, { type Types } from "mongoose";
import * as M from "./models.ts";

// §17 exports. Secrets never leave: password and token hashes are stripped, and sessions aren't exported.
const SECRET = new Set(["passwordHash", "tokenHash"]);
const clean = (doc: Record<string, unknown>) => Object.fromEntries(Object.entries(doc).filter(([k]) => !SECRET.has(k)));
const SKIP = new Set(["Session", "LoginAttempt", "Organization", "User", "Permission"]);

// Every collection owned by an organization (has an organizationId), for export and deletion.
export const tenantModels = () =>
  (Object.values(M) as unknown as mongoose.Model<unknown>[]).filter((m) => typeof m?.modelName === "string" && m.schema.path("organizationId") && !SKIP.has(m.modelName));

// Whole organization as NDJSON, one {"collection", "doc"} per line, streamed so large tenants don't sit in memory.
// ponytail: metadata only; uploaded files stay in storage (listed by storageKey). Bundle them into a zip if asked.
export function organizationExport(orgId: string) {
  const enc = new TextEncoder();
  const line = (collection: string, doc: unknown) => enc.encode(JSON.stringify({ collection, doc }) + "\n");
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const org = await M.Organization.findById(orgId).lean();
        controller.enqueue(line("organizations", org));
        const members = await M.Membership.find({ organizationId: orgId }).distinct("userId");
        for await (const u of M.User.find({ _id: { $in: members } }).lean().cursor()) controller.enqueue(line("users", clean(u)));
        controller.enqueue(line("permissions", await M.Permission.find().lean()));
        for (const m of tenantModels()) {
          for await (const doc of m.find({ organizationId: orgId }).lean().cursor()) controller.enqueue(line(m.collection.collectionName, clean(doc as Record<string, unknown>)));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

// Everything about one person (§17 user data export): who they are and what they did.
export async function userExport(userId: Types.ObjectId | string) {
  const by = { $in: [new mongoose.Types.ObjectId(String(userId))] };
  const [user, memberships, messages, comments, uploads, payments, notifications, activity] = await Promise.all([
    M.User.findById(userId).lean(),
    M.Membership.find({ userId }).lean(),
    M.Message.find({ senderId: by }).lean(),
    M.TaskComment.find({ authorId: by }).lean(),
    M.DocumentVersion.find({ uploadedBy: by }).select("-storageKey").lean(),
    M.Payment.find({ submittedBy: by }).select("-proofStorageKey").lean(),
    M.Notification.find({ recipientUserId: by }).lean(),
    M.AuditLog.find({ actorId: by }).lean(),
  ]);
  const orgs = await M.Organization.find({ _id: { $in: memberships.map((m) => m.organizationId) } }).select("name slug").lean();
  return {
    exportedAt: new Date().toISOString(),
    user: user && clean(user as Record<string, unknown>),
    organizations: orgs,
    memberships, messages, taskComments: comments, documentUploads: uploads, paymentsReported: payments, notifications, activity,
  };
}
