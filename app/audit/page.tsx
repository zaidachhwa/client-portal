import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Card, Empty, Select } from "@/components/ui";
import { AREAS } from "@/lib/activity";
import { activity, type Activity } from "@/lib/data";
import { getSession } from "@/lib/session";

export const metadata = { title: "Activity · Zenova Client Portal" };

export default function AuditPage({ searchParams }: PageProps<"/audit">) {
  return (
    <main className="mesh min-h-dvh p-3 sm:p-6">
      <Suspense fallback={null}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

async function Content({ searchParams }: Pick<PageProps<"/audit">, "searchParams">) {
  const s = await getSession();
  if (!s) redirect("/login");
  const q = await searchParams;
  const filter = { area: one(q.area), actor: one(q.actor), before: one(q.before) };
  const log = await activity(s, filter);
  if (!log) notFound();

  const keep = new URLSearchParams(Object.entries({ area: filter.area, actor: filter.actor }).filter((e): e is [string, string] => !!e[1]));
  const days = Map.groupBy(log.entries, (e) => day(e.at));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
        <ArrowLeft size={14} /> Dashboard
      </Link>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">Activity</h1>
          <p className="mt-1 text-[13px] text-muted">Everything that changed, by whom. Entries can&apos;t be edited or deleted.</p>
        </div>
        <a href={`/audit/export?${keep}`} download className="press inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <Download size={14} /> Download CSV
        </a>
      </header>

      {/* A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared. */}
      <form className="mb-4 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Select label="Area" name="area" defaultValue={filter.area ?? ""}>
          <option value="">Everything</option>
          {Object.entries(AREAS).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
        </Select>
        <Select label="Person" name="actor" defaultValue={filter.actor ?? ""}>
          <option value="">Anyone</option>
          {log.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.staff ? "" : " (client)"}</option>)}
        </Select>
        <button className="press h-[42px] rounded-full bg-ink px-5 text-[13px] font-medium text-white">Apply</button>
      </form>

      <Card>
        {log.entries.length === 0 && <Empty>No activity matches.</Empty>}
        {[...days].map(([label, entries]) => (
          <section key={label} className="mb-2 last:mb-0">
            <h2 className="sticky top-0 z-[1] -mx-2 mb-1 bg-white/40 px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted backdrop-blur">{label}</h2>
            <ul>{entries.map((e) => <Entry key={e.id} e={e} />)}</ul>
          </section>
        ))}
        {(log.next || filter.before) && (
          <nav className="mt-3 flex justify-between border-t border-line pt-3 text-[13px]">
            {filter.before ? <Link href={`/audit?${keep}`} className="text-muted hover:text-ink">← Newest</Link> : <span />}
            {log.next && <Link href={`/audit?${new URLSearchParams([...keep, ["before", log.next]])}`} className="hover:underline">Older entries →</Link>}
          </nav>
        )}
      </Card>
    </div>
  );
}

function Entry({ e }: { e: Activity["entries"][number] }) {
  const detail = e.changes.length > 0 || e.ipAddress || e.requestId;
  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-baseline gap-3">
        <time dateTime={e.at} className="w-16 shrink-0 text-[11px] tabular-nums text-muted">{time(e.at)}</time>
        <p className="min-w-0 flex-1 text-[13px] leading-snug">
          <span className="font-medium">{e.actor}</span> {e.summary}
          {e.link && <> · <Link href={e.link} className="text-muted underline decoration-black/15 underline-offset-2 hover:text-ink">open</Link></>}
        </p>
        {e.area && <span className="hidden shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-muted ring-1 ring-white sm:inline">{e.area}</span>}
      </div>
      {detail && (
        <details className="group ml-[76px] mt-1 text-[12px]">
          <summary className="w-fit cursor-pointer list-none text-muted hover:text-ink">
            <span className="group-open:hidden">Details</span><span className="hidden group-open:inline">Hide details</span>
          </summary>
          {e.changes.length > 0 && (
            <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl bg-white/60 p-3">
              {e.changes.map((c) => (
                <div key={c.field} className="contents">
                  <dt className="text-muted">{c.field}</dt>
                  <dd className="break-words"><span className="text-muted line-through decoration-black/25">{c.from}</span> → {c.to}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1.5 break-all text-[11px] text-muted" title={e.userAgent}>
            {[e.action, e.ipAddress && `IP ${e.ipAddress}`, e.requestId && `request ${e.requestId.slice(0, 8)}`].filter(Boolean).join(" · ")}
          </p>
        </details>
      )}
    </li>
  );
}
