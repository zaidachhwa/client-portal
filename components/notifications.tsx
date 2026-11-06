"use client";
import { Bell } from "lucide-react";
import Link from "next/link";
import { startTransition } from "react";
import { markRead } from "@/app/actions";
import type { Inbox } from "@/lib/data";

const ID = "notifications";

// Sidebar bell with the latest 20 notifications. A native popover, like the account menu:
// Escape, outside click and focus handling come for free.
export function Notifications({ inbox }: { inbox: Inbox }) {
  const close = () => document.getElementById(ID)?.hidePopover();
  return (
    <>
      <button
        popoverTarget={ID}
        aria-label={inbox.unread ? `Notifications, ${inbox.unread} unread` : "Notifications"}
        title="Notifications"
        className="press relative mt-auto grid size-11 place-items-center rounded-full text-ink/70 transition-colors duration-150 hover:bg-white/70 hover:text-ink"
      >
        <Bell size={18} />
        {inbox.unread > 0 && (
          <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-medium tabular-nums text-white ring-2 ring-[#fbf8f6]">
            {inbox.unread > 9 ? "9+" : inbox.unread}
          </span>
        )}
      </button>
      <div
        id={ID}
        popover="auto"
        className="menu fixed inset-auto bottom-16 left-[72px] m-0 flex max-h-[min(540px,calc(100dvh-96px))] w-[min(360px,calc(100vw-84px))] flex-col rounded-2xl bg-white/90 text-ink shadow-[0_16px_40px_-12px_rgb(27_33_49/0.35)] ring-1 ring-black/5 backdrop-blur-xl sm:left-[80px]"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[15px]">Notifications</h2>
          {inbox.unread > 0 && (
            <button onClick={() => startTransition(() => markRead())} className="rounded-full px-2 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-black/4 hover:text-ink">
              Mark all read
            </button>
          )}
        </header>
        {inbox.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">You&apos;re all caught up.</p>
        ) : (
          <ul className="scroll-thin overflow-y-auto p-1.5">
            {inbox.items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.link}
                  scroll={false}
                  onClick={() => {
                    close();
                    if (!n.read) startTransition(() => markRead(n.id));
                  }}
                  className="flex gap-3 rounded-xl px-2.5 py-2.5 transition-colors duration-150 hover:bg-black/4"
                >
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-rose-500"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug ${n.read ? "text-ink/70" : "font-medium"}`}>{n.title}</span>
                    {n.message && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted">{n.message}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted">{n.ago}</span>
                  {!n.read && <span className="sr-only">Unread</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
