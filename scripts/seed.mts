// Demo data, dated relative to today so the calendar always has something on it.
// Run: npm run seed -- --wipe  (DELETES the database and ./storage first). Every demo password is "demo1234".
import { randomBytes, createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {
  Client, ClientContact, CommunicationThread, Document, DocumentTemplate, DocumentRequirement, DocumentType, DocumentVersion, Membership, Message,
  Organization, Permission, PhaseInstance, Project, ProjectMember, ProjectWorkflow, Role, RolePermission, Task, User,
  WorkflowTemplate, WorkflowVersion, AuditLog, Invoice, InvoiceSequence, Notification, Payment, PaymentAllocation, PaymentMethod,
} from "../lib/models.ts";
import { computeInvoice, financialYear, invoiceStatus, outstanding } from "../lib/money.ts";
import { hashPassword } from "../lib/password.ts";
import { DEFAULT_ROLES, permissionDocs } from "../lib/permissions.ts";

const STORAGE = path.join(process.cwd(), "storage");

// Wiping is irreversible, so it never happens by accident: `npm run seed -- --wipe`.
if (!process.argv.includes("--wipe")) {
  console.error("This DELETES everything in the database and loads demo data. Run: npm run seed -- --wipe");
  process.exit(1);
}
await mongoose.connect(process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27037/client-portal?directConnection=true");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to load demo data with NODE_ENV=production.");
await mongoose.connection.dropDatabase();
await rm(STORAGE, { recursive: true, force: true });
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

const day = (n: number, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d;
};

const org = await Organization.create({
  name: "Zenova Studio", legalName: "Zenova Studio LLP", slug: "zenova", industry: "Marketing agency", taxInformation: { gstin: "27AAJFZ4321K1Z8", pan: "AAJFZ4321K" }, email: "hello@zenova.studio", phone: "+91 20 4000 1234",
  address: { line1: "4th floor, Baner Road", city: "Pune", state: "Maharashtra", postalCode: "411045", country: "India" },
  settings: { timezone: "Asia/Kolkata", locale: "en-IN", defaultCurrency: "INR" },
});
const organizationId = org._id;

// §6 Permissions are platform-wide; roles and grants are per organization.
const permissions = await Permission.create(permissionDocs());
const roleGrants = DEFAULT_ROLES;
const roles: Record<string, mongoose.Types.ObjectId> = {};
for (const [name, keys] of Object.entries(roleGrants)) {
  const role = await Role.create({ organizationId, name, isSystemRole: true });
  roles[name] = role._id;
  await RolePermission.create(
    keys.map((k) => ({ organizationId, roleId: role._id, permissionId: permissions.find((p) => p.key === k)!._id })),
  );
}

const passwordHash = hashPassword("demo1234");
const [maya, sam, ed, noor] = await User.create([
  { firstName: "Maya", lastName: "Lin", email: "maya@zenova.studio", passwordHash },
  { firstName: "Sam", lastName: "Ortiz", email: "sam@zenova.studio", passwordHash },
  { firstName: "Ed", lastName: "Carter", email: "ed@brightside.dental", passwordHash },
  { firstName: "Noor", lastName: "Haddad", email: "noor@haddadphysio.com", passwordHash },
]);

await Membership.create([
  { organizationId, userId: maya._id, membershipType: "employee", roleIds: [roles["Account manager"]], title: "Account manager", joinedAt: day(-200) },
  { organizationId, userId: sam._id, membershipType: "employee", roleIds: [roles.Specialist], title: "SEO specialist", joinedAt: day(-120) },
  { organizationId, userId: ed._id, membershipType: "client", roleIds: [roles.Client], title: "Client · Brightside Dental", joinedAt: day(-30) },
  { organizationId, userId: noor._id, membershipType: "client", roleIds: [roles.Client], title: "Client · Haddad Physio", joinedAt: day(-10) },
]);

// §10 Document types the onboarding phase asks for.
const [brandGuide, logo, registration] = await DocumentType.create([
  { organizationId, name: "Branding guide", allowedExtensions: ["pdf", "zip"], maxFileSizeBytes: 10_000_000 },
  { organizationId, name: "Logo files", allowedExtensions: ["png", "svg", "zip"], maxFileSizeBytes: 5_000_000 },
  { organizationId, name: "Business registration certificate", allowedExtensions: ["pdf", "png", "jpg"], maxFileSizeBytes: 5_000_000 },
]);

// §10.3 Every Local SEO project collects the same three documents during onboarding.
await DocumentTemplate.create({
  organizationId, name: "Local SEO onboarding documents", projectCategories: ["Local SEO"],
  requirements: [brandGuide, logo, registration].map((t) => ({ documentTypeId: t._id, isMandatory: true, phaseKey: "onboarding" })),
});

// §8 One published workflow; projects run instances of its version 1.
const template = await WorkflowTemplate.create({
  organizationId, name: "Local SEO onboarding", category: "Local SEO", status: "published", createdBy: maya._id,
});
const version = await WorkflowVersion.create({
  organizationId, workflowTemplateId: template._id, version: 1, status: "published", publishedAt: day(-60), publishedBy: maya._id,
  definition: {
    phases: [
      {
        key: "onboarding", name: "Account setup", completion: { mandatoryTasks: true, mandatoryDocuments: true },
        tasks: [
          { title: "Complete onboarding questionnaire", mandatory: true, assignee: "client", dueInDays: 2 },
          { title: "Share access", mandatory: true, assignee: "client", dueInDays: 4 },
          { title: "Complete business verification", mandatory: true, assignee: "client", dueInDays: 6 },
          { title: "Choose your preferences", mandatory: true, assignee: "client", dueInDays: 8 },
          { title: "Kick-off call", mandatory: true, assignee: "manager", dueInDays: 3 },
        ],
      },
      {
        key: "delivery", name: "Monthly delivery", completion: { mandatoryTasks: false, mandatoryDocuments: false },
        tasks: [
          { title: "Keyword research", assignee: "manager", dueInDays: 14 },
          { title: "Weekly SEO health check", assignee: "manager", dueInDays: 21 },
        ],
      },
    ],
  },
});
template.currentPublishedVersionId = version._id;
await template.save();

// Demo files are random bytes of the stated size, so downloads work end to end.
async function storeFile(documentId: unknown, size: number) {
  const key = `${organizationId}/${documentId}/1`;
  const data = randomBytes(size);
  await mkdir(path.join(STORAGE, path.dirname(key)), { recursive: true });
  await writeFile(path.join(STORAGE, key), data);
  return { key, checksum: createHash("sha256").update(data).digest("hex") };
}

type File = [name: string, mime: string, size: number, status: "approved" | "pending_review", requirement?: "brand" | "logo"];

async function seedProject(opts: {
  code: string; clientName: string; projectName: string; contact: typeof ed; offset: number; gstin: string; city: string;
  delivery: [string, string, number, boolean][]; onboardingDone: number; files: File[]; chat: [typeof ed, string, number][];
}) {
  const client = await Client.create({
    organizationId, clientCode: opts.code, clientType: "organization", displayName: opts.clientName, accountManagerId: maya._id,
    organizationDetails: { legalName: `${opts.clientName} Pvt Ltd`, gstin: opts.gstin, pan: opts.gstin.slice(2, 12) },
    billingAddress: { city: opts.city, state: "Maharashtra", country: "India" },
  });
  const primary = await ClientContact.create({
    organizationId, clientId: client._id, name: `${opts.contact.firstName} ${opts.contact.lastName}`, designation: "Owner",
    email: opts.contact.email, isPrimary: true,
  });
  client.primaryContactId = primary._id;
  await client.save();
  const project = await Project.create({
    organizationId, projectCode: `${opts.code}-SEO`, clientId: client._id, name: opts.projectName, category: "Local SEO",
    projectManagerId: maya._id, startDate: day(opts.offset - 30), expectedEndDate: day(opts.offset + 60),
  });
  const scope = { organizationId, projectId: project._id };
  await ProjectMember.create([
    { ...scope, userId: maya._id, role: "manager", accessLevel: "manage" },
    { ...scope, userId: sam._id, role: "specialist", accessLevel: "edit" },
    { ...scope, userId: opts.contact._id, role: "client", accessLevel: "edit" },
  ]);

  // Instantiate the workflow; each phase snapshots its completion rules (§8.4).
  const workflow = await ProjectWorkflow.create({
    ...scope, workflowTemplateId: template._id, workflowVersionId: version._id, startedAt: day(opts.offset - 30),
  });
  const [onboarding, delivery] = await PhaseInstance.insertMany(
    version.definition!.phases.map((p, i) => ({
      ...scope, workflowInstanceId: workflow._id, phaseKey: p.key, phaseName: p.name, sequence: i + 1,
      status: i === 0 ? "active" : "pending", startedAt: i === 0 ? day(opts.offset - 30) : undefined,
      completionConditionsSnapshot: p.completion, assignedUserIds: [maya._id],
    })),
  );
  workflow.currentPhaseInstanceId = onboarding._id;
  await workflow.save();

  await Task.create([
    ...["Complete onboarding questionnaire", "Share access", "Complete business verification", "Choose your preferences"]
      .map((title, i) => ({
        ...scope, phaseInstanceId: onboarding._id, title, assignedTo: opts.contact._id, isMandatory: true,
        dueDate: day(opts.offset + i * 2), ...(i < opts.onboardingDone && { status: "completed" as const, completedAt: day(-3) }),
      })),
    ...opts.delivery.map(([title, description, due, done]) => ({
      ...scope, phaseInstanceId: delivery._id, title, description, assignedTo: sam._id, dueDate: day(opts.offset + due),
      ...(done && { status: "completed" as const, completedAt: day(opts.offset + due) }),
    })),
  ]);

  const requirement = Object.fromEntries(
    await Promise.all(
      ([["brand", brandGuide], ["logo", logo], ["registration", registration]] as const).map(async ([k, type]) => [
        k,
        await DocumentRequirement.create({
          ...scope, clientId: client._id, documentTypeId: type._id, phaseInstanceId: onboarding._id, dueDate: day(opts.offset + 7),
        }),
      ]),
    ),
  );

  for (const [name, mimeType, size, status, req] of opts.files) {
    const r = req && requirement[req];
    const doc = await Document.create({ ...scope, clientId: client._id, status, requirementId: r?._id, documentTypeId: r?.documentTypeId });
    const { key, checksum } = await storeFile(doc._id, size);
    const v = await DocumentVersion.create({
      organizationId, documentId: doc._id, version: 1, originalFileName: name, storageKey: key, checksum,
      mimeType, fileSizeBytes: size, uploadedBy: opts.contact._id, verificationStatus: status === "approved" ? "approved" : "pending",
    });
    doc.currentVersionId = v._id;
    await doc.save();
    if (r) {
      r.status = status === "approved" ? "approved" : "submitted";
      if (status === "approved") r.approvedDocumentId = doc._id;
      await r.save();
    }
  }

  const thread = await CommunicationThread.create({
    ...scope, clientId: client._id, subject: opts.projectName, participants: [maya._id, opts.contact._id],
  });
  for (const [sender, message, minutesAgo] of opts.chat) {
    await Message.create({
      organizationId, threadId: thread._id, senderId: sender._id, message, createdAt: new Date(Date.now() - minutesAgo * 60_000),
    });
  }
  return { project, client };
}

const brightside = await seedProject({
  code: "BRT", clientName: "Brightside Dental", gstin: "27AABCB1234C1Z5", city: "Pune", projectName: "Local SEO retainer", contact: ed, offset: 0, onboardingDone: 1,
  delivery: [
    ["Weekly SEO health check", "Review GSC coverage and queries, GA4 sessions and conversions, fix quick issues, update tracker.", 1, false],
    ["GBP post & photo update", "Publish a GBP post, add two fresh photos of the team and equipment, answer new Q&A.", 2, false],
    ["Content calendar", "Monthly articles targeting patient questions and long-tail keywords; include FAQs and schema.", 6, false],
    ["Local backlinks & citations", "Industry associations, local chambers, partner clinics, high-quality directories; fix NAP.", 9, false],
    ["Sitemap submission", "Generate XML sitemap and submit to Google Search Console.", -4, true],
    ["Competitor gap report", "Compare top three local competitors on keywords, reviews and backlinks.", -9, true],
    ["Review response templates", "Draft reply templates for 5★, 3★ and 1★ reviews for the front desk.", -2, false],
  ],
  files: [
    ["Brightside-branding-guide.pdf", "application/pdf", 482_000, "pending_review", "brand"],
    ["clinic-front-desk.jpg", "image/jpeg", 124_000, "approved"],
    ["team-photo-2026.png", "image/png", 252_000, "approved"],
    ["logo-updated.png", "image/png", 48_000, "pending_review", "logo"],
    ["welcome-voicemail.mp3", "audio/mpeg", 81_000, "approved"],
  ],
  chat: [
    [maya, "Welcome aboard, Ed! I've set up your onboarding checklist. Start with the questionnaire whenever you're ready.", 2880],
    [ed, "Done with the questionnaire. Where should I send the brand guide?", 1500],
    [maya, "Upload it under Required Documents and I'll review it the same day.", 1440],
    [ed, "I tried changing the colors in the header but it didn't make the change. What can I do?", 45],
    [maya, "That's a cache thing. Hard refresh (Ctrl+Shift+R) and it should show. Let me know what happens.", 30],
  ],
});

const haddad = await seedProject({
  code: "HDP", clientName: "Haddad Physio", gstin: "27AAECH5678D1Z2", city: "Mumbai", projectName: "Website + local SEO", contact: noor, offset: 3, onboardingDone: 0,
  delivery: [
    ["Keyword research", "Map service pages to physiotherapy search intent per suburb.", 0, false],
    ["Service page outlines", "Outline five service pages with headings and FAQ blocks.", 4, false],
    ["GBP category audit", "Check primary and secondary categories against competitors.", -5, true],
  ],
  files: [["haddad-logo.svg", "image/svg+xml", 18_400, "pending_review", "logo"]],
  chat: [[maya, "Hi Noor! Your workspace is ready. The checklist on the left walks you through setup.", 600]],
});

// §11 Billing: payment methods, a few issued invoices and payments in each state.
const [upi, bank] = await PaymentMethod.create([
  { organizationId, name: "UPI", type: "upi" },
  { organizationId, name: "Bank transfer", type: "bank_transfer" },
  { organizationId, name: "Cheque", type: "cheque" },
  { organizationId, name: "Cash", type: "cash" },
]);

const sequences = new Map<string, number>();
async function invoice(p: typeof brightside, issued: number, dueIn: number, lines: [string, number, number][]) {
  const date = day(issued);
  const fy = financialYear(date);
  sequences.set(fy, (sequences.get(fy) ?? 0) + 1);
  const t = computeInvoice(lines.map(([description, qty, price]) => ({ description, quantity: qty * 100, unitPrice: price * 100, rateBp: 1800 })), true);
  return Invoice.create({
    organizationId, clientId: p.client._id, projectId: p.project._id, invoiceNumber: `INV/${fy}/${String(sequences.get(fy)).padStart(4, "0")}`,
    invoiceDate: date, dueDate: day(issued + dueIn, 23), issuedAt: date, createdBy: maya._id,
    billingSnapshot: {
      seller: { name: org.legalName, gstin: org.taxInformation!.gstin, address: org.address },
      buyer: { name: p.client.organizationDetails!.legalName, gstin: p.client.organizationDetails!.gstin, address: p.client.billingAddress },
      project: { code: p.project.projectCode, name: p.project.name }, placeOfSupply: "Maharashtra", intraState: true,
    },
    lineItemsSnapshot: t.items, taxSummary: t.taxSummary, subtotal: t.subtotal, discountTotal: 0, taxTotal: t.taxTotal, grandTotal: t.grandTotal,
    outstandingAmount: t.grandTotal,
  });
}

let paymentCount = 0;
async function payment(
  p: typeof brightside, rupees: number, daysAgo: number, method: typeof upi, by: typeof ed,
  opts: { verified: boolean; utr?: string; settles?: Awaited<ReturnType<typeof invoice>> },
) {
  const amount = rupees * 100;
  const pay = await Payment.create({
    organizationId, clientId: p.client._id, projectId: p.project._id, paymentReference: `PAY-${String(++paymentCount).padStart(4, "0")}`, paymentMethodId: method._id,
    amount, transactionDate: day(-daysAgo, 12), externalTransactionId: opts.utr, submittedBy: by._id,
    ...(opts.verified && { verificationStatus: "verified" as const, status: "completed" as const, verifiedBy: maya._id, verifiedAt: day(-daysAgo + 1) }),
  });
  const inv = opts.settles;
  if (inv) {
    await PaymentAllocation.create({ organizationId, paymentId: pay._id, invoiceId: inv._id, allocatedAmount: amount, createdBy: maya._id, allocatedAt: day(-daysAgo + 1) });
    inv.amountPaid += amount;
    inv.outstandingAmount = outstanding(inv);
    inv.status = invoiceStatus(inv);
    await inv.save();
  }
}

const brtSetup = await invoice(brightside, -40, 15, [["Local SEO setup and audit", 1, 25000]]);
await payment(brightside, 29500, 30, upi, ed, { verified: true, utr: "UPI/429184736512", settles: brtSetup });
await invoice(brightside, -5, 15, [["Local SEO retainer – November", 1, 25000], ["Clinic photo shoot", 1, 8000]]);
await payment(brightside, 10000, 1, upi, ed, { verified: false, utr: "UPI/431902245871" });
const hdpBuild = await invoice(haddad, -20, 15, [["Website design and build", 1, 60000], ["Service page copy", 5, 2500]]);
await payment(haddad, 20000, 12, bank, maya, { verified: true, utr: "NEFT N3120458", settles: hdpBuild });
await InvoiceSequence.create([...sequences].map(([financialYear, currentSequence]) => ({ organizationId, financialYear, documentType: "invoice" as const, prefix: "INV", currentSequence })));

// §14.2 A few inbox items so the bell has something to show on a fresh demo.
const brtLink = `/?project=${brightside.project._id}`;
await Notification.create([
  { organizationId, recipientUserId: maya._id, channel: "in_app", title: "Payment to verify: ₹10,000.00 for Local SEO retainer", message: "Ed Carter reported a UPI payment of ₹10,000.00 (ref UPI/431902245871).", resourceType: "project", resourceId: brightside.project._id, link: `${brtLink}#billing`, createdAt: day(-1, 12) },
  { organizationId, recipientUserId: maya._id, channel: "in_app", title: "To review: logo-updated.png", message: "Ed Carter uploaded “logo-updated.png” for Local SEO retainer.", resourceType: "project", resourceId: brightside.project._id, link: `${brtLink}#files`, createdAt: day(-2, 15) },
  { organizationId, recipientUserId: ed._id, channel: "in_app", title: "Invoice INV/2026-27/0002 from Zenova Studio", message: "Zenova Studio issued an invoice for ₹38,940.00.", resourceType: "project", resourceId: brightside.project._id, link: `${brtLink}#billing`, createdAt: day(-5, 11) },
]);

// §14.5 The seed's own history, so the activity log isn't empty on a fresh demo.
const [brtInvoices, hdpInvoices] = await Promise.all([brightside, haddad].map((p) => Invoice.find({ projectId: p.project._id }).sort({ invoiceDate: 1 }).lean()));
const seeded = { requestId: "seed", userAgent: "seed script" };
await AuditLog.insertMany([
  ...[brightside, haddad].flatMap((p, k) => [
    { action: "client.created", resourceType: "client", resourceId: p.client._id, after: { code: p.client.clientCode, displayName: p.client.displayName }, createdAt: day(-60 + k * 25, 10) },
    { action: "project.created", resourceType: "project", resourceId: p.project._id, after: { code: p.project.projectCode, name: p.project.name }, createdAt: day(-60 + k * 25, 11) },
  ]),
  ...[...brtInvoices, ...hdpInvoices].map((i) => ({
    action: "invoice.issued", resourceType: "invoice", resourceId: i._id, after: { invoiceNumber: i.invoiceNumber, grandTotal: i.grandTotal }, createdAt: i.invoiceDate,
  })),
  { action: "payment.verified", resourceType: "payment", resourceId: brtInvoices[0]._id, before: { verificationStatus: "pending" }, after: { verificationStatus: "verified" }, createdAt: day(-29, 10) },
  { action: "invitation.created", resourceType: "invitation", resourceId: noor._id, after: { email: noor.email, type: "client" }, createdAt: day(-12, 16) },
].map((e) => ({ organizationId, actorId: maya._id, ...seeded, ...e })));

console.log("Seeded org 'zenova': 4 users (password demo1234), 3 roles, 2 projects with workflows, document requirements, invoices and payments.");
await mongoose.disconnect();
