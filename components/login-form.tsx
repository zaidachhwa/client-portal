"use client";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useActionState, useRef } from "react";
import { login } from "@/app/actions";
import { Button, TextField, ease, keepValues, rise } from "./ui";

export function LoginForm({ demo }: { demo: { email: string; label: string }[] }) {
  const [state, action, pending] = useActionState(login, undefined);
  const form = useRef<HTMLFormElement>(null);

  // Fill and submit in one tap; demo passwords are all "demo1234".
  const fillDemo = (email: string) => {
    const f = form.current!;
    (f.elements.namedItem("email") as HTMLInputElement).value = email;
    (f.elements.namedItem("password") as HTMLInputElement).value = "demo1234";
    f.requestSubmit();
  };

  return (
    <MotionConfig reducedMotion="user">
      <motion.div initial="hidden" animate="show" variants={rise} className="w-full max-w-[380px]">
        <div className="glass rounded-[28px] p-7">
          <svg viewBox="0 0 24 24" className="mb-6 size-8 text-ink" role="img" aria-label="Zenova">
            <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
          </svg>
          <p className="text-[13px] text-muted">Welcome back</p>
          <h1 className="mb-6 mt-1 text-[30px] leading-[1.1] tracking-[-0.02em]">Sign in to<br />your portal</h1>

          <form ref={form} onSubmit={keepValues(action)} className="space-y-4">
            <TextField label="Email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
            <TextField label="Password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
            <AnimatePresence initial={false}>
              {state?.error && (
                <motion.p
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease }}
                  className="overflow-hidden px-1 text-[12px] text-rose-600"
                >
                  {state.error}
                </motion.p>
              )}
            </AnimatePresence>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        {demo.length > 0 && (
          <div className="glass mt-4 rounded-[24px] p-3">
            <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Demo accounts</p>
            {demo.map((d) => (
              <button
                key={d.email}
                type="button"
                disabled={pending}
                onClick={() => fillDemo(d.email)}
                className="press block w-full rounded-xl px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-white/60"
              >
                {d.label}
                <span className="block text-[11px] text-muted">{d.email}</span>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </MotionConfig>
  );
}
