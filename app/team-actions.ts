"use server";
import { refresh } from "next/cache";
import { after } from "next/server";
import { isValidObjectId, Types } from "mongoose";
import { tx } from "@/lib/db";
import { canAccessProject } from "@/lib/data";
import { appUrl, audit, requireSession, type S } from "@/lib/guard";
import { Membership, Permission, Project, ProjectMember, Role, RolePermission, User } from "@/lib/models";
import { notify } from "@/lib/notify";
import { can, permissionKeys } from "@/lib/session";

// Roles, permissions and who has access (§6). Rules, all enforced here:
//  - you can only grant permissions you hold yourself (no privilege escalation);
//  - you can't change your own access, or that of someone holding permissions you lack;
//  - a role in use can't be switched off;
//  - at least one active teammate must keep roles.manage, so the organization can't lock itself out.

type Result = { error?: string };
const MANAGE = "roles.manage";
const field = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);

class Refused extends Error {}
const refusing = (run: () => Promise<Result>): Promise<Result> =>
  run().catch((e) => {
    if (e instanceof Refused) return { error: e.message };
    if ((e as { code?: number }).code === 11000) return { error: "A role with that name already exists." };
    throw e;
  });

const allowed = (s: S) => s.isStaff && can(s, MANAGE);
const exceeds = (keys: string[], s: S) => keys.filter((k) => !s.permissions.includes(k));

// Runs inside the transaction after a change; aborts it if nobody could manage roles any more.
async function assertSomeoneCanManage(s: S) {
  const perm = await Permission.findOne({ key: MANAGE }).lean();
  const roles = await RolePermission.find({ organizationId: s.orgId, permissionId: perm?._id }).distinct("roleId");
  const activeRoles = await Role.find({ organizationId: s.orgId, _id: { $in: roles }, status: "active" }).distinct("_id");
  const managers = await Membership.countDocuments({ organizationId: s.orgId, membershipType: "employee", status: "active", roleIds: { $in: activeRoles } });
  if (!managers) throw new Refused("That would leave nobody able to manage roles. Give someone else access first.");
}

// A member you may manage: not yourself, and holding nothing you don't.
async function manageable(s: S, membershipId: string) {
  if (!isValidObjectId(membershipId) || membershipId === s.membershipId) return null;
  const m = await Membership.findOne({ _id: membershipId, organizationId: s.orgId });
  if (!m) return null;
  return exceeds(await permissionKeys(s.orgId, m.roleIds), s).length ? null : m;
}

export async function saveRole(roleId: string | undefined, _: Result | undefined, form: FormData): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to manage roles." };
  const name = field(form, "name", 60);
  const description = field(form, "description", 200);
  const keys = [...new Set(form.getAll("permission").map(String))];
  if (!name) return { error: "Name the role." };

  const perms = await Permission.find({ key: { $in: keys } }).lean();
  if (perms.length !== keys.length) return { error: "Unknown permission." };
  const over = exceeds(keys, s);
  if (over.length) return { error: `You can't grant permissions you don't have: ${over.join(", ")}.` };

  const role = roleId ? (isValidObjectId(roleId) ? await Role.findOne({ _id: roleId, organizationId: s.orgId }) : null) : null;
  if (roleId && !role) return { error: "Role not found." };
  // Editing a role that already holds permissions you lack would let you strip or reshape access above yours.
  if (role && exceeds(await permissionKeys(s.orgId, [role._id]), s).length) return { error: "This role has permissions you don't hold, so only someone who does can edit it." };

  return refusing(() =>
    tx(async () => {
      const before = role ? await permissionKeys(s.orgId, [role._id]) : [];
      const [r] = role
        ? [Object.assign(role, { name, description })]
        : await Role.insertMany([{ organizationId: s.orgId, name, description, isSystemRole: false }]);
      if (role) await role.save();
      await RolePermission.deleteMany({ organizationId: s.orgId, roleId: r._id });
      if (perms.length) await RolePermission.insertMany(perms.map((p) => ({ organizationId: s.orgId, roleId: r._id, permissionId: p._id })));
      await assertSomeoneCanManage(s);
      await audit(s, role ? "role.updated" : "role.created", "role", r._id, role ? { name: role.name, permissions: before } : undefined, { name, permissions: keys.sort() });
      return {};
    }),
  ).finally(() => refresh());
}

export async function setRoleActive(roleId: string, active: boolean): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s) || !isValidObjectId(roleId)) return { error: "You don't have permission to manage roles." };
  const role = await Role.findOne({ _id: roleId, organizationId: s.orgId });
  if (!role) return { error: "Role not found." };
  if (exceeds(await permissionKeys(s.orgId, [role._id]), s).length && !active) return { error: "This role has permissions you don't hold." };
  if (!active) {
    const inUse = await Membership.countDocuments({ organizationId: s.orgId, roleIds: role._id, status: { $ne: "suspended" } });
    if (inUse) return { error: `${inUse} ${inUse === 1 ? "person uses" : "people use"} this role. Move them to another role first.` };
  }
  return refusing(() =>
    tx(async () => {
      role.status = active ? "active" : "inactive";
      await role.save();
      await assertSomeoneCanManage(s);
      await audit(s, active ? "role.activated" : "role.deactivated", "role", role._id, undefined, { name: role.name });
      return {};
    }),
  ).finally(() => refresh());
}

export async function setMemberRole(membershipId: string, roleId: string): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to manage people." };
  const m = await manageable(s, membershipId);
  if (!m) return { error: "You can't change this person's access." };
  const role = isValidObjectId(roleId) ? await Role.findOne({ _id: roleId, organizationId: s.orgId, status: "active" }).lean() : null;
  if (!role) return { error: "Pick an active role." };
  const over = exceeds(await permissionKeys(s.orgId, [role._id]), s);
  if (over.length) return { error: `That role has permissions you don't hold: ${over.join(", ")}.` };

  return refusing(() =>
    tx(async () => {
      const before = await Role.find({ _id: { $in: m.roleIds } }).distinct("name");
      m.roleIds = [role._id];
      if (m.membershipType === "employee") m.title = role.name;
      await m.save();
      await assertSomeoneCanManage(s);
      await audit(s, "membership.role_changed", "membership", m._id, { roles: before }, { roles: [role.name] });
      return {};
    }),
  ).finally(() => refresh());
}

// Suspension takes effect on the person's next request: getSession re-checks membership status every time.
export async function setMemberActive(membershipId: string, active: boolean): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to manage people." };
  const m = await manageable(s, membershipId);
  if (!m) return { error: "You can't change this person's access." };
  return refusing(() =>
    tx(async () => {
      m.status = active ? "active" : "suspended";
      await m.save();
      await assertSomeoneCanManage(s);
      await audit(s, active ? "membership.reactivated" : "membership.suspended", "membership", m._id);
      return {};
    }),
  ).finally(() => refresh());
}

// ---- Project team (§6.4). Needs manage access on the project. The project manager always keeps
// manage; clients can be given view or edit, never manage; nobody changes their own access.

const LEVELS = ["view", "edit", "manage"] as const;
type Level = (typeof LEVELS)[number];
const isLevel = (l: unknown): l is Level => LEVELS.includes(l as Level);

async function projectMemberFor(s: S, memberId: string) {
  if (!s.isStaff || !isValidObjectId(memberId)) return null;
  const m = await ProjectMember.findOne({ _id: memberId, organizationId: s.orgId, status: "active" });
  if (!m || !(await canAccessProject(s, m.projectId, "manage"))) return null;
  return m;
}

const isProjectManager = async (projectId: Types.ObjectId, userId: Types.ObjectId) =>
  !!(await Project.exists({ _id: projectId, projectManagerId: userId }));

export async function addProjectMember(projectId: string, userId: string, level: string): Promise<Result> {
  const s = await requireSession();
  if (!s.isStaff || !isValidObjectId(projectId) || !(await canAccessProject(s, projectId, "manage"))) return { error: "Only the project's managers can change its team." };
  if (!isLevel(level)) return { error: "Pick an access level." };
  const member = isValidObjectId(userId) ? await Membership.findOne({ organizationId: s.orgId, userId, membershipType: "employee", status: "active" }).lean() : null;
  if (!member) return { error: "Pick a teammate." };
  if (await ProjectMember.exists({ organizationId: s.orgId, projectId, userId, status: "active" })) return { error: "They're already on this project." };

  await ProjectMember.insertMany([{ organizationId: s.orgId, projectId, userId, role: "member", accessLevel: level }]);
  const [project, user] = await Promise.all([Project.findById(projectId).lean(), User.findById(userId).lean()]);
  await audit(s, "project.member_added", "project", new Types.ObjectId(projectId), undefined, { member: user?.firstName, access: level });
  const base = await appUrl();
  after(() =>
    notify(s.orgId, [userId], {
      title: `You were added to ${project?.name}`, message: `${s.name} gave you ${level} access.`, resourceType: "project", resourceId: projectId, link: `/?project=${projectId}`,
    }, base),
  );
  refresh();
  return {};
}

export async function setProjectAccess(memberId: string, level: string): Promise<Result> {
  const s = await requireSession();
  const m = await projectMemberFor(s, memberId);
  if (!m) return { error: "Only the project's managers can change its team." };
  if (!isLevel(level)) return { error: "Pick an access level." };
  if (String(m.userId) === s.userId) return { error: "You can't change your own access." };
  if (m.role === "client" && level === "manage") return { error: "Clients can have view or edit access." };
  if (level !== "manage" && (await isProjectManager(m.projectId, m.userId))) return { error: "The project manager always keeps manage access." };
  const before = m.accessLevel ?? null;
  m.accessLevel = level;
  await m.save();
  await audit(s, "project.access_changed", "project", m.projectId, { access: before }, { access: level });
  refresh();
  return {};
}

export async function removeProjectMember(memberId: string): Promise<Result> {
  const s = await requireSession();
  const m = await projectMemberFor(s, memberId);
  if (!m) return { error: "Only the project's managers can change its team." };
  if (String(m.userId) === s.userId) return { error: "You can't remove yourself." };
  if (await isProjectManager(m.projectId, m.userId)) return { error: "The project manager can't be removed." };
  // Soft removal keeps history; the partial unique index lets them be added again later.
  m.status = "removed";
  await m.save();
  await audit(s, "project.member_removed", "project", m.projectId, { member: String(m.userId), role: m.role }, undefined);
  refresh();
  return {};
}
