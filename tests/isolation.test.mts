// Tenant and project isolation (§6.4, §18), tested through the running app exactly as a browser would:
// page and file requests, and server actions posted with their action IDs.
//   "rival": an admin with every permission, in a different organization.
//   "noor":  a client in the same organization, but on another project.
// Each attack is paired with a control (Maya, who is allowed) so a broken harness can't pass silently.
// Needs: `npm run seed`, then `npm run dev` (or a production server) at TEST_BASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import mongoose, { Types } from "mongoose";
import * as M from "../lib/models.ts";
import { BASE, connect, sha256 } from "./helpers.mts";

type Id = Types.ObjectId;
const token = () => randomBytes(32).toString("base64url");
const tokens = { rival: token(), noor: token(), maya: token(), sam: token() };
const v: Record<string, Id> = {}; // victim records in the demo organization
let actionIds: Record<string, string> = {};
let invoiceNumber = "";

// ---- HTTP helpers

const get = (who: keyof typeof tokens, path: string) =>
  fetch(BASE + path, { headers: { Cookie: `sid=${tokens[who]}` }, redirect: "manual" });

// Server action wire format (React Flight "reply", as encodeReply produces it): arguments as a JSON array;
// each FormData argument becomes "$K<n>" (n counts from 1, hex) with its fields sent as "_<n>_<name>".
async function act(who: keyof typeof tokens, name: string, args: unknown[], page = "/") {
  const id = actionIds[name];
  assert.ok(id, `no action id for ${name}`);
  const fd = new FormData();
  let part = 0;
  const root = JSON.stringify(args.map((x) => {
    if (x === undefined) return "$undefined";
    if (!(x instanceof FormData)) return x;
    const n = (++part).toString(16);
    for (const [k, val] of x.entries()) fd.append(`_${n}_${k}`, val);
    return `$K${n}`;
  }));
  let body: BodyInit = root;
  if (part) {
    fd.set("0", root);
    body = fd;
  }
  const res = await fetch(BASE + page, {
    method: "POST",
    headers: { Cookie: `sid=${tokens[who]}`, "Next-Action": id, Origin: BASE, Accept: "text/x-component" },
    body,
  });
  await res.text();
  return res.status;
}

const form = (fields: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(fields)) f.append(k, val);
  return f;
};

// ---- Setup: rival org with an all-powerful admin, sessions for everyone, a few extra victim records

before(async () => {
  await fetch(BASE).catch(() => assert.fail(`The app isn't running at ${BASE}. Start it with npm run dev.`));
  await connect();
  const org = await M.Organization.findOne({ slug: "zenova" }).lean();
  assert.ok(org, "run npm run seed first");
  const orgId = org._id;
  const [maya, noor, ed] = await Promise.all(["maya@zenova.studio", "noor@haddadphysio.com", "ed@brightside.dental"].map((email) => M.User.findOne({ email }).lean()));
  const project = await M.Project.findOne({ organizationId: orgId, projectCode: "BRT-SEO" }).lean();
  const [task, doc, invoice, payment, method, phase] = await Promise.all([
    M.Task.findOne({ projectId: project!._id, assignedTo: ed!._id, status: { $ne: "completed" } }).lean(),
    M.Document.findOne({ projectId: project!._id, status: "pending_review" }).lean(),
    M.Invoice.findOne({ projectId: project!._id }).lean(),
    M.Payment.findOne({ projectId: project!._id, verificationStatus: "pending" }).lean(),
    M.PaymentMethod.findOne({ organizationId: orgId, status: "active" }).lean(),
    M.PhaseInstance.findOne({ projectId: project!._id, status: "active" }).lean(),
  ]);
  for (const [k, x] of Object.entries({ task, doc, invoice, payment, method, phase })) assert.ok(x, `demo data has no ${k}`);
  invoiceNumber = invoice!.invoiceNumber;
  const version = await M.DocumentVersion.findById(doc!.currentVersionId).lean();
  // Give the pending payment a real receipt, so the proof route has something to leak.
  await M.Payment.updateOne({ _id: payment!._id }, { proofStorageKey: version!.storageKey, proofFileName: "receipt.pdf" });
  const [contact] = await M.ClientContact.insertMany([{ organizationId: orgId, clientId: project!.clientId, name: "Isolation Test Contact" }]);
  Object.assign(v, {
    org: orgId, project: project!._id, client: project!.clientId, task: task!._id, doc: doc!._id, invoice: invoice!._id,
    payment: payment!._id, method: method!._id, phase: phase!._id, contact: contact._id, maya: maya!._id,
  });

  const [rivalOrg] = await M.Organization.insertMany([{ name: "Rival Agency", slug: `rival-${Date.now()}` }]);
  const [rival] = await M.User.insertMany([{ firstName: "Rival", lastName: "Admin", email: `rival-${Date.now()}@example.test` }]);
  const [role] = await M.Role.insertMany([{ organizationId: rivalOrg._id, name: "Owner" }]);
  await M.RolePermission.insertMany((await M.Permission.find().lean()).map((p) => ({ organizationId: rivalOrg._id, roleId: role._id, permissionId: p._id })));
  const [rivalMembership] = await M.Membership.insertMany([{ organizationId: rivalOrg._id, userId: rival._id, roleIds: [role._id], membershipType: "employee" }]);
  Object.assign(v, { rivalOrg: rivalOrg._id, rival: rival._id });

  const memberships = {
    rival: rivalMembership,
    noor: await M.Membership.findOne({ organizationId: orgId, userId: noor!._id }).lean(),
    maya: await M.Membership.findOne({ organizationId: orgId, userId: maya!._id }).lean(),
    sam: await M.Membership.findOne({ organizationId: orgId, userId: (await M.User.findOne({ email: "sam@zenova.studio" }).lean())!._id }).lean(),
  };
  v.mayaMembership = memberships.maya!._id;
  // Sam is on Brightside's team but view-only for these tests (§6.4).
  v.sam = memberships.sam!.userId;
  await M.ProjectMember.updateOne({ projectId: v.project, userId: v.sam, status: "active" }, { accessLevel: "view" });
  await M.Session.insertMany(Object.entries(tokens).map(([who, t]) => {
    const m = memberships[who as keyof typeof tokens]!;
    return { userId: m.userId, organizationId: m.organizationId, membershipId: m._id, tokenHash: sha256(t), expiresAt: new Date(Date.now() + 3_600_000) };
  }));

  // Visit the pages as Maya so the dev server compiles them, then read the action IDs it registered.
  for (const path of ["/", `/invoices/${v.invoice}`, "/settings", "/team"]) assert.equal((await get("maya", path)).status, 200, path);
  const manifest = JSON.parse(await readFile(".next/dev/server/server-reference-manifest.json", "utf8").catch(() => readFile(".next/server/server-reference-manifest.json", "utf8")));
  actionIds = Object.fromEntries(Object.entries(manifest.node as Record<string, { exportedName: string }>).map(([id, a]) => [a.exportedName, id]));
});

after(async () => {
  await M.ProjectMember.updateOne({ projectId: v.project, userId: v.sam }, { accessLevel: "edit" });
  await M.Session.deleteMany({ tokenHash: { $in: Object.values(tokens).map(sha256) } });
  await M.Payment.updateOne({ _id: v.payment }, { $unset: { proofStorageKey: 1, proofFileName: 1 } });
  await M.ClientContact.deleteOne({ _id: v.contact });
  await M.PaymentMethod.deleteMany({ organizationId: v.org, name: /^Isolation control/ });
  await Promise.all([M.Membership, M.Role, M.RolePermission].map((m) => (m as mongoose.Model<unknown>).deleteMany({ organizationId: v.rivalOrg })));
  await M.Organization.deleteOne({ _id: v.rivalOrg });
  await M.User.deleteOne({ _id: v.rival });
  await mongoose.disconnect();
});

// ---- Controls: the same requests succeed for someone who is allowed

describe("controls (Maya, allowed)", () => {
  test("reads her project's file, receipt and invoice", async () => {
    assert.equal((await get("maya", `/files/${v.doc}`)).status, 200);
    assert.equal((await get("maya", `/payments/${v.payment}/proof`)).status, 200);
    assert.ok((await (await get("maya", `/invoices/${v.invoice}`)).text()).includes(invoiceNumber));
  });

  test("sees her organization's activity and export", async () => {
    assert.ok((await (await get("maya", "/audit")).text()).includes("INV/"));
    assert.ok((await (await get("maya", "/audit/export")).text()).includes("maya@zenova.studio"));
  });

  test("a plain-argument action takes effect", async () => {
    const before = (await M.Task.findById(v.task).lean())!.status;
    await act("maya", "toggleTask", [String(v.task)]);
    assert.notEqual((await M.Task.findById(v.task).lean())!.status, before);
    await act("maya", "toggleTask", [String(v.task)]);
    assert.equal((await M.Task.findById(v.task).lean())!.status, before);
  });

  test("a form action takes effect", async () => {
    await act("maya", "addPaymentMethod", [undefined, form({ name: "Isolation control method", type: "upi" })], "/settings");
    assert.ok(await M.PaymentMethod.exists({ organizationId: v.org, name: "Isolation control method" }));
  });
});

// ---- Attacks

for (const who of ["rival", "noor"] as const) {
  describe(`${who} can't reach Brightside Dental`, () => {
    test("file, receipt and invoice reads are refused", async () => {
      assert.equal((await get(who, `/files/${v.doc}`)).status, 404);
      assert.equal((await get(who, `/payments/${v.payment}/proof`)).status, 404);
      assert.ok(!(await (await get(who, `/invoices/${v.invoice}`)).text()).includes(invoiceNumber), "invoice leaked");
    });

    test("the activity log and its export show nothing of the other organization", async () => {
      const page = await get(who, "/audit");
      const csv = await get(who, "/audit/export");
      if (who === "noor") {
        assert.equal(csv.status, 404); // clients have no activity log at all
        assert.ok(!(await page.text()).includes("Brightside"));
      } else {
        const [html, rows] = [await page.text(), await csv.text()];
        assert.ok(!html.includes("Brightside") && !html.includes("INV/"), "activity leaked into another organization's log");
        assert.ok(!rows.includes("Brightside") && !rows.includes("maya@zenova.studio"), "activity leaked into another organization's export");
      }
    });

    test("asking the dashboard for the project shows nothing of it", async () => {
      const html = await (await get(who, `/?project=${v.project}`)).text();
      assert.ok(!html.includes("Brightside"), "project data leaked into the dashboard");
    });

    test("task, chat, document and workflow actions change nothing", async () => {
      const [task, phase, doc, messages] = await Promise.all([
        M.Task.findById(v.task).lean(), M.PhaseInstance.findById(v.phase).lean(), M.Document.findById(v.doc).lean(), M.Message.countDocuments({ organizationId: v.org }),
      ]);
      const comments = await M.TaskComment.countDocuments({ taskId: v.task });
      await act(who, "toggleTask", [String(v.task)]);
      await act(who, "addTaskComment", [String(v.task), `pwned by ${who}`, true]);
      await act(who, "sendMessage", [String(v.project), `pwned by ${who}`]);
      await act(who, "reviewDocument", [String(v.doc), "approved"]);
      await act(who, "completePhase", [String(v.project)]);
      await act(who, "uploadDocument", [undefined, form({ projectId: String(v.project), file: new Blob(["x"], { type: "application/pdf" }) })]);
      assert.equal((await M.Task.findById(v.task).lean())!.status, task!.status);
      assert.equal((await M.PhaseInstance.findById(v.phase).lean())!.status, phase!.status);
      assert.equal((await M.Document.findById(v.doc).lean())!.status, doc!.status);
      assert.equal(await M.Message.countDocuments({ organizationId: v.org }), messages);
      assert.equal(await M.TaskComment.countDocuments({ taskId: v.task }), comments);
      assert.equal(await M.DocumentVersion.countDocuments({ documentId: v.doc }), 1);
    });

    test("billing actions change nothing", async () => {
      const [payments, notes] = await Promise.all([M.Payment.countDocuments({ projectId: v.project }), M.CreditNote.countDocuments({ invoiceId: v.invoice })]);
      const key = () => randomBytes(16).toString("hex");
      await act(who, "verifyPayment", [String(v.payment), "verified"]);
      await act(who, "recordPayment", [String(v.project), undefined, form({ amount: "1", date: "2026-01-01", methodId: String(v.method), key: key() })]);
      await act(who, "issueNote", [String(v.invoice), "credit", undefined, form({ amount: "1", rate: "0", reason: "pwned", key: key() })], `/invoices/${v.invoice}`);
      assert.equal((await M.Payment.findById(v.payment).lean())!.verificationStatus, "pending");
      assert.equal(await M.Payment.countDocuments({ projectId: v.project }), payments);
      assert.equal(await M.CreditNote.countDocuments({ invoiceId: v.invoice }), notes);
    });

    test("client and settings actions change nothing", async () => {
      await act(who, "updateClient", [String(v.client), undefined, form({ displayName: "Pwned" })]);
      await act(who, "removeContact", [String(v.client), String(v.contact)]);
      await act(who, "setPaymentMethodActive", [String(v.method), false], "/settings");
      assert.equal((await M.Client.findById(v.client).lean())!.displayName, "Brightside Dental");
      assert.equal((await M.ClientContact.findById(v.contact).lean())!.status, "active");
      assert.equal((await M.PaymentMethod.findById(v.method).lean())!.status, "active");
    });

    test("can't read or clear someone else's notifications", async () => {
      const mine = { organizationId: v.org, recipientUserId: v.maya, channel: "in_app" as const };
      const [n] = await M.Notification.insertMany([{ ...mine, title: "Isolation check", resourceType: "project", resourceId: v.project, link: "/" }]);
      const unread = await M.Notification.countDocuments({ ...mine, readAt: null });
      await act(who, "markRead", [String(n._id)]);
      await act(who, "markRead", []);
      assert.equal(await M.Notification.countDocuments({ ...mine, readAt: null }), unread);
      assert.ok(!(await (await get(who, "/")).text()).includes("Isolation check"), "notification leaked into another inbox");
      await M.Notification.deleteOne({ _id: n._id });
    });

    test("can't change roles or anyone's access", async () => {
      const sam = await M.Membership.findOne({ organizationId: v.org, userId: { $ne: v.maya }, membershipType: "employee" }).lean();
      const ownerRole = await M.Role.findOne({ organizationId: v.org, name: "Account manager" }).lean();
      const grants = await M.RolePermission.countDocuments({ roleId: ownerRole!._id });
      await act(who, "setMemberRole", [String(sam!._id), String(ownerRole!._id)], "/team");
      await act(who, "setMemberActive", [String(v.mayaMembership), false], "/team");
      await act(who, "saveRole", [String(ownerRole!._id), undefined, form({ name: "Pwned" })], "/team");
      await act(who, "setRoleActive", [String(ownerRole!._id), false], "/team");
      assert.deepEqual((await M.Membership.findById(sam!._id).lean())!.roleIds.map(String), sam!.roleIds.map(String));
      assert.equal((await M.Membership.findById(v.mayaMembership).lean())!.status, "active");
      const owner = await M.Role.findById(ownerRole!._id).lean();
      assert.equal(owner!.name, "Account manager");
      assert.equal(owner!.status, "active");
      assert.equal(await M.RolePermission.countDocuments({ roleId: ownerRole!._id }), grants);
    });

    test("drafts, milestones, task settings and archiving change nothing", async () => {
      const [drafts, schedules, project, client, task] = await Promise.all([
        M.InvoiceDraft.countDocuments({ projectId: v.project }), M.PaymentSchedule.countDocuments({ projectId: v.project }),
        M.Project.findById(v.project).lean(), M.Client.findById(v.client).lean(), M.Task.findById(v.task).lean(),
      ]);
      await act(who, "saveDraft", [String(v.project), undefined, undefined, form({ description: "pwned", unitPrice: "1", rate: "0" })]);
      await act(who, "addSchedule", [String(v.project), undefined, form({ title: "pwned", calculationType: "fixed", amount: "1", rate: "0", triggerType: "manual" })]);
      await act(who, "setAgreedValue", [String(v.project), undefined, form({ agreedValue: "1" })]);
      await act(who, "updateTask", [String(v.task), "urgent", []]);
      await act(who, "archiveProject", [String(v.project), true]);
      await act(who, "archiveClient", [String(v.client), true]);
      assert.equal(await M.InvoiceDraft.countDocuments({ projectId: v.project }), drafts);
      assert.equal(await M.PaymentSchedule.countDocuments({ projectId: v.project }), schedules);
      const p = await M.Project.findById(v.project).lean();
      assert.equal(p!.status, project!.status);
      assert.equal(p!.financialSettings?.agreedValue, project!.financialSettings?.agreedValue);
      assert.equal((await M.Client.findById(v.client).lean())!.status, client!.status);
      assert.equal((await M.Task.findById(v.task).lean())!.priority, task!.priority);
    });

    test("can't switch into someone else's membership", async () => {
      await act(who, "switchOrg", [String(v.mayaMembership)]);
      assert.equal(await M.Session.countDocuments({ membershipId: v.mayaMembership, userId: { $ne: v.maya } }), 0);
    });
  });
}

// ---- Project access levels (§6.4): a view-only member reads and talks, but changes nothing.

describe("sam, view-only on Brightside Dental", () => {
  test("can read the project and chat", async () => {
    assert.ok((await (await get("sam", `/?project=${v.project}`)).text()).includes("Brightside"));
    const before = await M.Message.countDocuments({ organizationId: v.org });
    await act("sam", "sendMessage", [String(v.project), "view-only hello"]);
    assert.equal(await M.Message.countDocuments({ organizationId: v.org }), before + 1);
    await M.Message.deleteMany({ organizationId: v.org, message: "view-only hello" });
  });

  test("can't tick tasks, upload, advance the workflow or change the team", async () => {
    const [task, phase, versions, members] = await Promise.all([
      M.Task.findById(v.task).lean(), M.PhaseInstance.findById(v.phase).lean(), M.DocumentVersion.countDocuments({ organizationId: v.org }),
      M.ProjectMember.countDocuments({ projectId: v.project, status: "active" }),
    ]);
    await act("sam", "toggleTask", [String(v.task)]);
    await act("sam", "completePhase", [String(v.project)]);
    await act("sam", "uploadDocument", [undefined, form({ projectId: String(v.project), file: new Blob(["x"], { type: "application/pdf" }) })]);
    const ed = await M.ProjectMember.findOne({ projectId: v.project, role: "client", status: "active" }).lean();
    await act("sam", "removeProjectMember", [String(ed!._id)]);
    assert.equal((await M.Task.findById(v.task).lean())!.status, task!.status);
    assert.equal((await M.PhaseInstance.findById(v.phase).lean())!.status, phase!.status);
    assert.equal(await M.DocumentVersion.countDocuments({ organizationId: v.org }), versions);
    assert.equal(await M.ProjectMember.countDocuments({ projectId: v.project, status: "active" }), members);
  });
});
