// Money maths (§11): exact minor units, GST rounding, financial years, balances.
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInvoice, financialYear, gst, invoiceStatus, mulDiv, outstanding, toHundredths, toMinor } from "../lib/money.ts";

test("discounts reduce the taxable amount, never below zero", () => {
  const [line] = computeInvoice([{ description: "Retainer", quantity: 100, unitPrice: 25_000_00, rateBp: 1800, discount: 5_000_00 }], true).items;
  assert.equal(line.taxableAmount, 20_000_00);
  assert.equal(line.total, 23_600_00);
  const capped = computeInvoice([{ description: "x", quantity: 100, unitPrice: 100, rateBp: 1800, discount: 500 }], false);
  assert.equal(capped.items[0].taxableAmount, 0);
  assert.equal(capped.discountTotal, 100);
  assert.equal(capped.subtotal - capped.discountTotal + capped.taxTotal, capped.grandTotal);
});

test("money maths", () => {

  assert.equal(toMinor("1,25,000.5"), 12500050);
  assert.equal(toMinor("0.1"), 10);
  assert.equal(toMinor("19.99"), 1999);
  for (const bad of ["", "-1", "1.234", "abc", "1e5", "9999999999999"]) assert.equal(toMinor(bad), null, bad);
  assert.equal(toHundredths("1.5"), 150);
  assert.equal(toHundredths("0"), null);

  assert.equal(mulDiv(5, 1, 2), 3); // half-up
  assert.equal(mulDiv(999_999, 100_000_000_000, 100), 999_999_000_000_000); // max qty × max price stays exact
  assert.equal(mulDiv(150, 33333, 100), 49999 + 1); // 1.5 × ₹333.33 = ₹499.995 -> ₹500.00

  // ₹333.33 at 18% intra-state: 9% each = 29.9997 -> 30.00 each.
  assert.deepEqual(gst(33333, 1800, true).map((c) => c.amount), [3000, 3000]);
  assert.deepEqual(gst(33333, 1800, false).map((c) => c.amount), [6000]);

  const inv = computeInvoice(
    [
      { description: "Retainer", quantity: 100, unitPrice: 25_000_00, rateBp: 1800 },
      { description: "Photos", quantity: 250, unitPrice: 1_999_99, rateBp: 1800 },
      { description: "Filing fee", quantity: 100, unitPrice: 500_00, rateBp: 0 },
    ],
    true,
  );
  assert.equal(inv.subtotal, 25_000_00 + 4_999_98 + 500_00);
  assert.equal(inv.taxTotal, 2 * 2_250_00 + 2 * 45_000); // 4,999.98 × 9% = 449.9982 -> 450.00 each
  assert.equal(inv.grandTotal, inv.subtotal + inv.taxTotal);
  assert.deepEqual(inv.taxSummary.map((t) => [t.taxType, t.amount]), [["CGST", 2_700_00], ["SGST", 2_700_00]]);

  assert.equal(financialYear(new Date("2026-03-31T18:30:00Z")), "2026-27"); // 00:00 on 1 April IST
  assert.equal(financialYear(new Date("2026-03-31T18:29:00Z")), "2025-26"); // 23:59 on 31 March IST
  assert.equal(financialYear(new Date("2027-01-15T00:00:00Z")), "2026-27");

  const bal = { grandTotal: 1000, debitTotal: 100, creditTotal: 200, amountPaid: 900 };
  assert.equal(outstanding(bal), 0);
  assert.equal(invoiceStatus(bal), "paid");
  assert.equal(invoiceStatus({ ...bal, amountPaid: 0, creditTotal: 0 }), "issued");
});
