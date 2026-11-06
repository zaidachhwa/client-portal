import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { User } from "@/lib/models";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in · Zenova Client Portal" };

export default function LoginPage() {
  return (
    <main className="mesh grid min-h-dvh place-items-center p-4">
      <Suspense fallback={null}>
        <Gate />
      </Suspense>
    </main>
  );
}

async function Gate() {
  if (await getSession()) redirect("/");
  // Seeded demo accounts are listed only in development, and only those that still exist.
  const accounts = [
    { email: "ed@brightside.dental", label: "Ed Carter · Client" },
    { email: "noor@haddadphysio.com", label: "Noor Haddad · Client" },
    { email: "maya@zenova.studio", label: "Maya Lin · Account manager" },
    { email: "sam@zenova.studio", label: "Sam Ortiz · SEO specialist" },
  ];
  const existing = process.env.NODE_ENV === "development" ? await User.find({ email: { $in: accounts.map((a) => a.email) } }).distinct("email") : [];
  return <LoginForm demo={accounts.filter((a) => existing.includes(a.email))} />;
}
