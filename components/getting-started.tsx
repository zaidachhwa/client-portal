"use client";
import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { markTourSeen } from "@/app/actions";
import type { GettingStartedItem } from "@/lib/data";
import { showMe } from "./tour";
import { Card, CardHeader, ProgressBar } from "./ui";

// Account managers' setup checklist. Items tick themselves off from real data; "Show me" highlights where to act.
export function GettingStarted({ items }: { items: GettingStartedItem[] }) {
  const [hidden, setHidden] = useState(false);
  const [missing, setMissing] = useState<string>();
  if (hidden) return null;
  const done = items.filter((i) => i.done).length;
  const all = done === items.length;
  const hide = () => {
    setHidden(true);
    void markTourSeen("setup-hidden");
  };

  return (
    <Card tour="setup">
      <CardHeader
        title={all ? "You're all set" : "Get started"}
        sub={all ? "Your workspace is ready for clients." : "Get your workspace ready for clients."}
        action={<span className="text-[13px] tabular-nums text-muted">{done}/{items.length}</span>}
      />
      <ProgressBar value={done / items.length} className="mb-3" />
      {!all && (
        <ul className="-mx-1">
          {items.map((i) => (
            <li key={i.key} className="flex items-start gap-3 rounded-2xl px-1 py-2">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${i.done ? "bg-ink text-white" : "ring-1 ring-ink/20"}`}>
                {i.done && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] ${i.done ? "text-muted line-through decoration-ink/20" : "font-medium"}`}>{i.title}</span>
                {!i.done && <span className="block text-[11px] leading-snug text-muted">{i.body}</span>}
                {!i.done && missing === i.key && <span role="status" className="block text-[11px] text-rose-600">Open a project first; this lives on the project.</span>}
              </span>
              {!i.done && (i.target ? (
                <button
                  type="button"
                  onClick={() => {
                    if (showMe(i.target!, i.title, i.body)) return setMissing(undefined);
                    if (i.href) location.assign(i.href);
                    else setMissing(i.key);
                  }}
                  className="shrink-0 rounded-full bg-white/70 px-2.5 py-1 text-[11px] ring-1 ring-white transition-colors duration-150 hover:bg-white"
                >
                  Show me
                </button>
              ) : i.href ? (
                <Link href={i.href} className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
                  Open <ArrowUpRight size={11} />
                </Link>
              ) : null)}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={hide} className="mt-2 self-start px-1 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline">
        Hide this card
      </button>
    </Card>
  );
}
