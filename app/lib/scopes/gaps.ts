/**
 * What is still missing, as the fewest possible one-field questions.
 *
 * Questions are derived, never stored: every time the scope or pricing
 * changes they are recomputed, so an answer that resolves a gap (or a new
 * recording that supplies it) removes the step automatically. Each question
 * has a stable key; an answer is applied to the scope document itself, so a
 * single measurement answer updates every task that references it.
 */

import { divisionLabel, divisionOrder, unitLabel } from "./divisions.ts";
import { costBookEntry } from "./costbook.ts";
import { costBookAgeKey } from "./pricing.ts";
import type {
  Answer,
  Evidence,
  Measurement,
  PricingIssue,
  PricingResult,
  Question,
  ScopeDoc,
  ScopeStatusName,
  ScopeTask,
} from "./types.ts";

export function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Short stable hash for free-text keys. */
export function textKey(s: string): string {
  let h = 2166136261;
  for (const c of norm(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * Merge duplicate measurements (same label, area and unit) so one fact is
 * asked once, preferring the firmest value, and point every task at it.
 */
export function reconcileMeasurements(doc: ScopeDoc): ScopeDoc {
  const keep = new Map<string, Measurement>();
  const remap = new Map<string, string>();
  const rank = (m: Measurement) =>
    m.value === null ? 0 : m.status === "estimated" ? 1 : m.status === "stated" ? 2 : 3;
  for (const m of doc.measurements) {
    const k = `${norm(m.label)}|${norm(m.area)}|${m.unit}`;
    const existing = keep.get(k);
    if (!existing) {
      keep.set(k, m);
      continue;
    }
    const winner = rank(m) > rank(existing) ? m : existing;
    const loser = winner === m ? existing : m;
    winner.evidence = [...winner.evidence, ...loser.evidence];
    keep.set(k, winner);
    remap.set(loser.id, winner.id);
  }
  if (!remap.size) return doc;
  return {
    ...doc,
    measurements: [...keep.values()],
    tasks: doc.tasks.map((t) =>
      t.quantity?.measurementId && remap.has(t.quantity.measurementId)
        ? { ...t, quantity: { ...t.quantity, measurementId: remap.get(t.quantity.measurementId)! } }
        : t,
    ),
  };
}

function taskContext(t: ScopeTask): string {
  return [t.area, t.title].filter(Boolean).join(": ") + ` · ${divisionLabel(t.division)}`;
}

function order(doc: ScopeDoc, taskIds: string[]): number {
  const t = doc.tasks.find((x) => taskIds.includes(x.id));
  if (!t) return 9999;
  return (t.phase === "pre-construction" ? 0 : 1000) + divisionOrder(t.division);
}

export type AnswerState = Map<string, { status: "answered" | "deferred" }>;

export function deriveQuestions(doc: ScopeDoc, pricing: PricingResult, answers: AnswerState): Question[] {
  const qs: (Question & { sort: number })[] = [];
  const add = (q: Question) => {
    if (qs.some((x) => x.key === q.key)) {
      const existing = qs.find((x) => x.key === q.key)!;
      existing.taskIds = [...new Set([...existing.taskIds, ...q.taskIds])];
      existing.blocking = existing.blocking || q.blocking;
      return;
    }
    qs.push({ ...q, deferred: answers.get(q.key)?.status === "deferred", sort: order(doc, q.taskIds) });
  };
  const task = (id?: string) => doc.tasks.find((t) => t.id === id);

  // Conflicting statements.
  for (const c of doc.conflicts) {
    if (c.resolution) continue;
    const affected = doc.tasks.filter((t) => c.taskIds.includes(t.id) && !t.dismissed);
    add({
      key: `conflict:${c.id}`,
      context: affected[0] ? taskContext(affected[0]) : c.topic,
      prompt: `Which is correct: ${c.topic}?`,
      help: "Sources disagree. Pick the statement that reflects the final decision.",
      input: {
        type: "choice",
        options: [...c.statements.map((s) => s.text), "Exclude this work"],
        allowOther: true,
      },
      blocking: affected.some((t) => t.bucket === "approved") || affected.length === 0,
      taskIds: affected.map((t) => t.id),
      evidence: c.statements.flatMap((s) => s.evidence),
    });
  }

  for (const t of doc.tasks) {
    if (t.dismissed || t.bucket === "future") continue;
    const blocking = t.bucket === "approved";
    // Undecided options the client must choose between.
    for (const s of t.selections ?? []) {
      if (s.chosen || s.options.length === 0) continue;
      add({
        key: `choice:${t.id}:${s.id}`,
        context: taskContext(t),
        prompt: `Which ${s.label.toLowerCase()} did the client approve?`,
        help: "Pick the approved option. Choose Other if it is something else.",
        input: { type: "choice", options: s.options, allowOther: true },
        blocking,
        taskIds: [t.id],
        evidence: s.evidence,
      });
    }
    if (t.certainty === "undecided" && !(t.selections ?? []).some((s) => !s.chosen && s.options.length)) {
      add({
        key: `decide:${t.id}`,
        context: taskContext(t),
        prompt: `Is "${t.title}" part of the work?`,
        help: "The client had not decided. Undecided work is left out of the estimate.",
        input: {
          type: "choice",
          options: ["Include in the estimate", "Optional upgrade", "Still considering", "Not included"],
          allowOther: false,
        },
        blocking: false,
        taskIds: [t.id],
        evidence: t.evidence,
      });
    }
    // Overlooked supporting work, for confirmation before it is added.
    if (t.certainty === "suggested") {
      add({
        key: `suggest:${t.id}`,
        context: taskContext(t),
        prompt: `Add "${t.title}" to the approved scope?`,
        help: `${t.description} This is often left out of walkthrough notes.`,
        input: { type: "confirm", yes: "Add it", no: "Not needed" },
        blocking: false,
        taskIds: [t.id],
        evidence: t.evidence,
      });
    }
  }

  for (const i of pricing.issues) {
    const q = issueQuestion(doc, i, task(i.taskId), pricing);
    if (q) add(q);
  }

  for (const oq of doc.openQuestions) {
    add({
      key: `open:${textKey(oq)}`,
      context: "Clarification",
      prompt: oq,
      help: "Answer if known. This does not hold up the estimate.",
      input: { type: "text", multiline: true },
      blocking: false,
      taskIds: [],
      evidence: [],
    });
  }

  return qs
    .filter((q) => answers.get(q.key)?.status !== "answered")
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || Number(a.deferred) - Number(b.deferred) || a.sort - b.sort)
    .map((q) => {
      const out: Question & { sort?: number } = { ...q };
      delete out.sort;
      return out;
    });
}

function issueQuestion(
  doc: ScopeDoc,
  i: PricingIssue,
  t: ScopeTask | undefined,
  pricing: PricingResult,
): Question | null {
  const ctx = t ? taskContext(t) : "Pricing";
  const ids = t ? [t.id] : [];
  const ev: Evidence[] = t?.evidence ?? [];
  if (i.key.startsWith("measure:")) {
    const m = doc.measurements.find((x) => `measure:${x.id}` === i.key);
    if (!m) return null;
    const estimated = m.value !== null && m.status === "estimated";
    return {
      key: i.key,
      context: [m.area, m.label].filter(Boolean).join(": ") || ctx,
      prompt: estimated ? `Confirm the ${m.label.toLowerCase()}.` : `What is the ${m.label.toLowerCase()}?`,
      help: estimated
        ? `The system estimated ${m.value} ${m.unit}. Measure or confirm it. Every item that uses it updates.`
        : `Enter the measurement in ${unitLabel(m.unit)}. Every item that uses it updates.`,
      input: { type: "measurement", unit: m.unit },
      blocking: i.blocking,
      suggested: estimated ? m.value : null,
      taskIds: doc.tasks.filter((x) => x.quantity?.measurementId === m.id).map((x) => x.id),
      evidence: m.evidence,
    };
  }
  if (i.key.startsWith("qty:") && t) {
    const unit = t.quantity?.unit || costBookEntry(t.costCode)?.uom || "EA";
    return {
      key: i.key,
      context: ctx,
      prompt: i.kind === "estimated-quantity" ? `Confirm the quantity for ${t.title.toLowerCase()}.` : `How many ${unitLabel(unit)} for ${t.title.toLowerCase()}?`,
      help: i.kind === "estimated-quantity" ? `Estimated at ${t.quantity?.value} ${unit}.` : `Enter the quantity in ${unitLabel(unit)}.`,
      input: { type: "number", unit },
      blocking: i.blocking,
      suggested: i.kind === "estimated-quantity" ? (t.quantity?.value ?? null) : null,
      taskIds: ids,
      evidence: ev,
    };
  }
  if (i.key.startsWith("price:") && t) {
    const trade = t.performer === "supplier" ? "supplier" : "trade";
    return {
      key: i.key,
      context: ctx,
      prompt: `What is the ${trade}'s quoted amount for this work?`,
      help: "Enter P5's cost (the amount quoted to P5, before markup). Attach the quote if you have it.",
      input: { type: "currency", allowAttachment: true },
      blocking: i.blocking,
      taskIds: ids,
      evidence: ev,
    };
  }
  if (i.key.startsWith("hours:") && t) {
    const proposed = t.laborHours?.value ?? null;
    return {
      key: i.key,
      context: ctx,
      prompt: proposed ? `Confirm the labor hours for ${t.title.toLowerCase()}.` : `How many labor hours for ${t.title.toLowerCase()}?`,
      help: proposed
        ? `Proposed ${proposed} hours${t.laborHours?.note ? ` (${t.laborHours.note})` : ""}. No approved production rate covers this item.`
        : "No approved production rate covers this item. Enter the hours P5's crew will spend.",
      input: { type: "number", unit: "HR" },
      blocking: i.blocking,
      suggested: proposed,
      taskIds: ids,
      evidence: ev,
    };
  }
  if (i.key.startsWith("allowance:") && t) {
    const line = pricing.lines.find((l) => l.taskId === t.id && l.allowance);
    return {
      key: i.key,
      context: ctx,
      prompt: `Approve the allowance for ${t.title.toLowerCase()}.`,
      help: "This is an allowance, not a final selection. Confirm or change P5's direct-cost amount.",
      input: { type: "currency", allowAttachment: false },
      blocking: i.blocking,
      suggested: line?.cost ?? t.allowance?.amount ?? null,
      taskIds: ids,
      evidence: ev,
    };
  }
  if (i.key === costBookAgeKey()) {
    return {
      key: i.key,
      context: "Cost book",
      prompt: "Are the cost book prices still current?",
      help: i.message,
      input: { type: "confirm", yes: "Prices are current", no: "Not yet" },
      blocking: true,
      taskIds: [],
      evidence: [],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Applying an answer
// ---------------------------------------------------------------------------

function mapTask(doc: ScopeDoc, id: string, fn: (t: ScopeTask) => ScopeTask): ScopeDoc {
  return { ...doc, tasks: doc.tasks.map((t) => (t.id === id ? fn(t) : t)) };
}

function num(a: Answer): number {
  const v = "amount" in a ? a.amount : "value" in a ? a.value : NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid number.");
  return n;
}

function str(a: Answer): string {
  if (!("value" in a) || typeof a.value !== "string" || !a.value.trim()) throw new Error("Enter an answer.");
  return a.value.trim();
}

/** Apply one answer to the scope document. Pure. */
export function applyAnswer(doc: ScopeDoc, key: string, answer: Answer): ScopeDoc {
  const [kind, id, sub] = key.split(":");
  switch (kind) {
    case "measure": {
      const value = num(answer);
      return {
        ...doc,
        measurements: doc.measurements.map((m) =>
          m.id === id ? { ...m, value, status: "confirmed", unit: ("unit" in answer && answer.unit) || m.unit } : m,
        ),
      };
    }
    case "qty":
      return mapTask(doc, id, (t) => ({
        ...t,
        quantity: { ...(t.quantity ?? {}), measurementId: null, value: num(answer), estimated: false },
      }));
    case "price":
      return mapTask(doc, id, (t) => ({
        ...t,
        quote: { amount: num(answer), assetId: "assetId" in answer ? (answer.assetId ?? null) : null },
      }));
    case "hours":
      return mapTask(doc, id, (t) => ({
        ...t,
        laborHours: { value: num(answer), basis: "confirmed", note: t.laborHours?.note ?? null },
      }));
    case "allowance":
      return mapTask(doc, id, (t) => ({ ...t, allowance: { amount: num(answer), approved: true } }));
    case "choice": {
      const chosen = str(answer);
      return mapTask(doc, id, (t) => {
        const selections = (t.selections ?? []).map((s) => (s.id === sub ? { ...s, chosen } : s));
        const decided = selections.every((s) => s.chosen || !s.options.length);
        return {
          ...t,
          selections,
          certainty: decided && t.certainty === "undecided" ? "confirmed" : t.certainty,
        };
      });
    }
    case "decide": {
      const v = str(answer);
      return mapTask(doc, id, (t) => {
        if (v === "Not included") return { ...t, dismissed: true };
        if (v === "Optional upgrade") return { ...t, bucket: "optional", certainty: "confirmed" };
        if (v === "Still considering") return { ...t, bucket: "considering" };
        return { ...t, bucket: "approved", certainty: "confirmed" };
      });
    }
    case "suggest": {
      const yes = "value" in answer && answer.value === true;
      return mapTask(doc, id, (t) => (yes ? { ...t, certainty: "confirmed" } : { ...t, dismissed: true }));
    }
    case "conflict": {
      const v = str(answer);
      const c = doc.conflicts.find((x) => x.id === id);
      if (!c) return doc;
      const exclude = v === "Exclude this work";
      return {
        ...doc,
        conflicts: doc.conflicts.map((x) => (x.id === id ? { ...x, resolution: v } : x)),
        tasks: doc.tasks.map((t) =>
          c.taskIds.includes(t.id)
            ? exclude
              ? { ...t, bucket: "considering" }
              : {
                  ...t,
                  certainty: t.certainty === "conflict" ? "confirmed" : t.certainty,
                  notes: [t.notes, `Resolved: ${v}`].filter(Boolean).join("\n"),
                }
            : t,
        ),
      };
    }
    case "open": {
      const v = str(answer);
      const q = doc.openQuestions.find((x) => textKey(x) === id);
      if (!q) return doc;
      return {
        ...doc,
        openQuestions: doc.openQuestions.filter((x) => x !== q),
        assumptions: [...doc.assumptions, `${q} ${v}`],
      };
    }
    default:
      return doc;
  }
}

// ---------------------------------------------------------------------------
// Scope readiness
// ---------------------------------------------------------------------------

export function readiness(
  doc: ScopeDoc | null,
  pricing: PricingResult | null,
  questions: Question[],
  extraBlockers: string[] = [],
): { status: ScopeStatusName; blocking: number; blockers: string[] } {
  if (!doc || !doc.tasks.some((t) => !t.dismissed && t.bucket === "approved")) {
    return { status: "in_progress", blocking: 0, blockers: ["No approved scope yet."] };
  }
  const blockers = [
    ...questions.filter((q) => q.blocking).map((q) => `${q.context.split(" · ")[0]}: ${q.prompt}`),
    ...(pricing?.issues ?? []).filter((i) => i.blocking && i.kind === "labor-rate-unconfirmed").map((i) => i.message),
    ...extraBlockers,
  ];
  return { status: blockers.length ? "needs_information" : "ready", blocking: blockers.length, blockers };
}

