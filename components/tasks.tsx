"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check, MessageSquare } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toggleTask } from "@/app/actions";
import type { TaskItem } from "@/lib/data";
import { TaskTitle, useOpenTask } from "./task-dialog";
import { Card, CardHeader, Empty, IconButton, ProgressBar, Segmented, ease, rise, shortDate } from "./ui";

// Optimistic toggle shared by the check circle and the checklist pill.
function useToggle(task: TaskItem) {
  const [done, setDone] = useOptimistic(task.status === "completed");
  const [, start] = useTransition();
  return [done, () => start(async () => { setDone(!done); await toggleTask(task.id); })] as const;
}

export function TaskCheck({ task, canToggle }: { task: TaskItem; canToggle: boolean }) {
  const [done, toggle] = useToggle(task);
  return (
    <button
      disabled={!canToggle}
      aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
      aria-pressed={done}
      onClick={toggle}
      className={`press grid size-[18px] shrink-0 place-items-center rounded-full transition-colors duration-200 disabled:cursor-default ${done ? "bg-ink text-white" : "bg-black/8 text-transparent enabled:hover:bg-black/15"}`}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));
const tabs = ["Upcoming", "Completed", "Overdue"] as const;

export function Timeline({ tasks, canToggle, phase }: { tasks: TaskItem[]; canToggle: (t: TaskItem) => boolean; phase?: string }) {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Upcoming");
  const today = startOfToday();
  const due = (t: TaskItem) => (t.dueDate ? new Date(t.dueDate) : today);
  const lists = {
    Upcoming: tasks.filter((t) => t.status !== "completed" && due(t) >= today),
    Completed: tasks.filter((t) => t.status === "completed"),
    Overdue: tasks.filter((t) => t.status !== "completed" && due(t) < today),
  };
  const progress = tasks.length ? lists.Completed.length / tasks.length : 0;

  return (
    <Card>
      <CardHeader
        title="Your Task Timeline"
        sub={phase ? `Current phase: ${phase}` : "See your project take shape."}
        action={<span className="text-[13px] tabular-nums text-muted">{Math.round(progress * 100)}%</span>}
      />
      <ProgressBar value={progress} className="mb-4" />
      <div className="rounded-2xl bg-white/70 p-2">
        <Segmented id="timeline-tab" label="Task status" options={tabs} value={tab} onChange={setTab} className="mb-1" />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.ul
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease }}
            className="scroll-thin max-h-48 overflow-y-auto"
          >
            {lists[tab].length === 0 && <Empty>Nothing {tab.toLowerCase()}.</Empty>}
            {lists[tab].map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 border-b border-line px-2 py-2 text-[12px] last:border-0">
                <TaskCheck task={t} canToggle={canToggle(t)} />
                <TaskTitle task={t} className="flex-1" />
                <span className={`shrink-0 tabular-nums ${tab === "Overdue" ? "text-rose-500" : "text-muted"}`}>{shortDate(t.dueDate)}</span>
              </li>
            ))}
          </motion.ul>
        </AnimatePresence>
      </div>
    </Card>
  );
}

// Onboarding checklist: finished steps become dark pills, open steps wait on the client.
export function Checklist({ tasks, canToggle }: { tasks: TaskItem[]; canToggle: (t: TaskItem) => boolean }) {
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === "completed").length;
  return (
    <motion.section variants={rise} className="px-1">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[19px] tracking-[-0.01em]">Complete Account Setup</h2>
        <span className="text-[12px] tabular-nums text-muted">{done}/{tasks.length}</span>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => <ChecklistItem key={t.id} task={t} canToggle={canToggle(t)} />)}
      </ul>
    </motion.section>
  );
}

function ChecklistItem({ task, canToggle }: { task: TaskItem; canToggle: boolean }) {
  const [done, toggle] = useToggle(task);
  const open = useOpenTask();
  return (
    <li className="flex items-center gap-1">
      <button
        disabled={!canToggle}
        aria-pressed={done}
        onClick={toggle}
        className={`press flex min-w-0 flex-1 items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4 text-left transition-colors duration-200 disabled:cursor-default ${done ? "bg-ink text-white shadow-[0_8px_20px_-10px_rgb(27_33_49/0.6)]" : "enabled:hover:bg-white/50"}`}
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200 ${done ? "bg-white/10" : "bg-white/50 ring-1 ring-white"}`}>
          <motion.span
            initial={false}
            animate={{ opacity: done ? 1 : 0, scale: done ? 1 : 0.6, filter: done ? "blur(0px)" : "blur(2px)" }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
          >
            <Check size={16} strokeWidth={2.5} />
          </motion.span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{task.title}</span>
          <span className={`block text-[11px] ${done ? "text-white/60" : "text-muted"}`}>
            {done ? "Task completed" : task.mine ? "Waiting on you" : "Waiting on client"}
          </span>
        </span>
      </button>
      <IconButton label={`Comments on ${task.title}${task.comments.length ? ` (${task.comments.length})` : ""}`} onClick={() => open(task.id)} className="relative">
        <MessageSquare size={14} />
        {task.comments.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-ink text-[9px] tabular-nums text-white">{task.comments.length}</span>}
      </IconButton>
    </li>
  );
}
