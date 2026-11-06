// Mongoose models for the collections the dashboard uses (see writing-block(2).md).
// Tenant-owned records carry an immutable organizationId; indexes follow §15.
import mongoose, { Schema, type InferSchemaType } from "mongoose";

const id = Schema.Types.ObjectId;
const org = { type: id, ref: "Organization", required: true, immutable: true };
const ref = (name: string, required = false) => ({ type: id, ref: name, required });
const opts = { timestamps: true } as const;
const created = { timestamps: { createdAt: true, updatedAt: false } } as const;

function model<T extends Schema>(name: string, schema: T, collection: string) {
  // On a dev hot reload, replace the previously registered model so schema edits take effect
  // (reusing it would silently drop new fields). In production each model is defined once.
  if (mongoose.models[name] && process.env.NODE_ENV !== "production") mongoose.deleteModel(name);
  return (mongoose.models[name] as mongoose.Model<InferSchemaType<T>>) ?? mongoose.model(name, schema, collection);
}

// §5 Platform and organization

const organization = new Schema(
  {
    name: { type: String, required: true },
    legalName: String,
    slug: { type: String, required: true, unique: true, lowercase: true },
    industry: String,
    email: String,
    phone: String,
    logo: String,
    address: { line1: String, line2: String, city: String, state: String, postalCode: String, country: String }, // state decides CGST+SGST vs IGST
    taxInformation: { gstin: String, pan: String, cin: String },
    settings: {
      timezone: String, locale: String, defaultCurrency: String,
      // §17 How long to keep things. Financial records are never purged by the app; the figure is the legal minimum.
      retention: {
        auditYears: { type: Number, default: 8, min: 1, max: 30 },
        documentYearsAfterArchive: { type: Number, default: 3, min: 1, max: 30 },
        financialYears: { type: Number, default: 8, min: 6, max: 30 },
      },
    },
    status: { type: String, enum: ["active", "trial", "suspended", "cancelled"], default: "active", index: true },
  },
  opts,
);

const user = new Schema(
  {
    firstName: { type: String, required: true },
    lastName: String,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: String,
    passwordHash: { type: String, select: false },
    emailVerifiedAt: Date,
    avatar: String,
    status: { type: String, enum: ["active", "pending", "suspended"], default: "active", index: true },
    lastLoginAt: Date,
    emailNotifications: { type: Boolean, default: true }, // in-app notifications always arrive; this only stops the emails
  },
  opts,
);

const membership = new Schema(
  {
    organizationId: org,
    userId: ref("User", true),
    roleIds: [ref("Role")],
    title: String,
    membershipType: { type: String, enum: ["employee", "client", "external"], required: true },
    status: { type: String, enum: ["invited", "active", "suspended"], default: "active" },
    joinedAt: Date,
  },
  opts,
);
membership.index({ organizationId: 1, userId: 1 }, { unique: true });
membership.index({ organizationId: 1, status: 1 });
membership.index({ userId: 1, status: 1 });

// §6 Roles, permissions and sessions

const role = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true },
    description: String,
    isSystemRole: Boolean,
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  opts,
);
role.index({ organizationId: 1, name: 1 }, { unique: true });

// Platform-managed, so no organizationId.
const permission = new Schema({
  key: { type: String, required: true, unique: true },
  module: String,
  resource: String,
  action: String,
  description: String,
});

const rolePermission = new Schema(
  { organizationId: org, roleId: ref("Role", true), permissionId: ref("Permission", true) },
  created,
);
rolePermission.index({ organizationId: 1, roleId: 1, permissionId: 1 }, { unique: true });

// Same rule as sessions: only the token's SHA-256 is stored.
const invitation = new Schema(
  {
    organizationId: org,
    email: { type: String, required: true, lowercase: true, trim: true },
    membershipType: { type: String, enum: ["employee", "client"], required: true },
    roleIds: [ref("Role")],
    projectId: ref("Project"),
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "accepted", "revoked"], default: "pending" },
    expiresAt: { type: Date, required: true },
    invitedBy: ref("User", true),
    acceptedBy: ref("User"),
    acceptedAt: Date,
  },
  opts,
);
invitation.index({ organizationId: 1, status: 1, createdAt: -1 });
invitation.index({ organizationId: 1, email: 1, status: 1 });

// Only a SHA-256 of the cookie token is stored, so a DB leak can't be replayed as a login.
const session = new Schema(
  {
    userId: ref("User", true),
    organizationId: org,
    membershipId: ref("Membership", true),
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    ipAddress: String,
    userAgent: String,
  },
  created,
);
session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: sessions are explicitly temporary (§15)
session.index({ userId: 1 });

// Failed sign-ins, kept 15 minutes (TTL) so the login throttle can count recent ones.
const loginAttempt = new Schema({ key: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
loginAttempt.index({ key: 1, createdAt: -1 });
loginAttempt.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

// Per-organization counters for human-readable codes (CL-0001). Incremented atomically.
const counter = new Schema({ organizationId: org, key: { type: String, required: true }, value: { type: Number, default: 0 } });
counter.index({ organizationId: 1, key: 1 }, { unique: true });

// §7 Clients and projects

const address = { line1: String, line2: String, city: String, state: String, postalCode: String, country: String };

const client = new Schema(
  {
    organizationId: org,
    clientCode: { type: String, required: true },
    clientType: { type: String, enum: ["individual", "organization"], required: true },
    displayName: { type: String, required: true },
    individualDetails: { firstName: String, lastName: String, pan: String },
    organizationDetails: { legalName: String, gstin: String, pan: String, cin: String },
    primaryContactId: ref("ClientContact"),
    billingAddress: address,
    accountManagerId: ref("User"),
    tags: [String],
    status: { type: String, default: "active" },
  },
  opts,
);
client.index({ organizationId: 1, clientCode: 1 }, { unique: true });
client.index({ organizationId: 1, status: 1 });
client.index({ organizationId: 1, accountManagerId: 1 });

const clientContact = new Schema(
  {
    organizationId: org,
    clientId: ref("Client", true),
    name: { type: String, required: true },
    designation: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    isPrimary: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  opts,
);
clientContact.index({ organizationId: 1, clientId: 1 });

const project = new Schema(
  {
    organizationId: org,
    projectCode: { type: String, required: true },
    clientId: ref("Client", true),
    name: { type: String, required: true },
    description: String,
    category: String,
    projectManagerId: ref("User"),
    startDate: Date,
    expectedEndDate: Date,
    completedAt: Date,
    status: { type: String, default: "active" },
    archivedAt: Date,
    // Commercial agreement snapshot (§7.3); percentage milestones are worked out from agreedValue (paise).
    financialSettings: { currency: { type: String, default: "INR" }, billingType: String, agreedValue: { type: Number, validate: Number.isSafeInteger } },
  },
  opts,
);
project.index({ organizationId: 1, projectCode: 1 }, { unique: true });
project.index({ organizationId: 1, clientId: 1 });
project.index({ organizationId: 1, projectManagerId: 1, status: 1 });

const projectMember = new Schema({
  organizationId: org,
  projectId: ref("Project", true),
  userId: ref("User", true),
  role: String, // manager | member | specialist | client: what they are on the project
  // §6.4 What they may do here, on top of their role's permissions. view: read, chat, comment;
  // edit: also tasks, uploads, reviews, workflow, billing; manage: also the project's team.
  accessLevel: { type: String, enum: ["view", "edit", "manage"] },
  assignedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["active", "removed"], default: "active" },
});
projectMember.index(
  { organizationId: 1, projectId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
projectMember.index({ organizationId: 1, userId: 1, status: 1 });

// §8–9 Workflows, phases and tasks

const workflowTemplate = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true },
    description: String,
    category: String,
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    currentPublishedVersionId: ref("WorkflowVersion"),
    createdBy: ref("User"),
  },
  opts,
);

const workflowPhase = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    // What must be true before the phase can be completed; copied onto the phase instance.
    completion: { mandatoryTasks: Boolean, mandatoryDocuments: Boolean },
    // Tasks created for every project that runs this phase.
    tasks: [
      {
        _id: false,
        title: { type: String, required: true },
        mandatory: Boolean,
        assignee: { type: String, enum: ["client", "manager"] },
        dueInDays: Number,
      },
    ],
  },
  { _id: false },
);

const workflowVersion = new Schema(
  {
    organizationId: org,
    workflowTemplateId: ref("WorkflowTemplate", true),
    version: { type: Number, required: true },
    definition: { phases: [workflowPhase] },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft" },
    publishedAt: Date,
    publishedBy: ref("User"),
  },
  created,
);
workflowVersion.index({ organizationId: 1, workflowTemplateId: 1, version: 1 }, { unique: true });
// Published versions are immutable (§8.2): block edits to the definition once published.
workflowVersion.pre(["updateOne", "findOneAndUpdate", "updateMany"], function () {
  this.where({ status: { $ne: "published" } });
});

const projectWorkflow = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    workflowTemplateId: ref("WorkflowTemplate", true),
    workflowVersionId: ref("WorkflowVersion", true),
    status: { type: String, enum: ["active", "completed", "cancelled", "paused"], default: "active" },
    currentPhaseInstanceId: ref("PhaseInstance"),
    startedAt: Date,
    completedAt: Date,
  },
  created,
);
projectWorkflow.index({ organizationId: 1, projectId: 1 }, { unique: true });

const phaseInstance = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    workflowInstanceId: ref("ProjectWorkflow"),
    phaseKey: { type: String, required: true },
    phaseName: String,
    sequence: Number,
    status: { type: String, enum: ["pending", "active", "completed"], default: "pending" },
    assignedUserIds: [ref("User")],
    completionConditionsSnapshot: Object,
    startedAt: Date,
    completedAt: Date,
  },
  opts,
);
phaseInstance.index({ organizationId: 1, projectId: 1, sequence: 1 });

const workflowExecution = new Schema(
  {
    organizationId: org,
    workflowInstanceId: ref("ProjectWorkflow", true),
    phaseInstanceId: ref("PhaseInstance"),
    eventType: { type: String, required: true },
    previousStatus: String,
    newStatus: String,
    triggeredBy: ref("User"),
    executionResult: { type: String, enum: ["success", "failed"], required: true },
    details: Object,
  },
  created,
);
workflowExecution.index({ organizationId: 1, workflowInstanceId: 1, createdAt: 1 });

const task = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    phaseInstanceId: ref("PhaseInstance"),
    title: { type: String, required: true },
    description: String,
    assignedTo: ref("User"),
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: {
      type: String,
      enum: ["todo", "in_progress", "blocked", "completed", "cancelled"],
      default: "todo",
    },
    dueDate: Date,
    isMandatory: Boolean,
    // Tasks in the same project that must be completed first (§9.1). Bounded by the project's task count.
    dependencies: [ref("Task")],
    completedAt: Date,
  },
  opts,
);
task.index({ organizationId: 1, assignedTo: 1, status: 1 });
task.index({ organizationId: 1, dueDate: 1 });

// §9.2 Internal comments are staff-only; clients only ever see and write "client" ones.
// ponytail: no attachments yet; documents have their own upload flow. Add when comments need files.
const taskComment = new Schema(
  {
    organizationId: org,
    taskId: ref("Task", true),
    authorId: ref("User", true),
    message: { type: String, required: true, maxlength: 2000 },
    visibility: { type: String, enum: ["internal", "client"], default: "client" },
  },
  created,
);
taskComment.index({ organizationId: 1, taskId: 1, createdAt: 1 });
task.index({ organizationId: 1, projectId: 1 });

// §10 Documents

const documentType = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true },
    description: String,
    allowedExtensions: [String],
    maxFileSizeBytes: Number,
    requiresVerification: { type: Boolean, default: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  opts,
);
documentType.index({ organizationId: 1, name: 1 }, { unique: true });

// Which documents a new project must collect, by client type and project category (§10.3).
const documentTemplate = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true },
    clientTypes: [String],
    projectCategories: [String],
    requirements: [{ _id: false, documentTypeId: ref("DocumentType", true), isMandatory: Boolean, phaseKey: String }],
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  opts,
);

const documentRequirement = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    clientId: ref("Client", true),
    documentTypeId: ref("DocumentType", true),
    phaseInstanceId: ref("PhaseInstance"),
    isMandatory: { type: Boolean, default: true },
    status: { type: String, enum: ["pending", "submitted", "approved", "rejected"], default: "pending" },
    dueDate: Date,
    approvedDocumentId: ref("Document"),
  },
  opts,
);
documentRequirement.index({ organizationId: 1, projectId: 1 });

const document = new Schema(
  {
    organizationId: org,
    clientId: ref("Client", true),
    projectId: ref("Project"),
    requirementId: ref("DocumentRequirement"),
    documentTypeId: ref("DocumentType"),
    currentVersionId: ref("DocumentVersion"),
    visibility: { type: String, enum: ["internal", "client"], default: "client" },
    status: { type: String, enum: ["pending_review", "approved", "rejected"], default: "pending_review" },
  },
  opts,
);
document.index({ organizationId: 1, projectId: 1 });
document.index({ organizationId: 1, status: 1 });

const documentVersion = new Schema(
  {
    organizationId: org,
    documentId: ref("Document", true),
    version: { type: Number, required: true },
    originalFileName: { type: String, required: true },
    storageKey: { type: String, required: true },
    mimeType: String,
    fileSizeBytes: Number,
    checksum: String,
    uploadedBy: ref("User"),
    verificationStatus: { type: String, default: "pending" },
    verifiedBy: ref("User"),
    verifiedAt: Date,
  },
  created,
);
documentVersion.index({ organizationId: 1, documentId: 1, version: 1 }, { unique: true });

const documentReview = new Schema(
  {
    organizationId: org,
    documentId: ref("Document", true),
    documentVersionId: ref("DocumentVersion", true),
    reviewerId: ref("User", true),
    decision: { type: String, enum: ["approved", "rejected", "revision_requested"], required: true },
    comments: String,
  },
  created,
);

// §14 Communication and audit

const thread = new Schema(
  {
    organizationId: org,
    clientId: ref("Client", true),
    projectId: ref("Project"),
    subject: String,
    participants: [ref("User")],
    visibility: { type: String, default: "client" },
    status: { type: String, default: "open" },
  },
  opts,
);
thread.index({ organizationId: 1, projectId: 1 });

const message = new Schema(
  {
    organizationId: org,
    threadId: ref("CommunicationThread", true),
    senderId: ref("User", true),
    message: { type: String, required: true, maxlength: 2000 },
    attachments: [Object],
    visibility: { type: String, enum: ["internal", "client"], default: "client" },
  },
  created,
);
message.index({ organizationId: 1, threadId: 1, createdAt: 1 });

// §14.2 One row per recipient per channel: in-app rows are the inbox, email rows record delivery.
// ponytail: wording lives in code; add notification_templates (§14.1) when orgs need to edit messages.
const notification = new Schema(
  {
    organizationId: org,
    recipientUserId: ref("User", true),
    channel: { type: String, enum: ["in_app", "email"], required: true },
    title: { type: String, required: true },
    message: String,
    resourceType: String,
    resourceId: id,
    link: String, // in-app path to open, e.g. /chat?project=…
    deliveryStatus: { type: String, enum: ["delivered", "sent", "failed", "skipped"], default: "delivered" },
    readAt: Date,
  },
  created,
);
notification.index({ organizationId: 1, recipientUserId: 1, channel: 1, createdAt: -1 }); // inbox, newest first
notification.index({ organizationId: 1, recipientUserId: 1, channel: 1, readAt: 1 }); // unread count
notification.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // retention: 90 days (§17)

const auditLog = new Schema(
  {
    organizationId: org,
    actorId: ref("User"), // empty for system jobs such as retention
    action: { type: String, required: true },
    resourceType: String,
    resourceId: id,
    before: Object,
    after: Object,
    requestId: String,
    ipAddress: String,
    userAgent: String,
  },
  created,
);
auditLog.index({ organizationId: 1, createdAt: -1 });
auditLog.index({ organizationId: 1, actorId: 1, createdAt: -1 });
// Audit history is append-only (§18): the model refuses every update and delete.
// ponytail: app-level only; in production also give the app's DB user insert+find (no update/remove) on audit_logs.
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"] as const) {
  auditLog.pre(op as "updateOne", () => {
    throw new Error("Audit log is append-only");
  });
}
auditLog.pre("save", function () {
  if (!this.isNew) throw new Error("Audit log is append-only");
});

// §11 Finance. Money is integer minor units (paise for INR) everywhere; tax rates are basis points (1800 = 18%).
// Issued numbers, snapshots and totals are immutable: corrections go through credit and debit notes.
const money = { type: Number, default: 0, validate: { validator: Number.isSafeInteger, message: "Money must be whole minor units" } };
const frozen = { ...money, immutable: true };
const taxComponent = new Schema({ taxType: String, rateBp: Number, amount: Number }, { _id: false });
const idempotent = (schema: Schema) =>
  schema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });

const paymentMethod = new Schema(
  {
    organizationId: org,
    name: { type: String, required: true },
    type: { type: String, enum: ["cash", "upi", "bank_transfer", "cheque", "gateway", "custom"], required: true },
    configuration: Object, // never gateway secrets (§11.1)
    requiredMetadataFields: [String],
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  opts,
);

const lineItem = new Schema(
  { description: String, quantity: Number, unitPrice: Number, discount: Number, taxableAmount: Number, taxComponents: [taxComponent], total: Number },
  { _id: false },
);

// ponytail: line items live only in lineItemsSnapshot (no invoice_items collection) because invoices are issued in one step; add the collection with drafts.
const invoice = new Schema(
  {
    organizationId: org,
    clientId: { ...ref("Client", true), immutable: true },
    projectId: { ...ref("Project", true), immutable: true },
    invoiceNumber: { type: String, required: true, immutable: true },
    invoiceDate: { type: Date, required: true, immutable: true },
    dueDate: { type: Date, required: true },
    currency: { type: String, default: "INR", immutable: true },
    status: { type: String, enum: ["issued", "partially_paid", "paid"], default: "issued" },
    billingSnapshot: { type: Object, immutable: true },
    lineItemsSnapshot: { type: [lineItem], immutable: true },
    taxSummary: { type: [taxComponent], immutable: true },
    subtotal: frozen,
    discountTotal: frozen,
    taxTotal: frozen,
    grandTotal: frozen,
    // Running balances: outstanding = grandTotal + debitTotal - creditTotal - amountPaid.
    creditTotal: money,
    debitTotal: money,
    amountPaid: money,
    outstandingAmount: { ...money, min: 0 },
    issuedAt: { type: Date, immutable: true },
    createdBy: ref("User"),
    paymentScheduleId: ref("PaymentSchedule"),
    idempotencyKey: String,
  },
  opts,
);
invoice.index({ organizationId: 1, invoiceNumber: 1 }, { unique: true });
invoice.index({ organizationId: 1, projectId: 1, invoiceDate: 1 });
idempotent(invoice);

// Draft invoices live apart from issued ones, so issued invoices stay immutable and drafts get no number
// until they're issued (§11.3).
const draftLine = new Schema({ description: String, quantity: String, unitPrice: String, rate: Number, discount: String }, { _id: false });
const invoiceDraft = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    lines: { type: [draftLine], validate: [(v: unknown[]) => v.length <= 50, "Too many lines"] },
    dueDate: Date,
    note: String, // why it exists, e.g. "Milestone: Kick-off"
    paymentScheduleId: ref("PaymentSchedule"),
    createdBy: ref("User"),
  },
  opts,
);
invoiceDraft.index({ organizationId: 1, projectId: 1 });

// §11.2 Billing milestones. When the trigger fires the schedule becomes "due" and raises a draft invoice
// for a person to review and issue; nothing is invoiced automatically.
const paymentSchedule = new Schema(
  {
    organizationId: org,
    projectId: ref("Project", true),
    title: { type: String, required: true },
    calculationType: { type: String, enum: ["fixed", "percentage"], required: true },
    amount: { type: Number, required: true, validate: Number.isSafeInteger }, // paise when fixed; basis points of the agreed value when percentage
    rateBp: { type: Number, default: 1800 },
    currency: { type: String, default: "INR" },
    triggerType: { type: String, enum: ["date", "phase_completion", "manual"], required: true },
    dueDate: Date,
    phaseInstanceId: ref("PhaseInstance"),
    status: { type: String, enum: ["pending", "due", "paid", "cancelled"], default: "pending" },
    draftId: ref("InvoiceDraft"),
    invoiceId: ref("Invoice"),
  },
  opts,
);
paymentSchedule.index({ organizationId: 1, projectId: 1, status: 1 });

const invoiceSequence = new Schema(
  {
    organizationId: org,
    financialYear: { type: String, required: true },
    documentType: { type: String, enum: ["invoice", "credit_note", "debit_note"], required: true },
    prefix: String,
    currentSequence: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);
invoiceSequence.index({ organizationId: 1, financialYear: 1, documentType: 1 }, { unique: true });

const payment = new Schema(
  {
    organizationId: org,
    clientId: ref("Client", true),
    projectId: ref("Project", true),
    paymentReference: { type: String, required: true },
    paymentMethodId: ref("PaymentMethod", true),
    amount: { ...frozen, min: 1 },
    currency: { type: String, default: "INR" },
    transactionDate: { type: Date, required: true },
    externalTransactionId: String,
    verificationStatus: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    status: { type: String, enum: ["pending", "completed", "rejected"], default: "pending" },
    proofStorageKey: String,
    proofFileName: String,
    unappliedAmount: { ...money, min: 0 }, // verified money not yet allocated or refunded
    submittedBy: ref("User"),
    verifiedBy: ref("User"),
    verifiedAt: Date,
    idempotencyKey: String,
  },
  created,
);
payment.index({ organizationId: 1, transactionDate: -1 });
payment.index({ organizationId: 1, projectId: 1 });
payment.index({ organizationId: 1, paymentReference: 1 }, { unique: true });
idempotent(payment);

const paymentAllocation = new Schema(
  {
    organizationId: org,
    paymentId: ref("Payment", true),
    invoiceId: ref("Invoice", true),
    allocatedAmount: { ...frozen, min: 1 },
    currency: { type: String, default: "INR" },
    allocatedAt: { type: Date, default: Date.now },
    createdBy: ref("User"),
  },
);
paymentAllocation.index({ organizationId: 1, invoiceId: 1 });
paymentAllocation.index({ organizationId: 1, paymentId: 1 });

const refund = new Schema(
  {
    organizationId: org,
    paymentId: ref("Payment", true),
    amount: { ...frozen, min: 1 },
    currency: { type: String, default: "INR" },
    reason: String,
    externalRefundReference: String,
    status: { type: String, enum: ["processed"], default: "processed" },
    processedAt: Date,
    createdBy: ref("User"),
    idempotencyKey: String,
  },
  created,
);
refund.index({ organizationId: 1, paymentId: 1 });
idempotent(refund);

// §11.9 Credit and debit notes share a shape; they adjust an invoice's balance without touching its snapshot.
const adjustmentNote = () => {
  const schema = new Schema(
    {
      organizationId: org,
      clientId: ref("Client", true),
      projectId: ref("Project", true),
      invoiceId: ref("Invoice", true),
      noteNumber: { type: String, required: true, immutable: true },
      reason: { type: String, required: true },
      taxableAmount: frozen,
      taxComponents: { type: [taxComponent], immutable: true },
      taxTotal: frozen,
      total: frozen,
      issuedAt: { type: Date, immutable: true },
      approvals: [{ userId: ref("User"), decision: String, at: Date }],
      idempotencyKey: String,
    },
    created,
  );
  schema.index({ organizationId: 1, noteNumber: 1 }, { unique: true });
  schema.index({ organizationId: 1, invoiceId: 1 });
  idempotent(schema);
  return schema;
};

export const Organization = model("Organization", organization, "organizations");
export const User = model("User", user, "users");
export const Membership = model("Membership", membership, "memberships");
export const Role = model("Role", role, "roles");
export const Permission = model("Permission", permission, "permissions");
export const RolePermission = model("RolePermission", rolePermission, "role_permissions");
export const Session = model("Session", session, "sessions");
export const LoginAttempt = model("LoginAttempt", loginAttempt, "login_attempts");
export const Counter = model("Counter", counter, "counters");
export const Invitation = model("Invitation", invitation, "invitations");
export const WorkflowTemplate = model("WorkflowTemplate", workflowTemplate, "workflow_templates");
export const WorkflowVersion = model("WorkflowVersion", workflowVersion, "workflow_versions");
export const ProjectWorkflow = model("ProjectWorkflow", projectWorkflow, "project_workflows");
export const WorkflowExecution = model("WorkflowExecution", workflowExecution, "workflow_executions");
export const DocumentType = model("DocumentType", documentType, "document_types");
export const DocumentTemplate = model("DocumentTemplate", documentTemplate, "document_templates");
export const ClientContact = model("ClientContact", clientContact, "client_contacts");
export const DocumentRequirement = model("DocumentRequirement", documentRequirement, "document_requirements");
export const Client = model("Client", client, "clients");
export const Project = model("Project", project, "projects");
export const ProjectMember = model("ProjectMember", projectMember, "project_members");
export const PhaseInstance = model("PhaseInstance", phaseInstance, "phase_instances");
export const Task = model("Task", task, "tasks");
export const TaskComment = model("TaskComment", taskComment, "task_comments");
export const Document = model("Document", document, "documents");
export const DocumentVersion = model("DocumentVersion", documentVersion, "document_versions");
export const DocumentReview = model("DocumentReview", documentReview, "document_reviews");
export const CommunicationThread = model("CommunicationThread", thread, "communication_threads");
export const Message = model("Message", message, "messages");
export const AuditLog = model("AuditLog", auditLog, "audit_logs");
export const Notification = model("Notification", notification, "notifications");
export const PaymentMethod = model("PaymentMethod", paymentMethod, "payment_methods");
export const Invoice = model("Invoice", invoice, "invoices");
export const InvoiceDraft = model("InvoiceDraft", invoiceDraft, "invoice_drafts");
export const PaymentSchedule = model("PaymentSchedule", paymentSchedule, "payment_schedules");
export const InvoiceSequence = model("InvoiceSequence", invoiceSequence, "invoice_sequences");
export const Payment = model("Payment", payment, "payments");
export const PaymentAllocation = model("PaymentAllocation", paymentAllocation, "payment_allocations");
export const Refund = model("Refund", refund, "refunds");
export const CreditNote = model("CreditNote", adjustmentNote(), "credit_notes");
export const DebitNote = model("DebitNote", adjustmentNote(), "debit_notes");
