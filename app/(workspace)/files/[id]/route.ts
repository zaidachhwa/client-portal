import { isValidObjectId } from "mongoose";
import { canAccessProject } from "@/lib/data";
import { Document, DocumentVersion } from "@/lib/models";
import { getSession } from "@/lib/session";
import { getFile } from "@/lib/storage";

// Files live in private storage; every download re-checks tenant, project access and visibility.
export async function GET(_req: Request, ctx: RouteContext<"/files/[id]">) {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return new Response("Not found", { status: 404 });

  const doc = await Document.findOne({ _id: id, organizationId: s.orgId, ...(!s.isStaff && { visibility: "client" }) }).lean();
  if (!doc?.projectId || !(await canAccessProject(s, doc.projectId))) return new Response("Not found", { status: 404 });
  const v = await DocumentVersion.findOne({ _id: doc.currentVersionId, organizationId: s.orgId }).lean();
  if (!v) return new Response("Not found", { status: 404 });

  const data = await getFile(v.storageKey).catch(() => null);
  if (!data) return new Response("File is missing from storage", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": v.mimeType || "application/octet-stream",
      // Always a download, never rendered inline: user uploads (e.g. SVG) can't run script on our origin.
      "Content-Disposition": `attachment; filename="${v.originalFileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
