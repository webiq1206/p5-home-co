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

const FILLER = new Set(
  ("a an and are as at be by did do does for from how in is it its many much of on or our per that the their this to up was we what "
    + "which will with you your total overall exact approximate approx about required needed need new existing old current all entire whole "
    + "each any some client homeowner customer project work job scope please confirm").split(" "),
);
const MEASURE_WORDS = new Set(
  "length footage foot feet ft linear lineal lf area square sq sf size quantity qty number count amount dimension dimensions measurement measurements run inch inches yard yards".split(" "),
);
const ACTION_WORDS = new Set(
  ("install installation replace replacement remove removal demo demolish demolition supply furnish provide add paint painting prime priming "
    + "patch patching repair prep prepare preparation haul dispose disposal protect protection clean cleaning finish finishing refinish set hang "
    + "trim caulk seal sand texture frame build rough connect disconnect relocate move update upgrade apply").split(" "),
);

/** The meaningful words of a phrase, singular, so "New baseboards" and "baseboard" compare equal. */
export function words(text: string | null | undefined, drop: Set<string>[] = []): string[] {
  const out = new Set<string>();
  for (const raw of norm(text).split(" ")) {
    if (!raw || /^\d+$/.test(raw)) continue;
    const w = raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw;
    if (FILLER.has(raw) || FILLER.has(w) || drop.some((d) => d.has(raw) || d.has(w))) continue;
    out.add(w);
  }
  return [...out].sort();
}

/** What a task or measurement is about, ignoring the action and the unit: "Install new baseboards" -> "baseboard". */
export function subject(text: string | null | undefined): string {
  return words(text, [MEASURE_WORDS, ACTION_WORDS]).join(" ");
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const shared = a.filter((x) => set.has(x)).length;
  return shared / Math.min(a.length, b.length);
}

/**
 * Merge duplicate measurements (same subject, area and unit) so one fact is
 * asked once, preferring the firmest value, and point every task at it.
 */
export function reconcileMeasurements(doc: ScopeDoc): ScopeDoc {
  const keep = new Map<string, Measurement>();
  const remap = new Map<string, string>();
  const rank = (m: Measurement) =>
    m.value === null ? 0 : m.status === "estimated" ? 1 : m.status === "stated" ? 2 : 3;
  for (const m of doc.measurements) {
    // "Baseboard length" and "Total linear footage of baseboards" are the same fact.
    const k = `${subject(m.label) || norm(m.label)}|${norm(m.area)}|${m.unit}`;
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

const KIND_RANK: Record<string, number> = { conflict: 0, decide: 1, suggest: 1, choice: 2, measure: 3, qty: 4, hours: 5, price: 6, allowance: 7, open: 8 };

/**
 * Where a question belongs: by phase and division, then by room, then by the
 * task's place in the scope, so everything about one item is asked together.
 */
type Place = { division: number; area: string; task: number; kind: number };
function place(doc: ScopeDoc, key: string, taskIds: string[]): Place {
  const kind = KIND_RANK[key.split(":")[0]] ?? 9;
  const index = doc.tasks.findIndex((x) => taskIds.includes(x.id));
  if (index === -1) return { division: 99_999, area: "", task: 99_999, kind };
  const t = doc.tasks[index];
  return { division: (t.phase === "pre-construction" ? 0 : 1000) + divisionOrder(t.division), area: norm(t.area), task: index, kind };
}

export type AnswerState = Map<string, { status: "answered" | "deferred" }>;

export function deriveQuestions(doc: ScopeDoc, pricing: PricingResult, answers: AnswerState): Question[] {
  const qs: (Question & { sort: Place })[] = [];
  const add = (q: Question) => {
    if (qs.some((x) => x.key === q.key)) {
      const existing = qs.find((x) => x.key === q.key)!;
      existing.taskIds = [...new Set([...existing.taskIds, ...q.taskIds])];
      existing.blocking = existing.blocking || q.blocking;
      return;
    }
    qs.push({ ...q, deferred: answers.get(q.key)?.status === "deferred", sort: place(doc, q.key, q.taskIds) });
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
    // Marked conflicting with no open conflict to resolve it: decide directly,
    // so the work is never silently left out of the estimate.
    if (t.certainty === "conflict" && !doc.conflicts.some((c) => !c.resolution && c.taskIds.includes(t.id))) {
      add({
        key: `decide:${t.id}`,
        context: taskContext(t),
        prompt: `Is "${t.title}" part of the work?`,
        help: "Sources disagreed about this work. It is left out of the estimate until decided.",
        input: {
          type: "choice",
          options: ["Include in the estimate", "Optional upgrade", "Still considering", "Not included"],
          allowOther: false,
        },
        blocking,
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

  mergeSharedQuantities(doc, qs);

  // Free-text clarifications come last, and only when nothing above already
  // asks for the same thing and the scope does not already hold the answer.
  for (const oq of doc.openQuestions) {
    if (redundantClarification(oq, doc, qs)) continue;
    const about = words(oq, [MEASURE_WORDS, ACTION_WORDS]);
    const related = doc.tasks.filter((t) => !t.dismissed && overlap(subject(t.title).split(" ").filter(Boolean), about) === 1);
    add({
      key: `open:${textKey(oq)}`,
      context: related[0] ? taskContext(related[0]) : "Clarification",
      prompt: oq,
      help: "Answer if known. This does not hold up the estimate.",
      input: { type: "text", multiline: true },
      blocking: false,
      taskIds: related.slice(0, 1).map((t) => t.id),
      evidence: [],
    });
  }

  // Answers are applied to the scope itself, so a question exists exactly
  // while its gap exists. Nothing is hidden because it was answered before.
  // Order: the scope's own order (phase, division, room, task), with items
  // saved for later after everything else.
  return qs
    .sort(
      (a, b) =>
        Number(a.deferred) - Number(b.deferred) ||
        a.sort.division - b.sort.division ||
        a.sort.area.localeCompare(b.sort.area) ||
        a.sort.task - b.sort.task ||
        a.sort.kind - b.sort.kind,
    )
    .map((q) => {
      const out: Question & { sort?: Place } = { ...q };
      delete out.sort;
      return out;
    });
}

/**
 * Several tasks often need the same number (remove, install and paint the same
 * baseboards). When their quantity is missing, in the same unit, for the same
 * thing in the same room, it is asked once and the answer fills every task.
 */
function mergeSharedQuantities(doc: ScopeDoc, qs: (Question & { sort: Place })[]): void {
  const first = new Map<string, Question>();
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!q.key.startsWith("qty:") || q.input.type !== "number" || q.suggested !== null && q.suggested !== undefined) continue;
    const t = doc.tasks.find((x) => x.id === q.taskIds[0]);
    const about = t ? subject(t.title) : "";
    if (!t || !about) continue;
    const k = `${q.input.unit}|${norm(t.area)}|${about}`;
    const keeper = first.get(k);
    if (!keeper) {
      first.set(k, q);
      continue;
    }
    keeper.also = [...(keeper.also ?? []), q.key];
    keeper.taskIds = [...new Set([...keeper.taskIds, ...q.taskIds])];
    keeper.blocking = keeper.blocking || q.blocking;
    keeper.evidence = [...keeper.evidence, ...q.evidence];
    const names = keeper.taskIds.map((id) => doc.tasks.find((x) => x.id === id)?.title).filter(Boolean);
    keeper.help = `Enter the quantity in ${unitLabel(q.input.unit)}. One answer covers: ${names.join("; ")}.`;
    qs.splice(i--, 1);
  }
}

const ASKS_QUANTITY = /\bhow (many|much|long|big|large|wide|tall)\b|\b(length|footage|square feet|square foot|sq ?ft|linear feet|linear foot|area|size|quantity|number of|count|dimensions?|measurements?)\b/i;
const ASKS_CHOICE = /\b(which|what (type|kind|style|color|colour|finish|brand|material|model|species|grade|size))\b/i;

/**
 * A clarification is dropped when the scope already answers it or a structured
 * question already asks it: a quantity question about something that has a
 * measurement or quantity (known, or asked above), a "which one" question about
 * something with a selection, or a rewording of one that was answered earlier.
 */
export function redundantClarification(oq: string, doc: ScopeDoc, asked: Question[]): boolean {
  const all = words(oq);
  const about = words(oq, [MEASURE_WORDS, ACTION_WORDS]);
  if (!about.length) return false;
  const same = (text: string | null | undefined) => {
    const other = subject(text).split(" ").filter(Boolean);
    return other.length > 0 && overlap(other, about) === 1;
  };

  // Answered before: answers are kept as "<question> <answer>" assumptions.
  for (const a of doc.assumptions) {
    const cut = a.indexOf("?");
    if (cut === -1) continue;
    const prior = words(a.slice(0, cut + 1));
    const shared = prior.filter((w) => all.includes(w)).length;
    if (shared / Math.max(prior.length, all.length) >= 0.6) return true;
  }

  const live = doc.tasks.filter((t) => !t.dismissed);
  if (ASKS_QUANTITY.test(oq)) {
    if (doc.measurements.some((m) => same(m.label))) return true;
    if (live.some((t) => same(t.title) && (t.quantity || costBookEntry(t.costCode)))) return true;
  }
  if (ASKS_CHOICE.test(oq)) {
    if (live.some((t) => (t.selections ?? []).some((s) => same(s.label) || (same(t.title) && overlap(words(s.label), all) > 0)))) return true;
  }
  // The same thing asked twice in different words.
  return asked.some((q) => {
    if (!q.key.startsWith("open:")) return false;
    const prior = words(q.prompt);
    const shared = prior.filter((w) => all.includes(w)).length;
    return shared / Math.max(prior.length, all.length) >= 0.7;
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
    const unit = costBookEntry(t.costCode)?.uom || t.quantity?.unit || "EA";
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

function positive(a: Answer, what: string): number {
  const n = num(a);
  if (n <= 0) throw new Error(`Enter ${what} greater than zero, or save it for later.`);
  return n;
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
        quantity: {
          ...(t.quantity ?? {}),
          measurementId: null,
          value: num(answer),
          unit: ("unit" in answer && answer.unit) || t.quantity?.unit || null,
          factor: null,
          estimated: false,
        },
      }));
    case "price":
      return mapTask(doc, id, (t) => ({
        ...t,
        quote: { amount: positive(answer, "an amount"), assetId: "assetId" in answer ? (answer.assetId ?? null) : null },
      }));
    case "hours":
      return mapTask(doc, id, (t) => ({
        ...t,
        laborHours: { value: positive(answer, "hours"), basis: "confirmed", note: t.laborHours?.note ?? null },
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
        if (v === "Still considering") return { ...t, bucket: "considering", certainty: t.certainty === "conflict" ? "undecided" : t.certainty };
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
  // Every blocking pricing issue counts, whether or not a question can resolve
  // it, so the status can never read "ready" while a line is unpriced.
  const asked = new Set(questions.map((q) => q.key));
  const blockers = [
    ...questions.filter((q) => q.blocking).map((q) => `${q.context.split(" · ")[0]}: ${q.prompt}`),
    ...(pricing?.issues ?? []).filter((i) => i.blocking && !asked.has(i.key)).map((i) => i.message),
    ...extraBlockers,
  ];
  return { status: blockers.length ? "needs_information" : "ready", blocking: blockers.length, blockers };
}

