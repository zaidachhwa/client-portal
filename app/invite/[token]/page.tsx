import { connection } from "next/server";
import { Suspense } from "react";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { db } from "@/lib/db";
import { getInvite } from "@/lib/data";

export const metadata = { title: "Accept invite · Zenova Client Portal" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="mesh grid min-h-dvh place-items-center p-4">
      <Suspense fallback={null}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  await connection();
  const { token } = await params;
  await db();
  const invite = await getInvite(token);
  return <AcceptInviteForm token={token} invite={invite} />;
}
