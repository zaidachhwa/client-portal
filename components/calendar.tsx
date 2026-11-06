"use client";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TaskItem } from "@/lib/data";
import { TaskTitle } from "./task-dialog";
import { TaskCheck } from "./tasks";
import { Card, CardHeader, Empty, IconButton, Segmented, ease } from "./ui";

const modes = ["Day", "Week", "Month"] as const;
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const weekStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

export function Calendar({ tasks, canToggle, className = "" }: { tasks: TaskItem[]; canToggle: (t: TaskItem) => boolean; className?: string }) {
  const [mode, setMode] = useState<(typeof modes)[number]>("Month");
  const [selected, setSelected] = useState(() => new Date());
  const [view, setView] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dir, setDir] = useState(0);

  const dated = tasks.filter((t) => t.dueDate).map((t) => ({ t, d: new Date(t.dueDate!) }));
  const busy = new Set(dated.map(({ d }) => key(d)));
  const visible = dated.filter(({ d }) =>
    mode === "Day" ? key(d) === key(selected)
    : mode === "Week" ? key(weekStart(d)) === key(weekStart(selected))
    : d.getMonth() === view.getMonth() && d.getFullYear() === view.getFullYear(),
  );

  const shift = (n: number) => {
    setDir(n);
    setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  };
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = [...Array(view.getDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = key(new Date());

  return (
    <Card id="calendar" className={className}>
      <CardHeader
        title="Calendar"
        sub="Your project calendar"
        action={<Segmented id="cal-mode" label="Calendar range" options={modes} value={mode} onChange={setMode} className="w-52" />}
      />
      {/* Side by side once the card is wide enough; the task list scrolls at the grid's height. */}
      <div className="grid gap-6 @2xl:grid-cols-[minmax(0,1fr)_280px]">
        <ul className="scroll-thin max-h-72 overflow-y-auto pr-1 @2xl:max-h-[300px]">
          {visible.length === 0 && <Empty>No tasks scheduled for this {mode.toLowerCase()}.</Empty>}
          {visible.map(({ t, d }) => (
            <li key={t.id} className="flex gap-3 border-b border-line py-3 last:border-0">
              <span className="pt-0.5"><TaskCheck task={t} canToggle={canToggle(t)} /></span>
              <div className="min-w-0 flex-1">
                <TaskTitle task={t} className="max-w-full text-[13px] font-medium" />
                <p className="truncate text-[11px] text-muted">{t.description}</p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">
                {d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </li>
          ))}
        </ul>

        <div className="mx-auto w-full max-w-[320px] text-[13px]">
          <div className="mb-2 flex items-center justify-between">
            <IconButton label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></IconButton>
            <span className="tabular-nums">
              {view.toLocaleDateString("en-US", { month: "long" })}
              <span className="ml-4">{view.getFullYear()}</span>
            </span>
            <IconButton label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></IconButton>
          </div>
          <div className="grid grid-cols-7 text-center text-[10px] uppercase text-muted">
            {"SMTWTFS".split("").map((c, i) => <span key={i} className="py-1">{c}</span>)}
          </div>
          <div className="overflow-hidden">
            {/* Direction-aware: next month slides in from the right, previous from the left. */}
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={key(view)}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * 16 }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: d * -16 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.2, ease }}
                className="grid grid-cols-7 place-items-center"
              >
                {cells.map((n, i) => {
                  if (!n) return <span key={`b${i}`} />;
                  const date = new Date(view.getFullYear(), view.getMonth(), n);
                  const k = key(date);
                  const isSel = k === key(selected);
                  const weekend = i % 7 === 0 || i % 7 === 6;
                  return (
                    <button
                      key={k}
                      onClick={() => { setSelected(date); if (mode === "Month") setMode("Day"); }}
                      aria-label={date.toDateString()}
                      aria-current={k === today ? "date" : undefined}
                      aria-pressed={isSel}
                      className={`press relative my-0.5 grid size-8 place-items-center rounded-full tabular-nums transition-colors duration-150
                        ${isSel ? "bg-ink text-white" : `hover:bg-white/70 ${weekend ? "text-muted" : ""}`}
                        ${k === today && !isSel ? "ring-1 ring-ink/30" : ""}`}
                    >
                      {n}
                      {busy.has(k) && <span className={`absolute bottom-0.5 size-1 rounded-full ${isSel ? "bg-white" : "bg-ink"}`} />}
                    </button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Card>
  );
}
