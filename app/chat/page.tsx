import { DashboardPage } from "@/components/dashboard-page";

export const metadata = { title: "Chat · Zenova Client Portal" };

export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return <DashboardPage searchParams={searchParams} view="chat" />;
}
