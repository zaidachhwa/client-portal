import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { People, Roles } from "@/components/team";
import { Card, CardHeader } from "@/components/ui";
import { teamSettings } from "@/lib/data";
import { getSession } from "@/lib/session";

export const metadata = { title: "Team & roles · Zenova Client Portal" };

export default function TeamPage() {
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
  const team = await teamSettings(s);
  if (!team) notFound();
  const staff = team.members.filter((m) => m.type === "employee").length;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-5">
      <header className="lg:col-span-2">
        <Link href="/" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <ArrowLeft size={14} /> Dashboard
        </Link>
        <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">Team & roles</h1>
        <p className="mt-1 text-[13px] text-muted">Who can do what. You can only grant permissions you have yourself.</p>
      </header>
      <Card>
        <CardHeader title="People" sub={`${staff} teammate${staff === 1 ? "" : "s"} · ${team.members.length - staff} client${team.members.length - staff === 1 ? "" : "s"}`} />
        <People team={team} />
      </Card>
      <Card>
        <CardHeader title="Roles" sub="Each role is a set of permissions. Changes apply on everyone's next page load." />
        <Roles team={team} />
      </Card>
    </div>
  );
}
