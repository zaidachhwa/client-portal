import "server-only";
import type { Types } from "mongoose";
import { sendMail } from "./mail";
import { Notification, ProjectMember, User } from "./models";

type Id = Types.ObjectId | string;

export type Note = {
  title: string;
  message: string;
  resourceType: string;
  resourceId: Id;
  link: string; // app path; emails get it as an absolute link
  // Also email it. Lines are the email body; the title is the subject unless one is given.
  email?: { subject?: string; lines: string[]; cta: string };
  // Replace the recipient's unread notification for the same resource instead of adding another
  // (a busy chat thread stays one line in the inbox).
  collapse?: boolean;
};

// Deliver one event to several people: an in-app row each, plus an email when asked.
// Runs after the response (callers wrap it in after()), so it never slows the action down.
export async function notify(orgId: Id, recipients: (Id | null | undefined)[], n: Note, base: string) {
  const ids = [...new Set(recipients.filter(Boolean).map(String))];
  if (!ids.length) return;
  const about = { organizationId: orgId, resourceType: n.resourceType, resourceId: n.resourceId };

  if (n.collapse) await Notification.deleteMany({ ...about, recipientUserId: { $in: ids }, channel: "in_app", readAt: null });
  await Notification.insertMany(ids.map((recipientUserId) => ({ ...about, recipientUserId, channel: "in_app", title: n.title, message: n.message, link: n.link })));

  if (!n.email) return;
  const users = await User.find({ _id: { $in: ids }, status: "active" }).lean();
  for (const u of users) {
    if (u.emailNotifications === false) {
      // They opted out of email; the in-app notification above still reaches them.
      await Notification.create({ ...about, recipientUserId: u._id, channel: "email", title: n.email.subject ?? n.title, message: n.message, link: n.link, deliveryStatus: "skipped" });
      continue;
    }
    const r = await sendMail(u.email, n.email.subject ?? n.title, [`Hi ${u.firstName},`, ...n.email.lines], { label: n.email.cta, url: base + n.link });
    await Notification.create({
      ...about, recipientUserId: u._id, channel: "email", title: n.email.subject ?? n.title, message: n.message, link: n.link,
      deliveryStatus: r.sent ? "sent" : r.reason.includes("not set") ? "skipped" : "failed",
    });
  }
}

// Active members of a project, optionally only clients or only staff, minus whoever caused the event.
export async function projectPeople(orgId: Id, projectId: Id, who: "client" | "staff" | "all", except?: Id) {
  const rows = await ProjectMember.find({
    organizationId: orgId, projectId, status: "active",
    ...(who === "client" ? { role: "client" } : who === "staff" ? { role: { $ne: "client" } } : {}),
  }).lean();
  return rows.map((r) => r.userId).filter((u) => String(u) !== String(except));
}
