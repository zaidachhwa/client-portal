import { DashboardPage } from "@/components/dashboard-page";

export const metadata = { title: "Calendar · Zenova Client Portal" };

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return <DashboardPage searchParams={searchParams} view="calendar" />;
}
