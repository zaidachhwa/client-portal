"use client";
import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteTask, saveTask } from "@/app/actions";
import type { ProjectView, TaskItem } from "@/lib/data";
import { Button, Dialog, FormError, IconButton, Select, TextField, reach, useSubmit } from "./ui";

// Present only for staff who may add, edit and delete tasks on this project.
export type TaskManage = { projectId: string; assignees: ProjectView["assignees"] };

// YYYY-MM-DD in the viewer's own calendar, for <input type="date">.
export const dayValue = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-CA") : "");
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

// One form for adding and editing. `task` absent means a new task.
// busy: saved, waiting for the refreshed data to arrive (keeps "Saving…" showing until then).
export function TaskForm({ manage, task, defaultDate, busy = false, onDone, onCancel }: {
  manage: TaskManage; task?: TaskItem; defaultDate?: string; busy?: boolean; onDone: () => void; onCancel: () => void;
}) {
  const { onSubmit, error, pending: submitting } = useSubmit(
    (form) =>
      saveTask(manage.projectId, task?.id ?? null, {
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
        dueDate: String(form.get("dueDate") ?? ""),
        assigneeId: String(form.get("assigneeId") ?? ""),
        priority: String(form.get("priority") ?? "medium"),
        mandatory: form.get("mandatory") === "on",
      }),
    () => onDone(),
  );
  const pending = submitting || busy;
  const team = manage.assignees.filter((a) => !a.client);
  const clients = manage.assignees.filter((a) => a.client);

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <TextField label="Task" name="title" required maxLength={160} defaultValue={task?.title} placeholder="Send the monthly report" autoFocus />
      <label className="block">
        <span className="mb-1.5 block px-1 text-[12px] text-muted">Details (optional)</span>
        <textarea
          name="description"
          rows={3}
          maxLength={1000}
          defaultValue={task?.description}
          className="w-full resize-none rounded-2xl bg-white/70 px-4 py-3 text-[14px] outline-none ring-1 ring-white transition-shadow duration-150 placeholder:text-muted focus:ring-ink/25"
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <TextField label="Due date" name="dueDate" type="date" defaultValue={task ? dayValue(task.dueDate) : defaultDate} />
        <Select label="Priority" name="priority" defaultValue={task?.priority ?? "medium"}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </Select>
      </div>
      <Select label="Assign to" name="assigneeId" defaultValue={task?.assigneeId ?? ""}>
        <option value="">Unassigned</option>
        {team.length > 0 && <optgroup label="Team">{team.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
        {clients.length > 0 && <optgroup label="Client">{clients.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
      </Select>
      <label className="flex items-start gap-2 px-1 text-[12px]">
        <input type="checkbox" name="mandatory" defaultChecked={task?.mandatory} className="mt-0.5 size-4 shrink-0 accent-[#1b2131]" />
        <span>
          Required for the current phase
          <span className="block text-muted">The phase can&apos;t be completed until this is done.</span>
        </span>
      </label>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="soft" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : task ? "Save changes" : "Add task"}</Button>
      </div>
    </form>
  );
}

// "+" on the calendar: opens a new task on the given day.
export function NewTaskButton({ manage, date, label = "Add task" }: { manage: TaskManage; date: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={label} variant="soft" onClick={() => setOpen(true)}>
        <Plus size={15} />
      </IconButton>
      <Dialog open={open} onClose={() => setOpen(false)} title="New task" sub="Shows on the calendar and, if assigned, notifies that person.">
        {/* key: a fresh form (and date) each time it opens */}
        {open && <TaskForm key={date} manage={manage} defaultDate={date} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

// Two-step delete inside the task dialog: the first click asks, the second deletes.
export function DeleteTask({ task, onDeleted }: { task: TaskItem; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const remove = () => start(async () => {
    const r = await reach(deleteTask(task.id));
    setError(r.error);
    if (!r.error) onDeleted();
  });
  if (!confirming) {
    return <button type="button" onClick={() => setConfirming(true)} className="text-[12px] text-rose-600 underline-offset-2 hover:underline">Delete task</button>;
  }
  return (
    <div role="alertdialog" aria-label="Confirm delete" className="space-y-2 rounded-2xl bg-rose-50/90 p-3 text-[12px] ring-1 ring-rose-200/70">
      <p>Delete “{task.title}”? Its comments are deleted too, and any task waiting on it stops waiting. This can&apos;t be undone.</p>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="soft" onClick={() => setConfirming(false)} disabled={pending} className="px-4 py-1.5">Keep it</Button>
        <Button type="button" variant="danger" onClick={remove} disabled={pending} className="px-4 py-1.5">{pending ? "Deleting…" : "Delete"}</Button>
      </div>
    </div>
  );
}
