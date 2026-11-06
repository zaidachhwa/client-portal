import "server-only";
import type { Types } from "mongoose";
import { InvoiceDraft, PaymentSchedule, PhaseInstance, Project } from "./models";
import { mulDiv } from "./money";
import { notify } from "./notify";

type Id = Types.ObjectId | string;
type Schedule = { _id: Types.ObjectId; organizationId: Types.ObjectId; projectId: Types.ObjectId; title: string; calculationType: string; amount: number; rateBp?: number | null };

// A milestone fell due: raise a draft invoice for it and tell the project manager. Claiming it with a
// conditional update first means two requests at once can't both raise a draft.
export async function markDue(sch: Schedule) {
  const claimed = await PaymentSchedule.findOneAndUpdate({ _id: sch._id, status: "pending" }, { status: "due" });
  if (!claimed) return;
  const project = await Project.findById(sch.projectId).lean();
  const agreed = project?.financialSettings?.agreedValue ?? 0;
  const price = sch.calculationType === "percentage" ? mulDiv(agreed, sch.amount, 10000) : sch.amount;
  const [draft] = await InvoiceDraft.insertMany([{
    organizationId: sch.organizationId, projectId: sch.projectId, paymentScheduleId: sch._id, note: `Milestone: ${sch.title}`,
    lines: [{ description: sch.title, quantity: "1", unitPrice: (price / 100).toFixed(2), rate: sch.rateBp ?? 1800, discount: "" }],
    dueDate: new Date(Date.now() + 15 * 86_400_000),
  }]);
  await PaymentSchedule.updateOne({ _id: sch._id }, { draftId: draft._id });
  if (project?.projectManagerId) {
    await notify(sch.organizationId, [project.projectManagerId], {
      title: `Milestone due: ${sch.title}`, message: `A draft invoice for ${project.name} is ready to review and issue.`,
      resourceType: "project", resourceId: sch.projectId, link: `/billing?project=${sch.projectId}`,
    }, process.env.APP_URL ?? "");
  }
}

// Due dates that have passed and phases that have completed. Called when billing is viewed and when a
// phase completes, so no background job is needed.
export async function raiseDue(orgId: Id, projectId: Id) {
  const pending = await PaymentSchedule.find({ organizationId: orgId, projectId, status: "pending", triggerType: { $in: ["date", "phase_completion"] } }).lean();
  if (!pending.length) return;
  const done = await PhaseInstance.find({ organizationId: orgId, projectId, status: "completed" }).distinct("_id");
  const now = Date.now();
  for (const sch of pending) {
    const ready = sch.triggerType === "date" ? !!sch.dueDate && sch.dueDate.getTime() <= now : done.some((p) => String(p) === String(sch.phaseInstanceId));
    if (ready) await markDue(sch);
  }
}
