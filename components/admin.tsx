"use client";
import { Check, Copy } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { createOrganization, resendOwnerInvite, setOrganizationStatus } from "@/app/admin-actions";
import type { PlatformOverview } from "@/lib/platform";
import { Badge, Button, Empty, FormError, TextField, reach } from "./ui";

type Org = PlatformOverview["organizations"][number];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never");

export function Organizations({ organizations }: { organizations: Org[] }) {
  if (!organizations.length) return <Empty>No organizations yet. Create the first one.</Empty>;
  return (
    <div className="scroll-thin -mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-[11px] text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-normal">Organization</th>
            <th className="py-2 pr-3 font-normal">Owner</th>
            <th className="py-2 pr-3 text-right font-normal">Staff</th>
            <th className="py-2 pr-3 text-right font-normal">Clients</th>
            <th className="py-2 pr-3 text-right font-normal">Projects</th>
            <th className="py-2 pr-3 font-normal">Last activity</th>
            <th className="py-2 font-normal"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>{organizations.map((o) => <Row key={o.id} org={o} />)}</tbody>
      </table>
    </div>
  );
}

function Row({ org: o }: { org: Org }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, start] = useTransition();
  const suspended = o.status === "suspended";

  const toggle = () => start(async () => {
    const r = await reach(setOrganizationStatus(o.id, suspended ? "active" : "suspended"));
    setError(r.error);
    setConfirming(false);
  });
  const resend = () => start(async () => {
    const r = await reach(resendOwnerInvite(o.id));
    setError(r.error);
    if (!r.error) setNotice(r.emailed ? "Invite emailed again." : `Email failed. Share this link: ${location.origin}${r.link}`);
  });

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="py-3 pr-3">
        <span className="flex items-center gap-2">
          <span className="font-medium">{o.name}</span>
          {o.status !== "active" && <Badge tone={suspended ? "rose" : "soft"}>{o.status}</Badge>}
        </span>
        <span className="block text-[11px] text-muted">{o.slug} · since {day(o.createdAt)} · {o.invoices} invoices</span>
        {(error || notice) && <p role={error ? "alert" : "status"} className={`mt-1 break-all text-[11px] ${error ? "text-rose-600" : "text-muted"}`}>{error ?? notice}</p>}
      </td>
      <td className="py-3 pr-3">
        {o.owner ? (
          <>
            <span className="block">{o.owner.name}</span>
            <span className="block text-[11px] text-muted">{o.owner.email}</span>
          </>
        ) : o.pendingOwner ? (
          <>
            <span className="block text-[11px] text-muted">Invite pending</span>
            <span className="block text-[11px]">{o.pendingOwner}</span>
          </>
        ) : (
          <span className="text-[11px] text-muted">No Account manager</span>
        )}
      </td>
      <td className="py-3 pr-3 text-right tabular-nums">{o.staff}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{o.clients}</td>
      <td className="py-3 pr-3 text-right tabular-nums">{o.projects}</td>
      <td className="py-3 pr-3 text-[12px] text-muted">{day(o.lastActivity)}</td>
      <td className="py-3">
        <div className="flex flex-col items-end gap-1.5">
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <Button variant="soft" onClick={() => setConfirming(false)} disabled={pending} className="px-3 py-1.5 text-[12px]">Cancel</Button>
              <Button onClick={toggle} disabled={pending} variant={suspended ? "solid" : "danger"} className="px-3 py-1.5 text-[12px]">
                {pending ? "Saving…" : suspended ? "Reactivate" : "Suspend"}
              </Button>
            </span>
          ) : (
            <Button variant="soft" onClick={() => setConfirming(true)} className="px-3 py-1.5 text-[12px]">{suspended ? "Reactivate…" : "Suspend…"}</Button>
          )}
          {o.pendingOwner && !confirming && (
            <button onClick={resend} disabled={pending} className="text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline">Resend owner invite</button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function CreateOrganization() {
  const [state, action, pending] = useActionState(createOrganization, undefined);
  const [copied, setCopied] = useState(false);
  const link = state?.link && typeof window !== "undefined" ? `${location.origin}${state.link}` : "";

  return (
    <form action={action} className="space-y-3">
      <TextField label="Organization name" name="name" required maxLength={120} placeholder="Acme Studio" />
      <TextField label="Owner's email" name="ownerEmail" type="email" required maxLength={200} placeholder="owner@acme.studio" />
      <FormError message={state?.error} />
      {state?.link && (
        <div role="status" className="space-y-2 rounded-2xl bg-white/60 p-3 text-[12px]">
          <p>{state.emailed ? "Created. The owner has been emailed an invite." : "Created, but the email didn't send. Share this link with the owner:"}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-[11px] text-muted">{link}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
              aria-label="Copy invite link"
              className="press grid size-8 shrink-0 place-items-center rounded-full bg-white/70 ring-1 ring-white"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating…" : "Create organization"}</Button>
    </form>
  );
}
