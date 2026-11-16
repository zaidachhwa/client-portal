import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OtpForm } from "@/components/otp-form";
import { db } from "@/lib/db";
import { User } from "@/lib/models";
import { currentChallenge, maskEmail, resendWaitSeconds } from "@/lib/otp";

export const metadata = { title: "Verify it's you · Zenova Client Portal" };

export default function VerifyPage() {
  return (
    <main className="mesh grid min-h-dvh place-items-center p-4">
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  await connection(); // per-request: reads cookies and the clock
  await db();
  const current = await currentChallenge();
  const user = current && (await User.findById(current.challenge.userId).lean());
  if (!current || !user) redirect("/login");
  return <OtpForm email={maskEmail(user.email)} admin={!!current.challenge.platformAdmin} resendIn={resendWaitSeconds(current.challenge.lastSentAt)} />;
}
