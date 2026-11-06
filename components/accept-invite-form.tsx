"use client";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useActionState } from "react";
import { acceptInvite } from "@/app/actions";
import { Button, TextField, ease, keepValues, rise } from "./ui";

type Invite = { email: string; orgName: string; projectName: string | null; existingUser: boolean } | null;

export function AcceptInviteForm({ token, invite }: { token: string; invite: Invite }) {
  const [state, action, pending] = useActionState(acceptInvite.bind(null, token), undefined);

  return (
    <MotionConfig reducedMotion="user">
      <motion.div initial="hidden" animate="show" variants={rise} className="glass w-full max-w-[380px] rounded-[28px] p-7">
        <svg viewBox="0 0 24 24" className="mb-6 size-8 text-ink" role="img" aria-label="Zenova">
          <path fill="currentColor" d="M12 1c.6 5.6 2.4 8.4 11 11-8.6 2.6-10.4 5.4-11 11-.6-5.6-2.4-8.4-11-11 8.6-2.6 10.4-5.4 11-11Z" />
        </svg>

        {!invite ? (
          <>
            <h1 className="mb-2 text-[26px] leading-[1.1] tracking-[-0.02em]">This invite has expired</h1>
            <p className="mb-6 text-[13px] text-muted">Invite links work once and last 7 days. Ask whoever invited you for a new one.</p>
            <Link href="/login" className="press inline-flex w-full items-center justify-center rounded-full bg-white/70 px-5 py-2.5 text-[13px] font-medium ring-1 ring-white transition-colors duration-150 hover:bg-white">
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted">You&apos;re invited to {invite.orgName}</p>
            <h1 className="mb-1 mt-1 text-[30px] leading-[1.1] tracking-[-0.02em]">
              {invite.existingUser ? <>Join with your<br />account</> : <>Set up your<br />account</>}
            </h1>
            <p className="mb-6 text-[13px] text-muted">
              {invite.email}
              {invite.projectName && <> · {invite.projectName}</>}
            </p>

            <form onSubmit={keepValues(action)} className="space-y-4">
              {!invite.existingUser && (
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="First name" name="firstName" required autoComplete="given-name" maxLength={80} />
                  <TextField label="Last name" name="lastName" autoComplete="family-name" maxLength={80} />
                </div>
              )}
              <TextField
                label={invite.existingUser ? "Your current password" : "Choose a password"}
                name="password"
                type="password"
                required
                minLength={invite.existingUser ? undefined : 8}
                autoComplete={invite.existingUser ? "current-password" : "new-password"}
                placeholder={invite.existingUser ? "••••••••" : "At least 8 characters"}
              />
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
                {pending ? "Joining…" : `Join ${invite.orgName}`}
              </Button>
            </form>
          </>
        )}
      </motion.div>
    </MotionConfig>
  );
}
