"use client";
import { AnimatePresence, motion } from "motion/react";
import { Lock, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { saveRole, setMemberActive, setMemberRole, setRoleActive } from "@/app/team-actions";
import type { TeamSettings } from "@/lib/data";
import { Avatar, Badge, Button, FormError, TextField, ease, reach, useSubmit } from "./ui";

type Member = TeamSettings["members"][number];
type Role = TeamSettings["roles"][number];

export function People({ team }: { team: TeamSettings }) {
  return <ul>{team.members.map((m) => <PersonRow key={m.id} member={m} roles={team.roles} />)}</ul>;
}

function PersonRow({ member: m, roles }: { member: Member; roles: Role[] }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => setError((await reach(fn())).error));
  const suspended = m.status === "suspended";
  const current = roles.find((r) => r.id === m.roleId);

  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className={`flex flex-wrap items-center gap-3 ${suspended ? "opacity-60" : ""}`}>
        <Avatar name={m.name} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{m.name}{m.me && <span className="font-normal text-muted"> (you)</span>}</span>
          <span className="block truncate text-[11px] text-muted">{m.email}{m.type === "client" && " · client"}{suspended && " · suspended"}</span>
        </span>
        {m.manageable ? (
          <>
            <select
              aria-label={`Role for ${m.name}`}
              value={m.roleId}
              disabled={pending || suspended}
              onChange={(e) => run(() => setMemberRole(m.id, e.target.value))}
              className="rounded-full bg-white/70 py-1.5 pl-3 pr-2 text-[12px] ring-1 ring-white outline-none focus:ring-ink/25 disabled:opacity-60"
            >
              {!current && <option value="">No role</option>}
              {roles.filter((r) => (r.active && r.editable) || r.id === m.roleId).map((r) => <option key={r.id} value={r.id} disabled={!r.active}>{r.name}</option>)}
            </select>
            <Button variant="soft" className="px-3 py-1.5 text-[12px]" disabled={pending} onClick={() => run(() => setMemberActive(m.id, suspended))}>
              {suspended ? "Restore" : "Suspend"}
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] text-muted" title={m.me ? "You can't change your own access" : "Has permissions you don't, so only someone who does can change them"}>
            {current?.name ?? "No role"} <Lock size={12} />
          </span>
        )}
      </div>
      <FormError message={error} />
    </li>
  );
}

export function Roles({ team }: { team: TeamSettings }) {
  const [open, setOpen] = useState<string | null>(null); // role id, "new", or null
  return (
    <>
      <ul className="mb-3">
        {team.roles.map((r) => (
          <li key={r.id} className="border-b border-line last:border-0">
            <RoleRow role={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            <Expand open={open === r.id}><RoleForm role={r} team={team} onDone={() => setOpen(null)} /></Expand>
          </li>
        ))}
      </ul>
      {open !== "new" && <Button variant="soft" className="w-full" onClick={() => setOpen("new")}><Plus size={14} /> New role</Button>}
      <Expand open={open === "new"}><RoleForm team={team} onDone={() => setOpen(null)} /></Expand>
    </>
  );
}

function RoleRow({ role: r, open, onToggle }: { role: Role; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={open} className={`flex w-full items-center gap-3 py-2.5 text-left ${r.active ? "" : "opacity-60"}`}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{r.name}</span>
        <span className="block truncate text-[11px] text-muted">
          {[`${r.permissions.length} permission${r.permissions.length === 1 ? "" : "s"}`, `${r.members} ${r.members === 1 ? "person" : "people"}`, !r.active && "switched off"].filter(Boolean).join(" · ")}
        </span>
      </span>
      {r.system && <Badge tone="soft">Built-in</Badge>}
      {!r.editable && <Lock size={12} className="text-muted" aria-label="Has permissions you don't hold" />}
    </button>
  );
}

function RoleForm({ role, team, onDone }: { role?: Role; team: TeamSettings; onDone: () => void }) {
  const { onSubmit, run, error, pending } = useSubmit((form) => saveRole(role?.id, undefined, form), onDone);
  const locked = role && !role.editable;
  return (
    <form onSubmit={onSubmit} className="mb-3 space-y-3 rounded-2xl bg-white/60 p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
        <TextField label="Name" name="name" required maxLength={60} defaultValue={role?.name} disabled={locked} placeholder="Finance" />
        <TextField label="Description" name="description" maxLength={200} defaultValue={role?.description} disabled={locked} placeholder="Optional" />
      </div>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="sr-only">Permissions</legend>
        {team.permissions.map((group) => (
          <div key={group.module}>
            <p className="mb-1 px-1 text-[11px] uppercase tracking-wide text-muted">{group.module}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {group.items.map((p) => (
                <label key={p.key} title={p.mine ? p.key : "You don't have this permission, so you can't grant it"} className={`flex items-start gap-2 rounded-xl px-2 py-1.5 text-[12px] ${p.mine ? "hover:bg-white/70" : "opacity-50"}`}>
                  <input type="checkbox" name="permission" value={p.key} defaultChecked={role?.permissions.includes(p.key)} disabled={!p.mine} className="mt-0.5 size-4 shrink-0 accent-[#1b2131]" />
                  <span>{p.description}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      <FormError message={error} />
      {locked ? (
        <p className="px-1 text-[12px] text-muted">This role has permissions you don&apos;t hold, so only someone who does can change it.</p>
      ) : (
        <div className="flex gap-2">
          {role && (
            <Button type="button" variant="soft" disabled={pending} onClick={() => run(() => setRoleActive(role.id, !role.active))}>
              {role.active ? "Switch off" : "Switch on"}
            </Button>
          )}
          <Button type="submit" disabled={pending} className="flex-1">{pending ? "Saving…" : role ? "Save role" : "Create role"}</Button>
        </div>
      )}
    </form>
  );
}

function Expand({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
