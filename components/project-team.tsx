"use client";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveProject } from "@/app/actions";
import { addProjectMember, removeProjectMember, setProjectAccess } from "@/app/team-actions";
import type { ProjectTeam } from "@/lib/data";
import { Avatar, Badge, Button, Card, CardHeader, FormError, IconButton, reach } from "./ui";

const LEVELS = [
  ["view", "Can view"],
  ["edit", "Can edit"],
  ["manage", "Can manage"],
] as const;
const label = (l: string) => LEVELS.find(([k]) => k === l)?.[1] ?? l;
const select = "rounded-full bg-white/70 py-1.5 pl-3 pr-2 text-[12px] ring-1 ring-white outline-none focus:ring-ink/25 disabled:opacity-60";

// Who's on this project and what they may do here (§6.4). Managers can change it; everyone else just sees it.
export function ProjectTeamCard({ projectId, team }: { projectId: string; team: ProjectTeam }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => setError((await reach(fn())).error));
  const router = useRouter();

  return (
    <Card>
      <CardHeader title="Project team" sub={team.canManage ? "Who can see and work on this project." : "You can view who's on this project."} />
      <ul>
        {team.members.map((m) => {
          const locked = !team.canManage || m.me || m.manager;
          return (
            <li key={m.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-0">
              <Avatar name={m.name} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{m.name}{m.me && <span className="font-normal text-muted"> (you)</span>}</span>
                <span className="block truncate text-[11px] text-muted">{m.manager ? "Project manager" : m.client ? "Client" : "Teammate"}</span>
              </span>
              {locked ? (
                <Badge tone="soft">{label(m.access)}</Badge>
              ) : (
                <>
                  <select aria-label={`Access for ${m.name}`} value={m.access} disabled={pending} onChange={(e) => run(() => setProjectAccess(m.id, e.target.value))} className={select}>
                    {LEVELS.filter(([k]) => !(m.client && k === "manage")).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <IconButton label={`Remove ${m.name} from the project`} disabled={pending} onClick={() => run(() => removeProjectMember(m.id))}><X size={14} /></IconButton>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {team.canManage && team.candidates.length > 0 && <AddMember projectId={projectId} candidates={team.candidates} run={run} pending={pending} />}
      {team.canArchive && !team.archived && (
        <button
          disabled={pending}
          onClick={() =>
            confirm("Archive this project? It becomes read-only for everyone until restored.") &&
            // Stay on it: without ?project= the dashboard would open the first active project instead.
            run(async () => {
              const r = await archiveProject(projectId, true);
              if (!r.error) router.replace(`/?project=${projectId}`, { scroll: false });
              return r;
            })
          }
          className="mt-3 text-[12px] text-muted underline decoration-black/15 underline-offset-2 hover:text-ink"
        >
          Archive project
        </button>
      )}
      <FormError message={error} />
    </Card>
  );
}

function AddMember({ projectId, candidates, run, pending }: {
  projectId: string; candidates: ProjectTeam["candidates"]; run: (fn: () => Promise<{ error?: string }>) => void; pending: boolean;
}) {
  const [userId, setUserId] = useState(candidates[0].userId);
  const [level, setLevel] = useState("edit");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/60 p-2">
      <select aria-label="Teammate to add" value={userId} onChange={(e) => setUserId(e.target.value)} className={`${select} min-w-0 flex-1`}>
        {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
      </select>
      <select aria-label="Their access" value={level} onChange={(e) => setLevel(e.target.value)} className={select}>
        {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <Button className="px-4 py-1.5 text-[12px]" disabled={pending} onClick={() => run(() => addProjectMember(projectId, userId, level))}>Add</Button>
    </div>
  );
}
