"use client";
import { ArrowLeft, MailCheck } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { resendOtp, verifyOtp } from "@/app/actions";
import { Button, ease, rise } from "./ui";

const LENGTH = 6;

export function OtpForm({ email, admin, resendIn }: { email: string; admin: boolean; resendIn: number }) {
  const [state, action, pending] = useActionState(verifyOtp, undefined);
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [wait, setWait] = useState(resendIn);
  const [notice, setNotice] = useState<string>();
  const [sending, startSend] = useTransition();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const code = digits.join("");

  // Resend countdown.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // A wrong code clears the boxes so the next try starts fresh (adjusted during render, not in an effect).
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.error) setDigits(Array(LENGTH).fill(""));
  }
  useEffect(() => {
    if (state?.error) boxes.current[0]?.focus();
  }, [state]);

  // Fills from position i onward; used for typing, paste and SMS/email autofill alike.
  const fill = (i: number, value: string) => {
    const incoming = value.replace(/\D/g, "").slice(0, LENGTH - i).split("");
    if (!incoming.length) return;
    const next = [...digits];
    incoming.forEach((d, k) => (next[i + k] = d));
    setDigits(next);
    const after = Math.min(i + incoming.length, LENGTH - 1);
    boxes.current[after]?.focus();
    // Submit as soon as the last digit lands.
    if (next.every(Boolean)) requestAnimationFrame(() => form.current?.requestSubmit());
  };

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      boxes.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  const resend = () =>
    startSend(async () => {
      const r = await resendOtp();
      setNotice(r.error ?? "A new code is on its way.");
      if (!r.error) {
        setWait(30);
        setDigits(Array(LENGTH).fill(""));
        boxes.current[0]?.focus();
      }
    });

  return (
    <MotionConfig reducedMotion="user">
      <motion.div initial="hidden" animate="show" variants={rise} className="w-full max-w-[400px]">
        <Link href="/login" className="press mb-4 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-[13px] ring-1 ring-white transition-colors duration-150 hover:bg-white">
          <ArrowLeft size={14} /> Use a different account
        </Link>
        <div className="glass rounded-[28px] p-7">
          <span className="mb-6 grid size-11 place-items-center rounded-full bg-ink text-white"><MailCheck size={18} /></span>
          <p className="text-[13px] text-muted">{admin ? "Platform admin sign-in" : "One more step"}</p>
          <h1 className="mb-2 mt-1 text-[30px] leading-[1.1] tracking-[-0.02em]">Check your email</h1>
          <p className="mb-6 text-[13px] leading-relaxed text-muted">
            We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>. It expires in 10 minutes.
          </p>

          <form ref={form} action={action} className="space-y-4">
            <input type="hidden" name="code" value={code} />
            <fieldset>
              <legend className="sr-only">Sign-in code</legend>
              <div className="flex justify-between gap-2" onPaste={(e) => { e.preventDefault(); fill(0, e.clipboardData.getData("text")); }}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { boxes.current[i] = el; }}
                    value={d}
                    onChange={(e) => (e.target.value ? fill(i, e.target.value.slice(-LENGTH)) : setDigits(digits.map((x, k) => (k === i ? "" : x))))}
                    onKeyDown={(e) => onKey(i, e)}
                    onFocus={(e) => e.target.select()}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    autoFocus={i === 0}
                    maxLength={LENGTH}
                    aria-label={`Digit ${i + 1}`}
                    disabled={pending}
                    className={`h-14 w-full min-w-0 rounded-2xl bg-white/70 text-center text-[22px] font-medium tabular-nums outline-none ring-1 transition-shadow duration-150 focus:ring-2 focus:ring-ink/40 disabled:opacity-60 ${state?.error ? "ring-rose-300" : "ring-white"}`}
                  />
                ))}
              </div>
            </fieldset>

            {!admin && (
              <label className="flex items-center gap-2 px-1 text-[12px] text-muted">
                <input type="checkbox" name="trust" defaultChecked className="size-4 accent-[#1b2131]" />
                Trust this browser for 30 days
              </label>
            )}

            <AnimatePresence initial={false} mode="wait">
              {(state?.error || notice) && (
                <motion.p
                  key={state?.error ?? notice}
                  role={state?.error ? "alert" : "status"}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease }}
                  className={`overflow-hidden px-1 text-[12px] ${state?.error ? "text-rose-600" : "text-muted"}`}
                >
                  {state?.error ?? notice}
                </motion.p>
              )}
            </AnimatePresence>

            <Button type="submit" disabled={pending || code.length < LENGTH} className="w-full">
              {pending ? "Checking…" : "Verify and sign in"}
            </Button>
          </form>

          <p className="mt-5 text-center text-[12px] text-muted">
            Didn&apos;t get it?{" "}
            {wait > 0 ? (
              <span className="tabular-nums">Send a new code in {wait}s</span>
            ) : (
              <button type="button" onClick={resend} disabled={sending} className="font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60">
                {sending ? "Sending…" : "Send a new code"}
              </button>
            )}
          </p>
        </div>
      </motion.div>
    </MotionConfig>
  );
}
