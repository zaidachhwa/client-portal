"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { useActionState } from "react";
import { completePhase } from "@/app/actions";
import type { ProjectView } from "@/lib/data";
import { Button, Card, CardHeader, ease } from "./ui";

// Phase stepper for the selected project; staff with workflows.advance can close the current phase.
export function Workflow({ project, canAdvance }: { project: ProjectView; canAdvance: boolean }) {
  const [state, action, pending] = useActionState(async () => completePhase(project.id), undefined);
  if (project.phases.length === 0) return null;
  const done = project.workflowStatus === "completed";

  return (
    <Card>
      <CardHeader title="Workflow" sub={[project.clientName, project.name, project.category].filter(Boolean).join(" · ")} />
      {project.description && <p className="-mt-2 mb-3 text-[12px] leading-relaxed text-muted">{project.description}</p>}
      <ol className="mb-4 space-y-1">
        {project.phases.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 py-1.5">
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] tabular-nums transition-colors duration-200
                ${p.status === "completed" ? "bg-ink text-white" : p.current ? "bg-white text-ink ring-2 ring-ink" : "bg-black/6 text-muted"}`}
            >
              {p.status === "completed" ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className={`text-[13px] ${p.status === "pending" ? "text-muted" : "font-medium"}`}>{p.name}</span>
            {p.current && <span className="ml-auto text-[11px] text-muted">Current</span>}
          </li>
        ))}
      </ol>
      {done ? (
        <p className="text-[13px] text-muted">All phases complete.</p>
      ) : (
        canAdvance && (
          <form action={action}>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Checking…" : "Complete current phase"}
            </Button>
          </form>
        )
      )}
      <AnimatePresence initial={false}>
        {state?.error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden pt-3 text-[12px] text-rose-600"
          >
            {state.error}
          </motion.p>
        )}
      </AnimatePresence>
    </Card>
  );
}
