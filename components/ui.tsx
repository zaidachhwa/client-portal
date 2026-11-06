"use client";
import { motion, type Variants } from "motion/react";
import { ChevronDown, Search, X } from "lucide-react";
import { STATES } from "@/lib/india";
import { startTransition, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ComponentProps, type FormEvent, type ReactNode } from "react";

export const ease = [0.23, 1, 0.32, 1] as const;

// <form action> resets every field after the action runs, wiping what the user typed when the
// server returns an error. Submitting through onSubmit keeps the values.
export const keepValues = (dispatch: (form: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  startTransition(() => dispatch(form));
};

// A server action that can't be reached (offline, server restarting, laptop just woke) rejects instead of
// returning; turn that into an ordinary error message so the page never crashes over it.
export const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
export const reach = <R extends { error?: string }>(p: Promise<R>) => p.catch((): R => ({ error: OFFLINE }) as R);

// Same idea for forms that need the result: submits without resetting, shows the error, calls onDone on success.
export function useSubmit<R extends { error?: string }>(save: (form: FormData) => Promise<R>, onDone: (r: R, form: HTMLFormElement) => void) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, form?: HTMLFormElement) =>
    start(async () => {
      const r = await reach(fn());
      setError(r.error);
      if (!r.error) onDone(r, form!);
    });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const form = new FormData(el);
    run(() => save(form), el);
  };
  return { onSubmit, run, error, pending };
}

// Idempotency key for money-moving forms. getRandomValues works on plain-http hosts too, unlike randomUUID.
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// Cards enter once on load with a short stagger; the grid parent orchestrates it.
export const stagger: Variants = { show: { transition: { staggerChildren: 0.05 } } };
export const rise: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease } },
};

// Cards size to their content. Pass a fixed height (e.g. h-[520px]) for scrolling bodies.
export function Card({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <motion.section id={id} variants={rise} className={`glass @container flex scroll-mt-4 flex-col rounded-[28px] p-5 ${className}`}>
      {children}
    </motion.section>
  );
}

export function CardHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-[1_1_10rem]">
        <h2 className="text-[19px] leading-tight tracking-[-0.01em]">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

// Segmented control; the active pill glides between options (shared layoutId).
export function Segmented<T extends string>({
  id, options, value, onChange, className = "", label,
}: { id: string; options: readonly T[]; value: T; onChange: (v: T) => void; className?: string; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={`flex shrink-0 rounded-full bg-black/4 p-1 text-[12px] ${className}`}>
      {options.map((o) => (
        <button
          key={o}
          type="button" // inside forms (invite, schedule, client type) a default "submit" button would submit the form
          role="tab"
          aria-selected={o === value}
          onClick={() => onChange(o)}
          className={`press relative flex-1 whitespace-nowrap rounded-full px-3 py-1.5 transition-colors duration-150 ${o === value ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {o === value && (
            <motion.span
              layoutId={id}
              transition={{ type: "spring", duration: 0.35, bounce: 0 }}
              className="absolute inset-0 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.08)]"
            />
          )}
          <span className="relative">{o}</span>
        </button>
      ))}
    </div>
  );
}

export function SearchField({ size = "md", ...props }: Omit<ComponentProps<"input">, "size"> & { size?: "sm" | "md"; "aria-label": string }) {
  const sm = size === "sm";
  return (
    <label className={`flex items-center gap-2 rounded-full bg-white/60 ring-1 ring-white transition-shadow duration-150 focus-within:ring-ink/20 ${sm ? "px-3 py-1.5 text-[12px]" : "px-4 py-2.5 text-[14px]"}`}>
      <input type="search" {...props} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden" />
      <Search size={sm ? 13 : 16} className="shrink-0 text-muted" />
    </label>
  );
}

export function TextField({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[12px] text-muted">{label}</span>
      <input
        {...props}
        className="w-full rounded-full bg-white/70 px-4 py-2.5 text-[14px] outline-none ring-1 ring-white transition-shadow duration-150 placeholder:text-muted focus:ring-ink/25"
      />
    </label>
  );
}

// Native select (keyboard, mobile pickers and a11y for free), styled to match TextField.
export function Select({ label, children, ...props }: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-[12px] text-muted">{label}</span>
      <span className="relative block">
        <select
          {...props}
          className="w-full appearance-none rounded-full bg-white/70 py-2.5 pl-4 pr-9 text-[14px] outline-none ring-1 ring-white transition-shadow duration-150 focus:ring-ink/25"
        >
          {children}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" />
      </span>
    </label>
  );
}

export function StateSelect({ label = "State", ...props }: ComponentProps<"select"> & { label?: string }) {
  return (
    <Select label={label} name="state" {...props}>
      <option value="">Choose…</option>
      {STATES.map(([code, name]) => <option key={code} value={name}>{name}</option>)}
    </Select>
  );
}

const button = {
  solid: "bg-ink text-white shadow-[0_8px_20px_-10px_rgb(27_33_49/0.6)] hover:bg-ink/90",
  soft: "bg-white/70 text-ink ring-1 ring-white hover:bg-white",
};

// False during server render and before hydration. Until then a click can't run our handlers: a submit would
// do a plain browser form submit (a page reload that loses the action), so buttons stay disabled until ready.
const noop = () => () => {};
export const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

export function Button({ variant = "solid", className = "", disabled, ...props }: ComponentProps<"button"> & { variant?: keyof typeof button }) {
  const hydrated = useHydrated();
  return (
    <button
      {...props}
      disabled={disabled || !hydrated}
      className={`press inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium transition-colors duration-150 ${disabled ? "disabled:opacity-60" : ""} ${button[variant]} ${className}`}
    />
  );
}

const iconButton = {
  ghost: "text-ink/70 hover:bg-white/70 hover:text-ink",
  soft: "bg-white/70 text-ink/70 hover:text-ink",
  solid: "bg-ink text-white",
};

export function IconButton({
  label, variant = "ghost", size = 32, className = "", disabled, type = "button", ...props
}: ComponentProps<"button"> & { label: string; variant?: keyof typeof iconButton; size?: number }) {
  const hydrated = useHydrated();
  return (
    // Icon buttons are actions, not submits, unless a caller says type="submit" (e.g. chat's Send).
    <button
      {...props}
      type={type}
      disabled={disabled || !hydrated}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`press grid shrink-0 place-items-center rounded-full transition-colors duration-150 ${disabled ? "disabled:opacity-50" : ""} ${iconButton[variant]} ${className}`}
    />
  );
}

// Transform-only fill, so updates never trigger layout.
export function ProgressBar({ value, inverted = false, className = "" }: { value: number; inverted?: boolean; className?: string }) {
  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`block h-1.5 overflow-hidden rounded-full ${inverted ? "bg-white/15" : "bg-black/7"} ${className}`}
    >
      <motion.span
        className={`block h-full origin-left rounded-full ${inverted ? "bg-white" : "bg-ink"}`}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: value }}
        transition={{ duration: 0.6, ease }}
      />
    </span>
  );
}

const badge = {
  amber: "bg-amber-100/80 text-amber-800",
  rose: "bg-rose-100/80 text-rose-700",
  ink: "bg-ink text-white",
  soft: "bg-white/70 text-ink/70 ring-1 ring-white",
};

export function Badge({ tone, children }: { tone: keyof typeof badge; children: ReactNode }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] tabular-nums ${badge[tone]}`}>{children}</span>;
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 45% 82%), hsl(${(hue + 40) % 360} 50% 70%))` }}
      className="inline-grid shrink-0 place-items-center rounded-full font-medium text-ink/80 ring-2 ring-white"
    >
      {initials}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted">{children}</p>;
}

export const fileSize = (b: number) =>
  b >= 1e6 ? `${(b / 1e6).toFixed(1)} mb` : b >= 1e3 ? `${Math.round(b / 1e3)} kb` : `${b} b`;

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "No date";

// Native <dialog>: focus trap, Escape and the top layer come from the browser.
export function Dialog({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="dialog m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] rounded-[28px] bg-[#fbf8f6]/95 p-0 text-ink shadow-[0_24px_60px_-20px_rgb(27_33_49/0.45)] ring-1 ring-white backdrop-blur-xl"
    >
      <div className="p-6">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] leading-tight tracking-[-0.01em]">{title}</h2>
            {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}><X size={16} /></IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function FormError({ message }: { message?: string }) {
  return message ? <p role="alert" className="px-1 text-[12px] text-rose-600">{message}</p> : null;
}
