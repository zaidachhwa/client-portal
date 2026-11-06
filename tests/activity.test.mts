// Activity log wording and change detection (§14.5).
import assert from "node:assert/strict";
import { test } from "node:test";
import { areaOf, changes, describe } from "../lib/activity.ts";

test("entries read as sentences", () => {
  assert.equal(describe("invoice.issued", null, { invoiceNumber: "INV/2026-27/0004", grandTotal: 3_540_000 }), "issued invoice INV/2026-27/0004 for ₹35,400.00");
  assert.equal(describe("client.contact_removed", { contact: "Priya" }, null), "removed contact Priya");
  assert.equal(describe("something.new", null, null), "something.new");
});

test("only changed fields are reported, nested one level", () => {
  const before = { displayName: "Brightside", billingAddress: { city: "Pune", state: "Maharashtra" }, _id: "x" };
  const after = { displayName: "Brightside", billingAddress: { city: "Pune West", state: "Maharashtra" }, _id: "y" };
  assert.deepEqual(changes(before, after), [{ field: "billingAddress.city", from: "Pune", to: "Pune West" }]);
  assert.deepEqual(changes(before, before), []);
  assert.deepEqual(changes(null, after), []);
  assert.deepEqual(changes({ gstin: undefined }, { gstin: "27AAJFZ4321K1Z8" }), [{ field: "gstin", from: "—", to: "27AAJFZ4321K1Z8" }]);
});

test("areas group actions by prefix", () => {
  assert.equal(areaOf("payment.refunded"), "billing");
  assert.equal(areaOf("payment_method.created"), "settings");
  assert.equal(areaOf("task.commented"), "projects");
  assert.equal(areaOf("unknown.thing"), undefined);
});
