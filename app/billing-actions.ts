"use server";
import { createHash } from "node:crypto";
import { refresh } from "next/cache";
import { after } from "next/server";
import { isValidObjectId, Types } from "mongoose";
import { tx } from "@/lib/db";
import { canAccessProject } from "@/lib/data";
import { appUrl, audit, nextNumber, requireSession, type S } from "@/lib/guard";
import { notify, projectPeople } from "@/lib/notify";
import {
  Client, CreditNote, DebitNote, Invoice, InvoiceDraft, InvoiceSequence, PaymentSchedule, PhaseInstance, Organization, Payment, PaymentAllocation, PaymentMethod, Project, Refund,
} from "@/lib/models";
import { computeInvoice, financialYear, formatMoney, GST_RATES_BP, gst, invoiceStatus, mulDiv, outstanding, toHundredths, toMinor, type LineInput } from "@/lib/money";
import { can } from "@/lib/session";
import { markDue, raiseDue } from "@/lib/schedules";
import { putFile } from "@/lib/storage";

// Finance (§11). Every money-moving operation runs in one transaction (§16) and is idempotent:
// a retried submit carries the same key and gets the first result back instead of a second charge.

type Result = { error?: string; id?: string };
const field = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[\w-]{16,64}$/;

type Keyed = { findOne(filter: object): { lean(): PromiseLike<{ _id: unknown } | null> } };

async function once(model: Keyed, s: S, key: string, run: () => Promise<Result>): Promise<Result> {
  if (!KEY.test(key)) return { error: "Reload the page and try again." };
  const done = await model.findOne({ organizationId: s.orgId, idempotencyKey: key }).lean();
  if (done) return { id: String(done._id) };
  try {
    return await run();
  } catch (e) {
    // Two identical submits raced: the unique index let one through; answer the other with its result.
    const dup = (e as { code?: number; keyPattern?: object }).code === 11000 && "idempotencyKey" in ((e as { keyPattern?: object }).keyPattern ?? {});
    if (!dup) throw e;
    const first = await model.findOne({ organizationId: s.orgId, idempotencyKey: key }).lean();
    return { id: String(first?._id) };
  }
}

// Thrown inside a transaction to abort it with a message for the user.
class Refused extends Error {}
const refusing = async (run: () => Promise<Result>): Promise<Result> =>
  run().catch((e) => {
    if (e instanceof Refused) return { error: e.message };
    throw e;
  });

async function staffProject(s: S, projectId: string, permission: string) {
  if (!s.isStaff || !can(s, permission) || !isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "edit"))) return null;
  return Project.findOne({ _id: projectId, organizationId: s.orgId }).lean();
}

// Gap-free numbering per financial year and document type (§11.5). The increment is part of the
// caller's transaction, so an aborted issue gives its number back.
const PREFIX = { invoice: "INV", credit_note: "CN", debit_note: "DN" } as const;
async function documentNumber(s: S, type: keyof typeof PREFIX, date: Date) {
  const fy = financialYear(date);
  const seq = await InvoiceSequence.findOneAndUpdate(
    { organizationId: s.orgId, financialYear: fy, documentType: type },
    { $inc: { currentSequence: 1 }, $setOnInsert: { prefix: PREFIX[type] } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return `${seq!.prefix}/${fy}/${String(seq!.currentSequence).padStart(4, "0")}`;
}

// Spend verified, unapplied payment money on the project's open invoices, oldest first (§11.7).
// Runs inside the caller's transaction; concurrent writers to the same invoice conflict and retry.
async function applyPayments(s: S, projectId: Types.ObjectId | string) {
  const [payments, invoices] = await Promise.all([
    Payment.find({ organizationId: s.orgId, projectId, verificationStatus: "verified", unappliedAmount: { $gt: 0 } }).sort({ transactionDate: 1, createdAt: 1 }),
    Invoice.find({ organizationId: s.orgId, projectId, outstandingAmount: { $gt: 0 } }).sort({ invoiceDate: 1, invoiceNumber: 1 }),
  ]);
  for (const p of payments) {
    for (const inv of invoices) {
      const amount = Math.min(p.unappliedAmount, inv.outstandingAmount);
      if (!amount) continue;
      inv.amountPaid += amount;
      inv.outstandingAmount = outstanding(inv);
      inv.status = invoiceStatus(inv);
      p.unappliedAmount -= amount;
      await PaymentAllocation.insertMany([{ organizationId: s.orgId, paymentId: p._id, invoiceId: inv._id, allocatedAmount: amount, createdBy: s.userId }]);
    }
    await p.save();
  }
  await Promise.all(invoices.filter((i) => i.isModified()).map((i) => i.save()));
}

// ---- Invoices

// Line rows as the invoice form posts them (repeated fields). Blank rows are skipped.
function rawLines(form: FormData) {
  const [d, q, p, r, disc] = ["description", "quantity", "unitPrice", "rate", "discount"].map((k) => form.getAll(k).map((v) => String(v).trim()));
  return d.slice(0, 50).map((_, i) => ({ description: d[i].slice(0, 300), quantity: q[i] || "1", unitPrice: p[i] ?? "", rate: Number(r[i]), discount: disc[i] ?? "" }))
    .filter((l) => l.description || l.unitPrice);
}

function parseLines(form: FormData): { lines: LineInput[] } | { error: string } {
  const lines: LineInput[] = [];
  for (const [i, l] of rawLines(form).entries()) {
    const quantity = toHundredths(l.quantity);
    const unitPrice = toMinor(l.unitPrice);
    const discount = l.discount ? toMinor(l.discount) : 0;
    if (!l.description) return { error: `Line ${i + 1}: add a description.` };
    if (!quantity) return { error: `Line ${i + 1}: quantity should be a number like 1 or 2.5.` };
    if (!unitPrice) return { error: `Line ${i + 1}: enter a price like 25000 or 1999.50.` };
    if (discount === null) return { error: `Line ${i + 1}: discount should be an amount like 500.` };
    if (discount > mulDiv(quantity, unitPrice, 100)) return { error: `Line ${i + 1}: the discount is bigger than the line.` };
    if (!GST_RATES_BP.includes(l.rate)) return { error: `Line ${i + 1}: pick a GST rate.` };
    lines.push({ description: l.description, quantity, unitPrice, rateBp: l.rate, discount });
  }
  return lines.length ? { lines } : { error: "Add at least one line." };
}

export async function issueInvoice(projectId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const project = await staffProject(s, projectId, "invoices.issue");
  if (!project) return { error: "You don't have permission to invoice this project." };

  const parsed = parseLines(form);
  if ("error" in parsed) return { error: parsed.error };
  const lines = parsed.lines;
  const due = field(form, "dueDate", 10);
  if (!DATE.test(due)) return { error: "Pick a due date." };
  const now = new Date();
  const dueDate = new Date(`${due}T23:59:59+05:30`);
  if (dueDate < now) return { error: "The due date can't be in the past." };

  const [org, client] = await Promise.all([Organization.findById(s.orgId).lean(), Client.findOne({ _id: project.clientId, organizationId: s.orgId }).lean()]);
  if (!org || !client) return { error: "Client not found." };
  const sellerState = org.address?.state?.trim().toLowerCase();
  const intraState = !!sellerState && sellerState === client.billingAddress?.state?.trim().toLowerCase();
  const totals = computeInvoice(lines, intraState);

  const result = await once(Invoice, s, field(form, "key", 64), () =>
    tx(async () => {
      const invoiceNumber = await documentNumber(s, "invoice", now);
      const [inv] = await Invoice.insertMany([{
        organizationId: s.orgId, clientId: client._id, projectId: project._id, invoiceNumber, invoiceDate: now, dueDate, currency: "INR",
        // What was billed, to whom, frozen at issue (§11.3).
        billingSnapshot: {
          seller: { name: org.legalName || org.name, gstin: org.taxInformation?.gstin, address: org.address },
          buyer: { name: client.organizationDetails?.legalName || client.displayName, gstin: client.organizationDetails?.gstin, address: client.billingAddress },
          project: { code: project.projectCode, name: project.name },
          placeOfSupply: client.billingAddress?.state, intraState,
        },
        lineItemsSnapshot: totals.items, taxSummary: totals.taxSummary,
        subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal,
        outstandingAmount: totals.grandTotal, issuedAt: now, createdBy: s.userId, idempotencyKey: field(form, "key", 64),
      }]);
      const draft = isValidObjectId(field(form, "draftId")) ? await InvoiceDraft.findOne({ _id: field(form, "draftId"), organizationId: s.orgId, projectId: project._id }) : null;
      if (draft) {
        if (draft.paymentScheduleId) {
          await PaymentSchedule.updateOne({ _id: draft.paymentScheduleId, organizationId: s.orgId }, { invoiceId: inv._id, $unset: { draftId: 1 } });
          await Invoice.updateOne({ _id: inv._id }, { paymentScheduleId: draft.paymentScheduleId });
        }
        await draft.deleteOne();
      }
      await applyPayments(s, project._id); // money already paid in advance settles the new invoice
      await audit(s, "invoice.issued", "invoice", inv._id, undefined, { invoiceNumber, grandTotal: totals.grandTotal });
      return { id: String(inv._id), number: invoiceNumber };
    }),
  );

  if (result.id && "number" in result) {
    const base = await appUrl();
    const number = result.number as string;
    const message = `${org.name} issued invoice ${number} for ${formatMoney(totals.grandTotal)}, due ${dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}.`;
    after(async () =>
      notify(s.orgId, await projectPeople(s.orgId, project._id, "client"), {
        title: `Invoice ${number} from ${org.name}`, message, resourceType: "invoice", resourceId: result.id!, link: `/invoices/${result.id}`,
        email: { lines: [message], cta: "View invoice" },
      }, base),
    );
  }
  refresh();
  return { id: result.id, error: result.error };
}

// Credit notes lower what's owed, debit notes raise it; the invoice itself is never edited (§11.9).
export async function issueNote(invoiceId: string, kind: "credit" | "debit", _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!["credit", "debit"].includes(kind) || !isValidObjectId(invoiceId)) return { error: "Invoice not found." };
  const invoice = await Invoice.findOne({ _id: invoiceId, organizationId: s.orgId }).lean();
  if (!invoice || !(await staffProject(s, String(invoice.projectId), "invoices.issue"))) return { error: "You don't have permission to adjust this invoice." };

  const taxable = toMinor(field(form, "amount", 20));
  const rateBp = Number(field(form, "rate", 5));
  const reason = field(form, "reason", 300);
  if (!taxable) return { error: "Enter an amount before tax, like 5000." };
  if (!GST_RATES_BP.includes(rateBp)) return { error: "Pick a GST rate." };
  if (!reason) return { error: "Say why, so the client understands the adjustment." };

  const taxComponents = gst(taxable, rateBp, !!(invoice.billingSnapshot as { intraState?: boolean } | undefined)?.intraState);
  const taxTotal = taxComponents.reduce((t, c) => t + c.amount, 0);
  const total = taxable + taxTotal;
  const Note = kind === "credit" ? CreditNote : DebitNote;
  const key = field(form, "key", 64);

  const result = await refusing(() =>
    once(Note, s, key, () =>
      tx(async () => {
        const inv = await Invoice.findOne({ _id: invoice._id, organizationId: s.orgId });
        if (kind === "credit" && total > inv!.outstandingAmount) {
          throw new Refused(`A credit note can't exceed what's still owed (${formatMoney(inv!.outstandingAmount)}). Refund the payment instead.`);
        }
        const now = new Date();
        const noteNumber = await documentNumber(s, kind === "credit" ? "credit_note" : "debit_note", now);
        const [note] = await Note.insertMany([{
          organizationId: s.orgId, clientId: inv!.clientId, projectId: inv!.projectId, invoiceId: inv!._id, noteNumber, reason,
          taxableAmount: taxable, taxComponents, taxTotal, total, issuedAt: now,
          approvals: [{ userId: s.userId, decision: "approved", at: now }], idempotencyKey: key,
        }]);
        if (kind === "credit") inv!.creditTotal += total;
        else inv!.debitTotal += total;
        inv!.outstandingAmount = outstanding(inv!);
        inv!.status = invoiceStatus(inv!);
        await inv!.save();
        if (kind === "debit") await applyPayments(s, inv!.projectId);
        await audit(s, `invoice.${kind}_note_issued`, "invoice", inv!._id, undefined, { noteNumber, total });
        return { id: String(note._id) };
      }),
    ),
  );
  refresh();
  return result;
}

// ---- Payments

const PROOF_TYPES = ["pdf", "png", "jpg", "jpeg", "webp"];
const PROOF_MAX = 5 * 1024 * 1024;

function paymentFields(form: FormData) {
  const amount = toMinor(field(form, "amount", 20));
  const date = field(form, "date", 10);
  if (!amount) return { error: "Enter the amount, like 25000 or 1999.50." };
  if (!DATE.test(date)) return { error: "Pick the payment date." };
  const transactionDate = new Date(`${date}T12:00:00+05:30`);
  if (transactionDate.getTime() > Date.now() + 86_400_000) return { error: "The payment date can't be in the future." };
  return { amount, transactionDate, externalTransactionId: field(form, "reference", 80) || undefined };
}

async function method(s: S, id: string) {
  return isValidObjectId(id) ? PaymentMethod.findOne({ _id: id, organizationId: s.orgId, status: "active" }).lean() : null;
}

const paymentReference = (s: S) => nextNumber(s.orgId, "payment", () => Payment.countDocuments({ organizationId: s.orgId })).then((n) => `PAY-${String(n).padStart(4, "0")}`);

// Staff record money they've already seen arrive: verified on entry and allocated immediately.
export async function recordPayment(projectId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const project = await staffProject(s, projectId, "payments.verify");
  if (!project) return { error: "You don't have permission to record payments here." };
  const f = paymentFields(form);
  if ("error" in f) return f;
  const m = await method(s, field(form, "methodId"));
  if (!m) return { error: "Pick how they paid." };

  const key = field(form, "key", 64);
  const result = await once(Payment, s, key, () =>
    tx(async () => {
      const now = new Date();
      const [p] = await Payment.insertMany([{
        organizationId: s.orgId, clientId: project.clientId, projectId: project._id, paymentReference: await paymentReference(s), paymentMethodId: m._id,
        amount: f.amount, transactionDate: f.transactionDate, externalTransactionId: f.externalTransactionId,
        verificationStatus: "verified", status: "completed", unappliedAmount: f.amount, submittedBy: s.userId, verifiedBy: s.userId, verifiedAt: now, idempotencyKey: key,
      }]);
      await applyPayments(s, project._id);
      await audit(s, "payment.recorded", "payment", p._id, undefined, { amount: f.amount, reference: p.paymentReference });
      return { id: String(p._id) };
    }),
  );
  refresh();
  return result;
}

// Clients report a payment (with proof); it counts only once staff verify it.
export async function submitPayment(projectId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!can(s, "payments.submit") || !isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "edit"))) return { error: "You can't report payments for this project." };
  const project = await Project.findOne({ _id: projectId, organizationId: s.orgId }).lean();
  if (!project) return { error: "Project not found." };
  const f = paymentFields(form);
  if ("error" in f) return f;
  const m = await method(s, field(form, "methodId"));
  if (!m) return { error: "Pick how you paid." };

  const file = form.get("proof");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !f.externalTransactionId) return { error: "Add the transaction reference (UTR) or attach a receipt." };
  const name = hasFile ? file.name.replace(/[^\w.\- ]+/g, "_").slice(-120) : "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (hasFile && !PROOF_TYPES.includes(ext)) return { error: `Receipts can be ${PROOF_TYPES.join(", ")}.` };
  if (hasFile && file.size > PROOF_MAX) return { error: "The receipt is too large (max 5 MB)." };

  const key = field(form, "key", 64);
  const result = await once(Payment, s, key, async () => {
    const id = new Types.ObjectId();
    const data = hasFile ? Buffer.from(await file.arrayBuffer()) : null;
    // Content-addressed key: a retried upload of the same receipt lands on the same object.
    const proofStorageKey = data ? await putFile(`${s.orgId}/payments/${createHash("sha256").update(data).digest("hex").slice(0, 32)}`, data, ext) : undefined;
    return tx(async () => {
      const [p] = await Payment.insertMany([{
        _id: id, organizationId: s.orgId, clientId: project.clientId, projectId: project._id, paymentReference: await paymentReference(s), paymentMethodId: m._id,
        amount: f.amount, transactionDate: f.transactionDate, externalTransactionId: f.externalTransactionId, proofStorageKey, proofFileName: name || undefined,
        verificationStatus: "pending", status: "pending", unappliedAmount: 0, submittedBy: s.userId, idempotencyKey: key,
      }]);
      await audit(s, "payment.submitted", "payment", p._id, undefined, { amount: f.amount });
      return { id: String(p._id) };
    });
  });

  if (result.id) {
    const base = await appUrl();
    const message = `${s.name} reported a ${m.name} payment of ${formatMoney(f.amount)}${f.externalTransactionId ? ` (ref ${f.externalTransactionId})` : ""}.`;
    after(async () =>
      notify(s.orgId, [project.projectManagerId], {
        title: `Payment to verify: ${formatMoney(f.amount)} for ${project.name}`, message, resourceType: "payment", resourceId: result.id!,
        link: `/billing?project=${project._id}`, email: { lines: [message, "Check it arrived, then verify it from the Billing card."], cta: "Open billing" },
      }, base),
    );
  }
  refresh();
  return result;
}

export async function verifyPayment(paymentId: string, decision: "verified" | "rejected"): Promise<Result> {
  const s = await requireSession();
  if (!isValidObjectId(paymentId) || !["verified", "rejected"].includes(decision)) return { error: "Payment not found." };
  const payment = await Payment.findOne({ _id: paymentId, organizationId: s.orgId }).lean();
  if (!payment || !(await staffProject(s, String(payment.projectId), "payments.verify"))) return { error: "You don't have permission to verify this payment." };

  const result = await refusing(() =>
    tx(async () => {
      // Conditional on still pending, so two reviewers can't both verify (and double-allocate) it.
      const p = await Payment.findOneAndUpdate(
        { _id: payment._id, organizationId: s.orgId, verificationStatus: "pending" },
        {
          verificationStatus: decision, status: decision === "verified" ? "completed" : "rejected", verifiedBy: s.userId, verifiedAt: new Date(),
          unappliedAmount: decision === "verified" ? payment.amount : 0,
        },
      );
      if (!p) throw new Refused("Someone already reviewed this payment.");
      if (decision === "verified") await applyPayments(s, payment.projectId);
      await audit(s, `payment.${decision}`, "payment", payment._id, { verificationStatus: "pending" }, { verificationStatus: decision });
      return { id: paymentId };
    }),
  );

  if (!result.error && payment.submittedBy && String(payment.submittedBy) !== s.userId) {
    const base = await appUrl();
    const verified = decision === "verified";
    const message = verified
      ? `${s.name} confirmed your payment ${payment.paymentReference}. Thank you!`
      : `${s.name} couldn't find payment ${payment.paymentReference} in our account. Reply in the project chat and we'll sort it out.`;
    after(async () =>
      notify(s.orgId, [payment.submittedBy], {
        title: verified ? `Payment received: ${formatMoney(payment.amount)}` : `We couldn't match your payment of ${formatMoney(payment.amount)}`, message,
        resourceType: "payment", resourceId: payment._id, link: `/billing?project=${payment.projectId}`, email: { lines: [message], cta: "View billing" },
      }, base),
    );
  }
  refresh();
  return result;
}

// Refunds come out of a payment's unapplied balance (§11.8). To refund money already on an invoice,
// issue a credit note first so it becomes unapplied.
export async function refundPayment(paymentId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!isValidObjectId(paymentId)) return { error: "Payment not found." };
  const payment = await Payment.findOne({ _id: paymentId, organizationId: s.orgId, verificationStatus: "verified" }).lean();
  if (!payment || !(await staffProject(s, String(payment.projectId), "payments.verify"))) return { error: "You don't have permission to refund this payment." };
  const amount = toMinor(field(form, "amount", 20));
  const reason = field(form, "reason", 300);
  if (!amount) return { error: "Enter the amount to refund." };
  if (!reason) return { error: "Add a reason for the refund." };

  const key = field(form, "key", 64);
  const result = await refusing(() =>
    once(Refund, s, key, () =>
      tx(async () => {
        const p = await Payment.findOneAndUpdate(
          { _id: payment._id, organizationId: s.orgId, unappliedAmount: { $gte: amount } },
          { $inc: { unappliedAmount: -amount } },
        );
        if (!p) throw new Refused(`You can refund up to ${formatMoney((await Payment.findById(payment._id).lean())?.unappliedAmount ?? 0)} of this payment.`);
        const [r] = await Refund.insertMany([{
          organizationId: s.orgId, paymentId: payment._id, amount, reason, externalRefundReference: field(form, "reference", 80) || undefined,
          processedAt: new Date(), createdBy: s.userId, idempotencyKey: key,
        }]);
        await audit(s, "payment.refunded", "payment", payment._id, undefined, { amount, reason });
        return { id: String(r._id) };
      }),
    ),
  );
  refresh();
  return result;
}

// ---- Drafts (§11.3): editable, unnumbered, never sent until issued.

export async function saveDraft(projectId: string, draftId: string | undefined, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const project = await staffProject(s, projectId, "invoices.issue");
  if (!project) return { error: "You don't have permission to invoice this project." };
  const lines = rawLines(form);
  if (!lines.length) return { error: "Add at least one line." };
  const due = field(form, "dueDate", 10);
  const update = { lines, dueDate: DATE.test(due) ? new Date(`${due}T23:59:59+05:30`) : undefined };
  if (draftId) {
    const r = isValidObjectId(draftId) ? await InvoiceDraft.updateOne({ _id: draftId, organizationId: s.orgId, projectId: project._id }, update) : null;
    if (!r?.matchedCount) return { error: "Draft not found." };
  } else {
    const [d] = await InvoiceDraft.insertMany([{ organizationId: s.orgId, projectId: project._id, createdBy: s.userId, ...update }]);
    draftId = String(d._id);
  }
  refresh();
  return { id: draftId };
}

export async function deleteDraft(draftId: string): Promise<Result> {
  const s = await requireSession();
  const draft = isValidObjectId(draftId) ? await InvoiceDraft.findOne({ _id: draftId, organizationId: s.orgId }) : null;
  if (!draft || !(await staffProject(s, String(draft.projectId), "invoices.issue"))) return { error: "Draft not found." };
  // A milestone's draft goes back to "due" without a draft, so it can be raised again.
  if (draft.paymentScheduleId) await PaymentSchedule.updateOne({ _id: draft.paymentScheduleId }, { $unset: { draftId: 1 } });
  await draft.deleteOne();
  refresh();
  return {};
}

// ---- Payment schedules (§11.2)

const TRIGGERS = ["date", "phase_completion", "manual"] as const;

export async function setAgreedValue(projectId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const project = await staffProject(s, projectId, "invoices.issue");
  if (!project) return { error: "You don't have permission to change this project's billing." };
  const value = toMinor(field(form, "agreedValue", 20));
  if (!value) return { error: "Enter the agreed value, like 300000." };
  await Project.updateOne({ _id: project._id }, { "financialSettings.agreedValue": value, "financialSettings.currency": "INR" });
  await audit(s, "project.agreed_value_set", "project", project._id, { agreedValue: project.financialSettings?.agreedValue ?? null }, { agreedValue: value });
  refresh();
  return {};
}

export async function addSchedule(projectId: string, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  const project = await staffProject(s, projectId, "invoices.issue");
  if (!project) return { error: "You don't have permission to change this project's billing." };
  const title = field(form, "title", 120);
  const calculationType = field(form, "calculationType") === "percentage" ? "percentage" : "fixed";
  const triggerType = field(form, "triggerType") as (typeof TRIGGERS)[number];
  const rateBp = Number(field(form, "rate", 5));
  if (!title) return { error: "Name the milestone, like “Kick-off” or “Launch”." };
  if (!TRIGGERS.includes(triggerType)) return { error: "Pick when it's billed." };
  if (!GST_RATES_BP.includes(rateBp)) return { error: "Pick a GST rate." };

  // Percentages are stored as basis points of the agreed value; fixed amounts in paise.
  const amount = calculationType === "percentage" ? toHundredths(field(form, "amount", 6)) : toMinor(field(form, "amount", 20));
  if (!amount) return { error: calculationType === "percentage" ? "Enter a percentage, like 30." : "Enter an amount, like 50000." };
  if (calculationType === "percentage" && amount > 10000) return { error: "A percentage can't be more than 100." };
  if (calculationType === "percentage" && !project.financialSettings?.agreedValue) return { error: "Set the project's agreed value first." };

  const due = field(form, "dueDate", 10);
  const phaseId = field(form, "phaseInstanceId");
  if (triggerType === "date" && !DATE.test(due)) return { error: "Pick the billing date." };
  const phase = triggerType === "phase_completion" && isValidObjectId(phaseId)
    ? await PhaseInstance.findOne({ _id: phaseId, organizationId: s.orgId, projectId: project._id, status: { $ne: "completed" } }).lean()
    : null;
  if (triggerType === "phase_completion" && !phase) return { error: "Pick a phase that isn't finished yet." };

  const [sch] = await PaymentSchedule.insertMany([{
    organizationId: s.orgId, projectId: project._id, title, calculationType, amount, rateBp, triggerType,
    dueDate: triggerType === "date" ? new Date(`${due}T09:00:00+05:30`) : undefined, phaseInstanceId: phase?._id,
  }]);
  await audit(s, "payment_schedule.created", "project", project._id, undefined, { title, calculationType, amount, triggerType });
  await raiseDue(s.orgId, project._id); // a date already in the past becomes due straight away
  refresh();
  return { id: String(sch._id) };
}

export async function raiseSchedule(scheduleId: string): Promise<Result> {
  const s = await requireSession();
  const sch = isValidObjectId(scheduleId) ? await PaymentSchedule.findOne({ _id: scheduleId, organizationId: s.orgId, status: "pending" }) : null;
  if (!sch || !(await staffProject(s, String(sch.projectId), "invoices.issue"))) return { error: "Milestone not found." };
  await markDue(sch);
  refresh();
  return {};
}

export async function cancelSchedule(scheduleId: string): Promise<Result> {
  const s = await requireSession();
  const sch = isValidObjectId(scheduleId) ? await PaymentSchedule.findOne({ _id: scheduleId, organizationId: s.orgId, invoiceId: null, status: { $in: ["pending", "due"] } }) : null;
  if (!sch || !(await staffProject(s, String(sch.projectId), "invoices.issue"))) return { error: "Only milestones that haven't been invoiced can be cancelled." };
  if (sch.draftId) await InvoiceDraft.deleteOne({ _id: sch.draftId });
  await PaymentSchedule.updateOne({ _id: sch._id }, { status: "cancelled", $unset: { draftId: 1 } });
  await audit(s, "payment_schedule.cancelled", "project", sch.projectId, undefined, { title: sch.title });
  refresh();
  return {};
}
