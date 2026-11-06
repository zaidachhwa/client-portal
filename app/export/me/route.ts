import { userExport } from "@/lib/export";
import { audit } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { Types } from "mongoose";

// "Download my data" (§17): any signed-in person, their own records only.
export async function GET() {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const data = await userExport(s.userId);
  await audit(s, "user.exported", "user", new Types.ObjectId(s.userId));
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
