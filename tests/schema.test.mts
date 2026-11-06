// §18 acceptance criteria that can be checked from the schema itself.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import * as models from "../lib/models.ts";
import { connect } from "./helpers.mts";

// Platform-wide collections; everything else belongs to one organization.
const GLOBAL = new Set(["Organization", "User", "Permission", "LoginAttempt"]);
const tenantModels = (Object.values(models) as unknown as mongoose.Model<unknown>[]).filter((m) => !GLOBAL.has(m.modelName));

before(connect);
after(() => mongoose.disconnect());

test("every tenant-owned collection has a required, immutable organizationId", () => {
  assert.ok(tenantModels.length > 30, `found ${tenantModels.length} tenant models`);
  for (const m of tenantModels) {
    const path = m.schema.path("organizationId") as unknown as { options: { required?: boolean; immutable?: boolean } } | undefined;
    assert.ok(path, `${m.modelName} has no organizationId`);
    assert.equal(path!.options.required, true, `${m.modelName}.organizationId is not required`);
    assert.equal(path!.options.immutable, true, `${m.modelName}.organizationId is not immutable`);
  }
});

test("tenant indexes lead with organizationId (TTL and token-hash lookups excepted)", () => {
  for (const m of tenantModels) {
    for (const [fields, options] of m.schema.indexes()) {
      const keys = Object.keys(fields);
      // Deliberate cross-tenant lookups: sessions and invites by token hash (before the tenant is known),
      // a user's sessions and memberships (sign-in, workspace switcher). TTL indexes expire by time.
      if (options.expireAfterSeconds !== undefined || keys[0] === "tokenHash" || (["Session", "Membership"].includes(m.modelName) && keys[0] === "userId")) continue;
      assert.equal(keys[0], "organizationId", `${m.modelName} index ${JSON.stringify(fields)} isn't tenant-scoped`);
    }
  }
});

test("unique business keys are unique per organization", () => {
  const unique = (name: string) => models[name as keyof typeof models] as unknown as mongoose.Model<unknown>;
  for (const [name, key] of [["Client", "clientCode"], ["Invoice", "invoiceNumber"], ["InvoiceSequence", "documentType"], ["Payment", "paymentReference"], ["CreditNote", "noteNumber"], ["DebitNote", "noteNumber"]]) {
    const idx = unique(name).schema.indexes().find(([f, o]) => o.unique && key in f);
    assert.ok(idx && "organizationId" in idx[0], `${name}.${key} lacks an org-scoped unique index`);
  }
});

test("money fields reject fractions of a minor unit", async () => {
  const inv = new models.Invoice({ organizationId: new mongoose.Types.ObjectId(), grandTotal: 100.5, amountPaid: 1 });
  const err = inv.validateSync();
  assert.match(String(err?.errors.grandTotal), /whole minor units/);
  assert.equal(err?.errors.amountPaid, undefined);
});

test("issued invoice snapshots are immutable", async () => {
  const inv = await models.Invoice.findOne();
  assert.ok(inv, "run npm run seed first");
  const { grandTotal, invoiceNumber } = inv;
  inv.set({ grandTotal: grandTotal + 100, invoiceNumber: "HACKED", lineItemsSnapshot: [] });
  assert.equal(inv.grandTotal, grandTotal);
  assert.equal(inv.invoiceNumber, invoiceNumber);
  await models.Invoice.updateOne({ _id: inv._id }, { grandTotal: 1, invoiceNumber: "HACKED" });
  const fresh = await models.Invoice.findById(inv._id).lean();
  assert.equal(fresh!.grandTotal, grandTotal);
  assert.equal(fresh!.invoiceNumber, invoiceNumber);
});

test("published workflow versions can't be edited", async () => {
  const v = await models.WorkflowVersion.findOne({ status: "published" }).lean();
  assert.ok(v);
  await models.WorkflowVersion.updateOne({ _id: v._id }, { "definition.phases": [] });
  const fresh = await models.WorkflowVersion.findById(v._id).lean();
  assert.equal(fresh!.definition!.phases.length, v.definition!.phases.length);
});

test("audit history is append-only", async () => {
  const [entry] = await models.AuditLog.insertMany([{ organizationId: new mongoose.Types.ObjectId(), actorId: new mongoose.Types.ObjectId(), action: "test.append_only" }]);
  await assert.rejects(models.AuditLog.updateOne({ _id: entry._id }, { action: "tampered" }), /append-only/);
  await assert.rejects(models.AuditLog.deleteOne({ _id: entry._id }), /append-only/);
  await assert.rejects(models.AuditLog.deleteMany({}), /append-only/);
  entry.action = "tampered";
  await assert.rejects(entry.save(), /append-only/);
  // Clean up through the raw driver, which the app never uses for audit logs.
  await mongoose.connection.collection("audit_logs").deleteOne({ _id: entry._id });
});
