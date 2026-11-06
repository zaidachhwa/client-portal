"use client";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { ArrowLeftRight, Download, History, Mail, Users, ReceiptText, Settings, CalendarDays, Check, FileText, Folder, LayoutGrid, LogOut, MessageSquare, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { archiveProject, logout, reviewDocument, setEmailNotifications, switchOrg } from "@/app/actions";
import type { Billing as BillingData, ClientDetail, Inbox, ProjectTeam, CreateOptions, InviteOptions, OrgOption, ProjectSummary, ProjectView, ReviewItem, TaskItem } from "@/lib/data";
import type { Session } from "@/lib/session";
import { Calendar } from "./calendar";
import { Chat } from "./chat";
import { Requirements } from "./documents";
import { Files } from "./files";
import { Checklist, Timeline } from "./tasks";
import { Avatar, Card, CardHeader, Empty, IconButton, ProgressBar, SearchField, ease, fileSize, rise, stagger, FormError, reach } from "./ui";
import { Billing } from "./billing";
import { Notifications } from "./notifications";
import { ProjectTeamCard } from "./project-team";
import { OpenTask, TaskDialog } from "./task-dialog";
import { ClientCard } from "./client-card";
import { CreateButton } from "./create";
import { Invites } from "./invites";
import { Workflow } from "./workflow";

type Props = {
  session: NonNullable<Session> & { canUpload: boolean; canAdvance: boolean; canApprove: boolean };
  projects: ProjectSummary[];
  project: ProjectView | null;
  queue: ReviewItem[];
  invites: InviteOptions | null;
  create: CreateOptions | null;
  client: ClientDetail | null;
  orgs: OrgOption[];
  billing: BillingData | null;
  inbox: Inbox;
  openTask?: string; // from ?task=, e.g. a notification link
  team: ProjectTeam | null;
  view: View;
};

export function Dashboard({ session, projects, project, queue, invites, create, client, orgs, billing, inbox, openTask, team, view }: Props) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase();
  const match = (t: TaskItem) => (t.title + t.description).toLowerCase().includes(q);
  // Mirrors the server check in toggleTask; the server stays the source of truth.
  const edits = project?.access === "edit" || project?.access === "manage";
  // Blocked tasks can't be completed until what they wait on is done (unticking is always fine).
  const canToggle = (t: TaskItem) =>
    edits && (session.isStaff ? session.permissions.includes("tasks.update") : t.mine) && (t.status === "completed" || t.blockedBy.length === 0);
  const phase = project?.phases.find((p) => p.current)?.name;

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
      <div className="mesh flex min-h-dvh">
        <Sidebar session={session} orgs={orgs} inbox={inbox} view={view} projectId={project?.id} hasBilling={!!billing} />

        {view !== "overview" ? (
          <Section view={view} projects={projects} project={project}>
            {project && view === "calendar" && <Calendar tasks={project.tasks} canToggle={canToggle} />}
            {project && view === "files" && <Files project={project} canUpload={session.canUpload} />}
            {project && view === "chat" && <Chat project={project} me={session.name} className="h-[calc(100dvh-190px)] min-h-[420px]" />}
            {project && view === "billing" && (billing ? <Billing key={project.id} projectId={project.id} data={billing} /> : <Card><Empty>Billing isn&apos;t available to you on this project.</Empty></Card>)}
          </Section>
        ) : (
        /* The page scrolls as a whole; cards keep their natural height so nothing is squeezed. */
        <motion.main
          key={session.membershipId}
          initial="hidden"
          animate="show"
          variants={stagger}
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start items-start gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:gap-5"
        >
          <div className="flex flex-col gap-5">
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
                <Projects projects={projects.filter((p) => (p.name + p.clientName).toLowerCase().includes(q))} current={project?.id} action={create && <CreateButton options={create} />} />
                {project && <Workflow key={project.id} project={project} canAdvance={session.canAdvance} />}
                {project && team && <ProjectTeamCard key={`team-${project.id}`} projectId={project.id} team={team} />}
                {client && project && <ClientCard key={client.id} client={client} projectId={project.id} />}
                {session.canApprove && <ReviewQueue items={queue} />}
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
                <Calendar tasks={project.tasks.filter(match)} canToggle={canToggle} className="@3xl:col-span-2" />
                <Chat project={project} me={session.name} className="h-[540px]" />
                <Files project={project} canUpload={session.canUpload} className="max-h-[540px]" />
                {billing && <Billing key={project.id} projectId={project.id} data={billing} className="@3xl:col-span-2" />}
              </div>
            ) : (
              <Card>
                <Empty>No projects yet. Your team will add one shortly.</Empty>
              </Card>
            )}
          </div>
        </motion.main>
        )}
      </div>
      <TaskDialog
        task={openedTask || undefined}
        staff={session.isStaff}
        canEdit={edits && session.isStaff && session.permissions.includes("tasks.update")}
        allTasks={project?.allTasks ?? []}
        onClose={closeTask}
      />
      </OpenTask>
    </MotionConfig>
  );
}

// Each item is its own page; links keep the selected project.
export type View = "overview" | "calendar" | "files" | "chat" | "billing";
const nav: { view: View; path: string; label: string; Icon: typeof LayoutGrid }[] = [
  { view: "overview", path: "/", label: "Dashboard", Icon: LayoutGrid },
  { view: "calendar", path: "/calendar", label: "Calendar", Icon: CalendarDays },
  { view: "files", path: "/files", label: "Files", Icon: Folder },
  { view: "chat", path: "/chat", label: "Chat", Icon: MessageSquare },
  { view: "billing", path: "/billing", label: "Billing", Icon: ReceiptText },
];
const withProject = (path: string, projectId?: string) => (projectId ? `${path}?project=${projectId}` : path);

function Sidebar({ session, orgs, inbox, view, projectId, hasBilling }: Pick<Props, "session" | "orgs" | "inbox"> & { view: View; projectId?: string; hasBilling: boolean }) {
  return (
    <nav id="top" aria-label="Main" className="sticky top-0 z-10 flex h-dvh w-16 shrink-0 flex-col items-center gap-2 border-r border-white/60 bg-white/30 py-5 backdrop-blur-xl sm:w-[72px]">
      <svg viewBox="0 0 24 24" className="mb-6 size-7 text-ink" role="img" aria-label="Zenova">
        <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
      </svg>
      {nav.filter((n) => n.view !== "billing" || hasBilling).map(({ view: v, path, label, Icon }) => (
        <Link
          key={v}
          href={withProject(path, projectId)}
          aria-label={label}
          title={label}
          aria-current={v === view ? "page" : undefined}
          className={`press relative grid size-11 place-items-center rounded-full transition-colors duration-150 ${v === view ? "text-white" : "text-ink/70 hover:bg-white/70 hover:text-ink"}`}
        >
          {v === view && <motion.span layoutId="nav-active" transition={{ type: "spring", duration: 0.35, bounce: 0 }} className="absolute inset-0 rounded-full bg-ink" />}
          <Icon size={18} className="relative" />
        </Link>
      ))}

      <Notifications inbox={inbox} />
      <button popoverTarget="account-menu" aria-label={`Account: ${session.name}`} className="press mt-1 rounded-full">
        <Avatar name={session.name} size={42} />
      </button>
      <div id="account-menu" popover="auto" className="menu fixed inset-auto bottom-4 left-[76px] m-0 w-60 rounded-2xl bg-white/90 p-1.5 text-ink shadow-[0_16px_40px_-12px_rgb(27_33_49/0.35)] ring-1 ring-black/5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <Avatar name={session.name} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{session.name}</span>
            <span className="block truncate text-[11px] text-muted">{session.roleLabel}</span>
          </span>
        </div>
        {orgs.length > 1 && (
          <div className="border-t border-line py-1">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">Switch workspace</p>
            {orgs.map((o) => (
              <form key={o.membershipId} action={switchOrg.bind(null, o.membershipId)}>
                <button
                  disabled={o.current}
                  aria-current={o.current ? "true" : undefined}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 enabled:hover:bg-black/4"
                >
                  {o.current ? <Check size={15} className="text-ink" /> : <ArrowLeftRight size={15} className="text-muted" />}
                  <span className="truncate">{o.name}</span>
                </button>
              </form>
            ))}
          </div>
        )}
        {session.permissions.includes("organization.update") && session.isStaff && (
          <Link href="/settings" className="flex w-full items-center gap-2.5 rounded-xl border-t border-line px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <Settings size={15} className="text-muted" /> Settings
          </Link>
        )}
        {session.isStaff && session.permissions.includes("roles.manage") && (
          <Link href="/team" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <Users size={15} className="text-muted" /> Team & roles
          </Link>
        )}
        {session.isStaff && session.permissions.includes("audit.view") && (
          <Link href="/audit" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <History size={15} className="text-muted" /> Activity log
          </Link>
        )}
        <EmailToggle on={session.emailNotifications} />
        <a href="/export/me" download className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
          <Download size={15} className="text-muted" /> Download my data
        </a>
        <form action={logout} className="border-t border-line pt-1">
          <button className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <LogOut size={15} className="text-muted" /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

function Projects({ projects: all, current, action }: { projects: ProjectSummary[]; current?: string; action?: ReactNode }) {
  const archivedCount = all.filter((p) => p.archived).length;
  const [showArchived, setShowArchived] = useState(false);
  // The open project stays listed even when archived, so you can see where you are.
  const projects = all.filter((p) => showArchived || !p.archived || p.id === current);
  return (
    <Card>
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

function EmailToggle({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors duration-150 hover:bg-black/4">
      <Mail size={15} className="text-muted" />
      <span className="flex-1">Email me updates</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={pending}
        onChange={() => start(() => setEmailNotifications(!on))}
        className="relative h-5 w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-black/15 transition-colors duration-200 before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-transform before:duration-200 checked:bg-ink checked:before:translate-x-3 disabled:opacity-60"
      />
    </label>
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
    <Card>
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
