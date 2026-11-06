// Every stored balance must equal what its records add up to (§11). Runs over all data in the database,
// so it also catches drift left behind by manual testing.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { connect } from "./helpers.mts";

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sum = (xs: Doc[], f: (x: Doc) => number) => xs.reduce((t, x) => t + f(x), 0);
const of = (xs: Doc[], key: string, id: unknown) => xs.filter((x) => String(x[key]) === String(id));
let d: Record<string, Doc[]>;

before(async () => {
  await connect();
  const db = mongoose.connection.db!;
  const names = ["invoices", "payments", "payment_allocations", "refunds", "credit_notes", "debit_notes", "invoice_sequences"];
  d = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await db.collection(n).find().toArray()])));
  assert.ok(d.invoices.length, "run npm run seed first");
});
after(() => mongoose.disconnect());

test("invoice balances equal their allocations and notes", () => {
  for (const i of d.invoices) {
    assert.equal(i.amountPaid, sum(of(d.payment_allocations, "invoiceId", i._id), (a) => a.allocatedAmount), `${i.invoiceNumber} amountPaid`);
    assert.equal(i.creditTotal, sum(of(d.credit_notes, "invoiceId", i._id), (n) => n.total), `${i.invoiceNumber} creditTotal`);
    assert.equal(i.debitTotal, sum(of(d.debit_notes, "invoiceId", i._id), (n) => n.total), `${i.invoiceNumber} debitTotal`);
    assert.equal(i.outstandingAmount, i.grandTotal + i.debitTotal - i.creditTotal - i.amountPaid, `${i.invoiceNumber} outstanding`);
    assert.ok(i.outstandingAmount >= 0, `${i.invoiceNumber} overpaid`);
    assert.equal(i.grandTotal, i.subtotal - i.discountTotal + i.taxTotal, `${i.invoiceNumber} totals`);
  }
});

test("every verified rupee is allocated, refunded or unapplied, exactly once", () => {
  for (const p of d.payments) {
    const used = sum(of(d.payment_allocations, "paymentId", p._id), (a) => a.allocatedAmount) + sum(of(d.refunds, "paymentId", p._id), (r) => r.amount);
    assert.equal(used + p.unappliedAmount, p.verificationStatus === "verified" ? p.amount : 0, `${p.paymentReference} (${p.verificationStatus})`);
  }
});

test("allocations stay within one organization and project", () => {
  for (const a of d.payment_allocations) {
    const [p] = of(d.payments, "_id", a.paymentId);
    const [i] = of(d.invoices, "_id", a.invoiceId);
    assert.ok(p && i, "allocation points at a missing record");
    assert.equal(String(p.organizationId), String(a.organizationId));
    assert.equal(String(i.organizationId), String(a.organizationId));
    assert.equal(String(p.projectId), String(i.projectId));
  }
});

test("document numbers are gap-free and match their sequence", () => {
  for (const [docs, type, field] of [[d.invoices, "invoice", "invoiceNumber"], [d.credit_notes, "credit_note", "noteNumber"], [d.debit_notes, "debit_note", "noteNumber"]] as const) {
    const groups = Map.groupBy(docs, (x) => `${x.organizationId}|${x[field].split("/")[1]}`);
    for (const [key, group] of groups) {
      const [org, fy] = key.split("|");
      const nums = group.map((x) => Number(x[field].split("/")[2])).sort((a, b) => a - b);
      assert.deepEqual(nums, nums.map((_, k) => k + 1), `${type} ${fy} has gaps`);
      const seq = d.invoice_sequences.find((q) => String(q.organizationId) === org && q.financialYear === fy && q.documentType === type);
      assert.equal(seq?.currentSequence, nums.length, `${type} ${fy} sequence`);
    }
  }
});
