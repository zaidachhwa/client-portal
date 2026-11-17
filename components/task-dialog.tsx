"use client";
import { MessageSquare, Pencil } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { addTaskComment, updateTask } from "@/app/actions";
import type { TaskItem } from "@/lib/data";
import { DeleteTask, TaskForm, type TaskManage } from "./task-form";
import { Badge, Button, Dialog, FormError, reach, shortDate } from "./ui";

// Any task row can open the shared task dialog without prop-drilling.
export const OpenTask = createContext<(id: string) => void>(() => {});
export const useOpenTask = () => useContext(OpenTask);

// Title that opens the dialog, with the comment count beside it.
export function TaskTitle({ task, className = "" }: { task: TaskItem; className?: string }) {
  const open = useOpenTask();
  return (
    <button onClick={() => open(task.id)} className={`flex min-w-0 items-center gap-1.5 text-left hover:underline hover:decoration-black/20 hover:underline-offset-2 ${className}`}>
      {(task.priority === "high" || task.priority === "urgent") && task.status !== "completed" && (
        <span aria-label={`${task.priority} priority`} title={`${task.priority} priority`} className={`size-1.5 shrink-0 rounded-full ${task.priority === "urgent" ? "bg-rose-500" : "bg-amber-500"}`} />
      )}
      <span className="truncate">{task.title}</span>
      {task.comments.length > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-normal tabular-nums text-muted" aria-label={`${task.comments.length} comments`}>
          <MessageSquare size={11} /> {task.comments.length}
        </span>
      )}
    </button>
  );
}

const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const priorityTone = { urgent: "rose", high: "amber", medium: "soft", low: "soft" } as const;

export function TaskDialog({ task, staff, canEdit, allTasks, manage, onClose }: {
  task: TaskItem | undefined; staff: boolean; canEdit: boolean; allTasks: { id: string; title: string }[]; manage?: TaskManage; onClose: () => void;
}) {
  const done = task?.status === "completed";
  const sub = task && [task.dueDate && `Due ${shortDate(task.dueDate)}`, task.assignee ? `Assigned to ${task.mine ? "you" : task.assignee}` : "Unassigned", done ? "Done" : "Open"].filter(Boolean).join(" · ");
  return (
    <Dialog open={!!task} onClose={onClose} title={task?.title ?? ""} sub={sub}>
      {/* key: switching tasks always starts out of edit mode */}
      {task && <TaskBody key={task.id} task={task} staff={staff} canEdit={canEdit} allTasks={allTasks} manage={manage} onClose={onClose} />}
    </Dialog>
  );
}

function TaskBody({ task, staff, canEdit, allTasks, manage, onClose }: {
  task: TaskItem; staff: boolean; canEdit: boolean; allTasks: { id: string; title: string }[]; manage?: TaskManage; onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // After saving, stay in the form until the refreshed task arrives, so the header never shows the old values.
  const [savedFrom, setSavedFrom] = useState<TaskItem | null>(null);
  if (savedFrom && task !== savedFrom) {
    setSavedFrom(null);
    setEditing(false);
  }
  useEffect(() => {
    if (!savedFrom) return;
    const t = setTimeout(() => { setSavedFrom(null); setEditing(false); }, 3000); // never get stuck if the refresh is slow
    return () => clearTimeout(t);
  }, [savedFrom]);
  const done = task.status === "completed";
  if (editing && manage) {
    return (
      <div className="space-y-4">
        <TaskForm manage={manage} task={task} busy={!!savedFrom} onDone={() => setSavedFrom(task)} onCancel={() => setEditing(false)} />
        <div className="border-t border-line pt-3"><DeleteTask task={task} onDeleted={onClose} /></div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={priorityTone[task.priority as keyof typeof priorityTone] ?? "soft"}>{task.priority} priority</Badge>
        {task.mandatory && <Badge tone="soft">Required</Badge>}
        {task.blockedBy.length > 0 && !done && <span className="text-[12px] text-muted">Waiting on {task.blockedBy.join(", ")}</span>}
        {manage && (
          <Button type="button" variant="soft" onClick={() => setEditing(true)} className="ml-auto gap-1.5 px-3 py-1.5 text-[12px]">
            <Pencil size={12} /> Edit
          </Button>
        )}
      </div>
      {canEdit && <TaskSettings key={`${task.id}-${task.dependsOn.join()}`} task={task} allTasks={allTasks} />}
      <Thread task={task} staff={staff} />
    </div>
  );
}

// Staff with edit access set what this task waits on (§9.1). Priority lives in the Edit form.
function TaskSettings({ task, allTasks }: { task: TaskItem; allTasks: { id: string; title: string }[] }) {
  const [deps, setDeps] = useState(task.dependsOn);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const others = allTasks.filter((t) => t.id !== task.id);
  if (others.length === 0) return null;
  const dirty = [...deps].sort().join() !== [...task.dependsOn].sort().join();
  const save = () => start(async () => setError((await reach(updateTask(task.id, task.priority, deps))).error));
  return (
    <details className="rounded-2xl bg-white/60 px-3 py-2 text-[13px]">
      <summary className="cursor-pointer text-[12px] text-muted">Dependencies{task.dependsOn.length ? ` (${task.dependsOn.length})` : ""}</summary>
      <div className="mt-2 space-y-3">
        {others.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-[12px]">Can&apos;t be completed until these are done</legend>
            <div className="scroll-thin grid max-h-36 gap-0.5 overflow-y-auto sm:grid-cols-2">
              {others.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-white/70">
                  <input type="checkbox" checked={deps.includes(t.id)} onChange={(e) => setDeps(e.target.checked ? [...deps, t.id] : deps.filter((d) => d !== t.id))} className="size-3.5 accent-[#1b2131]" />
                  <span className="truncate">{t.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <FormError message={error} />
        <Button type="button" variant="soft" className="py-1.5" disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </details>
  );
}

function Thread({ task, staff }: { task: TaskItem; staff: boolean }) {
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const end = useRef<HTMLLIElement>(null);
  const send = () =>
    start(async () => {
      const r = await reach(addTaskComment(task.id, text, internal));
      setError(r.error);
      if (!r.error) {
        setText("");
        requestAnimationFrame(() => end.current?.scrollIntoView({ block: "nearest" }));
      }
    });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send();
  };

  return (
    <div className="space-y-4">
      {task.description && <p className="text-[13px] leading-relaxed text-ink/80">{task.description}</p>}

      <section aria-label="Comments">
        {task.comments.length === 0 ? (
          <p className="rounded-2xl bg-white/60 px-4 py-6 text-center text-[13px] text-muted">No comments yet. Ask a question or share an update.</p>
        ) : (
          <ul className="scroll-thin max-h-[min(360px,45dvh)] space-y-2 overflow-y-auto pr-1">
            {task.comments.map((c) => (
              <li key={c.id} className={`rounded-2xl px-3.5 py-2.5 ${c.internal ? "bg-amber-50/90 ring-1 ring-amber-200/70" : c.mine ? "bg-ink/[0.06]" : "bg-white/70"}`}>
                <div className="mb-0.5 flex items-center gap-2 text-[11px] text-muted">
                  <span className="font-medium text-ink">{c.mine ? "You" : c.author}</span>
                  <span className="tabular-nums">{time(c.at)}</span>
                  {c.internal && <Badge tone="amber">Internal</Badge>}
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{c.message}</p>
              </li>
            ))}
            <li ref={end} aria-hidden />
          </ul>
        )}
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="space-y-2"
      >
        <label className="block">
          <span className="sr-only">Comment</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={3}
            maxLength={2000}
            placeholder={internal ? "Note for the team only…" : "Write a comment…"}
            className={`w-full resize-none rounded-2xl px-4 py-3 text-[14px] outline-none ring-1 transition-shadow duration-150 placeholder:text-muted focus:ring-ink/25 ${internal ? "bg-amber-50/80 ring-amber-200" : "bg-white/70 ring-white"}`}
          />
        </label>
        <FormError message={error} />
        <div className="flex items-center gap-3">
          {staff && (
            <label className="flex items-center gap-2 px-1 text-[12px]">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="size-4 accent-[#1b2131]" />
              Internal note <span className="text-muted">(hidden from the client)</span>
            </label>
          )}
          <Button type="submit" disabled={pending || !text.trim()} className="ml-auto py-2">{pending ? "Sending…" : "Comment"}</Button>
        </div>
      </form>
    </div>
  );
}
