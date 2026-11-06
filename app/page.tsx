import { DashboardPage } from "@/components/dashboard-page";

export default function Page({ searchParams }: PageProps<"/">) {
  return <DashboardPage searchParams={searchParams} view="overview" />;
}
