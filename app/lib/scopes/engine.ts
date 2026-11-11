/**
 * The scope platform's workflow, server side:
 *
 *   capture -> transcribe -> extract and reconcile -> scope version
 *           -> derived questions (wizard) -> pricing -> QuickBooks
 *
 * Every change to the scope (generation, accepted regeneration, an edit, a
 * wizard answer, a restore) writes a new immutable version with its pricing,
 * so the exact state behind any estimate can always be shown again.
 */

import { query } from "../db.ts";
import type { FinishTier } from "../../../lib/p5/priceBook.ts";
import { extractScope, transcribe, type SourceInput } from "./ai.ts";
import { supportingSuggestions } from "./checklist.ts";
import { costBookEntry } from "./costbook.ts";
import { classify, prepareForModel, readBytes } from "./files.ts";
import { applyAnswer, deriveQuestions, readiness, reconcileMeasurements, type AnswerState } from "./gaps.ts";
import { applyChanges, diffScopes, markEdited, type Proposal } from "./merge.ts";
import { carryForward, normalizeScope } from "./normalize.ts";
import { costBookAgeKey, priceScope } from "./pricing.ts";
import {
  assetStorage,
  claimProcessing,
  currentVersion,
  getProject,
  getVersion,
  globalAcknowledgements,
  listAnswers,
  listAssets,
  loadScopeSettings,
  logEvent,
  saveAnswer,
  saveVersion,
  setProjectState,
  updateAsset,
  updateProjectFields,
  type ProjectRow,
  type VersionRow,
} from "./store.ts";
import type { Answer, PricingResult, Question, ScopeDoc, ScopeSettings, ScopeTask } from "./types.ts";
import { emptyScope } from "./types.ts";

export type Computed = {
  doc: ScopeDoc;
  pricing: PricingResult;
  questions: Question[];
  readiness: ReturnType<typeof readiness>;
};

async function answerState(projectId: number): Promise<{ state: AnswerState; acknowledged: Set<string> }> {
  const rows = await listAnswers(projectId);
  const acknowledged = await globalAcknowledgements();
  for (const r of rows) {
    if (r.question_key === costBookAgeKey() && r.status === "answered" && (r.answer as { value?: unknown })?.value === true) acknowledged.add(r.question_key);
  }
  return { state: new Map(rows.map((r) => [r.question_key, { status: r.status }])), acknowledged };
}

export async function compute(project: ProjectRow, doc: ScopeDoc, settings?: ScopeSettings): Promise<Computed> {
  const s = settings ?? (await loadScopeSettings());
  const { state, acknowledged } = await answerState(project.id);
  const pricing = priceScope(doc, {
    service: project.service,
    finishTier: (project.finish_tier as FinishTier) || "mid",
    settings: s,
    acknowledged,
  });
  // A "Not yet" on the price-age question is a real answer but must keep asking.
  const age = state.get(costBookAgeKey());
  if (age && !acknowledged.has(costBookAgeKey())) state.delete(costBookAgeKey());
  const questions = deriveQuestions(doc, pricing, state);
  return { doc, pricing, questions, readiness: readiness(doc, pricing, questions) };
}

/** Normalize, add checklist suggestions, price and store a new version. */
export async function commitDoc(
  project: ProjectRow,
  input: ScopeDoc,
  source: string,
  note: string | null,
  userId: number | null,
  opts: { clearProposal?: boolean } = {},
): Promise<{ version: VersionRow; computed: Computed }> {
  let doc = reconcileMeasurements(input);
  doc = { ...doc, tasks: [...doc.tasks, ...supportingSuggestions(doc, project.service)] };
  const computed = await compute(project, doc);
  const version = await saveVersion({
    projectId: project.id,
    doc,
    pricing: computed.pricing,
    source,
    note,
    status: computed.readiness.status,
    userId,
    clearProposal: opts.clearProposal,
  });
  await prefillProject(project, doc);
  return { version, computed };
}

/** Reuse captured client details: fill empty project fields, never overwrite typed ones. */
async function prefillProject(p: ProjectRow, doc: ScopeDoc): Promise<void> {
  const c = doc.client ?? {};
  const fields: Record<string, string> = {};
  const fill = (col: keyof ProjectRow, v: string | null | undefined) => {
    if (v && !p[col]) fields[col] = v;
  };
  fill("client_first_name", c.firstName?.value);
  fill("client_last_name", c.lastName?.value);
  fill("client_email", c.email?.value);
  fill("client_phone", c.phone?.value);
  fill("project_address", c.projectAddress?.value);
  fill("billing_address", c.billingAddress?.value);
  fill("title", doc.projectName);
  if (Object.keys(fields).length) await updateProjectFields(p.id, fields);
}

export async function currentDoc(project: ProjectRow): Promise<{ version: VersionRow | null; doc: ScopeDoc }> {
  const version = await currentVersion(project);
  return { version, doc: version?.doc ?? emptyScope() };
}

// ---------------------------------------------------------------------------
// Processing new material
// ---------------------------------------------------------------------------

const TEXT_BUDGET = 400_000;

export async function processProject(projectId: number, userId: number): Promise<{ ok: boolean; message: string }> {
  if (!(await claimProcessing(projectId, "Transcribing recordings"))) {
    return { ok: false, message: "This project is already being processed. It will update when that finishes." };
  }
  try {
    const project = (await getProject(projectId))!;
    const assets = await listAssets(projectId);
    const failures: string[] = [];

    // 1. Transcribe audio that has not been transcribed yet.
    for (const a of assets) {
      const audio = a.kind === "recording" || (a.kind === "note" && a.mime_type && classify(a.file_name ?? "", a.mime_type) === "audio");
      if (!audio || a.state === "ready") continue;
      await updateAsset(a.id, { state: "transcribing", error: null });
      try {
        const store = await assetStorage(projectId, a.id);
        const data = await readBytes(store!);
        const t = await transcribe(data, a.file_name ?? "recording.webm", a.mime_type ?? "audio/webm");
        await updateAsset(a.id, { state: "ready", transcript: t, duration_seconds: t.duration ?? a.duration_seconds });
        a.state = "ready";
        a.transcript = t;
      } catch (error) {
        const message = (error as Error).message;
        await updateAsset(a.id, { state: "failed", error: message });
        failures.push(`${a.label || a.file_name}: ${message}`);
      }
    }

    // 2. Gather every usable source. Files the model has already read are not
    //    sent again (the current scope carries what they said); all text is.
    await setProjectState(projectId, { processing_state: "running", processing_note: "Building the scope" });
    const { version: current, doc: currentScope } = await currentDoc(project);
    const sources: SourceInput[] = [];
    let budget = TEXT_BUDGET;
    for (const a of await listAssets(projectId)) {
      const base = { assetId: a.id, kind: a.kind, label: a.label || a.file_name || a.kind, createdAt: new Date(a.created_at).toISOString() };
      if (a.transcript && a.state === "ready") {
        const size = a.transcript.text.length;
        if (size > budget && a.used_in_version) continue;
        budget -= size;
        sources.push({ ...base, transcript: { ...a.transcript, duration: a.duration_seconds, offset: a.offset_seconds } });
        continue;
      }
      if (a.kind === "text" && a.body_text) {
        sources.push({ ...base, bodyText: a.body_text });
        continue;
      }
      if (["document", "photo", "quote"].includes(a.kind) && !a.used_in_version) {
        const store = await assetStorage(projectId, a.id);
        try {
          const data = await readBytes(store!);
          sources.push({ ...base, prepared: await prepareForModel(a.file_name ?? "file", a.mime_type ?? "", data), bodyText: a.body_text });
        } catch (error) {
          failures.push(`${a.label || a.file_name}: ${(error as Error).message}`);
        }
      }
    }
    if (!sources.length) {
      return { ok: false, message: failures.length ? `Nothing could be read. ${failures.join(" ")}` : "Add a recording, note or file first." };
    }

    const settings = await loadScopeSettings();
    const customerRecords = await query<{ display_name: string; raw: Record<string, unknown> }>(
      `SELECT display_name, raw FROM qbo_customer
        WHERE active AND ($1 <> '' AND display_name ILIKE '%' || $1 || '%' OR $2 <> '' AND raw->'BillAddr'->>'Line1' ILIKE $2 || '%')
        LIMIT 5`,
      [project.client_last_name ?? "", (project.project_address ?? "").split(",")[0].trim()],
    ).catch(() => []);

    const raw = await extractScope({
      project: {
        title: project.title,
        service: project.service,
        finishTier: project.finish_tier,
        client: {
          firstName: project.client_first_name,
          lastName: project.client_last_name,
          email: project.client_email,
          phone: project.client_phone,
          projectAddress: project.project_address,
          billingAddress: project.billing_address,
        },
      },
      current: current ? currentScope : null,
      sources,
      customerRecords: customerRecords.map((c) => `${c.display_name} ${JSON.stringify({ email: (c.raw as { PrimaryEmailAddr?: { Address?: string } }).PrimaryEmailAddr?.Address, address: (c.raw as { BillAddr?: unknown }).BillAddr })}`),
      productionRateCodes: Object.keys(settings.productionRates),
    });
    const generated = carryForward(
      current ? currentScope : null,
      normalizeScope(raw, { assetIds: assets.map((a) => a.id), validCostCode: (c) => Boolean(costBookEntry(c)) }),
    );

    let message: string;
    let versionId: number;
    if (!current) {
      const { version, computed } = await commitDoc(project, generated, "generated", "First scope from the project material", userId);
      versionId = version.id;
      message = computed.questions.some((q) => q.blocking)
        ? `Scope ready for review. ${computed.questions.filter((q) => q.blocking).length} detail(s) still needed.`
        : "Scope ready for review. Nothing else is needed.";
    } else {
      const changes = diffScopes(currentScope, generated);
      versionId = current.id;
      if (!changes.some((c) => !c.informational)) {
        await setProjectState(projectId, { pending_proposal: changes.length ? { changes, generated, createdAt: new Date().toISOString() } : null });
        message = changes.length ? "No changes to apply. Some differences were noted for review." : "The new material did not change the scope.";
      } else {
        const proposal: Proposal = { changes, generated, createdAt: new Date().toISOString() };
        await setProjectState(projectId, { pending_proposal: proposal });
        message = `${changes.filter((c) => !c.informational).length} proposed change(s) to review.`;
      }
    }
    for (const s of sources) await updateAsset(s.assetId, { used_in_version: versionId });
    await logEvent(projectId, "processed", { sources: sources.length, failures }, userId);
    return { ok: true, message: failures.length ? `${message} Could not read: ${failures.join(" ")}` : message };
  } catch (error) {
    await logEvent(projectId, "process-failed", { error: (error as Error).message }, userId).catch(() => undefined);
    return { ok: false, message: (error as Error).message };
  } finally {
    await setProjectState(projectId, { processing_state: "idle", processing_note: null });
  }
}

// ---------------------------------------------------------------------------
// Employee actions
// ---------------------------------------------------------------------------

export async function acceptProposal(projectId: number, acceptedIds: string[], userId: number): Promise<VersionRow> {
  const project = (await getProject(projectId))!;
  if (!project.pending_proposal) throw new Error("There are no proposed changes.");
  const { doc } = await currentDoc(project);
  const next = applyChanges(doc, project.pending_proposal, acceptedIds);
  const { version } = await commitDoc(project, next, "regenerated", `Accepted ${acceptedIds.length} proposed change(s)`, userId, { clearProposal: true });
  await logEvent(projectId, "proposal-accepted", { accepted: acceptedIds.length, of: project.pending_proposal.changes.length }, userId);
  return version;
}

export async function rejectProposal(projectId: number, userId: number): Promise<void> {
  await setProjectState(projectId, { pending_proposal: null });
  await logEvent(projectId, "proposal-rejected", null, userId);
}

export type EditOp =
  | { op: "task"; task: ScopeTask }
  | { op: "remove-task"; id: string }
  | { op: "restore-task"; id: string }
  | { op: "measurement"; id: string; value: number | null; unit?: string; label?: string }
  | { op: "list"; field: "goals" | "priorities" | "areas" | "siteConditions" | "access" | "schedule" | "inclusions" | "exclusions" | "assumptions" | "openQuestions"; values: string[] }
  | { op: "summary"; value: string }
  | { op: "restore-version"; versionId: number };

export async function editScope(projectId: number, ops: EditOp[], userId: number): Promise<VersionRow> {
  const project = (await getProject(projectId))!;
  let { doc } = await currentDoc(project);
  let note = "Edited by hand";
  for (const o of ops) {
    switch (o.op) {
      case "task": {
        const before = doc.tasks.find((t) => t.id === o.task.id);
        const task = markEdited(before, { ...o.task, evidence: o.task.evidence ?? before?.evidence ?? [] });
        doc = { ...doc, tasks: before ? doc.tasks.map((t) => (t.id === task.id ? task : t)) : [...doc.tasks, { ...task, origin: "manual" }] };
        break;
      }
      case "remove-task":
        doc = { ...doc, tasks: doc.tasks.map((t) => (t.id === o.id ? { ...t, dismissed: true, edited: [...new Set([...(t.edited ?? []), "dismissed"])] } : t)) };
        break;
      case "restore-task":
        doc = { ...doc, tasks: doc.tasks.map((t) => (t.id === o.id ? { ...t, dismissed: false, certainty: t.certainty === "suggested" ? "confirmed" : t.certainty } : t)) };
        break;
      case "measurement":
        doc = {
          ...doc,
          measurements: doc.measurements.map((m) =>
            m.id === o.id ? { ...m, value: o.value, unit: o.unit ?? m.unit, label: o.label ?? m.label, status: o.value === null ? "missing" : "confirmed" } : m,
          ),
        };
        break;
      case "list":
        doc = { ...doc, [o.field]: o.values.map((v) => v.trim()).filter(Boolean) };
        break;
      case "summary":
        doc = { ...doc, summary: o.value };
        break;
      case "restore-version": {
        const v = await getVersion(projectId, o.versionId);
        if (!v) throw new Error("That version was not found.");
        doc = v.doc;
        note = `Restored version ${v.version_no}`;
        break;
      }
    }
  }
  const { version } = await commitDoc(project, doc, ops.some((o) => o.op === "restore-version") ? "restored" : "edited", note, userId);
  return version;
}

export async function answerQuestion(input: {
  projectId: number;
  key: string;
  answer: Answer | null;
  defer: boolean;
  assetId: number | null;
  userId: number;
  prompt?: string;
}): Promise<void> {
  const project = (await getProject(input.projectId))!;
  if (input.defer) {
    await saveAnswer(input.projectId, input.key, "deferred", null, null, input.userId);
    return;
  }
  if (!input.answer) throw new Error("Enter an answer, or save it for later.");
  await saveAnswer(input.projectId, input.key, "answered", input.answer, input.assetId, input.userId);
  if (input.key.startsWith("price-age:")) {
    // A one-time acknowledgement; re-price so status updates.
    const { doc } = await currentDoc(project);
    await commitDoc(project, doc, "answer", "Cost book prices confirmed current", input.userId);
    return;
  }
  const { doc } = await currentDoc(project);
  const next = applyAnswer(doc, input.key, input.answer);
  await commitDoc(project, next, "answer", input.prompt ? `Answered: ${input.prompt}` : `Answered ${input.key}`, input.userId);
}

/** Re-price after a settings change, a tier or service change. No-op when nothing moved. */
export async function reprice(projectId: number, userId: number, note: string): Promise<void> {
  const project = (await getProject(projectId))!;
  const { version, doc } = await currentDoc(project);
  if (!version) return;
  const computed = await compute(project, doc);
  if (JSON.stringify(computed.pricing) === JSON.stringify(version.pricing)) {
    if (computed.readiness.status !== project.scope_status) await setProjectState(projectId, { scope_status: computed.readiness.status });
    return;
  }
  await commitDoc(project, doc, "repriced", note, userId);
}
