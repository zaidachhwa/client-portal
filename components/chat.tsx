"use client";
import { AnimatePresence, motion } from "motion/react";
import { CheckCheck, SendHorizontal } from "lucide-react";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { sendMessage } from "@/app/actions";
import type { ProjectView } from "@/lib/data";
import { Avatar, Card, CardHeader, Empty, FormError, IconButton, OFFLINE, newKey } from "./ui";

type Msg = ProjectView["messages"][number] & { pending?: boolean };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function Chat({ project, me, className = "" }: { project: ProjectView; me: string; className?: string }) {
  const [messages, add] = useOptimistic<Msg[], Msg>(project.messages, (list, m) => [...list, m]);
  const [, start] = useTransition();
  const [error, setError] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const counterpart = project.counterpart.firstName || "your team";

  // Jump to the newest message; scroll the list itself so the page never moves.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);

  function submit(form: HTMLFormElement) {
    const text = String(new FormData(form).get("text") ?? "").trim();
    if (!text) return;
    form.reset();
    setError(undefined);
    start(async () => {
      add({ id: newKey(), text, at: new Date().toISOString(), mine: true, sender: { name: me }, pending: true });
      try {
        await sendMessage(project.id, text);
      } catch {
        // Not sent: the optimistic bubble disappears with the transition; put the text back to retry.
        const input = form.elements.namedItem("text") as HTMLInputElement;
        if (!input.value) input.value = text;
        setError(OFFLINE);
      }
    });
  }

  return (
    <Card id="chat" className={className}>
      <CardHeader title={`Chat with ${counterpart}`} sub="Your project conversation" />
      <div ref={list} className="fade-top scroll-thin -mx-2 min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-2 pt-8">
        {messages.length === 0 && <Empty>Say hello to {counterpart}.</Empty>}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              style={{ transformOrigin: m.mine ? "bottom right" : "bottom left" }}
              className={`flex items-end gap-2 ${m.mine ? "justify-end" : ""}`}
            >
              {!m.mine && <Avatar name={m.sender.name} size={30} />}
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug @md:max-w-[75%] ${m.mine ? "rounded-br-md bg-black/6" : "rounded-bl-md bg-white/80"}`}>
                <p className="whitespace-pre-wrap wrap-break-word">{m.text}</p>
                <p className="mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums text-muted">
                  {m.mine && <CheckCheck size={12} className={m.pending ? "opacity-40" : ""} />}
                  {time(m.at)}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}
        className="mt-3 flex shrink-0 items-center gap-2 rounded-full bg-white/80 py-1.5 pl-4 pr-1.5 ring-1 ring-black/6 transition-shadow duration-150 focus-within:ring-ink/30"
      >
        <input name="text" aria-label="Message" autoComplete="off" maxLength={2000} placeholder="Type message…" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
        <IconButton type="submit" label="Send" variant="solid" size={36}><SendHorizontal size={15} /></IconButton>
      </form>
      <div className="mt-1 shrink-0"><FormError message={error} /></div>
    </Card>
  );
}
