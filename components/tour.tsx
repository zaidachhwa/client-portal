"use client";
import { driver, type Config, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useEffect } from "react";
import { markTourSeen } from "@/app/actions";

// Guided tours (one per role). Steps point at data-tour names, and any step whose element isn't on screen
// (no project yet, a permission this person lacks) is skipped, so the tour never points at nothing.
export type TourRole = "client" | "staff" | "owner";
type Step = { target: string; title: string; body: string };

const STEPS: Record<TourRole, Step[]> = {
  client: [
    { target: "timeline", title: "Your task timeline", body: "Everything on your project: what's upcoming, done and overdue. Tick a task when you've finished it." },
    { target: "checklist", title: "Getting set up", body: "The steps we need from you to get started. Each one says whether it's waiting on you or on us." },
    { target: "documents", title: "Required documents", body: "Upload what's asked for here. You'll see when each one is approved, or if we need another version." },
    { target: "chat", title: "Talk to your team", body: "One conversation for this project with your account manager, so nothing gets lost in email." },
    { target: "billing", title: "Invoices and payments", body: "See what's due. Paid by UPI or bank transfer? Press “I've paid” and attach the receipt." },
    { target: "notifications", title: "Updates", body: "Approvals, messages and new invoices show up here, and by email if you want them." },
    { target: "account", title: "Your account", body: "Replay this tour, turn email notifications off or download your data from this menu." },
  ],
  staff: [
    { target: "projects", title: "Your projects", body: "The projects you're on. Pick one to open its workflow, tasks, chat and files." },
    { target: "workflow", title: "Where the project stands", body: "Phases run in order. A phase completes only when its required tasks and documents are done." },
    { target: "checklist", title: "Onboarding checklist", body: "What's waiting on the client and on you. Tick off your own tasks here." },
    { target: "calendar", title: "Tasks and dates", body: "Open a task for details, priority and comments. Internal comments are never shown to clients." },
    { target: "review", title: "Review queue", body: "Client uploads waiting for you. Approve them, or reject to ask for a new version." },
    { target: "chat", title: "Client chat", body: "One conversation per project. The client is notified when you write." },
    { target: "notifications", title: "Updates", body: "Messages, uploads and phase changes on your projects arrive here." },
    { target: "account", title: "Your account", body: "Replay this tour, turn email notifications off or download your data." },
  ],
  owner: [
    { target: "setup", title: "Your setup checklist", body: "Seven steps to get your workspace ready. Each ticks itself off as you go, and “Show me” points at where to do it." },
    { target: "projects", title: "Your projects", body: "Every project in your organization. Pick one to open its workflow, tasks, chat, files and billing." },
    { target: "create", title: "Add clients and projects", body: "Add a client, then start a project from a workflow. Phases, tasks and required documents are created for you." },
    { target: "workflow", title: "Where each project stands", body: "Phases complete only when their required tasks and documents are done. Completing one tells the client and raises any milestone invoice." },
    { target: "client", title: "Bring the client in", body: "Contacts and tax details. The invite icon next to a contact gives them portal access; their tasks are assigned when they accept." },
    { target: "billing", title: "Billing", body: "Set the agreed value and milestones, issue GST invoices and verify the payments clients report." },
    { target: "review", title: "Review queue", body: "Client uploads waiting for you. Approve them, or reject to ask for a new version." },
    { target: "account", title: "Settings and more", body: "Organization details, workflows, roles and the activity log live in this menu. You can replay this tour from here." },
  ],
};

const find = (target: string) => {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  return el && el.getClientRects().length > 0 ? el : null; // present and actually rendered
};

const config = (): Config => ({
  animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  overlayColor: "#1b2131",
  overlayOpacity: 0.45,
  stagePadding: 6,
  stageRadius: 24,
  popoverClass: "zenova-tour",
  smoothScroll: true,
});

// Popover menus sit in the top layer and would cover the tour.
const closeMenus = () => document.querySelectorAll<HTMLElement>(":popover-open").forEach((p) => p.hidePopover());

export function startTour(role: TourRole, onDone?: () => void) {
  const steps: DriveStep[] = STEPS[role].flatMap((s) => {
    const el = find(s.target);
    return el ? [{ element: el, popover: { title: s.title, description: s.body } }] : [];
  });
  if (!steps.length) return onDone?.();
  closeMenus();
  const d = driver({
    ...config(),
    steps,
    showProgress: steps.length > 1,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    onDestroyed: () => onDone?.(),
  });
  d.drive();
}

// One-off highlight for a Get started item. Returns false when the element isn't on this screen.
export function showMe(target: string, title: string, body: string) {
  const el = find(target);
  if (!el) return false;
  closeMenus();
  driver({ ...config(), showButtons: ["close"] }).highlight({ element: el, popover: { title, description: body } });
  return true;
}

// Plays the role's tour once on first visit, and again whenever "Take the tour" is pressed.
let autoPlayed = false;
export function Tour({ role, auto }: { role: TourRole; auto: boolean }) {
  useEffect(() => {
    const play = () => startTour(role, () => void markTourSeen(role));
    window.addEventListener("zenova:tour", play);
    // Wait for the dashboard's entrance animation to settle before measuring elements.
    const timer = auto && !autoPlayed ? setTimeout(() => { autoPlayed = true; play(); }, 1000) : undefined;
    return () => {
      window.removeEventListener("zenova:tour", play);
      clearTimeout(timer);
    };
  }, [role, auto]);
  return null;
}
