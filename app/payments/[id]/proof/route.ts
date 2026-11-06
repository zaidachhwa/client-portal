import { paymentProof } from "@/lib/data";
import { getSession } from "@/lib/session";
import { getFile } from "@/lib/storage";

// Payment receipts: same private-storage rules as project files.
export async function GET(_req: Request, ctx: RouteContext<"/payments/[id]/proof">) {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const proof = await paymentProof(s, (await ctx.params).id);
  if (!proof) return new Response("Not found", { status: 404 });
  const data = await getFile(proof.key).catch(() => null);
  if (!data) return new Response("File is missing from storage", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${proof.name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
