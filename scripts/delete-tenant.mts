// §17 Verified tenant deletion. Irreversible, so it's a script, not a button.
//   npm run delete-tenant -- --slug acme                       dry run: what would be deleted
//   npm run delete-tenant -- --slug acme --confirm acme --apply delete, then verify nothing is left
// Deletes every record carrying the organization's id, its stored files, its sessions, and user accounts
// that belong to no other organization. Exits non-zero unless verification finds zero remaining records.
import mongoose from "mongoose";
import * as M from "../lib/models.ts";
import { tenantModels } from "../lib/export.ts";
import { deleteFile } from "../lib/storage.ts";

const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1];
const slug = process.argv.includes("--slug") ? arg("slug") : undefined;
const apply = process.argv.includes("--apply");
if (!slug) throw new Error("Pass --slug <organization slug>");
if (apply && arg("confirm") !== slug) throw new Error("To delete, also pass --confirm with the same slug.");

await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27037/client-portal?directConnection=true");
const db = mongoose.connection.db!;
const org = await M.Organization.findOne({ slug }).lean();
if (!org) throw new Error(`No organization with slug "${slug}".`);
const scope = { organizationId: org._id };

const collections = [...tenantModels().map((m) => m.collection.collectionName), "sessions"];
const counts = async () => Object.fromEntries(await Promise.all(collections.map(async (c) => [c, await db.collection(c).countDocuments(scope)] as const)));
const members = await M.Membership.find(scope).distinct("userId");
const otherOrgs = await M.Membership.find({ userId: { $in: members }, organizationId: { $ne: org._id } }).distinct("userId");
const orphanUsers = members.filter((u) => !otherOrgs.some((o) => String(o) === String(u)));
const files = [
  ...(await M.DocumentVersion.find(scope).select("storageKey").lean()).map((v) => v.storageKey),
  ...(await M.Payment.find({ ...scope, proofStorageKey: { $ne: null } }).select("proofStorageKey").lean()).map((p) => p.proofStorageKey!),
];

const before = await counts();
console.log(`${org.name} (${slug})`);
console.log(Object.entries(before).filter(([, n]) => n).map(([c, n]) => `  ${c}: ${n}`).join("\n"));
console.log(`  files: ${files.length}\n  user accounts only in this organization: ${orphanUsers.length}`);
if (!apply) {
  console.log("\nDry run: nothing was deleted.");
  await mongoose.disconnect();
  process.exit(0);
}

for (const key of files) await deleteFile(key);
// Raw collections on purpose: this also removes the append-only activity log, which is the point of deleting a tenant.
for (const c of collections) await db.collection(c).deleteMany(scope);
await db.collection("sessions").deleteMany({ userId: { $in: orphanUsers } });
await db.collection("users").deleteMany({ _id: { $in: orphanUsers } });
await db.collection("organizations").deleteOne({ _id: org._id });

// Verification: nothing with this organization's id may remain anywhere.
const after = await counts();
const left = Object.entries(after).filter(([, n]) => n);
const orgLeft = await db.collection("organizations").countDocuments({ _id: org._id });
const usersLeft = await db.collection("users").countDocuments({ _id: { $in: orphanUsers } });
if (left.length || orgLeft || usersLeft) {
  console.error("VERIFICATION FAILED:", { left, orgLeft, usersLeft });
  process.exit(1);
}
console.log(`\nDeleted and verified: 0 records remain for ${slug} across ${collections.length + 2} collections; ${files.length} files and ${orphanUsers.length} user accounts removed.`);
await mongoose.disconnect();
