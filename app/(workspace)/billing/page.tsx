import { DashboardPage } from "@/components/dashboard-page";

export const metadata = { title: "Billing · Zenova Client Portal" };

export default function BillingPage({ searchParams }: PageProps<"/billing">) {
  return <DashboardPage searchParams={searchParams} view="billing" />;
}
