// Turns audit entries (§14.5) into readable lines. Shared by the activity page and its CSV export.
import { formatMoney } from "./money.ts";

// Filter areas → action prefixes (the part before the dot).
export const AREAS = {
  clients: { label: "Clients", prefixes: ["client"] },
  projects: { label: "Projects & tasks", prefixes: ["project", "workflow", "task"] },
  documents: { label: "Documents", prefixes: ["document"] },
  billing: { label: "Billing", prefixes: ["invoice", "payment", "payment_schedule"] },
  people: { label: "People & roles", prefixes: ["invitation", "membership", "role"] },
  settings: { label: "Settings", prefixes: ["organization", "payment_method", "user"] },
} as const;
export type Area = keyof typeof AREAS;
export const isArea = (a: unknown): a is Area => typeof a === "string" && a in AREAS;
export const areaOf = (action: string) => (Object.keys(AREAS) as Area[]).find((k) => (AREAS[k].prefixes as readonly string[]).includes(action.split(".")[0]));

type Snap = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (v == null ? "" : String(v));
const money = (v: unknown) => (typeof v === "number" ? formatMoney(v) : "");

// "issued invoice INV/2026-27/0004 for ₹35,400.00" — the actor's name goes in front.
export function describe(action: string, before: Snap, after: Snap): string {
  const a = after ?? {};
  const b = before ?? {};
  switch (action) {
    case "client.created": return `added client ${str(a.displayName)} (${str(a.code)})`;
    case "client.updated": return `edited client ${str(a.displayName)}`;
    case "client.contact_added": return `added contact ${str(a.contact)}`;
    case "client.contact_updated": return `updated contact ${str(a.contact)}`;
    case "client.contact_removed": return `removed contact ${str(b.contact)}`;
    case "project.created": return `started project ${str(a.name)} (${str(a.code)})`;
    case "project.member_added": return `added ${str(a.member)} to a project with ${str(a.access)} access`;
    case "project.access_changed": return `changed someone's project access to ${str(a.access)}`;
    case "project.member_removed": return "removed someone from a project";
    case "task.updated": return `changed a task's priority or dependencies to ${str(a.priority)}`;
    case "client.archived": return `archived client ${str(a.displayName)}`;
    case "client.restored": return `restored client ${str(a.displayName)}`;
    case "project.archived": return `archived project ${str(a.name)}`;
    case "project.restored": return `restored project ${str(a.name)}`;
    case "payment_schedule.created": return `added the billing milestone ${str(a.title)}`;
    case "payment_schedule.cancelled": return `cancelled the billing milestone ${str(a.title)}`;
    case "project.agreed_value_set": return `set a project's agreed value to ${money(a.agreedValue)}`;
    case "workflow.phase_completed": return "completed a workflow phase";
    case "task.commented": return a.visibility === "internal" ? "added an internal note to a task" : "commented on a task";
    case "document.uploaded": return `uploaded ${str(a.name)}${Number(a.version) > 1 ? ` (version ${a.version})` : ""}`;
    case "document.approved": return "approved a document";
    case "document.rejected": return "asked for a document to be re-uploaded";
    case "invoice.issued": return `issued invoice ${str(a.invoiceNumber)} for ${money(a.grandTotal)}`;
    case "invoice.credit_note_issued": return `issued credit note ${str(a.noteNumber)} for ${money(a.total)}`;
    case "invoice.debit_note_issued": return `issued debit note ${str(a.noteNumber)} for ${money(a.total)}`;
    case "payment.recorded": return `recorded payment ${str(a.reference)} of ${money(a.amount)}`;
    case "payment.submitted": return `reported a payment of ${money(a.amount)}`;
    case "payment.verified": return "verified a payment";
    case "payment.rejected": return "marked a payment as not found";
    case "payment.refunded": return `refunded ${money(a.amount)}${a.reason ? ` (“${str(a.reason)}”)` : ""}`;
    case "payment_method.created": return `added payment method ${str(a.name)}`;
    case "payment_method.active": return "switched a payment method on";
    case "payment_method.inactive": return "switched a payment method off";
    case "retention.purged": return `removed records past the retention policy (${str(a.auditLogs)} activity entries, ${str(a.documents)} documents)`;
    case "organization.exported": return "downloaded a full export of the organization's data";
    case "organization.retention_updated": return "changed the data retention policy";
    case "user.exported": return "downloaded their personal data";
    case "organization.updated": return "updated the organization's details";
    case "role.created": return `created the role ${str(a.name)}`;
    case "role.updated": return `edited the role ${str(a.name)}`;
    case "role.activated": return `switched the role ${str(a.name)} on`;
    case "role.deactivated": return `switched the role ${str(a.name)} off`;
    case "membership.role_changed": return `changed someone's role to ${Array.isArray(a.roles) ? a.roles.join(", ") : ""}`;
    case "membership.suspended": return "suspended someone's access";
    case "membership.reactivated": return "restored someone's access";
    case "invitation.created": return `invited ${str(a.email)} as ${a.type === "employee" ? "a teammate" : "a client"}`;
    case "invitation.revoked": return "revoked an invite";
    case "invitation.accepted": return `joined${a.email ? ` (${str(a.email)})` : ""} from an invite`;
    default: return action;
  }
}

// Field-level changes between snapshots, one level of nesting flattened (address.city).
export function changes(before: Snap, after: Snap) {
  if (!before || !after) return [];
  const flat = (o: Record<string, unknown>, prefix = ""): [string, unknown][] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === "object" && !Array.isArray(v) && !prefix ? flat(v as Record<string, unknown>, `${k}.`) : [[prefix + k, v] as [string, unknown]],
    );
  const b = new Map(flat(before));
  const a = new Map(flat(after));
  const keys = [...new Set([...b.keys(), ...a.keys()])].filter((k) => k !== "_id");
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return keys.filter((k) => show(b.get(k)) !== show(a.get(k))).map((k) => ({ field: k, from: show(b.get(k)), to: show(a.get(k)) }));
}

// Where the thing lives, when there's a page for it.
export const linkFor = (resourceType?: string | null, resourceId?: string | null) =>
  !resourceId ? null : resourceType === "invoice" ? `/invoices/${resourceId}` : resourceType === "project" ? `/?project=${resourceId}` : null;
