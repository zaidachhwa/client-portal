"use server";
import { refresh } from "next/cache";
import { isValidObjectId } from "mongoose";
import { tx } from "@/lib/db";
import { audit, requireSession, type S } from "@/lib/guard";
import { WorkflowTemplate, WorkflowVersion } from "@/lib/models";
import { can } from "@/lib/session";
import { cleanPhases, text, type WorkflowInput } from "@/lib/workflows";

// Workflow templates (§8.1–8.2). Saving publishes a new immutable version; running projects keep theirs.
// ponytail: reuses organization.update; add a workflows.manage permission (and migrate roles) if a separate role needs it.

type Result = { error?: string; id?: string };
const allowed = (s: S) => s.isStaff && can(s, "organization.update");

export async function saveWorkflow(templateId: string | null, input: WorkflowInput): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s)) return { error: "You don't have permission to edit workflows." };
  const name = text(input?.name, 120);
  if (!name) return { error: "Name the workflow." };
  const { phases, error } = cleanPhases(input?.phases);
  if (error) return { error };
  const fields = { name, category: text(input.category, 60) || undefined, description: text(input.description, 500) || undefined };

  const existing = templateId
    ? isValidObjectId(templateId) ? await WorkflowTemplate.findOne({ _id: templateId, organizationId: s.orgId }) : null
    : undefined;
  if (existing === null) return { error: "Workflow not found." };

  // The template and its new published version commit together; the unique (template, version) index stops races.
  const id = await tx(async () => {
    const [template] = existing
      ? [existing]
      : await WorkflowTemplate.insertMany([{ organizationId: s.orgId, ...fields, status: "published", createdBy: s.userId }]);
    const last = await WorkflowVersion.findOne({ organizationId: s.orgId, workflowTemplateId: template._id }).sort({ version: -1 }).lean();
    const [version] = await WorkflowVersion.insertMany([{
      organizationId: s.orgId, workflowTemplateId: template._id, version: (last?.version ?? 0) + 1,
      definition: { phases }, status: "published", publishedAt: new Date(), publishedBy: s.userId,
    }]);
    const before = existing ? { name: existing.name, version: last?.version } : undefined;
    template.set({ ...fields, currentPublishedVersionId: version._id });
    await template.save();
    await audit(s, existing ? "workflow.published" : "workflow.created", "workflow_template", template._id, before, { name, version: version.version });
    return String(template._id);
  });
  refresh();
  return { id };
}

// Archived templates can't start new projects; projects already running them carry on.
export async function setWorkflowArchived(templateId: string, archived: boolean): Promise<Result> {
  const s = await requireSession();
  if (!allowed(s) || !isValidObjectId(templateId)) return { error: "You don't have permission to edit workflows." };
  const t = await WorkflowTemplate.findOne({ _id: templateId, organizationId: s.orgId });
  if (!t) return { error: "Workflow not found." };
  if (!archived && !t.currentPublishedVersionId) return { error: "Save this workflow before restoring it." };
  const before = { status: t.status };
  t.status = archived ? "archived" : "published";
  await t.save();
  await audit(s, archived ? "workflow.archived" : "workflow.restored", "workflow_template", t._id, before, { status: t.status });
  refresh();
  return {};
}
