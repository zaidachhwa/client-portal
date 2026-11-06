// Money as integer minor units (paise). Floats never touch a stored amount: parsing is string-based and
// multiplication goes through BigInt with half-up rounding. Shared by server actions and the invoice form preview.

export const MAX_AMOUNT = 1_000_000_000_00; // ₹100 crore per line or payment, well inside Number.MAX_SAFE_INTEGER

// "1,25,000.5" -> 12500050. Returns null for anything that isn't a plain non-negative amount with up to 2 decimals.
export function toMinor(input: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(input.replace(/[,\s₹]/g, ""));
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return v <= MAX_AMOUNT ? v : null;
}

// Quantity with up to 2 decimals, as hundredths: "1.5" -> 150.
export function toHundredths(input: string): number | null {
  const m = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return v > 0 ? v : null;
}

// round(a * b / c), half-up, exact for non-negative integers.
export const mulDiv = (a: number, b: number, c: number) => Number((BigInt(a) * BigInt(b) * BigInt(2) + BigInt(c)) / (BigInt(c) * BigInt(2)));

export function formatMoney(minor: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

// GST: same state -> CGST + SGST at half the rate each; otherwise IGST (§11.4 taxComponents).
export function gst(taxable: number, rateBp: number, intraState: boolean) {
  if (rateBp === 0) return [];
  return intraState
    ? [
        { taxType: "CGST", rateBp: rateBp / 2, amount: mulDiv(taxable, rateBp, 20000) },
        { taxType: "SGST", rateBp: rateBp / 2, amount: mulDiv(taxable, rateBp, 20000) },
      ]
    : [{ taxType: "IGST", rateBp, amount: mulDiv(taxable, rateBp, 10000) }];
}

export const GST_RATES_BP = [0, 500, 1200, 1800, 2800];

export type LineInput = { description: string; quantity: number /* hundredths */; unitPrice: number; rateBp: number; discount?: number };

export function computeInvoice(lines: LineInput[], intraState: boolean) {
  const items = lines.map((l) => {
    const gross = mulDiv(l.quantity, l.unitPrice, 100);
    const discount = Math.min(l.discount ?? 0, gross); // GST is charged on the amount after discount
    const taxableAmount = gross - discount;
    const taxComponents = gst(taxableAmount, l.rateBp, intraState);
    const tax = taxComponents.reduce((t, c) => t + c.amount, 0);
    return { description: l.description, quantity: l.quantity / 100, unitPrice: l.unitPrice, discount, taxableAmount, taxComponents, total: taxableAmount + tax };
  });
  // Tax summary groups by type and rate, as printed on a GST invoice.
  const summary = new Map<string, { taxType: string; rateBp: number; amount: number }>();
  for (const c of items.flatMap((i) => i.taxComponents)) {
    const k = `${c.taxType}:${c.rateBp}`;
    summary.set(k, { ...c, amount: (summary.get(k)?.amount ?? 0) + c.amount });
  }
  const sum = (f: (i: (typeof items)[number]) => number) => items.reduce((t, i) => t + f(i), 0);
  return {
    items,
    taxSummary: [...summary.values()],
    subtotal: sum((i) => i.taxableAmount + i.discount),
    discountTotal: sum((i) => i.discount),
    taxTotal: sum((i) => i.total - i.taxableAmount),
    grandTotal: sum((i) => i.total),
  };
}

// Indian financial year (April–March) in IST, e.g. "2026-27".
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

// Outstanding is always derived the same way, so every writer agrees.
export const outstanding = (i: { grandTotal: number; debitTotal: number; creditTotal: number; amountPaid: number }) =>
  i.grandTotal + i.debitTotal - i.creditTotal - i.amountPaid;

export const invoiceStatus = (i: { grandTotal: number; debitTotal: number; creditTotal: number; amountPaid: number }) =>
  outstanding(i) === 0 ? "paid" : i.amountPaid > 0 || i.creditTotal > 0 ? "partially_paid" : "issued";
