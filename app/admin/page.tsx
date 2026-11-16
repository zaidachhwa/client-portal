import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/actions";
import { CreateOrganization, Organizations } from "@/components/admin";
import { Card, CardHeader } from "@/components/ui";
import { platformOverview, requirePlatformAdmin } from "@/lib/platform";

// The check runs here first, before anything streams, so non-admins get a real 404 and the title never leaks.
export async function generateMetadata() {
  await requirePlatformAdmin();
  return { title: "Platform admin · Zenova", robots: { index: false } };
}

export default function AdminPage() {
  return (
    <main className="mesh min-h-dvh p-3 sm:p-6">
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const admin = await requirePlatformAdmin();
  const { stats, organizations } = await platformOverview();
  const tiles = [
    ["Organizations", stats.organizations, `${stats.active} active · ${stats.suspended} suspended`],
    ["People", stats.users, `${stats.staff} staff · ${stats.clients} clients`],
    ["Projects", stats.projects, "across all organizations"],
    ["Invoices issued", stats.invoices, "across all organizations"],
  ] as const;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:gap-5">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          {admin.hasWorkspace && (
            <Link href="/" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
              <ArrowLeft size={14} /> Dashboard
            </Link>
          )}
          <p className="flex items-center gap-2 text-[13px] text-muted"><ShieldCheck size={14} /> Signed in as {admin.email}</p>
          <h1 className="mt-1 text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">Platform admin</h1>
          <p className="mt-1 text-[13px] text-muted">Every organization on Zenova. Counts only; what&apos;s inside a workspace stays private to it.</p>
        </div>
        <form action={logout}>
          <button className="press inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="glass rounded-[24px] px-5 py-4">
            <dt className="text-[12px] text-muted">{label}</dt>
            <dd className="mt-1 text-[28px] tabular-nums leading-tight">{value}</dd>
            <dd className="text-[11px] text-muted">{sub}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        <Card>
          <CardHeader title="Organizations" sub="Suspending one signs its members out immediately; nothing is deleted." />
          <Organizations organizations={organizations} />
        </Card>
        <div className="grid gap-4 lg:gap-5">
          <Card>
            <CardHeader title="New organization" sub="Creates the workspace with default roles, payment methods and a starter workflow, then emails the owner an invite." />
            <CreateOrganization />
          </Card>
          <Card>
            <CardHeader title="Deleting an organization" sub="Irreversible, so it's a server command, not a button. Run a dry run first:" />
            <pre className="scroll-thin overflow-x-auto rounded-2xl bg-white/60 p-3 text-[11px] leading-relaxed">{`npm run delete-tenant -- --slug <slug>
npm run delete-tenant -- --slug <slug> \\
  --confirm <slug> --apply`}</pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
