"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveWorkflow, setWorkflowArchived } from "@/app/workflow-actions";
import type { WorkflowTemplateView } from "@/lib/data";
import type { PhaseInput, WorkflowInput } from "@/lib/workflows";
import { Badge, Button, Card, CardHeader, Empty, FormError, IconButton, Select, TextField, reach } from "./ui";

type Task = PhaseInput["tasks"][number];
const blankTask = (): Task => ({ title: "", mandatory: true, assignee: "manager", dueInDays: 7 });
// A first phase keyed "onboarding" shows as the client's "Complete Account Setup" checklist.
const blank = (): WorkflowInput => ({
  name: "", category: "", description: "",
  phases: [{ key: "onboarding", name: "Onboarding", mandatoryTasks: true, mandatoryDocuments: true, tasks: [blankTask()] }],
});
const toInput = (t: WorkflowTemplateView): WorkflowInput => ({ name: t.name, category: t.category, description: t.description, phases: t.phases });
const move = <T,>(list: T[], i: number, by: number) => {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
};

const check = "size-4 shrink-0 accent-[#1b2131]";
const row = "rounded-2xl bg-white/60 p-3";

export function Workflows({ templates }: { templates: WorkflowTemplateView[] }) {
  const [selected, setSelected] = useState<string | null>(templates[0]?.id ?? null);
  const current = templates.find((t) => t.id === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:gap-5">
      <Card>
        <CardHeader
          title="Workflows"
          sub="Pick one to edit."
          action={<Button variant="soft" onClick={() => setSelected(null)} className="px-3 py-1.5"><Plus size={14} /> New</Button>}
        />
        {templates.length === 0 && <Empty>No workflows yet.</Empty>}
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setSelected(t.id)}
                aria-current={t.id === selected ? "true" : undefined}
                className={`press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${t.id === selected ? "bg-ink text-white" : "hover:bg-white/60"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{t.name}</span>
                  <span className={`block truncate text-[11px] ${t.id === selected ? "text-white/60" : "text-muted"}`}>
                    v{t.version} · {t.phases.length} phase{t.phases.length === 1 ? "" : "s"} · {t.projects} project{t.projects === 1 ? "" : "s"}
                  </span>
                </span>
                {t.archived && <Badge tone="soft">Archived</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* key resets the editor when switching workflows */}
      <Editor key={selected ?? "new"} template={current} onCreated={setSelected} />
    </div>
  );
}

function Editor({ template, onCreated }: { template?: WorkflowTemplateView; onCreated: (id: string) => void }) {
  const [draft, setDraft] = useState<WorkflowInput>(() => (template ? toInput(template) : blank()));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const update = (next: Partial<WorkflowInput>) => { setDraft((d) => ({ ...d, ...next })); setDirty(true); setSaved(false); };
  const setPhase = (i: number, next: Partial<PhaseInput>) => update({ phases: draft.phases.map((p, j) => (j === i ? { ...p, ...next } : p)) });
  const setTask = (i: number, k: number, next: Partial<Task>) => setPhase(i, { tasks: draft.phases[i].tasks.map((t, j) => (j === k ? { ...t, ...next } : t)) });

  const save = () => start(async () => {
    const r = await reach(saveWorkflow(template?.id ?? null, draft));
    setError(r.error);
    if (r.error) return;
    setDirty(false);
    setSaved(true);
    if (!template && r.id) onCreated(r.id);
  });
  const archive = () => start(async () => setError((await reach(setWorkflowArchived(template!.id, !template!.archived))).error));

  return (
    <Card>
      <CardHeader
        title={template ? template.name : "New workflow"}
        sub={template ? `Version ${template.version}${template.archived ? " · archived, can't start new projects" : ""}` : "Phases run in order. Each phase's tasks are created when a project starts."}
        action={template && (
          <Button variant="soft" onClick={archive} disabled={pending} className="px-3 py-1.5">{template.archived ? "Restore" : "Archive"}</Button>
        )}
      />

      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
          <TextField label="Name" value={draft.name} onChange={(e) => update({ name: e.target.value })} maxLength={120} placeholder="Website build" />
          <TextField label="Category (optional)" value={draft.category} onChange={(e) => update({ category: e.target.value })} maxLength={60} placeholder="Design" />
        </div>
        <TextField label="Description (optional)" value={draft.description} onChange={(e) => update({ description: e.target.value })} maxLength={500} />

        <ol className="space-y-3">
          {draft.phases.map((p, i) => (
            <li key={i} className={row}>
              <div className="mb-3 flex items-end gap-2">
                <span className="mb-2.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[11px] tabular-nums text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <TextField label="Phase name" value={p.name} onChange={(e) => setPhase(i, { name: e.target.value })} maxLength={80} />
                </div>
                <IconButton label={`Move ${p.name || "phase"} up`} disabled={i === 0} onClick={() => update({ phases: move(draft.phases, i, -1) })} className="mb-1"><ArrowUp size={14} /></IconButton>
                <IconButton label={`Move ${p.name || "phase"} down`} disabled={i === draft.phases.length - 1} onClick={() => update({ phases: move(draft.phases, i, 1) })} className="mb-1"><ArrowDown size={14} /></IconButton>
                <IconButton label={`Remove ${p.name || "phase"}`} disabled={draft.phases.length === 1} onClick={() => update({ phases: draft.phases.filter((_, j) => j !== i) })} className="mb-1"><Trash2 size={14} /></IconButton>
              </div>

              <fieldset className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 px-1 text-[12px]">
                <legend className="mb-1.5 text-[12px] text-muted">Can only be completed when</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className={check} checked={p.mandatoryTasks} onChange={(e) => setPhase(i, { mandatoryTasks: e.target.checked })} />
                  every required task is done
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" className={check} checked={p.mandatoryDocuments} onChange={(e) => setPhase(i, { mandatoryDocuments: e.target.checked })} />
                  every required document is approved
                </label>
              </fieldset>

              <ul className="space-y-2">
                {p.tasks.map((t, k) => (
                  <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-xl bg-white/70 p-2 sm:grid-cols-[minmax(0,1fr)_130px_90px_auto_auto]">
                    <TextField label="Task" value={t.title} onChange={(e) => setTask(i, k, { title: e.target.value })} maxLength={160} placeholder="Kick-off call" />
                    <IconButton label={`Remove ${t.title || "task"}`} onClick={() => setPhase(i, { tasks: p.tasks.filter((_, j) => j !== k) })} className="mb-1.5 sm:order-last"><Trash2 size={14} /></IconButton>
                    <Select label="Done by" value={t.assignee} onChange={(e) => setTask(i, k, { assignee: e.target.value })}>
                      <option value="manager">Project manager</option>
                      <option value="client">Client</option>
                    </Select>
                    <TextField
                      label="Due (days)" type="number" min={0} max={365} inputMode="numeric"
                      value={t.dueInDays ?? ""} placeholder="None"
                      onChange={(e) => setTask(i, k, { dueInDays: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <label className="mb-3 flex items-center gap-2 text-[12px]">
                      <input type="checkbox" className={check} checked={t.mandatory} onChange={(e) => setTask(i, k, { mandatory: e.target.checked })} />
                      Required
                    </label>
                  </li>
                ))}
              </ul>
              <Button variant="soft" onClick={() => setPhase(i, { tasks: [...p.tasks, blankTask()] })} className="mt-2 w-full"><Plus size={14} /> Add task</Button>
            </li>
          ))}
        </ol>
        <Button variant="soft" onClick={() => update({ phases: [...draft.phases, { name: "", mandatoryTasks: true, mandatoryDocuments: false, tasks: [] }] })} className="w-full">
          <Plus size={14} /> Add phase
        </Button>

        <p className="px-1 text-[12px] text-muted">
          Due days count from the project&apos;s start date. Client tasks are assigned when the client accepts their invite.
          {template && template.activeProjects > 0 && ` ${template.activeProjects} running project${template.activeProjects === 1 ? " keeps" : "s keep"} version ${template.version}; only new projects get your changes.`}
        </p>
        <FormError message={error} />
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending || (!!template && !dirty)}>{pending ? "Saving…" : template ? "Publish new version" : "Create workflow"}</Button>
          {saved && <span role="status" className="text-[12px] text-muted">Published</span>}
          {dirty && !pending && <span className="text-[12px] text-muted">Unsaved changes</span>}
        </div>
      </div>
    </Card>
  );
}
