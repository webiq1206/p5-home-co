/**
 * Folding a regenerated scope into the current one without losing anything
 * an employee decided.
 *
 * The model is given the current scope (with its ids) plus the new material
 * and returns a full updated scope. This module compares the two and turns
 * the difference into a list of proposed changes the employee accepts or
 * rejects. Rules:
 *   - A field an employee edited by hand is never changed; a different
 *     generated value is shown as "kept your edit" for information.
 *   - Firm measurements (documented or confirmed) are never overwritten by a
 *     weaker or different generated value; the difference is flagged.
 *   - A task the model no longer returns is only proposed for removal when
 *     it was generated and never edited. Manual tasks always stay.
 *   - New conflicts and new tasks are proposed as additions.
 * Pure.
 */

import type { Conflict, Measurement, ScopeDoc, ScopeTask } from "./types.ts";

export type Change = {
  id: string;
  kind: "add-task" | "remove-task" | "update-task" | "kept-edit" | "update-measurement" | "measurement-conflict" | "add-conflict" | "update-list" | "update-client";
  label: string;
  taskId?: string;
  field?: string;
  before?: unknown;
  after?: unknown;
  /** Informational changes are shown but cannot be applied. */
  informational?: boolean;
};

export type Proposal = { changes: Change[]; generated: ScopeDoc; createdAt: string };

const TASK_FIELDS: (keyof ScopeTask)[] = [
  "title",
  "description",
  "area",
  "phase",
  "division",
  "bucket",
  "certainty",
  "costCode",
  "quantity",
  "performer",
  "laborHours",
  "materials",
  "selections",
  "notes",
];

const LIST_FIELDS = [
  "goals",
  "priorities",
  "areas",
  "siteConditions",
  "access",
  "schedule",
  "inclusions",
  "exclusions",
  "assumptions",
  "openQuestions",
] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Selections compare on what matters; evidence differences are not a change. */
function comparable(field: keyof ScopeTask, v: unknown): unknown {
  if (field === "selections" && Array.isArray(v)) {
    return v.map((s: { id: string; label: string; options: string[]; chosen: string | null }) => ({
      id: s.id,
      label: s.label,
      options: s.options,
      chosen: s.chosen,
    }));
  }
  return v;
}

const FIRM = new Set(["documented", "confirmed"]);

export function diffScopes(current: ScopeDoc, generated: ScopeDoc): Change[] {
  const changes: Change[] = [];
  const gen = new Map(generated.tasks.map((t) => [t.id, t]));
  const cur = new Map(current.tasks.map((t) => [t.id, t]));

  for (const c of current.tasks) {
    const g = gen.get(c.id);
    if (!g) {
      if (c.origin !== "manual" && !(c.edited?.length) && c.origin !== "checklist" && !c.dismissed) {
        changes.push({ id: `remove:${c.id}`, kind: "remove-task", taskId: c.id, label: `Remove "${c.title}" (no longer supported by the sources)` });
      }
      continue;
    }
    for (const f of TASK_FIELDS) {
      const before = comparable(f, c[f]);
      const after = comparable(f, g[f]);
      if (same(before, after)) continue;
      if (c.edited?.includes(f)) {
        changes.push({ id: `kept:${c.id}:${f}`, kind: "kept-edit", taskId: c.id, field: f, before: c[f], after: g[f], informational: true, label: `Kept your edit to ${f} on "${c.title}"` });
        continue;
      }
      changes.push({ id: `task:${c.id}:${f}`, kind: "update-task", taskId: c.id, field: f, before: c[f], after: g[f], label: `Update ${f} on "${c.title}"` });
    }
  }
  for (const g of generated.tasks) {
    if (!cur.has(g.id)) changes.push({ id: `add:${g.id}`, kind: "add-task", taskId: g.id, after: g, label: `Add "${g.title}"` });
  }

  const curM = new Map(current.measurements.map((m) => [m.id, m]));
  for (const g of generated.measurements) {
    const c = curM.get(g.id);
    if (!c) {
      changes.push({ id: `measure:${g.id}`, kind: "update-measurement", after: g, label: `Add measurement "${g.label}"` });
      continue;
    }
    if (c.value === g.value && c.unit === g.unit) continue;
    if (FIRM.has(c.status)) {
      if (g.value !== null) {
        changes.push({
          id: `mconflict:${g.id}`,
          kind: "measurement-conflict",
          before: c,
          after: g,
          informational: true,
          label: `New information says ${g.label} is ${g.value} ${g.unit}; the confirmed ${c.value} ${c.unit} was kept. Review if it changed.`,
        });
      }
      continue;
    }
    if (g.value !== null) {
      changes.push({ id: `measure:${g.id}`, kind: "update-measurement", before: c, after: g, label: `Update ${g.label}: ${c.value ?? "unknown"} to ${g.value} ${g.unit}` });
    }
  }

  const curC = new Set(current.conflicts.map((c) => c.id));
  for (const g of generated.conflicts) {
    if (!curC.has(g.id)) changes.push({ id: `conflict:${g.id}`, kind: "add-conflict", after: g, label: `Flag for review: ${g.topic}` });
  }

  for (const f of LIST_FIELDS) {
    const added = generated[f].filter((x) => !current[f].includes(x));
    if (added.length) changes.push({ id: `list:${f}`, kind: "update-list", field: f, after: added, label: `Add to ${f}: ${added.join("; ")}` });
  }
  if (generated.summary && generated.summary !== current.summary) {
    changes.push({ id: "list:summary", kind: "update-list", field: "summary", before: current.summary, after: generated.summary, label: "Update the summary" });
  }

  for (const k of ["firstName", "lastName", "email", "phone", "projectAddress", "billingAddress"] as const) {
    const g = generated.client?.[k];
    const c = current.client?.[k];
    if (!g?.value || g.value === c?.value) continue;
    changes.push({ id: `client:${k}`, kind: "update-client", field: k, before: c?.value ?? null, after: g, label: c?.value ? `Client ${k} differs: "${c.value}" vs "${g.value}"` : `Set client ${k} to "${g.value}"` });
  }
  return changes;
}

/** Apply the accepted changes. Unknown or informational ids are ignored. */
export function applyChanges(current: ScopeDoc, proposal: Proposal, acceptedIds: string[]): ScopeDoc {
  const accepted = new Set(acceptedIds);
  let doc: ScopeDoc = structuredClone(current);
  const gen = proposal.generated;
  for (const ch of proposal.changes) {
    if (!accepted.has(ch.id) || ch.informational) continue;
    switch (ch.kind) {
      case "add-task":
        doc.tasks.push(ch.after as ScopeTask);
        break;
      case "remove-task":
        doc.tasks = doc.tasks.filter((t) => t.id !== ch.taskId);
        break;
      case "update-task":
        doc.tasks = doc.tasks.map((t) => (t.id === ch.taskId ? { ...t, [ch.field!]: ch.after, evidence: mergeEvidence(t, gen.tasks.find((g) => g.id === t.id)) } : t));
        break;
      case "update-measurement": {
        const m = ch.after as Measurement;
        doc.measurements = doc.measurements.some((x) => x.id === m.id)
          ? doc.measurements.map((x) => (x.id === m.id ? m : x))
          : [...doc.measurements, m];
        break;
      }
      case "add-conflict":
        doc.conflicts = [...doc.conflicts, ch.after as Conflict];
        doc.tasks = doc.tasks.map((t) => ((ch.after as Conflict).taskIds.includes(t.id) ? { ...t, certainty: "conflict" } : t));
        break;
      case "update-list":
        if (ch.field === "summary") doc.summary = ch.after as string;
        else {
          const f = ch.field as (typeof LIST_FIELDS)[number];
          doc[f] = [...doc[f], ...(ch.after as string[])];
        }
        break;
      case "update-client":
        doc.client = { ...(doc.client ?? {}), [ch.field!]: ch.after };
        break;
    }
  }
  // Measurements a newly added task points at must exist.
  for (const t of doc.tasks) {
    const mid = t.quantity?.measurementId;
    if (mid && !doc.measurements.some((m) => m.id === mid)) {
      const m = gen.measurements.find((x) => x.id === mid);
      if (m) doc.measurements.push(m);
    }
  }
  doc = { ...doc };
  return doc;
}

function mergeEvidence(t: ScopeTask, g?: ScopeTask) {
  if (!g) return t.evidence;
  const seen = new Set(t.evidence.map((e) => JSON.stringify(e)));
  return [...t.evidence, ...g.evidence.filter((e) => !seen.has(JSON.stringify(e)))];
}

/** Record that a human edited these fields, so regeneration leaves them alone. */
export function markEdited(before: ScopeTask | undefined, after: ScopeTask): ScopeTask {
  if (!before) return { ...after, origin: after.origin ?? "manual", edited: after.edited ?? [] };
  const edited = new Set(before.edited ?? []);
  for (const f of TASK_FIELDS) if (!same(before[f], after[f])) edited.add(f);
  return { ...after, edited: [...edited] };
}
