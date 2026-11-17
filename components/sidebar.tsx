"use client";
import { motion } from "motion/react";
import { ArrowLeftRight, Check, Compass, Download, History, LogOut, Mail, Settings, ShieldCheck, Users, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { logout, setEmailNotifications, switchOrg } from "@/app/actions";
import type { Inbox, OrgOption } from "@/lib/data";
import type { Session } from "@/lib/session";
import { nav, withProject } from "./nav";
import { Notifications } from "./notifications";
import { Avatar } from "./ui";

// The workspace sidebar. It lives in the shared (workspace) layout, so it stays put while pages change;
// the current page and project come from the URL instead of from each page.
type SidebarSession = Pick<NonNullable<Session>, "name" | "roleLabel" | "permissions" | "isStaff" | "platformAdmin" | "emailNotifications">;

export function Sidebar({ session, orgs, inbox, showBilling }: { session: SidebarSession; orgs: OrgOption[]; inbox: Inbox; showBilling: boolean }) {
  const pathname = usePathname();
  const projectId = useSearchParams().get("project");
  const view = nav.find((n) => n.path === pathname)?.view ?? "overview";

  return (
    <nav id="top" aria-label="Main" className="sticky top-0 z-10 flex h-dvh w-16 shrink-0 flex-col items-center gap-2 border-r border-white/60 bg-white/30 py-5 backdrop-blur-xl sm:w-[72px]">
      <svg viewBox="0 0 24 24" className="mb-6 size-7 text-ink" role="img" aria-label="Zenova">
        <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
      </svg>
      {nav.filter((n) => n.view !== "billing" || showBilling).map(({ view: v, path, label, Icon }) => (
        <Link
          key={v}
          href={withProject(path, projectId)}
          aria-label={label}
          title={label}
          aria-current={v === view ? "page" : undefined}
          className={`press relative grid size-11 place-items-center rounded-full transition-colors duration-150 ${v === view ? "text-white" : "text-ink/70 hover:bg-white/70 hover:text-ink"}`}
        >
          {v === view && <motion.span layoutId="nav-active" transition={{ type: "spring", duration: 0.35, bounce: 0 }} className="absolute inset-0 rounded-full bg-ink" />}
          <Icon size={18} className="relative" />
        </Link>
      ))}

      <Notifications inbox={inbox} />
      <button data-tour="account" popoverTarget="account-menu" aria-label={`Account: ${session.name}`} className="press mt-1 rounded-full">
        <Avatar name={session.name} size={42} />
      </button>
      <div id="account-menu" popover="auto" className="menu fixed inset-auto bottom-4 left-[76px] m-0 w-60 rounded-2xl bg-white/90 p-1.5 text-ink shadow-[0_16px_40px_-12px_rgb(27_33_49/0.35)] ring-1 ring-black/5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <Avatar name={session.name} size={30} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{session.name}</span>
            <span className="block truncate text-[11px] text-muted">{session.roleLabel}</span>
          </span>
        </div>
        {orgs.length > 1 && (
          <div className="border-t border-line py-1">
            <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-muted">Switch workspace</p>
            {orgs.map((o) => (
              <form key={o.membershipId} action={switchOrg.bind(null, o.membershipId)}>
                <button
                  disabled={o.current}
                  aria-current={o.current ? "true" : undefined}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 enabled:hover:bg-black/4"
                >
                  {o.current ? <Check size={15} className="text-ink" /> : <ArrowLeftRight size={15} className="text-muted" />}
                  <span className="truncate">{o.name}</span>
                </button>
              </form>
            ))}
          </div>
        )}
        {session.permissions.includes("organization.update") && session.isStaff && (
          <Link href="/settings" className="flex w-full items-center gap-2.5 rounded-xl border-t border-line px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <Settings size={15} className="text-muted" /> Settings
          </Link>
        )}
        {session.permissions.includes("organization.update") && session.isStaff && (
          <Link href="/workflows" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <WorkflowIcon size={15} className="text-muted" /> Workflows
          </Link>
        )}
        {session.isStaff && session.permissions.includes("roles.manage") && (
          <Link href="/team" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <Users size={15} className="text-muted" /> Team & roles
          </Link>
        )}
        {session.isStaff && session.permissions.includes("audit.view") && (
          <Link href="/audit" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <History size={15} className="text-muted" /> Activity log
          </Link>
        )}
        {session.platformAdmin && (
          <Link href="/admin" className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <ShieldCheck size={15} className="text-muted" /> Platform admin
          </Link>
        )}
        <button
          type="button"
          onClick={() => {
            document.getElementById("account-menu")?.hidePopover();
            window.dispatchEvent(new Event("zenova:tour"));
          }}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4"
        >
          <Compass size={15} className="text-muted" /> Take the tour
        </button>
        <EmailToggle on={session.emailNotifications} />
        <a href="/export/me" download className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
          <Download size={15} className="text-muted" /> Download my data
        </a>
        <form action={logout} className="border-t border-line pt-1">
          <button className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-black/4">
            <LogOut size={15} className="text-muted" /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

function EmailToggle({ on }: { on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors duration-150 hover:bg-black/4">
      <Mail size={15} className="text-muted" />
      <span className="flex-1">Email me updates</span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={pending}
        onChange={() => start(() => setEmailNotifications(!on))}
        className="relative h-5 w-8 shrink-0 cursor-pointer appearance-none rounded-full bg-black/15 transition-colors duration-200 before:absolute before:left-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-white before:shadow before:transition-transform before:duration-200 checked:bg-ink checked:before:translate-x-3 disabled:opacity-60"
      />
    </label>
  );
}
