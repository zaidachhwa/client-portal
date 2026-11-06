"use server";
import { refresh } from "next/cache";
import { isValidObjectId, Types } from "mongoose";
import { audit, requireSession, type S } from "@/lib/guard";
import { CIN, GSTIN, PAN, gstinMatchesState, isState } from "@/lib/india";
import { Organization, PaymentMethod } from "@/lib/models";
import { can } from "@/lib/session";

// Organization profile (§5.2) and payment methods (§11.1). Both need organization.update.

type Result = { error?: string };
const field = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METHOD_TYPES = ["cash", "upi", "bank_transfer", "cheque", "gateway", "custom"] as const;

const allowed = (s: S) => s.isStaff && can(s, "organization.update");

export async function updateOrganization(_: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to edit organization settings." };

  const name = field(form, "name", 120);
  const email = field(form, "email").toLowerCase();
  const address = {
    line1: field(form, "line1", 160), line2: field(form, "line2", 160), city: field(form, "city", 80),
    state: field(form, "state", 80), postalCode: field(form, "postalCode", 6), country: "India",
  };
  const tax = { gstin: field(form, "gstin", 15).toUpperCase(), pan: field(form, "pan", 10).toUpperCase(), cin: field(form, "cin", 21).toUpperCase() };

  if (!name) return { error: "Enter the organization's name." };
  if (email && !EMAIL.test(email)) return { error: "Enter a valid email." };
  if (address.state && !isState(address.state)) return { error: "Pick a state from the list." };
  if (address.postalCode && !/^\d{6}$/.test(address.postalCode)) return { error: "PIN code should be 6 digits." };
  if (tax.gstin) {
    if (!GSTIN.test(tax.gstin)) return { error: "GSTIN should look like 27ABCDE1234F1Z5." };
    // The state decides CGST+SGST vs IGST on every invoice, so it must agree with the registration.
    if (!address.state) return { error: "Pick the state your GSTIN is registered in." };
    if (!gstinMatchesState(tax.gstin, address.state)) return { error: `That GSTIN is registered outside ${address.state}.` };
    if (tax.pan && tax.gstin.slice(2, 12) !== tax.pan) return { error: "The PAN doesn't match the one inside your GSTIN." };
  }
  if (tax.pan && !PAN.test(tax.pan)) return { error: "PAN should look like ABCDE1234F." };
  if (tax.cin && !CIN.test(tax.cin)) return { error: "CIN should look like U74999MH2020PTC123456." };

  const org = await Organization.findById(s.orgId);
  if (!org) return { error: "Organization not found." };
  const before = { name: org.name, legalName: org.legalName, email: org.email, phone: org.phone, address: org.address, taxInformation: org.taxInformation };
  org.set({
    name, legalName: field(form, "legalName", 160) || undefined, email: email || undefined, phone: field(form, "phone", 30) || undefined,
    address, taxInformation: { gstin: tax.gstin || undefined, pan: tax.pan || undefined, cin: tax.cin || undefined },
  });
  await org.save();
  // Issued invoices keep their own snapshot of these details; only new invoices pick up the change.
  await audit(s, "organization.updated", "organization", org._id, before, {
    name: org.name, legalName: org.legalName, email: org.email, phone: org.phone, address: org.address, taxInformation: org.taxInformation,
  });
  refresh();
  return {};
}

export async function addPaymentMethod(_: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to edit payment methods." };
  const name = field(form, "name", 60);
  const type = field(form, "type", 20) as (typeof METHOD_TYPES)[number];
  if (!name) return { error: "Name the payment method." };
  if (!METHOD_TYPES.includes(type)) return { error: "Pick a type." };
  if (await PaymentMethod.exists({ organizationId: s.orgId, name }).collation({ locale: "en", strength: 2 })) {
    return { error: "You already have a method with that name." };
  }
  const m = await PaymentMethod.create({ organizationId: s.orgId, name, type });
  await audit(s, "payment_method.created", "payment_method", m._id, undefined, { name, type });
  refresh();
  return {};
}

// Methods are switched off, never deleted: past payments still point at them.
export async function setPaymentMethodActive(methodId: string, active: boolean): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s) || !isValidObjectId(methodId)) return { error: "You don't have permission to edit payment methods." };
  const status = active ? "active" : "inactive";
  const r = await PaymentMethod.updateOne({ _id: methodId, organizationId: s.orgId }, { status });
  if (!r.matchedCount) return { error: "Payment method not found." };
  if (r.modifiedCount) await audit(s, `payment_method.${status}`, "payment_method", new Types.ObjectId(methodId));
  refresh();
  return {};
}

// §17 Retention policy. Financial records must be kept at least 6 years (GST); the app never purges them.
export async function updateRetention(_: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to edit organization settings." };
  const years = (k: string) => Number(field(form, k, 3));
  const policy = { auditYears: years("auditYears"), documentYearsAfterArchive: years("documentYearsAfterArchive"), financialYears: years("financialYears") };
  if (!Object.values(policy).every((y) => Number.isInteger(y) && y >= 1 && y <= 30)) return { error: "Use whole years between 1 and 30." };
  if (policy.financialYears < 6) return { error: "Financial records must be kept at least 6 years." };
  if (policy.auditYears < policy.financialYears) return { error: "Keep the activity log at least as long as financial records, so every invoice and payment stays traceable." };
  const org = await Organization.findById(s.orgId);
  if (!org) return { error: "Organization not found." };
  const before = { ...(org.settings?.retention ?? {}) };
  org.set("settings.retention", policy);
  await org.save();
  await audit(s, "organization.retention_updated", "organization", org._id, before, policy);
  refresh();
  return {};
}
