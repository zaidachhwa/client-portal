import "server-only";
import { notFound } from "next/navigation";
import { AuditLog, Invitation, Invoice, Membership, Organization, Project, User } from "./models";
import { currentLogin, isPlatformAdmin } from "./session";

// Platform admin console (§5). Admins see organizations and counts, never what's inside them
// (no client names, files, messages or invoice contents). Who is an admin comes only from PLATFORM_ADMINS.

// Anyone else gets a plain 404, so the console's existence isn't advertised.
export async function requirePlatformAdmin() {
  const login = await currentLogin();
  if (!login || !isPlatformAdmin(login.user.email)) notFound();
  const u = login.user;
  return { userId: u._id, name: `${u.firstName} ${u.lastName ?? ""}`.trim(), email: u.email, hasWorkspace: !!login.session.membershipId };
}

type Count = { _id: unknown; n: number };
const byOrg = (rows: Count[]) => new Map(rows.map((r) => [String(r._id), r.n]));

export async function platformOverview() {
  const orgs = await Organization.find().sort({ createdAt: -1 }).lean();
  const [staff, clients, projects, invoices, lastActivity, owners, pendingOwners, users] = await Promise.all([
    Membership.aggregate<Count>([{ $match: { status: "active", membershipType: "employee" } }, { $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    Membership.aggregate<Count>([{ $match: { status: "active", membershipType: "client" } }, { $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    Project.aggregate<Count>([{ $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    Invoice.aggregate<Count>([{ $group: { _id: "$organizationId", n: { $sum: 1 } } }]),
    AuditLog.aggregate<{ _id: unknown; at: Date }>([{ $group: { _id: "$organizationId", at: { $max: "$createdAt" } } }]),
    // The earliest Account manager is treated as the owner, the person to contact.
    Membership.aggregate<{ _id: unknown; userId: unknown }>([
      { $match: { status: "active", membershipType: "employee", title: "Account manager" } },
      { $sort: { joinedAt: 1 } },
      { $group: { _id: "$organizationId", userId: { $first: "$userId" } } },
    ]),
    Invitation.find({ status: "pending", membershipType: "employee", expiresAt: { $gt: new Date() } }).lean(),
    User.countDocuments({ status: "active" }),
  ]);
  const ownerUsers = await User.find({ _id: { $in: owners.map((o) => o.userId) } }).lean();
  const [s, c, p, i] = [byOrg(staff), byOrg(clients), byOrg(projects), byOrg(invoices)];
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  return {
    stats: {
      organizations: orgs.length,
      active: orgs.filter((o) => o.status === "active" || o.status === "trial").length,
      suspended: orgs.filter((o) => o.status === "suspended").length,
      users,
      staff: sum(s),
      clients: sum(c),
      projects: sum(p),
      invoices: sum(i),
    },
    organizations: orgs.map((o) => {
      const id = String(o._id);
      const ownerId = owners.find((x) => String(x._id) === id)?.userId;
      const owner = ownerUsers.find((u) => String(u._id) === String(ownerId));
      const pending = pendingOwners.find((inv) => String(inv.organizationId) === id);
      return {
        id, name: o.name, slug: o.slug, status: o.status as string,
        createdAt: o.createdAt.toISOString(),
        lastActivity: lastActivity.find((x) => String(x._id) === id)?.at.toISOString() ?? null,
        staff: s.get(id) ?? 0, clients: c.get(id) ?? 0, projects: p.get(id) ?? 0, invoices: i.get(id) ?? 0,
        owner: owner ? { name: `${owner.firstName} ${owner.lastName ?? ""}`.trim(), email: owner.email } : null,
        pendingOwner: !owner && pending ? pending.email : null,
      };
    }),
  };
}
export type PlatformOverview = Awaited<ReturnType<typeof platformOverview>>;
