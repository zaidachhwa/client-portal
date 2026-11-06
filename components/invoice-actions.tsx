"use client";
import { Printer } from "lucide-react";
import { useState } from "react";
import { issueNote } from "@/app/billing-actions";
import { formatMoney, GST_RATES_BP } from "@/lib/money";
import { Button, Dialog, FormError, Select, TextField, newKey, useSubmit } from "./ui";

// Print (browser "Save as PDF") for everyone; credit/debit notes for staff who issue invoices (§11.9).
export function InvoiceActions({ invoiceId, canAdjust, outstanding }: { invoiceId: string; canAdjust: boolean; outstanding: number }) {
  const [note, setNote] = useState<"credit" | "debit" | null>(null);
  return (
    <>
      <Button variant="soft" className="ml-auto py-2" onClick={() => window.print()}><Printer size={14} /> Print or save PDF</Button>
      {canAdjust && (
        <>
          <Button variant="soft" className="py-2" onClick={() => setNote("credit")} disabled={outstanding === 0}>Credit note</Button>
          <Button variant="soft" className="py-2" onClick={() => setNote("debit")}>Debit note</Button>
        </>
      )}
      <Dialog
        open={!!note}
        onClose={() => setNote(null)}
        title={note === "credit" ? "Credit note" : "Debit note"}
        sub={note === "credit" ? `Lowers what's owed, up to ${formatMoney(outstanding)}. The invoice itself stays as issued.` : "Adds to what's owed on this invoice."}
      >
        {note && <NoteForm key={note} invoiceId={invoiceId} kind={note} onDone={() => setNote(null)} />}
      </Dialog>
    </>
  );
}

function NoteForm({ invoiceId, kind, onDone }: { invoiceId: string; kind: "credit" | "debit"; onDone: () => void }) {
  const [key, setKey] = useState(newKey);
  const { onSubmit, error, pending } = useSubmit((form) => issueNote(invoiceId, kind, undefined, form), () => {
    setKey(newKey());
    onDone();
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="key" value={key} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Amount before GST (₹)" name="amount" inputMode="decimal" required placeholder="5000" />
        <Select label="GST" name="rate" defaultValue="1800">
          {GST_RATES_BP.map((r) => <option key={r} value={r}>{r / 100}%</option>)}
        </Select>
      </div>
      <TextField label="Reason" name="reason" required maxLength={300} placeholder={kind === "credit" ? "Discount agreed for delayed delivery" : "Extra landing page requested"} />
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Issuing…" : `Issue ${kind} note`}</Button>
    </form>
  );
}
