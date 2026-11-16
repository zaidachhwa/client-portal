// Workflow editor input (§8.2): untrusted phases become a clean, uniquely keyed definition.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPhases } from "../lib/workflows.ts";

const phase = (name: string, extra = {}) => ({ name, mandatoryTasks: true, mandatoryDocuments: false, tasks: [], ...extra });

test("keeps existing keys, slugs new ones and never repeats a key", () => {
  const { phases } = cleanPhases([phase("Onboarding", { key: "onboarding" }), phase("Design & Build"), phase("Design & build")]) as { phases: { key: string }[] };
  assert.deepEqual(phases.map((p) => p.key), ["onboarding", "design_build", "design_build_2"]);
});

test("cleans tasks and rejects bad input", () => {
  const { phases } = cleanPhases([phase("A", { tasks: [{ title: " Call ", mandatory: "yes", assignee: "hacker", dueInDays: null }] })]) as { phases: { tasks: object[] }[] };
  assert.deepEqual(phases[0].tasks, [{ title: "Call", mandatory: false, assignee: "manager" }]);
  assert.match(cleanPhases([]).error!, /at least one/);
  assert.match(cleanPhases([phase("  ")]).error!, /Name phase 1/);
  assert.match(cleanPhases([phase("A", { tasks: [{ title: "x", dueInDays: 1.5 }] })]).error!, /whole number/);
  assert.match(cleanPhases([phase("A", { tasks: [{ title: "x", dueInDays: -1 }] })]).error!, /whole number/);
  assert.match(cleanPhases([phase("A", { key: "Bad Key!", tasks: [{ title: "" }] })]).error!, /needs a title/);
});
