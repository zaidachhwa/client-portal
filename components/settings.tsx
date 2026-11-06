"use client";
import { useState, useTransition } from "react";
import { addPaymentMethod, setPaymentMethodActive, updateOrganization, updateRetention } from "@/app/settings-actions";
import type { OrgSettings } from "@/lib/data";
import { Button, FormError, Select, StateSelect, TextField, useSubmit } from "./ui";

const section = "px-1 pt-2 text-[11px] uppercase tracking-wide text-muted";

export function ProfileForm({ profile: p }: { profile: OrgSettings["profile"] }) {
  const [saved, setSaved] = useState(false);
  const { onSubmit, error, pending } = useSubmit((form) => updateOrganization(undefined, form), () => setSaved(true));
  return (
    <form onSubmit={onSubmit} onChange={() => setSaved(false)} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Name" name="name" required maxLength={120} defaultValue={p.name} />
        <TextField label="Legal name" name="legalName" maxLength={160} defaultValue={p.legalName} placeholder="As registered" />
        <TextField label="Billing email" name="email" type="email" maxLength={200} defaultValue={p.email} />
        <TextField label="Phone" name="phone" type="tel" maxLength={30} defaultValue={p.phone} />
      </div>
      <p className={section}>Address</p>
      <TextField label="Line 1" name="line1" maxLength={160} defaultValue={p.line1} />
      <TextField label="Line 2" name="line2" maxLength={160} defaultValue={p.line2} />
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField label="City" name="city" maxLength={80} defaultValue={p.city} />
        <StateSelect defaultValue={p.state} />
        <TextField label="PIN code" name="postalCode" inputMode="numeric" maxLength={6} defaultValue={p.postalCode} />
      </div>
      <p className={section}>Tax</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <TextField label="GSTIN" name="gstin" maxLength={15} defaultValue={p.gstin} placeholder="27ABCDE1234F1Z5" />
        <TextField label="PAN" name="pan" maxLength={10} defaultValue={p.pan} placeholder="ABCDE1234F" />
        <TextField label="CIN" name="cin" maxLength={21} defaultValue={p.cin} placeholder="Optional" />
      </div>
      <p className="px-1 text-[12px] text-muted">Clients in the same state are charged CGST + SGST; everyone else IGST.</p>
      <FormError message={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        {saved && <span role="status" className="text-[12px] text-muted">Saved</span>}
      </div>
    </form>
  );
}

const TYPES = [["upi", "UPI"], ["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["cash", "Cash"], ["gateway", "Payment gateway"], ["custom", "Other"]] as const;
const typeLabel = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

export function PaymentMethods({ methods }: { methods: OrgSettings["methods"] }) {
  const { onSubmit, error, pending } = useSubmit((form) => addPaymentMethod(undefined, form), (_, form) => form.reset());
  return (
    <>
      <ul className="mb-3">
        {methods.map((m) => <MethodRow key={m.id} method={m} />)}
      </ul>
      <form onSubmit={onSubmit} className="space-y-2 rounded-2xl bg-white/60 p-3">
        <div className="grid grid-cols-[1.3fr_1fr] gap-2">
          <TextField label="New method" name="name" required maxLength={60} placeholder="HDFC current account" />
          <Select label="Type" name="type" defaultValue="bank_transfer">
            {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </div>
        <FormError message={error} />
        <Button type="submit" variant="soft" disabled={pending} className="w-full">{pending ? "Adding…" : "Add method"}</Button>
      </form>
    </>
  );
}

function MethodRow({ method: m }: { method: OrgSettings["methods"][number] }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const toggle = () => start(async () => setError((await setPaymentMethodActive(m.id, !m.active)).error));
  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] font-medium ${m.active ? "" : "text-muted"}`}>{m.name}</span>
          <span className="block text-[11px] text-muted">
            {[typeLabel(m.type) !== m.name && typeLabel(m.type), !m.active && "Hidden from clients"].filter(Boolean).join(" · ") || "Available to clients"}
          </span>
        </span>
        {/* A native checkbox styled as a switch: keyboard and screen readers work as-is. */}
        <input
          type="checkbox"
          role="switch"
          aria-label={`${m.name} available`}
          checked={m.active}
          disabled={pending}
          onChange={toggle}
          className="relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-black/15 transition-colors duration-200 before:absolute before:left-0.5 before:top-0.5 before:size-5 before:rounded-full before:bg-white before:shadow before:transition-transform before:duration-200 before:ease-[cubic-bezier(0.23,1,0.32,1)] checked:bg-ink checked:before:translate-x-4 disabled:opacity-60"
        />
      </div>
      <FormError message={error} />
    </li>
  );
}

export function Retention({ policy }: { policy: OrgSettings["retention"] }) {
  const [saved, setSaved] = useState(false);
  const { onSubmit, error, pending } = useSubmit((form) => updateRetention(undefined, form), () => setSaved(true));
  const years = (name: keyof typeof policy, label: string, hint: string, min = 1) => (
    <label className="grid grid-cols-[1fr_88px] items-center gap-3 rounded-xl bg-white/60 px-3 py-2">
      <span><span className="block text-[13px]">{label}</span><span className="block text-[11px] text-muted">{hint}</span></span>
      <span className="flex items-center gap-1.5 text-[12px] text-muted">
        <input type="number" name={name} min={min} max={30} required defaultValue={policy[name]} className="w-14 rounded-full bg-white/80 px-2.5 py-1.5 text-right text-[13px] text-ink tabular-nums outline-none ring-1 ring-white focus:ring-ink/25" /> yrs
      </span>
    </label>
  );
  return (
    <form onSubmit={onSubmit} onChange={() => setSaved(false)} className="space-y-2">
      {years("financialYears", "Financial records", "Invoices, payments, notes. Never deleted by the app; GST needs 6+ years.", 6)}
      {years("auditYears", "Activity log", "At least as long as financial records.")}
      {years("documentYearsAfterArchive", "Project documents", "Counted from when the project is archived.")}
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" variant="soft" disabled={pending}>{pending ? "Saving…" : "Save policy"}</Button>
        {saved && <span role="status" className="text-[12px] text-muted">Saved</span>}
        <a href="/export/organization" download className="ml-auto text-[12px] text-muted underline decoration-black/15 underline-offset-2 hover:text-ink">Export all organization data</a>
      </div>
    </form>
  );
}
