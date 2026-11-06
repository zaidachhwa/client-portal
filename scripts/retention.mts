// §17 Retention job. Dry run by default; pass --apply to delete.
//   npm run retention            report what each organization's policy would remove
//   npm run retention -- --apply remove it
// Removes: activity-log entries older than the policy, and documents (files included) of projects archived
// longer than the policy. Never removes financial records; it only reports how many are past the minimum.
import mongoose from "mongoose";
import * as M from "../lib/models.ts";
import { deleteFile } from "../lib/storage.ts";

const apply = process.argv.includes("--apply");
const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 86_400_000);

await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27037/client-portal?directConnection=true");
const db = mongoose.connection.db!;

for (const org of await M.Organization.find().lean()) {
  const policy = { auditYears: 8, documentYearsAfterArchive: 3, financialYears: 8, ...org.settings?.retention };
  const scope = { organizationId: org._id };

  const auditFilter = { ...scope, createdAt: { $lt: yearsAgo(policy.auditYears) } };
  const projects = await M.Project.find({ ...scope, status: "archived", archivedAt: { $lt: yearsAgo(policy.documentYearsAfterArchive) } }).distinct("_id");
  const docs = await M.Document.find({ ...scope, projectId: { $in: projects } }).distinct("_id");
  const versions = await M.DocumentVersion.find({ ...scope, documentId: { $in: docs } }).select("storageKey").lean();
  const report = {
    auditLogs: await M.AuditLog.countDocuments(auditFilter),
    documents: docs.length,
    files: versions.length,
    financialPastMinimum: await M.Invoice.countDocuments({ ...scope, invoiceDate: { $lt: yearsAgo(policy.financialYears) } }),
  };
  console.log(`${org.name}: policy ${JSON.stringify(policy)} → ${JSON.stringify(report)}${report.financialPastMinimum ? " (financial records are kept; review manually)" : ""}`);
  if (!apply || (!report.auditLogs && !report.documents)) continue;

  for (const v of versions) await deleteFile(v.storageKey);
  // Raw collections: the audit model is append-only for the app; retention is the one sanctioned removal.
  await db.collection("audit_logs").deleteMany(auditFilter);
  await db.collection("document_reviews").deleteMany({ ...scope, documentId: { $in: docs } });
  await db.collection("document_versions").deleteMany({ ...scope, documentId: { $in: docs } });
  await db.collection("documents").deleteMany({ ...scope, _id: { $in: docs } });
  await M.AuditLog.insertMany([{ ...scope, action: "retention.purged", resourceType: "organization", resourceId: org._id, after: { auditLogs: report.auditLogs, documents: report.documents, files: report.files }, requestId: "retention", userAgent: "retention job" }]);
  console.log(`  removed.`);
}
if (!apply) console.log("\nDry run: nothing was deleted. Re-run with --apply to remove the above.");
await mongoose.disconnect();
