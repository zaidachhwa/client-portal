// Everything a new organization starts with: roles and permissions, payment methods and a starter workflow.
// Shared by `npm run setup` and the platform admin console, so the two can't drift apart.
import type { Types } from "mongoose";
import { Organization, PaymentMethod, Permission, Role, RolePermission, WorkflowTemplate, WorkflowVersion } from "./models.ts";
import { DEFAULT_ROLES, permissionDocs } from "./permissions.ts";

export const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";

// Uses insertMany throughout, so it can run inside tx().
export async function provisionOrganization(name: string, slug: string, createdBy?: Types.ObjectId) {
  const [org] = await Organization.insertMany([
    { name, slug, settings: { timezone: "Asia/Kolkata", locale: "en-IN", defaultCurrency: "INR" } },
  ]);
  const organizationId = org._id;

  await Permission.bulkWrite(permissionDocs().map((p) => ({ updateOne: { filter: { key: p.key }, update: { $set: p }, upsert: true } })));
  const permissions = await Permission.find().lean();
  const roles: Record<string, Types.ObjectId> = {};
  for (const [roleName, keys] of Object.entries(DEFAULT_ROLES)) {
    const [role] = await Role.insertMany([{ organizationId, name: roleName, isSystemRole: true }]);
    roles[roleName] = role._id;
    await RolePermission.insertMany(keys.map((k) => ({ organizationId, roleId: role._id, permissionId: permissions.find((p) => p.key === k)!._id })));
  }

  await PaymentMethod.insertMany([
    { organizationId, name: "UPI", type: "upi" },
    { organizationId, name: "Bank transfer", type: "bank_transfer" },
    { organizationId, name: "Cheque", type: "cheque" },
    { organizationId, name: "Cash", type: "cash" },
  ]);

  // A generic workflow so the first project can be created; tasks marked "client" wait for the client to join.
  const [template] = await WorkflowTemplate.insertMany([{ organizationId, name: "Client onboarding", category: "General", status: "published", createdBy }]);
  const [version] = await WorkflowVersion.insertMany([{
    organizationId, workflowTemplateId: template._id, version: 1, status: "published", publishedAt: new Date(), publishedBy: createdBy,
    definition: {
      phases: [
        {
          key: "onboarding", name: "Onboarding", completion: { mandatoryTasks: true, mandatoryDocuments: true },
          tasks: [
            { title: "Kick-off call", mandatory: true, assignee: "manager", dueInDays: 3 },
            { title: "Complete onboarding questionnaire", mandatory: true, assignee: "client", dueInDays: 5 },
            { title: "Share access to accounts", mandatory: true, assignee: "client", dueInDays: 7 },
          ],
        },
        {
          key: "delivery", name: "Delivery", completion: { mandatoryTasks: true, mandatoryDocuments: false },
          tasks: [
            { title: "Plan the work", assignee: "manager", dueInDays: 10 },
            { title: "Review and sign off", mandatory: true, assignee: "client", dueInDays: 30 },
          ],
        },
      ],
    },
  }]);
  await WorkflowTemplate.updateOne({ _id: template._id }, { currentPublishedVersionId: version._id });

  return { org, roles };
}
