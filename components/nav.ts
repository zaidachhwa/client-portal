import { CalendarDays, Folder, LayoutGrid, MessageSquare, ReceiptText } from "lucide-react";

// The workspace pages. A plain module (not "use client") so server pages and the client sidebar can both read it.
export type View = "overview" | "calendar" | "files" | "chat" | "billing";
export const nav: { view: View; path: string; label: string; Icon: typeof LayoutGrid }[] = [
  { view: "overview", path: "/", label: "Dashboard", Icon: LayoutGrid },
  { view: "calendar", path: "/calendar", label: "Calendar", Icon: CalendarDays },
  { view: "files", path: "/files", label: "Files", Icon: Folder },
  { view: "chat", path: "/chat", label: "Chat", Icon: MessageSquare },
  { view: "billing", path: "/billing", label: "Billing", Icon: ReceiptText },
];
export const withProject = (path: string, projectId?: string | null) => (projectId ? `${path}?project=${projectId}` : path);
