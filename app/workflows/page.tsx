import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Workflows } from "@/components/workflows";
import { workflowTemplates } from "@/lib/data";
import { getSession } from "@/lib/session";

export const metadata = { title: "Workflows · Zenova Client Portal" };

export default function WorkflowsPage() {
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
  const templates = await workflowTemplates(s);
  if (!templates) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-4 lg:mb-5">
        <Link href="/" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">Workflows</h1>
        <p className="mt-1 text-[13px] text-muted">The phases and tasks every new project starts with.</p>
      </header>
      <Workflows templates={templates} />
    </div>
  );
}
