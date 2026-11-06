// §6 Platform permissions and the default roles every organization starts with.
// Shared by the demo seed and `npm run setup`, so a new permission can't be missed by either.
export const PERMISSIONS = {
  "projects.view_all": "See every project in the organization",
  "tasks.update": "Complete and reopen tasks",
  "documents.upload": "Upload documents",
  "documents.approve": "Approve or reject uploaded documents",
  "messages.send": "Send project messages",
  "workflows.advance": "Complete workflow phases",
  "members.invite": "Invite clients and teammates",
  "clients.create": "Add clients",
  "clients.update": "Edit clients and their contacts",
  "projects.create": "Start projects",
  "invoices.issue": "Issue invoices, credit and debit notes",
  "payments.verify": "Record, verify and refund payments",
  "payments.submit": "Report a payment with proof",
  "organization.update": "Edit the organization profile, tax details and payment methods",
  "audit.view": "See the organization's activity log",
  "roles.manage": "Manage roles, permissions and who has access",
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;

export const DEFAULT_ROLES: Record<string, PermissionKey[]> = {
  // The owner role holds every permission, so it can grant and manage any role (you can only grant what you hold).
  "Account manager": Object.keys(PERMISSIONS) as PermissionKey[],
  Specialist: ["tasks.update", "documents.upload", "messages.send"],
  Client: ["documents.upload", "messages.send", "payments.submit"],
};

export const permissionDocs = () =>
  Object.entries(PERMISSIONS).map(([key, description]) => {
    const [resource, action] = key.split(".");
    return { key, module: resource, resource, action, description };
  });
