"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check, Upload } from "lucide-react";
import { useActionState, useRef } from "react";
import { uploadDocument } from "@/app/actions";
import type { Requirement } from "@/lib/data";
import { Badge, Card, CardHeader, IconButton, ease } from "./ui";

// Picking a file submits immediately; errors from the server's validation show inline.
export function UploadButton({
  projectId, requirementId, accept, label, variant = "soft",
}: { projectId: string; requirementId?: string; accept?: string; label: string; variant?: "soft" | "solid" }) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="relative">
      <input type="hidden" name="projectId" value={projectId} />
      {requirementId && <input type="hidden" name="requirementId" value={requirementId} />}
      <input ref={input} type="file" name="file" accept={accept} hidden onChange={(e) => e.currentTarget.files?.length && e.currentTarget.form?.requestSubmit()} />
      <IconButton type="button" label={label} variant={variant} disabled={pending} onClick={() => input.current?.click()}>
        <Upload size={14} className={pending ? "animate-pulse" : ""} />
      </IconButton>
      <AnimatePresence>
        {state?.error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease }}
            className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl bg-white/95 px-3 py-2 text-[11px] text-rose-600 shadow-[0_8px_24px_-12px_rgb(27_33_49/0.4)]"
          >
            {state.error}
          </motion.p>
        )}
      </AnimatePresence>
    </form>
  );
}

const status = {
  pending: { tone: "rose", text: "Needed" },
  rejected: { tone: "rose", text: "Re-upload" },
  submitted: { tone: "amber", text: "In review" },
  approved: { tone: "ink", text: "Approved" },
} as const;

export function Requirements({ projectId, items, canUpload }: { projectId: string; items: Requirement[]; canUpload: boolean }) {
  if (items.length === 0) return null;
  const approved = items.filter((r) => r.status === "approved").length;
  return (
    <Card>
      <CardHeader
        title="Required Documents"
        sub="We'll verify each upload."
        action={<span className="text-[12px] tabular-nums text-muted">{approved}/{items.length}</span>}
      />
      <ul>
        {items.map((r) => {
          const st = status[r.status as keyof typeof status] ?? status.pending;
          return (
            <li key={r.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <span className={`grid size-[18px] shrink-0 place-items-center rounded-full ${r.status === "approved" ? "bg-ink text-white" : "bg-black/8"}`}>
                {r.status === "approved" && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{r.name}</span>
                <span className="block text-[11px] text-muted">{r.mandatory ? "Required" : "Optional"}</span>
              </span>
              <Badge tone={st.tone}>{st.text}</Badge>
              {canUpload && r.status !== "approved" && (
                <UploadButton projectId={projectId} requirementId={r.id} accept={r.accept} label={`Upload ${r.name}`} />
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
