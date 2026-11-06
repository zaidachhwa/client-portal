# Database Schema Specification (DSS)
## Client Lifecycle Management Platform

**Version:** 1.0  
**Database:** MongoDB  
**ODM:** Mongoose  
**Architecture:** Multi-tenant shared database  
**Status:** Initial engineering specification

---

# 1. Database Design Principles

The database must support multiple organizations operating independently on the same platform.

The following principles are mandatory:

1. Every tenant-owned record must have an organization identifier.
2. Configuration definitions must be separated from operational records.
3. Published configurations must be versioned.
4. Financial records must preserve historical integrity.
5. Documents must support multiple versions.
6. Users must be independent of organizations.
7. Organization membership must control user access.
8. Relationships must be validated at the service layer.
9. Important business operations must generate audit records.
10. Database indexes must support tenant-aware queries.

## 1.1 Naming conventions

| Item | Convention | Example |
|---|---|---|
| Collections | Plural, lowercase | organizations |
| Model names | PascalCase | Organization |
| Fields | camelCase | organizationId |
| IDs | ObjectId | ObjectId |
| References | Explicit suffix Id | clientId |
| Timestamps | Standard names | createdAt |
| Tenant field | organizationId | organizationId |
| Soft deletion | deletedAt | Date or null |

Use MongoDB ObjectIds for internal relationships. Public-facing references should use separate, non-sequential identifiers.

---

# 2. Entity Relationship Architecture

## 2.1 Platform hierarchy

```text
PLATFORM
  |
  +-- organizations
  |      |
  |      +-- organization_settings
  |      +-- branches
  |      +-- departments
  |      +-- memberships
  |      +-- clients
  |      +-- projects
  |      +-- workflows
  |      +-- documents
  |      +-- invoices
  |      +-- payments
  |
  +-- users
  |
  +-- subscription_plans
  |
  +-- subscriptions
```

## 2.2 Core relationships

```text
Organization
    |
    +-- Branches
    |
    +-- Users through Memberships
    |
    +-- Clients
    |     |
    |     +-- Contacts
    |     |
    |     +-- Projects
    |           |
    |           +-- Workflow Instance
    |           |      |
    |           |      +-- Phase Instances
    |           |      +-- Tasks
    |           |
    |           +-- Documents
    |           +-- Agreements
    |           +-- Invoices
    |           +-- Payments
    |
    +-- Configuration Templates
    |     |
    |     +-- Versions
    |
    +-- Financial Settings
    |
    +-- Automation Rules
```

---

# 3. Collection Inventory

## 3.1 Platform collections

| Collection | Purpose | Tenant scope |
|---|---|---|
| users | Global user identities | Platform |
| organizations | Tenant organizations | Platform |
| organization_settings | Organization preferences | Tenant |
| branches | Organization branches | Tenant |
| departments | Internal departments | Tenant |
| memberships | User-organization relationships | Tenant |
| subscription_plans | SaaS plans | Platform |
| subscriptions | Organization subscriptions | Tenant |

## 3.2 Authentication and permission collections

| Collection | Purpose |
|---|---|
| roles | Organization roles |
| permissions | Available permission definitions |
| role_permissions | Role permission assignments |
| invitations | Employee and client invitations |
| sessions | Authentication sessions |
| api_keys | Integration API keys |

## 3.3 Client and project collections

| Collection | Purpose |
|---|---|
| clients | Client records |
| client_contacts | Client contact persons |
| projects | Client engagements |
| project_members | Project team assignments |
| project_activity | Project-specific activity timeline |

## 3.4 Workflow collections

| Collection | Purpose |
|---|---|
| workflow_templates | Workflow definitions |
| workflow_versions | Published and draft versions |
| project_workflows | Workflow instances |
| phase_instances | Executable project phases |
| workflow_executions | Transition and execution history |

## 3.5 Document collections

| Collection | Purpose |
|---|---|
| document_categories | Document categories |
| document_types | Configurable document definitions |
| document_templates | Requirement templates |
| document_requirements | Project-specific requirements |
| documents | Uploaded document records |
| document_versions | Individual uploaded versions |
| document_reviews | Verification history |

## 3.6 Financial collections

| Collection | Purpose |
|---|---|
| payment_methods | Organization payment methods |
| payment_schedules | Scheduled payments |
| invoices | Invoice headers |
| invoice_items | Invoice line items |
| invoice_sequences | Atomic invoice numbering |
| payments | Payment transactions |
| payment_allocations | Payment-to-invoice relationships |
| refunds | Refund transactions |
| credit_notes | Credit adjustments |
| debit_notes | Debit adjustments |
| financial_transactions | Financial transaction history |

## 3.7 Other collections

| Collection | Purpose |
|---|---|
| form_definitions | Dynamic form configurations |
| form_submissions | Submitted form data |
| custom_field_definitions | Custom field definitions |
| approval_templates | Approval configuration |
| approval_requests | Approval instances |
| approval_actions | Approval decisions |
| notification_templates | Notification definitions |
| notifications | Notification records |
| communication_threads | Client communication threads |
| messages | Individual messages |
| automation_rules | Automation definitions |
| automation_executions | Automation execution history |
| audit_logs | System audit records |
| webhook_endpoints | Webhook configurations |
| webhook_deliveries | Webhook delivery records |
| integration_configs | External integrations |
| data_export_jobs | Export requests and processing |

---

# 4. Global Schema Standards

All tenant-owned collections should follow a common base structure.

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  createdBy: ObjectId,
  updatedBy: ObjectId,

  createdAt: Date,
  updatedAt: Date,

  deletedAt: null
}
```

This is a logical standard, not a requirement that every collection must contain every field.

### Important rules

- `organizationId` must be immutable after record creation.
- `createdBy` must be resolved from authenticated context.
- `updatedBy` must be populated by the backend.
- Soft deletion should only be used where recovery is meaningful.
- Financial records and audit records should not be deleted through ordinary CRUD operations.
- Do not accept ownership fields directly from untrusted client input.

Use a common Mongoose base schema where practical, but ensure collection-specific indexes and validation remain explicit.

---

# 5. Platform and Organization Schemas

## 5.1 users

Purpose: Global user identity.

```javascript
{
  _id: ObjectId,

  firstName: String,
  lastName: String,

  email: String,
  phone: String,

  passwordHash: String,

  avatar: String,

  status: "active" | "pending" | "suspended",

  emailVerifiedAt: Date,
  phoneVerifiedAt: Date,

  mfaEnabled: Boolean,

  lastLoginAt: Date,

  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique normalized email.
- Unique normalized phone where applicable.
- Status index.

Email and phone uniqueness policies should be defined consistently across the platform. A user should not need multiple global accounts simply because they belong to multiple organizations.

## 5.2 organizations

```javascript
{
  _id: ObjectId,

  name: String,
  legalName: String,

  slug: String,

  industry: String,

  email: String,
  phone: String,

  logo: String,

  address: {
    line1: String,
    line2: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },

  taxInformation: {
    gstin: String,
    pan: String,
    cin: String
  },

  settings: {
    timezone: String,
    locale: String,
    defaultCurrency: String,
    financialYearStartMonth: Number
  },

  status: "active" | "trial" | "suspended" | "cancelled",

  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique slug.
- Status.
- Industry where filtering is needed.

## 5.3 organization_settings

Separate frequently changing settings from the organization profile.

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  branding: {
    primaryColor: String,
    secondaryColor: String,
    logo: String,
    favicon: String
  },

  localization: {
    timezone: String,
    locale: String,
    currency: String,
    dateFormat: String,
    numberFormat: String
  },

  security: {
    requireMfa: Boolean,
    sessionDurationMinutes: Number,
    allowedDomains: [String]
  },

  notifications: {
    emailEnabled: Boolean,
    whatsappEnabled: Boolean,
    smsEnabled: Boolean
  },

  financial: {
    defaultCurrency: String,
    taxRegistrationCountry: String,
    financialYearStartMonth: Number
  },

  updatedAt: Date
}
```

Index:

- Unique organizationId.

## 5.4 branches

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,
  code: String,

  address: Object,

  email: String,
  phone: String,

  managerId: ObjectId,

  status: "active" | "inactive",

  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique `{ organizationId, code }`.
- `{ organizationId, status }`.

## 5.5 departments

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,
  branchId: ObjectId,

  name: String,
  description: String,

  managerId: ObjectId,

  status: "active" | "inactive",

  createdAt: Date,
  updatedAt: Date
}
```

## 5.6 memberships

Purpose: Connect users with organizations.

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,
  userId: ObjectId,

  roleIds: [ObjectId],

  branchIds: [ObjectId],
  departmentIds: [ObjectId],

  membershipType: "employee" | "client" | "external",

  status: "invited" | "active" | "suspended",

  joinedAt: Date,

  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique `{ organizationId, userId }`.
- `{ organizationId, status }`.
- `{ userId, status }`.

A membership should represent one user's access to one organization. Additional resource-level assignments should be managed separately.

---

# 6. Role and Permission Schemas

## 6.1 roles

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,
  description: String,

  isSystemRole: Boolean,

  status: "active" | "inactive",

  createdAt: Date,
  updatedAt: Date
}
```

## 6.2 permissions

Permission definitions can be platform-managed.

```javascript
{
  _id: ObjectId,

  key: String,

  module: String,
  resource: String,
  action: String,

  description: String
}
```

Example:

```text
clients.view
clients.create
clients.update
projects.view
projects.assign
documents.approve
invoices.issue
payments.verify
workflows.publish
```

## 6.3 role_permissions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  roleId: ObjectId,
  permissionId: ObjectId,

  createdAt: Date
}
```

Unique index:

`{ organizationId, roleId, permissionId }`

## 6.4 Resource-level permissions

Use dedicated assignment records where users need project-specific access.

Example:

```javascript
{
  organizationId: ObjectId,
  userId: ObjectId,
  resourceType: "project",
  resourceId: ObjectId,
  accessLevel: "view" | "edit" | "manage"
}
```

Do not rely on role permissions alone for sensitive resource access.

---

# 7. Client and Project Schemas

## 7.1 clients

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,
  branchId: ObjectId,

  clientCode: String,

  clientType: "individual" | "organization",

  displayName: String,

  individualDetails: {
    firstName: String,
    lastName: String,
    dateOfBirth: Date,
    pan: String
  },

  organizationDetails: {
    legalName: String,
    tradeName: String,
    gstin: String,
    pan: String,
    cin: String,
    registrationNumber: String
  },

  primaryContactId: ObjectId,

  billingAddress: Object,
  communicationAddress: Object,

  accountManagerId: ObjectId,

  tags: [String],

  status: String,

  customFieldValues: Object,

  createdAt: Date,
  updatedAt: Date
}
```

Indexes:

- Unique `{ organizationId, clientCode }`.
- `{ organizationId, status }`.
- `{ organizationId, accountManagerId }`.
- Search indexes for displayName and contact fields.

## 7.2 client_contacts

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,
  clientId: ObjectId,

  name: String,
  designation: String,

  email: String,
  phone: String,

  isPrimary: Boolean,

  status: "active" | "inactive",

  createdAt: Date,
  updatedAt: Date
}
```

## 7.3 projects

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,
  branchId: ObjectId,

  projectCode: String,

  clientId: ObjectId,

  name: String,
  description: String,

  category: String,

  projectManagerId: ObjectId,

  workflowInstanceId: ObjectId,

  financialSettings: {
    currency: String,
    billingType: String,
    agreedValue: Number
  },

  startDate: Date,
  expectedEndDate: Date,
  completedAt: Date,

  status: String,

  customFieldValues: Object,

  createdAt: Date,
  updatedAt: Date
}
```

Important: The `financialSettings` field contains the project-level commercial agreement snapshot. Actual invoice and payment records must remain separate.

Indexes:

- Unique `{ organizationId, projectCode }`.
- `{ organizationId, clientId }`.
- `{ organizationId, projectManagerId, status }`.
- `{ organizationId, status, expectedEndDate }`.

## 7.4 project_members

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,
  userId: ObjectId,

  role: String,

  assignedAt: Date,

  status: "active" | "removed"
}
```

Unique active membership should be enforced through an appropriate compound index or controlled assignment logic.

---

# 8. Workflow Database Schemas

The workflow engine must use configuration definitions and execution instances separately.

## 8.1 workflow_templates

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,
  description: String,

  category: String,

  status: "draft" | "published" | "archived",

  currentPublishedVersionId: ObjectId,

  createdBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

## 8.2 workflow_versions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  workflowTemplateId: ObjectId,

  version: Number,

  definition: {
    phases: [],
    transitions: [],
    globalRules: []
  },

  status: "draft" | "published" | "archived",

  publishedAt: Date,
  publishedBy: ObjectId,

  createdAt: Date
}
```

The definition should be validated against a strict JSON schema before publishing.

Published versions must be immutable.

## 8.3 project_workflows

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,

  workflowTemplateId: ObjectId,
  workflowVersionId: ObjectId,

  status: "active" | "completed" | "cancelled" | "paused",

  currentPhaseInstanceId: ObjectId,

  startedAt: Date,
  completedAt: Date,

  createdAt: Date
}
```

## 8.4 phase_instances

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,
  workflowInstanceId: ObjectId,

  phaseKey: String,
  phaseName: String,

  sequence: Number,

  status: String,

  assignedUserIds: [ObjectId],

  entryConditionsSnapshot: Object,

  completionConditionsSnapshot: Object,

  startedAt: Date,
  completedAt: Date,

  createdAt: Date,
  updatedAt: Date
}
```

The configuration snapshot should preserve the applicable requirements even when the template changes later.

## 8.5 workflow_executions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  workflowInstanceId: ObjectId,
  phaseInstanceId: ObjectId,

  eventType: String,

  previousStatus: String,
  newStatus: String,

  triggeredBy: ObjectId,

  executionResult: "success" | "failed",

  details: Object,

  createdAt: Date
}
```

---

# 9. Task Schemas

## 9.1 tasks

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,
  phaseInstanceId: ObjectId,

  title: String,
  description: String,

  assignedTo: ObjectId,
  assignedDepartmentId: ObjectId,

  priority: "low" | "medium" | "high" | "urgent",

  status: "todo" | "in_progress" | "blocked" | "completed" | "cancelled",

  dueDate: Date,

  isMandatory: Boolean,

  dependencies: [ObjectId],

  completedAt: Date,

  createdAt: Date,
  updatedAt: Date
}
```

## 9.2 task_comments

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  taskId: ObjectId,

  authorId: ObjectId,

  message: String,

  visibility: "internal" | "client",

  attachments: [Object],

  createdAt: Date
}
```

---

# 10. Document Schemas

## 10.1 document_categories

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,
  description: String,

  status: "active" | "inactive"
}
```

## 10.2 document_types

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  categoryId: ObjectId,

  name: String,
  description: String,

  allowedExtensions: [String],

  maxFileSizeBytes: Number,

  requiresExpiryDate: Boolean,

  requiresVerification: Boolean,

  customMetadataSchema: Object,

  status: "active" | "inactive"
}
```

## 10.3 document_templates

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,

  clientTypes: [String],

  projectCategories: [String],

  requirements: [
    {
      documentTypeId: ObjectId,
      isMandatory: Boolean,
      phaseKey: String
    }
  ],

  status: "active" | "inactive"
}
```

For templates that need historical reproducibility, introduce explicit versions.

## 10.4 document_requirements

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,
  clientId: ObjectId,

  documentTypeId: ObjectId,

  phaseInstanceId: ObjectId,

  isMandatory: Boolean,

  status: String,

  dueDate: Date,

  approvedDocumentId: ObjectId,

  createdAt: Date,
  updatedAt: Date
}
```

## 10.5 documents

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  clientId: ObjectId,
  projectId: ObjectId,

  requirementId: ObjectId,

  documentTypeId: ObjectId,

  currentVersionId: ObjectId,

  visibility: "internal" | "client",

  expiryDate: Date,

  status: String,

  createdAt: Date,
  updatedAt: Date
}
```

## 10.6 document_versions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  documentId: ObjectId,

  version: Number,

  originalFileName: String,

  storageKey: String,

  mimeType: String,

  fileSizeBytes: Number,

  checksum: String,

  uploadedBy: ObjectId,

  verificationStatus: String,

  verifiedBy: ObjectId,
  verifiedAt: Date,

  createdAt: Date
}
```

Store file metadata in MongoDB and the actual file in private object storage.

## 10.7 document_reviews

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  documentId: ObjectId,
  documentVersionId: ObjectId,

  reviewerId: ObjectId,

  decision: "approved" | "rejected" | "revision_requested",

  comments: String,

  createdAt: Date
}
```

---

# 11. Financial Database Schemas

Financial records require precise monetary handling and careful versioning.

## 11.1 payment_methods

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,

  type: "cash" | "upi" | "bank_transfer" | "cheque" | "gateway" | "custom",

  configuration: Object,

  requiredMetadataFields: [],

  status: "active" | "inactive",

  createdAt: Date,
  updatedAt: Date
}
```

Do not store plaintext gateway secrets in this configuration. Use encrypted secret storage.

## 11.2 payment_schedules

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  projectId: ObjectId,

  title: String,

  calculationType: "fixed" | "percentage",

  amount: Number,

  currency: String,

  triggerType: "date" | "phase_completion" | "manual",

  dueDate: Date,

  phaseInstanceId: ObjectId,

  status: "pending" | "due" | "paid" | "cancelled",

  createdAt: Date,
  updatedAt: Date
}
```

Store money as Decimal128 or integer minor units consistently across the application. The example uses Number only as a conceptual placeholder.

## 11.3 invoices

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  clientId: ObjectId,
  projectId: ObjectId,

  invoiceNumber: String,

  invoiceDate: Date,
  dueDate: Date,

  currency: String,

  status: String,

  billingSnapshot: Object,

  lineItemsSnapshot: [],

  taxSummary: [],

  subtotal: Decimal128,
  discountTotal: Decimal128,
  taxTotal: Decimal128,
  grandTotal: Decimal128,

  amountPaid: Decimal128,
  outstandingAmount: Decimal128,

  issuedAt: Date,

  createdBy: ObjectId,

  createdAt: Date,
  updatedAt: Date
}
```

For issued invoices, preserve the issued snapshot. Corrections should use proper adjustment records.

## 11.4 invoice_items

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  invoiceId: ObjectId,

  description: String,

  quantity: Decimal128,

  unitPrice: Decimal128,

  discount: Decimal128,

  taxableAmount: Decimal128,

  taxComponents: [
    {
      taxType: String,
      rate: Decimal128,
      amount: Decimal128
    }
  ],

  total: Decimal128
}
```

## 11.5 invoice_sequences

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  financialYear: String,

  documentType: "invoice" | "credit_note" | "debit_note",

  prefix: String,

  currentSequence: Number,

  updatedAt: Date
}
```

Use atomic sequence increments. The unique index should include organization, financial year and document type.

## 11.6 payments

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  clientId: ObjectId,
  projectId: ObjectId,

  paymentReference: String,

  paymentMethodId: ObjectId,

  amount: Decimal128,

  currency: String,

  transactionDate: Date,

  externalTransactionId: String,

  verificationStatus: String,

  status: String,

  proofStorageKey: String,

  verifiedBy: ObjectId,
  verifiedAt: Date,

  createdAt: Date
}
```

## 11.7 payment_allocations

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  paymentId: ObjectId,
  invoiceId: ObjectId,

  allocatedAmount: Decimal128,

  currency: String,

  allocatedAt: Date,

  createdBy: ObjectId
}
```

## 11.8 refunds

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  paymentId: ObjectId,

  amount: Decimal128,

  currency: String,

  reason: String,

  externalRefundReference: String,

  status: String,

  processedAt: Date,

  createdAt: Date
}
```

## 11.9 credit_notes and debit_notes

Each should preserve:

- Organization.
- Client.
- Original invoice.
- Adjustment reference.
- Adjustment reason.
- Monetary values.
- Tax breakdown.
- Issuance timestamp.
- Approval history.

Never alter an issued invoice to simulate a credit or debit adjustment.

---

# 12. Forms and Custom Field Schemas

## 12.1 form_definitions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,

  targetEntity: String,

  fields: [
    {
      key: String,
      label: String,
      type: String,
      required: Boolean,
      options: [],
      validations: [],
      visibilityRules: []
    }
  ],

  version: Number,

  status: "draft" | "published" | "archived",

  createdAt: Date
}
```

Published form versions should be immutable.

## 12.2 form_submissions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  formDefinitionId: ObjectId,

  formVersion: Number,

  submittedBy: ObjectId,

  targetEntity: String,
  targetEntityId: ObjectId,

  values: Object,

  status: String,

  submittedAt: Date,

  createdAt: Date
}
```

## 12.3 custom_field_definitions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  entityType: String,

  fieldKey: String,

  label: String,

  fieldType: String,

  required: Boolean,

  validationRules: Object,

  options: [],

  status: "active" | "inactive"
}
```

Custom fields should be validated against their definitions before persistence.

---

# 13. Approvals and Automation Schemas

## 13.1 approval_templates

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,

  entityType: String,

  approvalSteps: [
    {
      sequence: Number,
      approverRoleId: ObjectId,
      approvalMode: "sequential" | "parallel"
    }
  ],

  conditions: [],

  status: String
}
```

## 13.2 approval_requests

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  templateId: ObjectId,

  resourceType: String,
  resourceId: ObjectId,

  status: String,

  currentStep: Number,

  requestedBy: ObjectId,

  createdAt: Date,
  completedAt: Date
}
```

## 13.3 approval_actions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  approvalRequestId: ObjectId,

  approverId: ObjectId,

  decision: String,

  comments: String,

  step: Number,

  createdAt: Date
}
```

## 13.4 automation_rules

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  name: String,

  trigger: {
    event: String
  },

  conditions: [],

  actions: [],

  version: Number,

  status: "draft" | "active" | "disabled",

  createdAt: Date,
  updatedAt: Date
}
```

## 13.5 automation_executions

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  automationRuleId: ObjectId,

  eventId: String,

  executionStatus: String,

  startedAt: Date,
  completedAt: Date,

  result: Object,

  error: Object,

  retryCount: Number
}
```

---

# 14. Communication and Audit Schemas

## 14.1 notification_templates

Store versioned notification templates with:

- Organization ID.
- Name.
- Channel.
- Trigger event.
- Subject.
- Body.
- Placeholder definitions.
- Status.
- Version.

## 14.2 notifications

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  recipientUserId: ObjectId,

  channel: String,

  title: String,
  message: String,

  resourceType: String,
  resourceId: ObjectId,

  deliveryStatus: String,

  readAt: Date,

  createdAt: Date
}
```

## 14.3 communication_threads

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  clientId: ObjectId,
  projectId: ObjectId,

  subject: String,

  participants: [ObjectId],

  visibility: String,

  status: String,

  createdAt: Date,
  updatedAt: Date
}
```

## 14.4 messages

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  threadId: ObjectId,

  senderId: ObjectId,

  message: String,

  attachments: [],

  visibility: "internal" | "client",

  createdAt: Date
}
```

## 14.5 audit_logs

```javascript
{
  _id: ObjectId,

  organizationId: ObjectId,

  actorId: ObjectId,

  action: String,

  resourceType: String,
  resourceId: ObjectId,

  before: Object,
  after: Object,

  requestId: String,

  ipAddress: String,

  userAgent: String,

  createdAt: Date
}
```

Audit records should be append-only and protected against modification by normal application roles.

Avoid recording passwords, access tokens, payment secrets or unnecessary personal information in audit snapshots.

---

# 15. Database Indexing Strategy

Tenant-aware indexing is mandatory.

Examples:

| Collection | Index |
|---|---|
| clients | organizationId + status |
| clients | organizationId + clientCode (unique) |
| projects | organizationId + clientId |
| projects | organizationId + projectManagerId |
| tasks | organizationId + assignedTo + status |
| tasks | organizationId + dueDate |
| documents | organizationId + projectId |
| invoices | organizationId + invoiceNumber (unique) |
| payments | organizationId + transactionDate |
| workflows | organizationId + status |
| audit_logs | organizationId + createdAt |

Additional requirements:

- Use pagination-friendly indexes.
- Avoid indexing every field.
- Review query execution plans.
- Use TTL indexes only for explicitly temporary records.
- Use partial unique indexes for records with conditional uniqueness.
- Consider MongoDB Search for advanced search capabilities.

---

# 16. Data Integrity and Transaction Requirements

Use MongoDB transactions for multi-document operations where consistency is required.

Critical transactional operations:

1. Invoice issuance and sequence allocation.
2. Payment creation and allocation.
3. Refund processing.
4. Approval completion and associated state transition.
5. Workflow phase completion and transition.
6. Configuration publication.
7. Client or project creation with dependent records.

MongoDB production deployments must use a replica set or an appropriate supported deployment topology for transactions.

Use optimistic concurrency through version fields or conditional updates for frequently modified records.

Use idempotency keys for retryable financial and workflow operations.

---

# 17. Data Retention and Archival

Define organization-specific retention policies.

Support:

- Active records.
- Archived records.
- Soft-deleted records where appropriate.
- Financial record retention.
- Document retention.
- Audit log retention.
- User data export.
- Tenant data export.
- Tenant deletion and verified deletion workflows.

Retention rules must respect applicable legal and regulatory requirements.

---

# 18. Database Acceptance Criteria

The schema is ready for development when:

- All collections have approved ownership rules.
- Every tenant-owned collection has an organizationId.
- Unique constraints are defined.
- Tenant-aware indexes are defined.
- Workflow templates and instances are separated.
- Configuration versions are immutable.
- Document versions are independent.
- Invoice and payment relationships are defined.
- Payment allocations support partial and multiple invoice settlement.
- Financial values use precise representations.
- Audit history is protected.
- Critical transactional operations are documented.
- Tenant isolation tests pass.

---

# 19. Final Database Architecture Decision

The recommended initial implementation is a shared MongoDB database with shared collections and organization-scoped documents.

Use a consistent tenant ownership convention and enforce it in the service and repository layers.

The system should be capable of evolving toward dedicated tenant databases or isolated deployments for enterprise customers without requiring a complete rewrite of business modules.

**The database is not merely a storage layer. It is the foundation of the platform's configuration, workflow and financial integrity.**