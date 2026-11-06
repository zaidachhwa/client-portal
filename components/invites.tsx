"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, X } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/app/actions";
import type { InviteOptions, ProjectSummary } from "@/lib/data";
import { Badge, Button, Card, CardHeader, IconButton, Segmented, Select, TextField, ease, keepValues } from "./ui";

const kinds = ["Client", "Teammate"] as const;

export function Invites({ options, projects }: { options: InviteOptions; projects: ProjectSummary[] }) {
  const [kind, setKind] = useState<(typeof kinds)[number]>("Client");
  const [state, action, pending] = useActionState(createInvite, undefined);
  // Clients default to the "Client" role; teammates to the least-privileged staff role, never silently to full access.
  const defaultRole = kind === "Client"
    ? options.roles.find((r) => r.name === "Client")?.id
    : options.roles.filter((r) => r.name !== "Client").sort((a, b) => a.permissions - b.permissions)[0]?.id;

  return (
    <Card>
      <CardHeader title="Invite People" sub="They'll set a password and join right away." />
      <form onSubmit={keepValues(action)} className="space-y-3">
        <Segmented id="invite-kind" label="Invite type" options={kinds} value={kind} onChange={setKind} />
        <input type="hidden" name="type" value={kind === "Client" ? "client" : "employee"} />
        <TextField label="Email" name="email" type="email" required autoComplete="off" placeholder="name@company.com" />
        <div className="grid grid-cols-2 gap-2">
          <Select key={kind} label="Role" name="roleId" defaultValue={defaultRole} required>
            {options.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select key={`project-${kind}`} label={kind === "Client" ? "Project" : "Project (optional)"} name="projectId" required={kind === "Client"} defaultValue="">
            {kind === "Teammate" && <option value="">None</option>}
            {kind === "Client" && <option value="" disabled>Choose…</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.clientName}</option>)}
          </Select>
        </div>
        <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating…" : "Create invite link"}</Button>
      </form>

      <AnimatePresence initial={false}>
        {(state?.error || state?.link) && (
          <motion.div
            key={state.link ?? state.error}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            {state.error ? (
              <p role="alert" className="pt-3 text-[12px] text-rose-600">{state.error}</p>
            ) : (
              <InviteLink path={state.link!} emailed={!!state.emailed} mailError={state.mailError} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {options.invites.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-1 px-1 text-[11px] uppercase tracking-wide text-muted">Pending</p>
          <ul>
            <AnimatePresence initial={false}>
              {options.invites.map((i) => <PendingInvite key={i.id} invite={i} />)}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </Card>
  );
}

// The token is only shown once (only its hash is stored), so make copying it effortless.
function InviteLink({ path, emailed, mailError }: { path: string; emailed: boolean; mailError?: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? path : window.location.origin + path;
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-3 rounded-2xl bg-white/70 p-3">
      <p className="mb-2 text-[12px] text-muted">
        {emailed ? "Invite emailed. You can also share this link directly; " : `Email not sent (${mailError ?? "unknown error"}). Share this link instead; `}
        it works once and expires in 7 days.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-black/4 px-2 py-1.5 text-[11px]">{url}</code>
        <IconButton label={copied ? "Copied" : "Copy invite link"} variant="solid" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </div>
    </div>
  );
}

function PendingInvite({ invite }: { invite: InviteOptions["invites"][number] }) {
  const [pending, start] = useTransition();
  return (
    <motion.li
      layout
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease }}
      className="overflow-hidden border-b border-line last:border-0"
    >
      <div className={`flex items-center gap-3 py-2.5 transition-opacity duration-150 ${pending ? "opacity-50" : ""}`}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium" title={invite.email}>{invite.email}</p>
          <p className="truncate text-[11px] text-muted">{[invite.role, invite.project].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge tone="amber">{invite.daysLeft}d left</Badge>
        <IconButton label={`Revoke invite for ${invite.email}`} variant="soft" disabled={pending} onClick={() => start(() => revokeInvite(invite.id))} className="hover:text-rose-600">
          <X size={14} />
        </IconButton>
      </div>
    </motion.li>
  );
}
