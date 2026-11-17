"use client";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Check, FileText, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { archiveProject, reviewDocument } from "@/app/actions";
import type { Billing as BillingData, ClientDetail, GettingStartedItem, ProjectTeam, CreateOptions, InviteOptions, ProjectSummary, ProjectView, ReviewItem, TaskItem } from "@/lib/data";
import type { Session } from "@/lib/session";
import { Calendar } from "./calendar";
import { Chat } from "./chat";
import { Requirements } from "./documents";
import { Files } from "./files";
import { Checklist, Timeline } from "./tasks";
import { Card, CardHeader, Empty, IconButton, ProgressBar, SearchField, ease, fileSize, rise, stagger, FormError, reach } from "./ui";
import { Billing } from "./billing";
import { ProjectTeamCard } from "./project-team";
import { OpenTask, TaskDialog } from "./task-dialog";
import { ClientCard } from "./client-card";
import { CreateButton } from "./create";
import { Invites } from "./invites";
import { Workflow } from "./workflow";
import { GettingStarted } from "./getting-started";
import { Tour, type TourRole } from "./tour";
import { nav, withProject, type View } from "./nav";
export type { View };
import type { TaskManage } from "./task-form";

type Props = {
  session: NonNullable<Session> & { canUpload: boolean; canAdvance: boolean; canApprove: boolean };
  projects: ProjectSummary[];
  project: ProjectView | null;
  queue: ReviewItem[];
  invites: InviteOptions | null;
  create: CreateOptions | null;
  client: ClientDetail | null;
  billing: BillingData | null;
  openTask?: string; // from ?task=, e.g. a notification link
  team: ProjectTeam | null;
  view: View;
  setup?: GettingStartedItem[] | null;
};

export function Dashboard({ session, projects, project, queue, invites, create, client, billing, openTask, team, view, setup }: Props) {
  // Which guided tour fits: clients, account managers (who can change org settings), everyone else on the team.
  const tourRole: TourRole = !session.isStaff ? "client" : session.permissions.includes("organization.update") ? "owner" : "staff";
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const match = (t: TaskItem) => (t.title + t.description).toLowerCase().includes(q);
  // Mirrors the server check in toggleTask; the server stays the source of truth.
  const edits = project?.access === "edit" || project?.access === "manage";
  // Blocked tasks can't be completed until what they wait on is done (unticking is always fine).
  const canToggle = (t: TaskItem) =>
    edits && (session.isStaff ? session.permissions.includes("tasks.update") : t.mine) && (t.status === "completed" || t.blockedBy.length === 0);
  const phase = project?.phases.find((p) => p.current)?.name;
  // The calendar shows every dated task, onboarding ones included, sorted by date (the timeline leaves those to the checklist).
  const dated = project ? [...project.tasks, ...project.onboarding].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")) : [];
  // Adding, editing and deleting tasks: staff with tasks.update and edit access (mirrors saveTask on the server).
  const manage: TaskManage | undefined =
    project && edits && session.isStaff && session.permissions.includes("tasks.update") ? { projectId: project.id, assignees: project.assignees } : undefined;

  const router = useRouter();
  // Live updates: re-fetch server data every 30s while the tab is visible, and as soon as it's focused again.
  // A refresh keeps client state (open dialogs, half-typed forms), so it's safe to run in the background.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && router.refresh();
    const timer = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  // The dialog follows ?task= when it changes (notification click), and can be opened from any task row.
  const [openId, setOpenId] = useState(openTask);
  const [linked, setLinked] = useState(openTask);
  if (openTask !== linked) {
    setLinked(openTask);
    setOpenId(openTask);
  }
  const openedTask = project && [...project.tasks, ...project.onboarding].find((t) => t.id === openId);
  const closeTask = () => {
    setOpenId(undefined);
    if (openTask && project) router.replace(`/?project=${project.id}`, { scroll: false });
  };

  return (
    <MotionConfig reducedMotion="user">
      <OpenTask value={setOpenId}>
        {view !== "overview" ? (
          <Section view={view} projects={projects} project={project}>
            {project && view === "calendar" && <Calendar tasks={dated} canToggle={canToggle} manage={manage} />}
            {project && view === "files" && <Files project={project} canUpload={session.canUpload} />}
            {project && view === "chat" && <Chat project={project} me={session.name} className="h-[calc(100dvh-190px)] min-h-[420px]" />}
            {project && view === "billing" && (billing ? <Billing key={project.id} projectId={project.id} data={billing} /> : <Card><Empty>Billing isn&apos;t available to you on this project.</Empty></Card>)}
          </Section>
        ) : (
        /* Cards keep their natural height so nothing is squeezed. */
        <motion.main
          key={session.membershipId}
          initial="hidden"
          animate="show"
          variants={stagger}
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-5"
        >
          {/* On desktop the left column scrolls on its own, so the page is only as tall as the right one. */}
          <div className="scroll-thin flex flex-col gap-5 lg:sticky lg:top-4 lg:-mx-2 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-2 lg:pb-2">
            <motion.header variants={rise} className="px-1 pt-3 lg:pt-8">
              <p className="text-[13px] text-muted">
                Welcome back, {session.firstName} – {session.isStaff ? "here's what needs you today" : "let's build together"}
              </p>
              <h1 className="mb-5 mt-2 text-[34px] leading-[1.05] tracking-[-0.02em]">
                {session.isStaff ? <>Client<br />Workspace</> : <>Your Project<br />Dashboard</>}
              </h1>
              <SearchField
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
                placeholder={session.isStaff ? "Search projects and tasks" : "Search tasks"}
              />
            </motion.header>

            {project?.archived && <ArchivedBanner projectId={project.id} canRestore={!!team?.canArchive} />}
            {session.isStaff ? (
              <>
                {setup && <GettingStarted items={setup} />}
                <Projects projects={projects.filter((p) => (p.name + p.clientName).toLowerCase().includes(q))} current={project?.id} action={create && <CreateButton options={create} />} />
                {project && <Workflow key={project.id} project={project} canAdvance={session.canAdvance} />}
                {project && <Checklist tasks={project.onboarding} canToggle={canToggle} />}
                {project && team && <ProjectTeamCard key={`team-${project.id}`} projectId={project.id} team={team} />}
                {invites && <Invites options={invites} projects={projects} />}
              </>
            ) : (
              project && (
                <>
                  <Timeline tasks={project.tasks.filter(match)} canToggle={canToggle} phase={phase} />
                  <Checklist tasks={project.onboarding} canToggle={canToggle} />
                  <Requirements projectId={project.id} items={project.requirements} canUpload={session.canUpload} />
                </>
              )
            )}
          </div>

          <div className="@container">
            {project ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-2 lg:gap-5">
                <Calendar tasks={dated.filter(match)} canToggle={canToggle} manage={manage} className="@3xl:col-span-2" />
                <Chat project={project} me={session.name} className="h-[540px]" />
                <Files project={project} canUpload={session.canUpload} className="max-h-[540px]" />
                {billing && <Billing key={project.id} projectId={project.id} data={billing} className="@3xl:col-span-2" />}
                {/* Staff extras sit under billing so both columns end at roughly the same height. */}
                {session.isStaff && client && <ClientCard key={client.id} client={client} projectId={project.id} />}
                {session.isStaff && session.canApprove && <ReviewQueue items={queue} />}
              </div>
            ) : (
              <Card>
                <Empty>No projects yet. Your team will add one shortly.</Empty>
              </Card>
            )}
          </div>
        </motion.main>
        )}
      <TaskDialog
        task={openedTask || undefined}
        staff={session.isStaff}
        canEdit={edits && session.isStaff && session.permissions.includes("tasks.update")}
        manage={manage}
        allTasks={project?.allTasks ?? []}
        onClose={closeTask}
      />
      {/* Plays once on a person's first visit to the overview; "Take the tour" in the menu replays it. */}
      <Tour role={tourRole} auto={view === "overview" && !session.toursSeen.includes(tourRole)} />
      </OpenTask>
    </MotionConfig>
  );
}

function Projects({ projects: all, current, action }: { projects: ProjectSummary[]; current?: string; action?: ReactNode }) {
  const archivedCount = all.filter((p) => p.archived).length;
  const [showArchived, setShowArchived] = useState(false);
  // The open project stays listed even when archived, so you can see where you are.
  const projects = all.filter((p) => showArchived || !p.archived || p.id === current);
  return (
    <Card tour="projects">
      <CardHeader title="Active Projects" sub={`${all.length - archivedCount} in progress`} action={action} />
      {projects.length === 0 && <Empty>No projects match.</Empty>}
      <ul className="space-y-1">
        {projects.map((p) => {
          const active = p.id === current;
          return (
            <li key={p.id}>
              <Link
                href={`/?project=${p.id}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`press relative block rounded-2xl px-3 py-2.5 transition-colors duration-200 ${active ? "text-white" : "hover:bg-white/60"}`}
              >
                {active && (
                  <motion.span layoutId="active-project" transition={{ type: "spring", duration: 0.35, bounce: 0 }} className="absolute inset-0 rounded-2xl bg-ink" />
                )}
                <span className="relative block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{p.clientName}</span>
                    <span className={`text-[11px] tabular-nums ${active ? "text-white/60" : "text-muted"}`}>{Math.round(p.progress * 100)}%</span>
                  </span>
                  <span className={`mb-2 block truncate text-[11px] ${active ? "text-white/60" : "text-muted"}`}>
                    {p.name}{p.category && ` · ${p.category}`}{p.archived && " · Archived"}
                  </span>
                  <ProgressBar value={p.progress} inverted={active} className="h-1" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {archivedCount > 0 && (
        <button onClick={() => setShowArchived(!showArchived)} className="mt-2 w-full rounded-xl px-3 py-1.5 text-left text-[12px] text-muted transition-colors duration-150 hover:bg-white/60 hover:text-ink">
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      )}
    </Card>
  );
}

// Archived projects are read-only for everyone; their managers can restore them here.
function ArchivedBanner({ projectId, canRestore }: { projectId: string; canRestore: boolean }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div role="status" className="rounded-2xl bg-amber-100/80 px-4 py-3 text-[13px] text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>This project is archived, so it&apos;s read-only.</span>
        {canRestore && (
          <button disabled={pending} onClick={() => start(async () => setError((await reach(archiveProject(projectId, false))).error))} className="rounded-full bg-white/80 px-3 py-1 text-[12px] font-medium">
            {pending ? "Restoring…" : "Restore"}
          </button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}

// A single section (Calendar, Files, Chat, Billing) full width, with a project picker.
function Section({ view, projects, project, children }: { view: View; projects: ProjectSummary[]; project: ProjectView | null; children: ReactNode }) {
  const router = useRouter();
  const title = nav.find((n) => n.view === view)!.label;
  const options = projects.filter((p) => !p.archived || p.id === project?.id);
  return (
    <motion.main initial="hidden" animate="show" variants={stagger} className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
      <motion.header variants={rise} className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1 pt-3 lg:pt-4">
        <div>
          <h1 className="text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.02em]">{title}</h1>
          {project && <p className="mt-1 text-[13px] text-muted">{project.clientName} · {project.name}</p>}
        </div>
        {options.length > 1 && (
          <select
            aria-label="Project"
            value={project?.id}
            onChange={(e) => router.push(withProject(nav.find((n) => n.view === view)!.path, e.target.value))}
            className="rounded-full bg-white/70 py-2 pl-4 pr-3 text-[13px] ring-1 ring-white outline-none focus:ring-ink/25"
          >
            {options.map((p) => <option key={p.id} value={p.id}>{p.clientName} · {p.name}</option>)}
          </select>
        )}
      </motion.header>
      {project ? children : <Card><Empty>No projects yet. Your team will add one shortly.</Empty></Card>}
    </motion.main>
  );
}

function ReviewQueue({ items }: { items: ReviewItem[] }) {
  return (
    <Card tour="review">
      <CardHeader title="Review Queue" sub="Client uploads waiting on verification." />
      {items.length === 0 && <Empty>All caught up.</Empty>}
      <ul>
        <AnimatePresence initial={false}>
          {items.map((d) => <ReviewRow key={d.id} item={d} />)}
        </AnimatePresence>
      </ul>
    </Card>
  );
}

function ReviewRow({ item }: { item: ReviewItem }) {
  const [pending, start] = useTransition();
  const decide = (decision: "approved" | "rejected") => start(() => reviewDocument(item.id, decision));
  return (
    <motion.li
      layout
      exit={{ opacity: 0, height: 0, filter: "blur(2px)" }}
      transition={{ duration: 0.2, ease }}
      className="overflow-hidden border-b border-line last:border-0"
    >
      <div className={`flex items-center gap-3 py-2.5 transition-opacity duration-150 ${pending ? "opacity-50" : ""}`}>
        <FileText size={15} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium" title={item.name}>{item.name}</p>
          <p className="truncate text-[11px] text-muted">{item.clientName} · {fileSize(item.size)}</p>
        </div>
        <IconButton label={`Reject ${item.name}`} variant="soft" disabled={pending} onClick={() => decide("rejected")} className="hover:text-rose-600">
          <X size={14} />
        </IconButton>
        <IconButton label={`Approve ${item.name}`} variant="solid" disabled={pending} onClick={() => decide("approved")}>
          <Check size={14} />
        </IconButton>
      </div>
    </motion.li>
  );
}
