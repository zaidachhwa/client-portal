"use client";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient, createProject } from "@/app/actions";
import type { CreateOptions } from "@/lib/data";
import { Button, Dialog, FormError, IconButton, Segmented, Select, StateSelect, TextField, useSubmit } from "./ui";

const tabs = ["Client", "Project"] as const;
const today = () => new Date().toISOString().slice(0, 10);

// "+" in the Active Projects header; opens one dialog with both forms.
export function CreateButton({ options }: { options: CreateOptions }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof tabs)[number]>(options.canCreateProject ? "Project" : "Client");
  const [clientId, setClientId] = useState<string>();
  const available = tabs.filter((t) => (t === "Client" ? options.canCreateClient : options.canCreateProject));

  return (
    <>
      <IconButton label="New client or project" variant="solid" onClick={() => setOpen(true)}>
        <Plus size={15} />
      </IconButton>
      <Dialog open={open} onClose={() => setOpen(false)} title={tab === "Client" ? "New client" : "New project"} sub={tab === "Client" ? "Add the company and who we talk to there." : "Sets up phases, tasks and required documents from the workflow."}>
        {available.length > 1 && <Segmented id="create-tab" label="Create" options={available} value={tab} onChange={setTab} className="mb-5" />}
        {tab === "Client" ? (
          <ClientForm
            options={options}
            // After adding a client, go straight to starting their first project.
            onCreated={(id) => {
              setClientId(id);
              if (options.canCreateProject) setTab("Project");
              else setOpen(false);
            }}
          />
        ) : (
          // Remount once the refreshed client list includes the new client, so it is preselected.
          <ProjectForm key={`${clientId}-${options.clients.length}`} options={options} clientId={clientId} onCreated={() => setOpen(false)} />
        )}
      </Dialog>
    </>
  );
}

function ClientForm({ options, onCreated }: { options: CreateOptions; onCreated: (id: string) => void }) {
  const [type, setType] = useState<"Company" | "Individual">("Company");
  const { onSubmit, error, pending } = useSubmit((form) => createClient(undefined, form), (r) => onCreated(r.clientId!));
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Segmented id="client-type" label="Client type" options={["Company", "Individual"] as const} value={type} onChange={setType} />
      <input type="hidden" name="clientType" value={type === "Company" ? "organization" : "individual"} />
      <TextField label={type === "Company" ? "Company name" : "Full name"} name="displayName" required maxLength={120} />
      {type === "Company" && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="GSTIN (optional)" name="gstin" maxLength={15} placeholder="27ABCDE1234F1Z5" />
          <TextField label="PAN (optional)" name="pan" maxLength={10} placeholder="ABCDE1234F" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <TextField label="City" name="city" maxLength={80} />
        <StateSelect defaultValue="" />
      </div>
      <p className="px-1 pt-2 text-[11px] uppercase tracking-wide text-muted">Primary contact</p>
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Name" name="contactName" required maxLength={120} />
        <TextField label="Role" name="contactDesignation" maxLength={80} placeholder="Owner" />
        <TextField label="Email" name="contactEmail" type="email" maxLength={200} />
        <TextField label="Phone" name="contactPhone" type="tel" maxLength={30} />
      </div>
      <Select label="Account manager" name="accountManagerId" defaultValue="">
        <option value="">Me</option>
        {options.staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      <FormError message={error} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Adding…" : "Add client"}</Button>
    </form>
  );
}

function ProjectForm({ options, clientId, onCreated }: { options: CreateOptions; clientId?: string; onCreated: () => void }) {
  const router = useRouter();
  const { onSubmit, error, pending } = useSubmit((form) => createProject(undefined, form), (r) => {
    onCreated();
    router.push(`/?project=${r.projectId}`);
  });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Select label="Client" name="clientId" required defaultValue={clientId ?? ""}>
        <option value="" disabled>Choose…</option>
        {options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <TextField label="Project name" name="name" required maxLength={120} placeholder="Local SEO retainer" />
      <TextField label="Category (optional)" name="category" maxLength={60} placeholder="Defaults to the workflow's category" list="project-categories" />
      <datalist id="project-categories">{[...new Set(options.templates.map((t) => t.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
      <label className="block">
        <span className="mb-1.5 block px-1 text-[12px] text-muted">Description (optional)</span>
        <textarea name="description" rows={2} maxLength={1000} placeholder="What's in scope" className="w-full resize-none rounded-2xl bg-white/70 px-4 py-2.5 text-[14px] outline-none ring-1 ring-white transition-shadow duration-150 placeholder:text-muted focus:ring-ink/25" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Workflow" name="workflowTemplateId" required defaultValue={options.templates[0]?.id ?? ""}>
          {options.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select label="Project manager" name="projectManagerId" defaultValue="">
          <option value="">Me</option>
          {options.staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <TextField label="Start" name="startDate" type="date" required defaultValue={today()} />
        <TextField label="Expected end (optional)" name="expectedEndDate" type="date" />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending || options.templates.length === 0} className="w-full">
        {pending ? "Setting up…" : "Create project"}
      </Button>
    </form>
  );
}
