import { activity } from "@/lib/data";
import { getSession } from "@/lib/session";

// CSV of the filtered activity log, same permission as the page.
// ponytail: capped at 5,000 rows in one response; stream page by page if exports get bigger.
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const log = await activity(s, { area: q.get("area") ?? undefined, actor: q.get("actor") ?? undefined }, 5000);
  if (!log) return new Response("Not found", { status: 404 });

  // Quote every cell; a leading = + - @ is neutralised so spreadsheets don't run it as a formula.
  const cell = (v: unknown) => {
    const t = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const head = ["time", "actor", "actor_email", "action", "summary", "resource_type", "resource_id", "ip_address", "request_id", "user_agent", "before", "after"];
  const rows = log.entries.map((e) => [e.at, e.actor, e.actorEmail, e.action, `${e.actor} ${e.summary}`, e.resourceType, e.resourceId, e.ipAddress, e.requestId, e.userAgent, e.before, e.after]);
  const csv = [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
