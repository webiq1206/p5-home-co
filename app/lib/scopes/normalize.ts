/**
 * Make a model's scope output safe to store. Pure.
 *
 * The model is told the rules; this enforces them regardless: only real
 * divisions and cost book codes, only evidence pointing at this project's
 * files, unique ids, finite numbers, and no measurement claiming to be
 * firmer than its source allows (a value with no evidence is an estimate).
 */

import { defaultPhase, isDivision } from "./divisions.ts";
import type {
  Bucket,
  Certainty,
  ClientField,
  Conflict,
  Evidence,
  Measurement,
  MeasureStatus,
  Performer,
  ScopeDoc,
  ScopeTask,
  Selection,
} from "./types.ts";

const CERTAINTY: Certainty[] = ["confirmed", "suggested", "assumed", "conflict", "undecided"];
const BUCKETS: Bucket[] = ["approved", "optional", "considering", "future"];
const MSTATUS: MeasureStatus[] = ["documented", "confirmed", "stated", "estimated", "missing"];
const PERFORMERS: Performer[] = ["internal", "subcontractor", "supplier"];

type Any = Record<string, unknown>;

const s = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const sn = (v: unknown, max = 4000): string | null => s(v, max) || null;
const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => [...new Set(arr(v).map((x) => s(x, 1000)).filter(Boolean))];
const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const UNIT_ALIASES: Record<string, string> = {
  FT: "LF", FEET: "LF", "LIN FT": "LF", "LINEAR FEET": "LF", "LINEAR FT": "LF",
  SQFT: "SF", "SQ FT": "SF", "SQUARE FEET": "SF", "SQ. FT.": "SF",
  EACH: "EA", HRS: "HR", HOURS: "HR", HOUR: "HR", DAYS: "DAY", MONTHS: "MO", MONTH: "MO",
  SQUARE: "SQ", SQUARES: "SQ", YD: "CY", "CU YD": "CY", TONS: "TON",
};

/** Units as the cost book spells them, so a quantity can be matched to a rate. */
export function unit(v: unknown, fallback = "EA"): string {
  const u = s(v, 16).toUpperCase().replace(/\.$/, "");
  return UNIT_ALIASES[u] ?? (u || fallback);
}

export function slug(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "item";
}

function evidence(v: unknown, assetIds: Set<number>): Evidence[] {
  return arr(v)
    .map((e) => e as Any)
    .map((e) => ({
      assetId: Number(e.assetId),
      t: n(e.t),
      page: n(e.page),
      quote: sn(e.quote, 300),
    }))
    .filter((e) => assetIds.has(e.assetId));
}

function uniqueId(base: string, used: Set<string>): string {
  let id = slug(base);
  let i = 2;
  while (used.has(id)) id = `${slug(base)}-${i++}`;
  used.add(id);
  return id;
}

export function normalizeScope(
  raw: unknown,
  opts: { assetIds: number[]; validCostCode: (code: string) => boolean },
): ScopeDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Any;
  const assetIds = new Set(opts.assetIds);

  const usedM = new Set<string>();
  const mIdMap = new Map<string, string>();
  const measurements: Measurement[] = arr(r.measurements).map((x) => {
    const m = x as Any;
    const label = s(m.label, 200) || "Measurement";
    const original = s(m.id, 80) || label;
    const id = uniqueId(original, usedM);
    mIdMap.set(original, id);
    const value = n(m.value);
    const ev = evidence(m.evidence, assetIds);
    let status = pick(m.status, MSTATUS, "estimated");
    // Only an employee confirms. A value nobody can point to is an estimate.
    if (status === "confirmed") status = ev.length ? "documented" : "estimated";
    if (value === null) status = "missing";
    else if (status === "missing") status = "estimated";
    else if ((status === "documented" || status === "stated") && ev.length === 0) status = "estimated";
    return { id, label, area: sn(m.area, 120), value: value !== null && value >= 0 ? value : null, unit: unit(m.unit), status, evidence: ev };
  });

  const usedT = new Set<string>();
  const tIdMap = new Map<string, string>();
  const tasks: ScopeTask[] = arr(r.tasks).map((x) => {
    const t = x as Any;
    const title = s(t.title, 200) || "Task";
    const original = s(t.id, 80) || title;
    const id = uniqueId(original, usedT);
    tIdMap.set(original, id);
    const code = s(t.costCode, 20).replace(/^PB-/, "");
    const costCode = code && opts.validCostCode(code) ? code : null;
    let division = s(t.division, 2).padStart(2, "0");
    if (!isDivision(division)) division = costCode ? costCode.slice(0, 2) : "01";
    const phase = t.phase === "pre-construction" || t.phase === "construction" ? t.phase : defaultPhase(division);
    const q = (t.quantity ?? null) as Any | null;
    const mid = q ? s(q.measurementId, 80) : "";
    const lh = (t.laborHours ?? null) as Any | null;
    const lhValue = lh ? n(lh.value) : null;
    const selections: Selection[] = arr(t.selections).map((y, i) => {
      const sel = y as Any;
      const options = strs(sel.options).slice(0, 12);
      const chosen = sn(sel.chosen, 300);
      return {
        id: slug(s(sel.id, 60) || s(sel.label, 60) || `selection-${i + 1}`),
        label: s(sel.label, 200) || "Selection",
        options,
        chosen,
        evidence: evidence(sel.evidence, assetIds),
      };
    });
    const certainty = pick(t.certainty, CERTAINTY, "assumed");
    return {
      id,
      title,
      description: s(t.description, 2000) || title,
      area: sn(t.area, 120),
      phase,
      division,
      bucket: pick(t.bucket, BUCKETS, "approved"),
      certainty,
      supporting: t.supporting === true,
      costCode,
      quantity: q
        ? {
            measurementId: mid || null,
            value: n(q.value),
            unit: sn(q.unit, 16) ? unit(q.unit) : null,
            factor: n(q.factor),
            estimated: q.estimated === true,
          }
        : null,
      performer: pick(t.performer, PERFORMERS, "subcontractor"),
      laborHours: lh
        ? { value: lhValue !== null && lhValue >= 0 ? lhValue : null, basis: lh.basis === "stated" ? "stated" : "proposed", note: sn(lh.note, 300) }
        : null,
      materials: strs(t.materials).slice(0, 30),
      selections,
      notes: sn(t.notes, 2000),
      evidence: evidence(t.evidence, assetIds),
      origin: "generated",
    } satisfies ScopeTask;
  });
  for (const t of tasks) {
    if (t.quantity?.measurementId) t.quantity.measurementId = mIdMap.get(t.quantity.measurementId) ?? (usedM.has(t.quantity.measurementId) ? t.quantity.measurementId : null);
    if (t.quote) delete t.quote;
  }

  const conflicts: Conflict[] = arr(r.conflicts).map((x, i) => {
    const c = x as Any;
    return {
      id: slug(s(c.id, 60) || s(c.topic, 60) || `conflict-${i + 1}`),
      topic: s(c.topic, 300) || "Conflicting information",
      statements: arr(c.statements)
        .map((y) => y as Any)
        .map((y) => ({ text: s(y.text, 500), evidence: evidence(y.evidence, assetIds) }))
        .filter((y) => y.text),
      taskIds: strs(c.taskIds).map((id) => tIdMap.get(id) ?? id).filter((id) => usedT.has(id)),
      resolution: null,
    };
  }).filter((c) => c.statements.length >= 2);

  const clientRaw = (r.client ?? {}) as Any;
  const client: ScopeDoc["client"] = {};
  for (const k of ["firstName", "lastName", "email", "phone", "projectAddress", "billingAddress"] as const) {
    const f = clientRaw[k] as Any | undefined;
    const value = f ? sn(f.value, 300) : null;
    if (value) client[k] = { value, certainty: pick(f!.certainty, CERTAINTY, "assumed"), evidence: evidence(f!.evidence, assetIds) } as ClientField;
  }

  return {
    projectName: sn(r.projectName, 200),
    summary: s(r.summary, 4000),
    client,
    goals: strs(r.goals),
    priorities: strs(r.priorities),
    areas: strs(r.areas),
    measurements,
    tasks,
    siteConditions: strs(r.siteConditions),
    access: strs(r.access),
    schedule: strs(r.schedule),
    inclusions: strs(r.inclusions),
    exclusions: strs(r.exclusions),
    assumptions: strs(r.assumptions),
    openQuestions: strs(r.openQuestions),
    conflicts,
  };
}

/**
 * Carry forward what the model must not drop: quotes, allowances, dismissed
 * flags, edit markers and origins on tasks it kept, plus confirmed
 * measurement values. Answers and human decisions live on the current scope,
 * not in any source file, so the model cannot be expected to repeat them.
 */
export function carryForward(current: ScopeDoc | null, generated: ScopeDoc): ScopeDoc {
  if (!current) return generated;
  const cur = new Map(current.tasks.map((t) => [t.id, t]));
  return {
    ...generated,
    tasks: generated.tasks.map((g) => {
      const c = cur.get(g.id);
      if (!c) return g;
      return {
        ...g,
        quote: c.quote ?? null,
        allowance: c.allowance ?? null,
        dismissed: c.dismissed,
        edited: c.edited,
        origin: c.origin ?? g.origin,
        supporting: c.supporting || g.supporting,
        laborHours: c.laborHours?.basis === "confirmed" ? c.laborHours : g.laborHours,
        certainty: c.certainty === "confirmed" && g.certainty === "suggested" ? "confirmed" : g.certainty,
      };
    }),
    conflicts: generated.conflicts.map((g) => current.conflicts.find((c) => c.id === g.id)?.resolution ? { ...g, resolution: current.conflicts.find((c) => c.id === g.id)!.resolution } : g),
    client: { ...(generated.client ?? {}) },
  };
}

/**
 * A task as sent by the editor, made safe to store. Unknown codes and
 * divisions are corrected, numbers must be finite and non-negative, and
 * everything the editor does not own (quotes, allowances, evidence, edit
 * markers) is carried from the stored task rather than trusted from the client.
 */
export function sanitizeTask(
  raw: unknown,
  before: ScopeTask | undefined,
  validCostCode: (code: string) => boolean,
  measurementIds: Set<string>,
): ScopeTask {
  const t = (raw && typeof raw === "object" ? raw : {}) as Any;
  const title = s(t.title, 200);
  if (!title) throw new Error("A task needs a name.");
  const id = before?.id ?? (slug(s(t.id, 60)) || `manual-${Date.now().toString(36)}`);
  const code = s(t.costCode, 20).replace(/^PB-/i, "");
  if (code && !validCostCode(code)) throw new Error(`"${code}" is not a cost book code. Leave it blank to enter a quote or hours.`);
  let division = s(t.division, 2).padStart(2, "0");
  if (!isDivision(division)) division = code ? code.slice(0, 2) : (before?.division ?? "01");
  const q = (t.quantity ?? null) as Any | null;
  const qValue = q ? n(q.value) : null;
  if (qValue !== null && qValue < 0) throw new Error("Quantity cannot be negative.");
  const mid = q ? s(q.measurementId, 80) : "";
  const lh = (t.laborHours ?? null) as Any | null;
  const lhValue = lh ? n(lh.value) : null;
  if (lhValue !== null && lhValue < 0) throw new Error("Hours cannot be negative.");
  const basis = lh && ["production-rate", "stated", "proposed", "confirmed"].includes(String(lh.basis)) ? (lh.basis as "stated") : "confirmed";
  const beforeSel = new Map((before?.selections ?? []).map((x) => [x.id, x]));
  return {
    id,
    title,
    description: s(t.description, 2000) || title,
    area: sn(t.area, 120),
    phase: t.phase === "pre-construction" || t.phase === "construction" ? t.phase : defaultPhase(division),
    division,
    bucket: pick(t.bucket, BUCKETS, before?.bucket ?? "approved"),
    certainty: pick(t.certainty, CERTAINTY, before?.certainty ?? "confirmed"),
    supporting: before?.supporting,
    costCode: code || null,
    quantity: q
      ? {
          measurementId: mid && measurementIds.has(mid) ? mid : null,
          value: qValue,
          unit: sn(q.unit, 16) ? unit(q.unit) : null,
          factor: n(q.factor),
          estimated: q.estimated === true,
        }
      : null,
    performer: pick(t.performer, PERFORMERS, before?.performer ?? "subcontractor"),
    laborHours: lh ? { value: lhValue, basis, note: sn(lh.note, 300) } : null,
    materials: strs(t.materials).slice(0, 30),
    selections: arr(t.selections).map((y, i) => {
      const sel = y as Any;
      const sid = slug(s(sel.id, 60) || `selection-${i + 1}`);
      return { id: sid, label: s(sel.label, 200) || "Selection", options: strs(sel.options).slice(0, 12), chosen: sn(sel.chosen, 300), evidence: beforeSel.get(sid)?.evidence ?? [] };
    }),
    notes: sn(t.notes, 2000),
    quote: before?.quote ?? null,
    allowance: before?.allowance ?? null,
    dismissed: before ? before.dismissed : false,
    evidence: before?.evidence ?? [],
    edited: before?.edited,
    origin: before?.origin ?? "manual",
  };
}
