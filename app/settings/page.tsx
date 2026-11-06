import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PaymentMethods, ProfileForm, Retention } from "@/components/settings";
import { Card, CardHeader } from "@/components/ui";
import { orgSettings } from "@/lib/data";
import { getSession } from "@/lib/session";

export const metadata = { title: "Settings · Zenova Client Portal" };

export default function SettingsPage() {
  return (
    <main className="mesh min-h-dvh p-3 sm:p-6">
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const s = await getSession();
  if (!s) redirect("/login");
  const settings = await orgSettings(s);
  if (!settings) notFound();

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-5">
      <header className="lg:col-span-2">
        <Link href="/" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[13px] text-muted">{settings.profile.name} · what appears on new invoices and how clients can pay.</p>
      </header>

      <Card>
        <CardHeader title="Organization" sub="Printed on every new invoice. Issued invoices keep the details they were issued with." />
        <ProfileForm profile={settings.profile} />
      </Card>

      <div className="grid content-start gap-4 lg:gap-5">
        <Card>
          <CardHeader title="Payment methods" sub="What clients can pick when they report a payment." />
          <PaymentMethods methods={settings.methods} />
        </Card>
        <Card>
          <CardHeader title="Data & retention" sub="How long records are kept. Expired ones are removed by the retention job; archived work stays readable until then." />
          <Retention policy={settings.retention} />
        </Card>
        <Card>
          <CardHeader title="Numbering" sub={`Financial year ${settings.numbering.financialYear} (April–March). Numbers never skip or repeat.`} />
          <dl className="space-y-2 text-[13px]">
            {([["Next invoice", settings.numbering.invoice], ["Next credit note", settings.numbering.creditNote], ["Next debit note", settings.numbering.debitNote]] as const).map(([label, value]) => (
              <div key={label} className="flex justify-between rounded-xl bg-white/60 px-3 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
