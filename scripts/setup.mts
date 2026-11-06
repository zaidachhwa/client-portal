// One-time production setup: creates your organization and its first admin (Account manager) in an EMPTY database.
//   MONGODB_URI="mongodb+srv://…" npm run setup
// Asks for the organization name, your name, email and a password (or reads SETUP_ORG, SETUP_FIRST_NAME,
// SETUP_LAST_NAME, SETUP_EMAIL, SETUP_PASSWORD). Refuses to run if an organization exists.
// Never run `npm run seed` against production: it wipes the database to load demo data.
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import mongoose from "mongoose";
import { Membership, Organization, Permission, PaymentMethod, Role, RolePermission, User, WorkflowTemplate, WorkflowVersion } from "../lib/models.ts";
import { hashPassword } from "../lib/password.ts";
import { DEFAULT_ROLES, permissionDocs } from "../lib/permissions.ts";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Set MONGODB_URI to the production database (e.g. your Atlas connection string).");

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (q: string, check: (v: string) => string | null, env?: string) => {
  const preset = env && process.env[env]?.trim();
  if (preset) {
    const problem = check(preset);
    if (problem) throw new Error(`${env}: ${problem}`);
    return preset;
  }
  for (;;) {
    const v = (await rl.question(q)).trim();
    const problem = check(v);
    if (!problem) return v;
    console.log(`  ${problem}`);
  }
};
// Password prompt that doesn't echo what's typed.
const askSecret = async (q: string) => {
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = out._writeToOutput.bind(rl);
  const answer = rl.question(q);
  out._writeToOutput = (s) => write(s.startsWith(q) ? s : "");
  const v = await answer;
  out._writeToOutput = write;
  stdout.write("\n");
  return v;
};

await mongoose.connect(uri);
if (await Organization.exists({})) {
  console.error("This database already has an organization. Setup only runs once, on an empty database.");
  process.exit(1);
}
console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}\n`);

const orgName = await ask("Organization name: ", (v) => (v.length >= 2 ? null : "Enter a name."), "SETUP_ORG");
const firstName = await ask("Your first name: ", (v) => (v ? null : "Enter your first name."), "SETUP_FIRST_NAME");
const lastName = process.env.SETUP_LAST_NAME?.trim() ?? (await rl.question("Your last name: ")).trim();
const email = (await ask("Your email (you sign in with this): ", (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email."), "SETUP_EMAIL")).toLowerCase();
let password = process.env.SETUP_PASSWORD ?? "";
if (password && password.length < 10) throw new Error("SETUP_PASSWORD must be at least 10 characters.");
while (!password) {
  const first = await askSecret("Password (at least 10 characters): ");
  if (first.length < 10) { console.log("  Too short."); continue; }
  if ((await askSecret("Repeat password: ")) === first) password = first;
  else console.log("  Those didn't match.");
}
rl.close();

// Indexes first: unique constraints, tenant indexes and TTLs (sessions, notifications) must exist from day one.
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
const [org] = await Organization.insertMany([{ name: orgName, slug, settings: { timezone: "Asia/Kolkata", locale: "en-IN", defaultCurrency: "INR" } }]);
const organizationId = org._id;

await Permission.bulkWrite(permissionDocs().map((p) => ({ updateOne: { filter: { key: p.key }, update: { $set: p }, upsert: true } })));
const permissions = await Permission.find().lean();
const roles: Record<string, mongoose.Types.ObjectId> = {};
for (const [name, keys] of Object.entries(DEFAULT_ROLES)) {
  const [role] = await Role.insertMany([{ organizationId, name, isSystemRole: true }]);
  roles[name] = role._id;
  await RolePermission.insertMany(keys.map((k) => ({ organizationId, roleId: role._id, permissionId: permissions.find((p) => p.key === k)!._id })));
}

const [user] = await User.insertMany([{ firstName, lastName, email, passwordHash: hashPassword(password), emailVerifiedAt: new Date() }]);
await Membership.insertMany([{ organizationId, userId: user._id, membershipType: "employee", roleIds: [roles["Account manager"]], title: "Account manager", joinedAt: new Date() }]);

await PaymentMethod.insertMany([
  { organizationId, name: "UPI", type: "upi" },
  { organizationId, name: "Bank transfer", type: "bank_transfer" },
  { organizationId, name: "Cheque", type: "cheque" },
  { organizationId, name: "Cash", type: "cash" },
]);

// A generic workflow so the first project can be created; tasks marked "client" wait for the client to join.
const [template] = await WorkflowTemplate.insertMany([{ organizationId, name: "Client onboarding", category: "General", status: "published", createdBy: user._id }]);
const [version] = await WorkflowVersion.insertMany([{
  organizationId, workflowTemplateId: template._id, version: 1, status: "published", publishedAt: new Date(), publishedBy: user._id,
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

console.log(`\nDone. "${orgName}" is ready. Sign in as ${email}, then open Settings to add your GSTIN and address.`);
await mongoose.disconnect();
