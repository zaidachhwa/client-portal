// Workflow definitions (§8.2): validation shared by the editor's server action and the tests.

export type PhaseInput = {
  key?: string; name: string; mandatoryTasks: boolean; mandatoryDocuments: boolean;
  tasks: { title: string; mandatory: boolean; assignee: string; dueInDays: number | null }[];
};
export type WorkflowInput = { name: string; category: string; description: string; phases: PhaseInput[] };

export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const KEY = /^[a-z0-9_]{1,40}$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "phase";

// Turns untrusted input into a stored phase list, or an error message.
export function cleanPhases(input: unknown): { phases?: object[]; error?: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "Add at least one phase." };
  if (input.length > 20) return { error: "A workflow can have at most 20 phases." };
  const keys = new Set<string>();
  const phases = [];
  for (const [i, p] of (input as PhaseInput[]).entries()) {
    const name = text(p?.name, 80);
    if (!name) return { error: `Name phase ${i + 1}.` };
    // Keys link phases to document requirements and the onboarding checklist, so existing ones are kept.
    let key = typeof p.key === "string" && KEY.test(p.key) ? p.key : slug(name);
    for (let n = 2; keys.has(key); n++) key = `${slug(name).slice(0, 36)}_${n}`;
    keys.add(key);
    if (!Array.isArray(p.tasks) || p.tasks.length > 30) return { error: `“${name}” can have at most 30 tasks.` };
    const tasks = [];
    for (const t of p.tasks) {
      const title = text(t?.title, 160);
      if (!title) return { error: `Every task in “${name}” needs a title.` };
      const due = t.dueInDays == null ? null : Number(t.dueInDays);
      if (due != null && (!Number.isInteger(due) || due < 0 || due > 365)) return { error: `“${title}”: due days must be a whole number from 0 to 365.` };
      tasks.push({ title, mandatory: t.mandatory === true, assignee: t.assignee === "client" ? "client" : "manager", ...(due == null ? {} : { dueInDays: due }) });
    }
    phases.push({ key, name, completion: { mandatoryTasks: p.mandatoryTasks === true, mandatoryDocuments: p.mandatoryDocuments === true }, tasks });
  }
  return { phases };
}

