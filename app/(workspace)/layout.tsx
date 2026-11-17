import type { ReactNode } from "react";
import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { SidebarSkeleton } from "@/components/skeletons";
import { inbox, myOrgs, seesBilling } from "@/lib/data";
import { getSession } from "@/lib/session";

// Shared by the overview, Calendar, Files, Chat and Billing. The sidebar is rendered once here and stays
// mounted while those pages change, so only the page area (with its own skeleton) swaps on navigation.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mesh flex min-h-dvh">
      <Suspense fallback={<SidebarSkeleton />}>
        <SidebarSlot />
      </Suspense>
      {children}
    </div>
  );
}

async function SidebarSlot() {
  const session = await getSession();
  if (!session) return <SidebarSkeleton />; // the page itself redirects to /welcome
  const [orgs, notifications] = await Promise.all([myOrgs(session), inbox(session)]);
  return (
    <Sidebar
      session={{ name: session.name, roleLabel: session.roleLabel, permissions: session.permissions, isStaff: session.isStaff, platformAdmin: session.platformAdmin, emailNotifications: session.emailNotifications }}
      orgs={orgs}
      inbox={notifications}
      showBilling={seesBilling(session)}
    />
  );
}
