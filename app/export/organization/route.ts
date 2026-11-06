import { Types } from "mongoose";
import { organizationExport } from "@/lib/export";
import { audit } from "@/lib/guard";
import { can, getSession } from "@/lib/session";

// Full tenant export (§17) for people who can edit the organization's settings.
export async function GET() {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  if (!s.isStaff || !can(s, "organization.update")) return new Response("Not found", { status: 404 });
  await audit(s, "organization.exported", "organization", new Types.ObjectId(s.orgId));
  return new Response(organizationExport(s.orgId), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="organization-export-${new Date().toISOString().slice(0, 10)}.ndjson"`,
      "Cache-Control": "private, no-store",
    },
  });
}
