// One-time production setup: creates your organization and its first admin (Account manager) in an EMPTY database.
//   MONGODB_URI="mongodb+srv://…" npm run setup
// Asks for the organization name, your name, email and a password (or reads SETUP_ORG, SETUP_FIRST_NAME,
// SETUP_LAST_NAME, SETUP_EMAIL, SETUP_PASSWORD). Refuses to run if an organization exists.
// Never run `npm run seed` against production: it wipes the database to load demo data.
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import mongoose from "mongoose";
import { Membership, Organization, User } from "../lib/models.ts";
import { hashPassword } from "../lib/password.ts";
import { provisionOrganization, slugify } from "../lib/provision.ts";

const uri = process.env.MONGODB_URI;
if (!uri)
  throw new Error(
    "Set MONGODB_URI to the production database (e.g. your Atlas connection string).",
  );

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (
  q: string,
  check: (v: string) => string | null,
  env?: string,
) => {
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
  if (!stdin.isTTY)
    throw new Error(
      "Password input requires a terminal; set SETUP_PASSWORD for non-interactive setup.",
    );

  rl.close();
  emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  const wasPaused = stdin.isPaused();
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(q);

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(wasRaw);
      if (wasPaused) stdin.pause();
      stdout.write("\n");
    };
    const onKeypress = (
      character: string,
      key: { name?: string; ctrl?: boolean; meta?: boolean },
    ) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Password prompt cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    };
    stdin.on("keypress", onKeypress);
  });
};

await mongoose.connect(uri);
if (await Organization.exists({})) {
  console.error(
    "This database already has an organization. Setup only runs once, on an empty database.",
  );
  process.exit(1);
}
console.log(
  `Connected to ${mongoose.connection.host}/${mongoose.connection.name}\n`,
);

const orgName = await ask(
  "Organization name: ",
  (v) => (v.length >= 2 ? null : "Enter a name."),
  "SETUP_ORG",
);
const firstName = await ask(
  "Your first name: ",
  (v) => (v ? null : "Enter your first name."),
  "SETUP_FIRST_NAME",
);
const lastName =
  process.env.SETUP_LAST_NAME?.trim() ??
  (await rl.question("Your last name: ")).trim();
const email = (
  await ask(
    "Your email (you sign in with this): ",
    (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email.",
    "SETUP_EMAIL",
  )
).toLowerCase();
let password = process.env.SETUP_PASSWORD ?? "";
if (password && password.length < 10)
  throw new Error("SETUP_PASSWORD must be at least 10 characters.");
while (!password) {
  const first = await askSecret("Password (at least 10 characters): ");
  if (first.length < 10) {
    console.log("  Too short.");
    continue;
  }
  if ((await askSecret("Repeat password: ")) === first) password = first;
  else console.log("  Those didn't match.");
}
rl.close();

// Indexes first: unique constraints, tenant indexes and TTLs (sessions, notifications) must exist from day one.
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

const { org, roles } = await provisionOrganization(orgName, slugify(orgName));
const organizationId = org._id;

const [user] = await User.insertMany([
  {
    firstName,
    lastName,
    email,
    passwordHash: hashPassword(password),
    emailVerifiedAt: new Date(),
  },
]);
await Membership.insertMany([
  {
    organizationId,
    userId: user._id,
    membershipType: "employee",
    roleIds: [roles["Account manager"]],
    title: "Account manager",
    joinedAt: new Date(),
  },
]);

console.log(
  `\nDone. "${orgName}" is ready. Sign in as ${email}, then open Settings to add your GSTIN and address.`,
);
await mongoose.disconnect();
