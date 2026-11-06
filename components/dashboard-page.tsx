import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Dashboard, type View } from "@/components/dashboard";
import { atLeast, billing, clientDetail, projectTeam, createOptions, getProjectView, inbox, inviteOptions, listProjects, myOrgs, reviewQueue } from "@/lib/data";
import { can, getSession } from "@/lib/session";

// Shared by the overview (/) and the section pages (/calendar, /files, /chat, /billing).
// The session is read per request, so it streams in behind Suspense (Cache Components).
type Params = PageProps<"/">["searchParams"];
export function DashboardPage({ searchParams, view }: { searchParams: Params; view: View }) {
  return (
    <Suspense fallback={<div className="mesh min-h-dvh" />}>
      <Content searchParams={searchParams} view={view} />
    </Suspense>
  );
}

async function Content({ searchParams, view }: { searchParams: Params; view: View }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { project: wanted, task } = await searchParams;
  const [projects, queue, invites, create, orgs, notifications] = await Promise.all([
    listProjects(session), reviewQueue(session), inviteOptions(session), createOptions(session), myOrgs(session), inbox(session),
  ]);
  const current = projects.find((p) => p.id === wanted) ?? projects.find((p) => !p.archived) ?? projects[0];
  const project = current ? await getProjectView(session, current.id) : null;
  const [client, bills, team] = project
    ? await Promise.all([session.isStaff ? clientDetail(session, project.clientId) : null, billing(session, project.id), projectTeam(session, project.id)])
    : [null, null, null];
  const edits = atLeast(project?.access, "edit");

  return (
    <Dashboard
      // Role permission AND project access (§6.4): view-only members get no write buttons.
      session={{ ...session, canUpload: edits && can(session, "documents.upload"), canAdvance: edits && can(session, "workflows.advance"), canApprove: can(session, "documents.approve") }}
      projects={projects}
      project={project}
      queue={queue}
      invites={invites}
      create={create}
      client={client}
      orgs={orgs}
      billing={bills}
      inbox={notifications}
      team={team}
      openTask={typeof task === "string" ? task : undefined}
      view={view}
    />
  );
}
