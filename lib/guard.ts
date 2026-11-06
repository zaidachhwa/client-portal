import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Types } from "mongoose";
import { changes } from "./activity.ts";
import { AuditLog, Counter } from "./models";
import { getSession, type Session } from "./session";

// Helpers shared by server action files. They live outside "use server" modules so they can't be called from the browser.

export type S = NonNullable<Session>;

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

// Who/where for audit entries (§14.5). Cached per request, so every entry one action writes shares a requestId.
export const requestMeta = cache(async () => {
  const h = await headers();
  return {
    requestId: h.get("x-request-id")?.slice(0, 64) ?? randomUUID(),
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent")?.slice(0, 300),
  };
});

// Snapshots must never carry secrets (§14.5); callers pass business fields only.
// An edit that changed nothing (same before and after) isn't recorded.
export const audit = async (s: S, action: string, resourceType: string, resourceId: Types.ObjectId, before?: object, after?: object) => {
  if (before && after && !changes(before as Record<string, unknown>, after as Record<string, unknown>).length) return;
  await AuditLog.create({ organizationId: s.orgId, actorId: s.userId, action, resourceType, resourceId, before, after, ...(await requestMeta()) });
};

// Absolute links for emails. Set APP_URL in production; the Host header is only a dev fallback.
export async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

// Atomic per-org counter. A counter that doesn't exist yet starts after the records already there.
// Concurrent increments inside a transaction conflict and are retried by the driver.
export async function nextNumber(orgId: string, key: string, existing: () => Promise<number>) {
  const floor = await existing();
  const c = await Counter.findOneAndUpdate(
    { organizationId: orgId, key },
    [{ $set: { value: { $add: [{ $max: [{ $ifNull: ["$value", 0] }, floor] }, 1] } } }],
    { upsert: true, returnDocument: "after", updatePipeline: true },
  ).lean();
  return c!.value;
}
