import {
  BadgeIndianRupee, CalendarClock, CheckCircle2, ClipboardCheck, FileCheck2, FileText, History, KeyRound,
  ListChecks, MessageSquare, ReceiptText, Repeat2, ShieldCheck, Users, Workflow,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeroShot, Motion, Reveal, Rule } from "@/components/landing";
import clientShot from "@/public/landing/client.png";
import staffShot from "@/public/landing/staff.png";

export const metadata = {
  title: "Zenova · The client portal for agencies",
  description: "Onboard clients, run every project on a repeatable workflow, collect documents and send GST-ready invoices in one workspace.",
};

// "Book a demo" only shows when there is somewhere for it to go.
const CONTACT = process.env.SALES_EMAIL;

const solid = "press inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_8px_20px_-10px_rgb(27_33_49/0.6)] transition-colors duration-150 hover:bg-ink/90";
const soft = "press inline-flex items-center justify-center gap-2 rounded-full bg-white/70 px-5 py-2.5 text-[14px] font-medium text-ink ring-1 ring-white transition-colors duration-150 hover:bg-white";

const steps = [
  { title: "Add the client", body: "Company, tax details and the people you talk to." },
  { title: "Start from a workflow", body: "Phases, tasks and required documents are created for you." },
  { title: "Invite them in", body: "Clients set a password and see exactly what's waiting on them." },
  { title: "Advance and bill", body: "Close each phase when its rules are met; milestones become invoices." },
];

const clientSide = [
  { Icon: ListChecks, title: "An onboarding checklist", body: "Every step they owe you, with who it's waiting on." },
  { Icon: FileCheck2, title: "Required documents", body: "Upload once, see when it's approved or needs another try." },
  { Icon: MessageSquare, title: "One conversation per project", body: "No more threads lost across email and WhatsApp." },
  { Icon: CalendarClock, title: "Timeline and calendar", body: "What's done, what's next and what's overdue." },
];

const teamSide = [
  { Icon: Workflow, title: "Repeatable workflows", body: "Design phases once. Each phase completes only when its required tasks and documents are done." },
  { Icon: ClipboardCheck, title: "Review queue", body: "Approve or reject client uploads in one place." },
  { Icon: Users, title: "Per-project access", body: "Decide who can view, edit or manage each project." },
];

const billing = [
  { Icon: ReceiptText, title: "GST-ready invoices", body: "CGST + SGST or IGST worked out from your state and theirs." },
  { Icon: Repeat2, title: "Milestones tied to phases", body: "Finishing a phase raises the draft invoice for you." },
  { Icon: BadgeIndianRupee, title: "Payments with proof", body: "Clients report UPI or bank payments; your team verifies them." },
  { Icon: FileText, title: "Credit and debit notes", body: "Corrections stay linked to the invoice they change." },
];

const trust = [
  { Icon: KeyRound, title: "Roles and permissions", body: "Give each teammate only what their job needs." },
  { Icon: History, title: "Activity log", body: "Every change, who made it and when, ready to export." },
  { Icon: ShieldCheck, title: "Your data stays yours", body: "Each organization is isolated. Export everything, set how long records are kept." },
];

function Logo() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-ink" aria-hidden>
      <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
    </svg>
  );
}

function Demo({ className = solid, children = "Book a demo" }: { className?: string; children?: ReactNode }) {
  return CONTACT ? <a href={`mailto:${CONTACT}?subject=Zenova%20demo`} className={className}>{children}</a> : null;
}

function Section({ id, eyebrow, title, sub, children }: { id: string; eyebrow: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <Reveal className="mb-12 max-w-2xl">
        <p className="mb-3 text-[13px] font-medium text-muted">{eyebrow}</p>
        <h2 id={`${id}-title`} className="text-[30px] leading-[1.1] sm:text-[40px]">{title}</h2>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">{sub}</p>
      </Reveal>
      {children}
    </section>
  );
}

function Feature({ Icon, title, body, i }: { Icon: typeof Users; title: string; body: string; i: number }) {
  return (
    <Reveal delay={i * 0.06}>
      <div className="flex gap-4 border-t border-line pt-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/70 ring-1 ring-white"><Icon size={16} /></span>
        <div>
          <h3 className="text-[15px] font-medium">{title}</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{body}</p>
        </div>
      </div>
    </Reveal>
  );
}

function Shot({ src, alt, preload }: { src: typeof staffShot; alt: string; preload?: boolean }) {
  return (
    <div className="glass overflow-hidden rounded-[20px] p-1.5 sm:rounded-[28px] sm:p-2">
      <Image src={src} alt={alt} preload={preload} sizes="(min-width: 1152px) 1120px, 100vw" className="w-full rounded-[14px] sm:rounded-[22px]" />
    </div>
  );
}

export default function Welcome() {
  return (
    <Motion>
      <div className="mesh min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-white/50 bg-white/40 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl">
          <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
            <Link href="/welcome" className="flex items-center gap-2 text-[17px] font-medium"><Logo /> Zenova</Link>
            <div className="hidden gap-6 text-[14px] text-muted md:flex">
              <a href="#flow" className="transition-colors hover:text-ink">How it works</a>
              <a href="#product" className="transition-colors hover:text-ink">Product</a>
              <a href="#billing" className="transition-colors hover:text-ink">Billing</a>
              <a href="#trust" className="transition-colors hover:text-ink">Security</a>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/login" className={`${soft} px-4 py-2`}>Sign in</Link>
              <Demo className={`${solid} hidden px-4 py-2 sm:inline-flex`} />
            </div>
          </nav>
        </header>

        <main>
          <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-1 text-[13px] text-muted ring-1 ring-white">
                <CheckCircle2 size={14} className="text-ink" /> Built for agencies, studios and consultancies
              </p>
              <h1 className="text-[40px] leading-[1.05] sm:text-[64px]">The client portal for agencies</h1>
              <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted">
                Onboard clients, run every project on a repeatable workflow, collect documents and send GST-ready invoices,
                in one calm workspace your clients will actually use.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Demo />
                <Link href="/login" className={soft}>Sign in to your workspace</Link>
              </div>
            </Reveal>
            <div className="mt-14 sm:mt-20">
              <HeroShot>
                <Shot src={staffShot} preload alt="Zenova team dashboard: active projects, the current workflow phase, an onboarding checklist, a task calendar, client chat, shared files and billing." />
              </HeroShot>
            </div>
          </section>

          <Section id="flow" eyebrow="How it works" title="From signed to delivered, in four steps" sub="The same path for every client, so nothing depends on someone remembering what comes next.">
            <ol className="relative grid gap-8 md:grid-cols-4 md:gap-6">
              <Rule />
              {steps.map((s, i) => (
                <li key={s.title}>
                  <Reveal delay={0.1 + i * 0.12}>
                    <span className="relative grid size-8 place-items-center rounded-full bg-ink text-[13px] tabular-nums text-white">{i + 1}</span>
                    <h3 className="mt-5 text-[16px] font-medium">{s.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{s.body}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="product" eyebrow="For your clients" title="A dashboard of their own" sub="Clients see their project, what's waiting on them and everything you've shared. Nothing internal, nothing to install.">
            <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
              <Reveal><Shot src={clientShot} alt="Zenova client dashboard: task timeline, onboarding checklist, project calendar, chat with the account manager and shared files." /></Reveal>
              <div className="grid gap-6">
                {clientSide.map((f, i) => <Feature key={f.title} {...f} i={i} />)}
              </div>
            </div>
            <div className="mt-20">
              <Reveal className="mb-8 max-w-2xl">
                <p className="mb-3 text-[13px] font-medium text-muted">For your team</p>
                <h3 className="text-[26px] leading-[1.15] sm:text-[32px]">Everything that needs you, in one view</h3>
              </Reveal>
              <div className="grid gap-6 md:grid-cols-3">
                {teamSide.map((f, i) => <Feature key={f.title} {...f} i={i} />)}
              </div>
            </div>
          </Section>

          <Section id="billing" eyebrow="Billing" title="Invoicing that follows the work" sub="Agree the value, set milestones and let the workflow tell you when to bill. Built for Indian GST from day one.">
            <div className="grid gap-6 sm:grid-cols-2">
              {billing.map((f, i) => <Feature key={f.title} {...f} i={i} />)}
            </div>
          </Section>

          <Section id="trust" eyebrow="Security and control" title="Built for teams that answer to clients" sub="Clear permissions, a full record of changes and a straightforward way out with your data.">
            <div className="grid gap-6 md:grid-cols-3">
              {trust.map((f, i) => <Feature key={f.title} {...f} i={i} />)}
            </div>
          </Section>

          <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
            <Reveal>
              <div className="glass rounded-[28px] px-6 py-14 text-center sm:px-12">
                <h2 className="mx-auto max-w-2xl text-[28px] leading-[1.15] sm:text-[36px]">Bring your next client onboard with Zenova</h2>
                <p className="mx-auto mt-4 max-w-xl text-[16px] text-muted">Set up your workspace, add your first workflow and invite a client the same day.</p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Demo />
                  <Link href="/login" className={soft}>Sign in</Link>
                </div>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="border-t border-white/60 pb-[env(safe-area-inset-bottom,0px)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-8 text-[13px] text-muted sm:px-6">
            <span className="flex items-center gap-2 text-ink"><Logo /> Zenova</span>
            {CONTACT && <span>{CONTACT}</span>}
            <Link href="/login" className="ml-auto transition-colors hover:text-ink">Sign in</Link>
          </div>
        </footer>
      </div>
    </Motion>
  );
}
