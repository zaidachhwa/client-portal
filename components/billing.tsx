"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check, FilePlus2, IndianRupee, Paperclip, Plus, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  addSchedule, cancelSchedule, deleteDraft, issueInvoice, raiseSchedule, recordPayment, refundPayment, saveDraft, setAgreedValue, submitPayment, verifyPayment,
} from "@/app/billing-actions";
import type { Billing as BillingData } from "@/lib/data";
import { computeInvoice, formatMoney, GST_RATES_BP, toHundredths, toMinor } from "@/lib/money";
import { Badge, Button, Card, CardHeader, Dialog, Empty, FormError, IconButton, Segmented, Select, TextField, ease, newKey, reach, shortDate, useSubmit } from "./ui";

type Invoice = BillingData["invoices"][number];
type Payment = BillingData["payments"][number];
type Draft = BillingData["drafts"][number];
type Open = "invoice" | "payment" | "schedule" | { refund: Payment } | { draft: Draft } | null;

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Invoices and payments for the selected project (§11). Clients see the same card, read-only plus "I've paid".
export function Billing({ projectId, data, className = "" }: { projectId: string; data: BillingData; className?: string }) {
  const [tab, setTab] = useState<"Invoices" | "Payments" | "Schedule">("Invoices");
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const pendingCount = data.payments.filter((p) => p.status === "pending").length;

  return (
    <Card id="billing" className={className}>
      <CardHeader
        title="Billing"
        sub={data.overdue ? `${formatMoney(data.overdue)} overdue` : data.outstanding ? `${formatMoney(data.outstanding)} outstanding` : "All settled"}
        action={
          <div className="flex gap-1.5">
            {data.canIssue && <IconButton label="New invoice" variant="soft" onClick={() => setOpen("invoice")}><FilePlus2 size={15} /></IconButton>}
            {data.canVerify && <IconButton label="Record payment" variant="solid" onClick={() => setOpen("payment")}><IndianRupee size={15} /></IconButton>}
            {data.canSubmit && data.methods.length > 0 && <Button onClick={() => setOpen("payment")} className="px-4 py-2">I&apos;ve paid</Button>}
          </div>
        }
      />

      <dl className="mb-4 grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Stat label="Outstanding" value={data.outstanding} />
        <Stat label="Overdue" value={data.overdue} tone={data.overdue ? "text-rose-600" : undefined} />
        <Stat label="Paid" value={data.paid} />
        <Stat label="Unapplied credit" value={data.credit} />
      </dl>

      <Segmented
        id={`billing-tab-${projectId}`}
        label="Show"
        options={data.canIssue ? (["Invoices", "Payments", "Schedule"] as const) : (["Invoices", "Payments"] as const)}
        value={tab}
        onChange={setTab}
        className="mb-2"
      />
      {pendingCount > 0 && data.canVerify && tab === "Invoices" && (
        <button onClick={() => setTab("Payments")} className="mb-2 w-full rounded-xl bg-amber-100/70 px-3 py-2 text-left text-[12px] text-amber-900">
          {pendingCount} payment{pendingCount > 1 ? "s" : ""} waiting for you to verify →
        </button>
      )}

      {tab === "Schedule" ? (
        <Schedule projectId={projectId} data={data} onAdd={() => setOpen("schedule")} />
      ) : tab === "Invoices" ? (
        data.invoices.length || data.drafts.length ? (
          <ul>
            {data.drafts.map((d) => <DraftRow key={d.id} draft={d} onOpen={() => setOpen({ draft: d })} />)}
            {data.invoices.map((i) => <InvoiceRow key={i.id} invoice={i} />)}
          </ul>
        ) : (
          <Empty>No invoices yet.</Empty>
        )
      ) : data.payments.length ? (
        <ul>{data.payments.map((p) => <PaymentRow key={p.id} payment={p} canVerify={data.canVerify} onRefund={() => setOpen({ refund: p })} />)}</ul>
      ) : (
        <Empty>No payments yet.</Empty>
      )}

      <Dialog
        open={open === "invoice" || (!!open && typeof open === "object" && "draft" in open)}
        onClose={close}
        title={open && typeof open === "object" && "draft" in open ? "Draft invoice" : "New invoice"}
        sub={`Gets the next number when issued. GST is ${data.intraState ? "split CGST + SGST" : "charged as IGST"} for this client.`}
      >
        {(open === "invoice" || (open && typeof open === "object" && "draft" in open)) && (
          <InvoiceForm
            key={open && typeof open === "object" && "draft" in open ? open.draft.id : "new"}
            projectId={projectId}
            intraState={data.intraState}
            draft={open && typeof open === "object" && "draft" in open ? open.draft : undefined}
            onDone={close}
          />
        )}
      </Dialog>
      <Dialog open={open === "schedule"} onClose={close} title="Add milestone" sub="When it triggers, a draft invoice is raised for you to review and issue.">
        {open === "schedule" && <ScheduleForm projectId={projectId} data={data} onDone={close} />}
      </Dialog>
      <Dialog
        open={open === "payment"}
        onClose={close}
        title={data.canVerify ? "Record payment" : "Report a payment"}
        sub={data.canVerify ? "Applied to the oldest unpaid invoices first." : "We'll confirm once it reaches our account."}
      >
        <PaymentForm projectId={projectId} methods={data.methods} staff={data.canVerify} onDone={close} />
      </Dialog>
      <Dialog open={!!open && typeof open === "object" && "refund" in open} onClose={close} title="Refund" sub="Comes out of the payment's unapplied balance.">
        {open && typeof open === "object" && "refund" in open && <RefundForm key={open.refund.id} payment={open.refund} onDone={close} />}
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl bg-white/60 px-3 py-2.5">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className={`text-[15px] tabular-nums ${tone}`}>{formatMoney(value)}</dd>
    </div>
  );
}

function InvoiceRow({ invoice: i }: { invoice: Invoice }) {
  const badge =
    i.status === "paid" ? <Badge tone="soft">Paid</Badge>
    : i.overdue ? <Badge tone="rose">Overdue</Badge>
    : i.status === "partially_paid" ? <Badge tone="amber">Part paid</Badge>
    : <Badge tone="soft">Due {shortDate(i.due)}</Badge>;
  return (
    <li className="border-b border-line last:border-0">
      <Link href={`/invoices/${i.id}`} className="press -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-150 hover:bg-white/60">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium tabular-nums">{i.number}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
            {shortDate(i.date)}{i.outstanding > 0 && i.outstanding < i.total && ` · ${formatMoney(i.outstanding)} left`}
            {/* Narrow cards: the badge sits under the number so the number never truncates. */}
            <span className="@md:hidden">{badge}</span>
          </span>
        </span>
        <span className="hidden @md:inline">{badge}</span>
        <span className="shrink-0 text-right text-[13px] tabular-nums @md:w-24">{formatMoney(i.total)}</span>
      </Link>
    </li>
  );
}

function PaymentRow({ payment: p, canVerify, onRefund }: { payment: Payment; canVerify: boolean; onRefund: () => void }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const review = (d: "verified" | "rejected") => start(async () => setError((await verifyPayment(p.id, d)).error));
  const detail = [p.method, shortDate(p.date), p.externalId && `ref ${p.externalId}`, p.unapplied > 0 && `${formatMoney(p.unapplied)} unapplied`, p.refunded > 0 && `${formatMoney(p.refunded)} refunded`]
    .filter(Boolean).join(" · ");
  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium tabular-nums">{p.reference}</span>
          <span className="block truncate text-[11px] text-muted">{detail}</span>
        </span>
        {p.hasProof && (
          <a href={`/payments/${p.id}/proof`} download aria-label="Download receipt" title="Download receipt" className="press grid size-8 shrink-0 place-items-center rounded-full text-ink/70 transition-colors duration-150 hover:bg-white/70 hover:text-ink">
            <Paperclip size={14} />
          </a>
        )}
        {p.status === "pending" && canVerify ? (
          <>
            <IconButton label="Reject payment" onClick={() => review("rejected")} disabled={pending}><X size={15} /></IconButton>
            <IconButton label="Verify payment" variant="solid" onClick={() => review("verified")} disabled={pending}><Check size={15} /></IconButton>
          </>
        ) : p.status === "pending" ? (
          <Badge tone="amber">Checking</Badge>
        ) : p.status === "rejected" ? (
          <Badge tone="rose">Not found</Badge>
        ) : (
          canVerify && p.unapplied > 0 && <IconButton label="Refund" onClick={onRefund}><Undo2 size={14} /></IconButton>
        )}
        <span className={`shrink-0 text-right text-[13px] tabular-nums @md:w-24 ${p.status === "rejected" ? "text-muted line-through" : ""}`}>{formatMoney(p.amount)}</span>
      </div>
      <FormError message={error} />
    </li>
  );
}

// ---- Forms. Each carries an idempotency key; a fresh one is minted after every success.

type Line = { id: number; description: string; quantity: string; unitPrice: string; rate: string; discount: string };
const blank = (id: number): Line => ({ id, description: "", quantity: "1", unitPrice: "", rate: "1800", discount: "" });

function InvoiceForm({ projectId, intraState, draft, onDone }: { projectId: string; intraState: boolean; draft?: Draft; onDone: () => void }) {
  const [key, setKey] = useState(newKey);
  const [lines, setLines] = useState<Line[]>(draft?.lines.length ? draft.lines.map((l, i) => ({ id: i, ...l })) : [blank(0)]);
  const { onSubmit, run, error, pending } = useSubmit((form) => issueInvoice(projectId, undefined, form), (_, form) => {
    setKey(newKey());
    setLines([blank(Date.now())]);
    form?.reset();
    onDone();
  });
  // Save as draft from the same fields, without issuing.
  const saveAsDraft = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = new FormData(e.currentTarget.form!);
    run(() => saveDraft(projectId, draft?.id, undefined, form));
  };
  const set = (id: number, patch: Partial<Line>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  // Live preview with the same maths the server uses; unparseable rows are left out.
  const valid = lines.flatMap((l) => {
    const quantity = toHundredths(l.quantity || "1");
    const unitPrice = toMinor(l.unitPrice);
    return quantity && unitPrice ? [{ description: l.description, quantity, unitPrice, rateBp: Number(l.rate), discount: toMinor(l.discount) ?? 0 }] : [];
  });
  const totals = computeInvoice(valid, intraState);

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="key" value={key} />
      {draft && <input type="hidden" name="draftId" value={draft.id} />}
      {draft?.note && <p className="rounded-xl bg-white/60 px-3 py-2 text-[12px] text-muted">{draft.note}</p>}
      <AnimatePresence initial={false}>
        {lines.map((l, n) => (
          <motion.fieldset
            key={l.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            <div className="space-y-2 rounded-2xl bg-white/60 p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField label={`Line ${n + 1}`} name="description" value={l.description} onChange={(e) => set(l.id, { description: e.target.value })} maxLength={300} placeholder="Local SEO retainer – November" />
                </div>
                {lines.length > 1 && (
                  <IconButton label={`Remove line ${n + 1}`} className="mb-1" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><X size={15} /></IconButton>
                )}
              </div>
              <div className="grid grid-cols-[0.8fr_1.4fr_1.1fr_1fr] gap-2">
                <TextField label="Qty" name="quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set(l.id, { quantity: e.target.value })} />
                <TextField label="Price (₹)" name="unitPrice" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(l.id, { unitPrice: e.target.value })} placeholder="25000" />
                <TextField label="Discount (₹)" name="discount" inputMode="decimal" value={l.discount} onChange={(e) => set(l.id, { discount: e.target.value })} placeholder="0" />
                <Select label="GST" name="rate" value={l.rate} onChange={(e) => set(l.id, { rate: e.target.value })}>
                  {GST_RATES_BP.map((r) => <option key={r} value={r}>{r / 100}%</option>)}
                </Select>
              </div>
            </div>
          </motion.fieldset>
        ))}
      </AnimatePresence>
      {lines.length < 50 && (
        <Button type="button" variant="soft" className="w-full" onClick={() => setLines([...lines, blank(Date.now())])}>
          <Plus size={14} /> Add line
        </Button>
      )}
      <TextField label="Due date" name="dueDate" type="date" required defaultValue={draft?.due && draft.due >= today() ? draft.due : inDays(15)} min={today()} />
      <dl className="space-y-1 rounded-2xl bg-white/60 px-4 py-3 text-[13px] tabular-nums">
        <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(totals.subtotal)}</dd></div>
        {totals.discountTotal > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>−{formatMoney(totals.discountTotal)}</dd></div>}
        {totals.taxSummary.map((t) => (
          <div key={`${t.taxType}${t.rateBp}`} className="flex justify-between"><dt className="text-muted">{t.taxType} {t.rateBp / 100}%</dt><dd>{formatMoney(t.amount)}</dd></div>
        ))}
        <div className="flex justify-between border-t border-line pt-1.5 text-[15px] font-medium"><dt>Total</dt><dd>{formatMoney(totals.grandTotal)}</dd></div>
      </dl>
      <FormError message={error} />
      <div className="flex gap-2">
        {draft && (
          <Button type="button" variant="soft" disabled={pending} onClick={() => run(() => deleteDraft(draft.id))}>Delete</Button>
        )}
        <Button type="button" variant="soft" disabled={pending} onClick={saveAsDraft}>{draft ? "Save" : "Save draft"}</Button>
        <Button type="submit" disabled={pending || !valid.length} className="flex-1">{pending ? "Working…" : "Issue invoice"}</Button>
      </div>
    </form>
  );
}

function PaymentForm({ projectId, methods, staff, onDone }: { projectId: string; methods: BillingData["methods"]; staff: boolean; onDone: () => void }) {
  const [key, setKey] = useState(newKey);
  const { onSubmit, error, pending } = useSubmit(
    (form) => (staff ? recordPayment : submitPayment)(projectId, undefined, form),
    (_, form) => {
      form.reset();
      setKey(newKey());
      onDone();
    },
  );
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="key" value={key} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Amount (₹)" name="amount" inputMode="decimal" required placeholder="29500" />
        <TextField label="Paid on" name="date" type="date" required defaultValue={today()} max={today()} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Method" name="methodId" required defaultValue={methods[0]?.id}>
          {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <TextField label="Reference / UTR" name="reference" maxLength={80} placeholder={staff ? "Optional" : "From your bank app"} />
      </div>
      {!staff && (
        <label className="block">
          <span className="mb-1.5 block px-1 text-[12px] text-muted">Receipt (PDF or image, optional if you added a UTR)</span>
          <input type="file" name="proof" accept=".pdf,.png,.jpg,.jpeg,.webp" className="w-full rounded-2xl bg-white/70 px-4 py-2.5 text-[13px] ring-1 ring-white file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1 file:text-[12px] file:text-white" />
        </label>
      )}
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : staff ? "Record payment" : "Send for confirmation"}</Button>
    </form>
  );
}

function RefundForm({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const [key, setKey] = useState(newKey);
  const { onSubmit, error, pending } = useSubmit((form) => refundPayment(payment.id, undefined, form), () => {
    setKey(newKey());
    onDone();
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="key" value={key} />
      <p className="px-1 text-[13px] text-muted">{payment.reference} has {formatMoney(payment.unapplied)} unapplied.</p>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Amount (₹)" name="amount" inputMode="decimal" required defaultValue={(payment.unapplied / 100).toFixed(2)} />
        <TextField label="Bank reference" name="reference" maxLength={80} placeholder="Optional" />
      </div>
      <TextField label="Reason" name="reason" required maxLength={300} placeholder="Overpaid by mistake" />
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Refunding…" : "Record refund"}</Button>
    </form>
  );
}

function DraftRow({ draft: d, onOpen }: { draft: Draft; onOpen: () => void }) {
  const total = d.lines.reduce((t, l) => {
    const q = toHundredths(l.quantity || "1");
    const p = toMinor(l.unitPrice);
    return q && p ? t + Math.round((q * p) / 100) - (toMinor(l.discount) ?? 0) : t;
  }, 0);
  return (
    <li className="border-b border-line last:border-0">
      <button onClick={onOpen} className="press -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-white/60">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{d.note || d.lines[0]?.description || "Untitled draft"}</span>
          <span className="block text-[11px] text-muted">Not issued yet · before GST</span>
        </span>
        <Badge tone="amber">Draft</Badge>
        <span className="shrink-0 text-right text-[13px] tabular-nums text-muted @md:w-24">{formatMoney(total)}</span>
      </button>
    </li>
  );
}

// ---- Payment schedule (§11.2)

const TRIGGER_LABEL = { date: "On a date", phase_completion: "When a phase completes", manual: "When you raise it" } as const;

function Schedule({ projectId, data, onAdd }: { projectId: string; data: BillingData; onAdd: () => void }) {
  const { onSubmit, error, pending } = useSubmit((form) => setAgreedValue(projectId, undefined, form), () => {});
  const amount = (sch: BillingData["schedules"][number]) =>
    sch.calculationType === "percentage"
      ? `${sch.amount / 100}%${data.agreedValue ? ` · ${formatMoney(Math.round((data.agreedValue * sch.amount) / 10000))}` : ""}`
      : formatMoney(sch.amount);
  return (
    <div>
      <form onSubmit={onSubmit} className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl bg-white/60 p-3">
        <div className="min-w-40 flex-1">
          <TextField label="Agreed project value (₹, before GST)" name="agreedValue" inputMode="decimal" defaultValue={data.agreedValue ? (data.agreedValue / 100).toFixed(2) : ""} placeholder="300000" />
        </div>
        <Button type="submit" variant="soft" disabled={pending} className="py-2">Save</Button>
        <div className="basis-full"><FormError message={error} /></div>
      </form>
      {data.schedules.length === 0 ? (
        <Empty>No milestones yet. Add one to bill by date, phase, or when you&apos;re ready.</Empty>
      ) : (
        <ul>{data.schedules.map((sch) => <ScheduleRow key={sch.id} sch={sch} amount={amount(sch)} />)}</ul>
      )}
      <Button variant="soft" className="mt-3 w-full" onClick={onAdd}><Plus size={14} /> Add milestone</Button>
    </div>
  );
}

function ScheduleRow({ sch, amount }: { sch: BillingData["schedules"][number]; amount: string }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => setError((await reach(fn())).error));
  const when = sch.triggerType === "date" ? `on ${shortDate(sch.when)}` : sch.triggerType === "phase_completion" ? `when ${sch.when} completes` : "when you raise it";
  const badge = { paid: <Badge tone="soft">Paid</Badge>, due: <Badge tone="amber">{sch.invoiceNumber ? "Invoiced" : "Due"}</Badge>, cancelled: <Badge tone="soft">Cancelled</Badge>, pending: <Badge tone="soft">Scheduled</Badge> }[sch.status as "paid"];
  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className={`flex items-center gap-2 ${sch.status === "cancelled" ? "opacity-60" : ""}`}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{sch.title}</span>
          <span className="block truncate text-[11px] text-muted">{amount} · {when}{sch.invoiceNumber && ` · ${sch.invoiceNumber}`}{sch.hasDraft && " · draft ready"}</span>
        </span>
        {badge}
        {sch.status === "pending" && sch.triggerType === "manual" && (
          <Button variant="soft" className="px-3 py-1 text-[12px]" disabled={pending} onClick={() => run(() => raiseSchedule(sch.id))}>Raise</Button>
        )}
        {(sch.status === "pending" || sch.status === "due") && !sch.invoiceNumber && (
          <IconButton label={`Cancel ${sch.title}`} disabled={pending} onClick={() => run(() => cancelSchedule(sch.id))}><X size={14} /></IconButton>
        )}
      </div>
      <FormError message={error} />
    </li>
  );
}

function ScheduleForm({ projectId, data, onDone }: { projectId: string; data: BillingData; onDone: () => void }) {
  const [type, setType] = useState<"fixed" | "percentage">(data.agreedValue ? "percentage" : "fixed");
  const [trigger, setTrigger] = useState<keyof typeof TRIGGER_LABEL>("phase_completion");
  const { onSubmit, error, pending } = useSubmit((form) => addSchedule(projectId, undefined, form), onDone);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <TextField label="Milestone" name="title" required maxLength={120} placeholder="Kick-off payment" />
      <Segmented id="sch-type" label="Amount" options={["fixed", "percentage"] as const} value={type} onChange={setType} />
      <input type="hidden" name="calculationType" value={type} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label={type === "percentage" ? "Percent of agreed value" : "Amount (₹, before GST)"} name="amount" inputMode="decimal" required placeholder={type === "percentage" ? "30" : "50000"} />
        <Select label="GST" name="rate" defaultValue="1800">{GST_RATES_BP.map((r) => <option key={r} value={r}>{r / 100}%</option>)}</Select>
      </div>
      {type === "percentage" && !data.agreedValue && <p className="px-1 text-[12px] text-amber-800">Set the agreed project value on the Schedule tab first.</p>}
      <Select label="Bill it" name="triggerType" value={trigger} onChange={(e) => setTrigger(e.target.value as keyof typeof TRIGGER_LABEL)}>
        {Object.entries(TRIGGER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Select>
      {trigger === "date" && <TextField label="Date" name="dueDate" type="date" required defaultValue={inDays(30)} />}
      {trigger === "phase_completion" && (
        <Select label="Phase" name="phaseInstanceId" required defaultValue={data.phases[0]?.id ?? ""}>
          {data.phases.length === 0 && <option value="">All phases are finished</option>}
          {data.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Adding…" : "Add milestone"}</Button>
    </form>
  );
}
