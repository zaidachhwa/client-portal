"use client";
import { AnimatePresence, motion } from "motion/react";
import { Mail, Pencil, Phone, Plus, UserPlus } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { archiveClient, inviteContact, removeContact, saveContact, updateClient } from "@/app/actions";
import type { ClientDetail } from "@/lib/data";
import { Badge, Button, Card, CardHeader, FormError, IconButton, StateSelect, TextField, ease, useSubmit } from "./ui";

type Contact = ClientDetail["contacts"][number];
type Editing = "client" | "new" | string | null; // a contact id when editing that contact

// Selected project's client: tax details and the people we talk to there (§7.1–7.2).
export function ClientCard({ client, projectId }: { client: ClientDetail; projectId: string }) {
  const [editing, setEditing] = useState<Editing>(null);
  const toggle = (what: Editing) => setEditing(editing === what ? null : what);
  const done = () => setEditing(null);
  const facts = [client.code, client.type === "organization" ? "Company" : "Individual", client.city].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardHeader
        title={client.name}
        sub={facts}
        action={client.canEdit && (
          <div className="flex gap-1">
            <IconButton label={editing === "client" ? "Cancel editing client" : "Edit client"} variant="soft" onClick={() => toggle("client")}>
              <Pencil size={13} />
            </IconButton>
            <IconButton label={editing === "new" ? "Cancel adding contact" : "Add contact"} variant="soft" onClick={() => toggle("new")}>
              <Plus size={15} className={`transition-transform duration-200 ${editing === "new" ? "rotate-45" : ""}`} />
            </IconButton>
          </div>
        )}
      />
      {(client.gstin || client.pan) && (
        <dl className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
          {client.gstin && <div className="rounded-xl bg-white/60 px-3 py-2"><dt className="text-[11px] text-muted">GSTIN</dt><dd className="tabular-nums">{client.gstin}</dd></div>}
          {client.pan && <div className="rounded-xl bg-white/60 px-3 py-2"><dt className="text-[11px] text-muted">PAN</dt><dd className="tabular-nums">{client.pan}</dd></div>}
        </dl>
      )}

      {client.archived && <p className="mb-3 rounded-xl bg-amber-100/80 px-3 py-2 text-[12px] text-amber-900">Archived. Hidden from new projects.</p>}
      <Expand open={editing === "client"}><ClientForm client={client} onDone={done} /></Expand>
      <Expand open={editing === "new"}><ContactForm clientId={client.id} onDone={done} /></Expand>

      <ul>
        {client.contacts.map((c) => (
          <ContactRow
            key={c.id}
            contact={c}
            client={client}
            projectId={projectId}
            editing={editing === c.id}
            onEdit={() => toggle(c.id)}
            onDone={done}
          />
        ))}
      </ul>
    </Card>
  );
}

function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const linkIcon = "press grid size-8 shrink-0 place-items-center rounded-full text-ink/70 transition-colors duration-150 hover:bg-white/70 hover:text-ink";

function ContactRow({ contact: c, client, projectId, editing, onEdit, onDone }: {
  contact: Contact; client: ClientDetail; projectId: string; editing: boolean; onEdit: () => void; onDone: () => void;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const invite = () => start(async () => setError((await inviteContact(c.id, projectId)).error));
  const details = (
    <>
      <span className="block truncate text-[13px] font-medium">{c.name}</span>
      <span className="block truncate text-[11px] text-muted">{[c.designation, c.email].filter(Boolean).join(" · ") || "No details"}</span>
    </>
  );

  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center gap-2">
        {client.canEdit ? (
          <button onClick={onEdit} aria-expanded={editing} title={`Edit ${c.name}`} className="min-w-0 flex-1 rounded-xl text-left">
            {details}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{details}</div>
        )}
        {c.primary && <Badge tone="ink">Primary</Badge>}
        {c.access === "member" && <Badge tone="soft">On portal</Badge>}
        {c.access === "invited" && <Badge tone="amber">Invited</Badge>}
        {!c.access && c.email && client.canInvite && (
          <IconButton label={`Invite ${c.name} to the portal`} onClick={invite} disabled={pending}>
            <UserPlus size={14} />
          </IconButton>
        )}
        {c.email && <a href={`mailto:${c.email}`} aria-label={`Email ${c.name}`} title={`Email ${c.name}`} className={linkIcon}><Mail size={14} /></a>}
        {c.phone && <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`} title={`Call ${c.name}`} className={linkIcon}><Phone size={14} /></a>}
      </div>
      <FormError message={error} />
      <Expand open={editing}><div className="pt-2"><ContactForm clientId={client.id} contact={c} onDone={onDone} /></div></Expand>
    </li>
  );
}

const formBox = "mb-3 space-y-2 rounded-2xl bg-white/60 p-3";

function ClientForm({ client, onDone }: { client: ClientDetail; onDone: () => void }) {
  const { onSubmit, run, error, pending } = useSubmit((form) => updateClient(client.id, undefined, form), onDone);
  return (
    <form onSubmit={onSubmit} className={formBox}>
      <TextField label={client.type === "organization" ? "Company name" : "Full name"} name="displayName" required maxLength={120} defaultValue={client.name} />
      <div className="grid grid-cols-2 gap-2">
        {client.type === "organization" && <TextField label="GSTIN" name="gstin" maxLength={15} defaultValue={client.gstin ?? ""} />}
        <TextField label="PAN" name="pan" maxLength={10} defaultValue={client.pan ?? ""} />
        <TextField label="City" name="city" maxLength={80} defaultValue={client.address.city} />
        <StateSelect defaultValue={client.address.state} />
      </div>
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="button" variant="soft" disabled={pending} onClick={() => run(() => archiveClient(client.id, !client.archived))}>
          {client.archived ? "Restore client" : "Archive client"}
        </Button>
        <Button type="submit" disabled={pending} className="flex-1">{pending ? "Saving…" : "Save client"}</Button>
      </div>
    </form>
  );
}

function ContactForm({ clientId, contact, onDone }: { clientId: string; contact?: Contact; onDone: () => void }) {
  const { onSubmit, run, error, pending } = useSubmit((form) => saveContact(clientId, contact?.id, undefined, form), onDone);
  return (
    <form onSubmit={onSubmit} className={formBox}>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" name="name" required maxLength={120} defaultValue={contact?.name} />
        <TextField label="Role" name="designation" maxLength={80} defaultValue={contact?.designation} />
        <TextField label="Email" name="email" type="email" maxLength={200} defaultValue={contact?.email} />
        <TextField label="Phone" name="phone" type="tel" maxLength={30} defaultValue={contact?.phone} />
      </div>
      {!contact?.primary && (
        <label className="flex items-center gap-2 px-1 text-[12px]">
          <input type="checkbox" name="primary" className="size-4 accent-[#1b2131]" /> Make primary contact
        </label>
      )}
      <FormError message={error} />
      <div className="flex gap-2">
        {contact && !contact.primary && (
          <Button type="button" variant="soft" disabled={pending} onClick={() => run(() => removeContact(clientId, contact.id))}>
            Remove
          </Button>
        )}
        <Button type="submit" disabled={pending} className="flex-1">{pending ? "Saving…" : contact ? "Save contact" : "Add contact"}</Button>
      </div>
    </form>
  );
}
