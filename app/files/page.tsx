import { DashboardPage } from "@/components/dashboard-page";

export const metadata = { title: "Files · Zenova Client Portal" };

export default function FilesPage({ searchParams }: PageProps<"/files">) {
  return <DashboardPage searchParams={searchParams} view="files" />;
}
