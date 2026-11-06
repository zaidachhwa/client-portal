import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { InvoiceActions } from "@/components/invoice-actions";
import { invoiceDetail, type InvoiceDetail } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { getSession } from "@/lib/session";

export const metadata = { title: "Invoice · Zenova Client Portal" };

export default function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  return (
    <main className="mesh min-h-dvh p-3 sm:p-6 print:p-0">
      <Suspense fallback={null}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: Pick<PageProps<"/invoices/[id]">, "params">) {
  const s = await getSession();
  if (!s) redirect("/login");
  const inv = await invoiceDetail(s, (await params).id);
  if (!inv) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/billing?project=${inv.projectId}`} className="press inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <ArrowLeft size={14} /> Billing
        </Link>
        <InvoiceActions invoiceId={inv.id} canAdjust={inv.canAdjust} outstanding={inv.outstanding} />
      </nav>
      <Sheet inv={inv} />
    </div>
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const address = (a?: Record<string, string>) => [a?.line1, a?.city, a?.state, a?.postalCode].filter(Boolean).join(", ");

// A plain, printable tax invoice: everything here comes from the issued snapshot, never live client data.
function Sheet({ inv }: { inv: InvoiceDetail }) {
  const status = inv.status === "paid" ? "Paid" : inv.overdue ? "Overdue" : inv.status === "partially_paid" ? "Partly paid" : "Due";
  return (
    <article className="glass rounded-[28px] p-6 text-[13px] sm:p-10 print:rounded-none">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted">Tax invoice</p>
          <h1 className="mt-1 text-[26px] leading-tight tracking-[-0.01em] tabular-nums">{inv.number}</h1>
          <p className="mt-1 text-muted">{inv.project.name} · {inv.project.code}</p>
        </div>
        <div className="text-right">
          <span className={`inline-block rounded-full px-3 py-1 text-[12px] ${inv.status === "paid" ? "bg-white/80" : inv.overdue ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>{status}</span>
          <p className="mt-2 text-muted">Issued {date(inv.date)}</p>
          <p className="text-muted">Due {date(inv.due)}</p>
        </div>
      </header>

      <section className="mb-8 grid gap-6 sm:grid-cols-2">
        {([["From", inv.seller], ["Bill to", inv.buyer]] as const).map(([label, p]) => (
          <div key={label}>
            <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">{label}</p>
            <p className="font-medium">{p.name}</p>
            {address(p.address) && <p className="text-muted">{address(p.address)}</p>}
            {p.gstin && <p className="text-muted tabular-nums">GSTIN {p.gstin}</p>}
          </div>
        ))}
      </section>
      {inv.placeOfSupply && <p className="mb-3 text-muted">Place of supply: {inv.placeOfSupply}</p>}

      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[480px] tabular-nums">
          <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Description</th>
              <th className="py-2 text-right font-normal">Qty</th>
              <th className="py-2 text-right font-normal">Rate</th>
              <th className="py-2 text-right font-normal">Taxable</th>
              <th className="py-2 text-right font-normal">GST</th>
              <th className="py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((l, i) => (
              <tr key={i} className="border-b border-line align-top">
                <td className="py-2.5 pr-3">{l.description}</td>
                <td className="py-2.5 text-right">{l.quantity}</td>
                <td className="py-2.5 text-right">{formatMoney(l.unitPrice)}</td>
                <td className="py-2.5 text-right">{formatMoney(l.taxable)}</td>
                <td className="py-2.5 text-right text-muted">{l.taxComponents.map((c) => `${c.taxType} ${(c.rateBp ?? 0) / 100}%`).join(" + ") || "—"}</td>
                <td className="py-2.5 text-right">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-4 max-w-xs space-y-1.5 tabular-nums">
        <Row label="Subtotal" value={inv.subtotal} />
        {inv.taxSummary.map((t) => <Row key={`${t.taxType}${t.rateBp}`} label={`${t.taxType} @ ${t.rateBp / 100}%`} value={t.amount} />)}
        <Row label="Invoice total" value={inv.grandTotal} strong />
        {inv.notes.map((n) => <Row key={n.number} label={`${n.kind} note ${n.number}`} value={n.kind === "Credit" ? -n.total : n.total} />)}
        {inv.payments.map((p) => <Row key={p.reference} label={`Paid ${date(p.date)} · ${p.reference}`} value={-p.amount} />)}
        <Row label="Balance due" value={inv.outstanding} strong />
      </dl>

      {inv.notes.length > 0 && (
        <section className="mt-8">
          <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted">Adjustments</p>
          <ul className="space-y-1.5">
            {inv.notes.map((n) => (
              <li key={n.number} className="flex flex-wrap justify-between gap-2">
                <span><span className="tabular-nums">{n.number}</span> <span className="text-muted">· {date(n.date)} · {n.reason}</span></span>
                <span className="tabular-nums">{n.kind === "Credit" ? "−" : "+"}{formatMoney(n.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function Row({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-line pt-1.5 text-[15px] font-medium" : "text-muted"}`}>
      <dt>{label}</dt>
      <dd className={strong ? "text-ink" : ""}>{value < 0 ? `−${formatMoney(-value)}` : formatMoney(value)}</dd>
    </div>
  );
}
