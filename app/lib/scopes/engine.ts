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

import { query, queryOne } from "../db.ts";
import type { FinancePolicy } from "../../../lib/p5/pricing.ts";
import type { FinishTier } from "../../../lib/p5/priceBook.ts";
import { extractScope, transcribe, type SourceInput } from "./ai.ts";
import { supportingSuggestions } from "./checklist.ts";
import { costBookEntry } from "./costbook.ts";
import { classify, prepareForModel, readBytes } from "./files.ts";
import { applyAnswer, deriveQuestions, readiness, reconcileMeasurements, type AnswerState } from "./gaps.ts";
import { applyChanges, diffScopes, markEdited, type Proposal } from "./merge.ts";
import { carryForward, normalizeScope, sanitizeTask } from "./normalize.ts";
import { costBookAgeKey, priceScope } from "./pricing.ts";
import { pdfPageCount, readSheets, readsPageByPage, sheetNotes } from "./sheets.ts";
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
import { canonical, emptyScope } from "./types.ts";

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

/** The finance policy the estimator has saved, if any; the approved default otherwise. */
export async function savedFinance(): Promise<FinancePolicy | undefined> {
  const row = await queryOne<{ finance: FinancePolicy | null }>(
    "SELECT payload->'finance' AS finance FROM p5_estimator_policy WHERE id = 'current'",
  ).catch(() => null);
  const f = row?.finance;
  return f && typeof f.annualOverhead === "number" ? f : undefined;
}

export async function compute(project: ProjectRow, doc: ScopeDoc, settings?: ScopeSettings): Promise<Computed> {
  const s = settings ?? (await loadScopeSettings());
  const { state, acknowledged } = await answerState(project.id);
  const pricing = priceScope(doc, {
    finance: await savedFinance(),
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
const MAX_IMAGES = 30;

/** How long one request spends reading pages before handing back so the next request can continue. */
const SHEET_BUDGET_MS = 200_000;

export async function processProject(projectId: number, userId: number): Promise<{ ok: boolean; message: string; partial?: boolean }> {
  const started = Date.now();
  if (!(await claimProcessing(projectId, "Transcribing recordings"))) {
    return { ok: false, message: "This project is already being processed. It will update when that finishes." };
  }
  try {
    const project = (await getProject(projectId))!;
    const assets = await listAssets(projectId);
    const failures: string[] = [];

    // 1. Transcribe audio that has not been transcribed yet, three parts at a time.
    const pendingAudio = assets.filter((a) => {
      const audio = a.kind === "recording" || (a.kind === "note" && classify(a.file_name ?? "", a.mime_type ?? "") === "audio");
      return audio && a.state !== "ready";
    });
    const transcribeOne = async (a: (typeof assets)[number]) => {
      await updateAsset(a.id, { state: "transcribing", error: null });
      try {
        const store = await assetStorage(projectId, a.id);
        const data = await readBytes(store!);
        const t = await transcribe(data, a.file_name ?? "recording.webm", a.mime_type ?? "audio/webm", a.duration_seconds === null ? null : Number(a.duration_seconds));
        await updateAsset(a.id, { state: "ready", transcript: t, duration_seconds: t.duration ?? a.duration_seconds });
      } catch (error) {
        const message = (error as Error).message;
        await updateAsset(a.id, { state: "failed", error: message });
        failures.push(`${a.label || a.file_name}: ${message}`);
      }
    };
    for (let i = 0; i < pendingAudio.length; i += 3) await Promise.all(pendingAudio.slice(i, i + 3).map(transcribeOne));

    // 2. Gather every usable source. Files the model has already read are not
    //    sent again (the current scope carries what they said); all text is.
    await setProjectState(projectId, { processing_state: "running", processing_note: "Building the scope" });
    const { version: current, doc: currentScope } = await currentDoc(project);
    const sources: SourceInput[] = [];
    const unfinished: string[] = [];
    let stalled = 0;
    let budget = TEXT_BUDGET;
    let images = 0;
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
          // A long PDF (a plan set, a specification, a long scope of work) is read page by page.
          if (classify(a.file_name ?? "", a.mime_type ?? "") === "pdf") {
            const pages = await pdfPageCount(data).catch(() => 0);
            if (pages && readsPageByPage(pages, data.length)) {
              const name = a.label || a.file_name || "document";
              const progress = await readSheets({
                assetId: a.id,
                fileName: name,
                data,
                deadline: started + SHEET_BUDGET_MS,
                onProgress: (p) => setProjectState(projectId, { processing_state: "running", processing_note: `Reading page ${Math.min(p.read + 1, p.total)} of ${p.total} of ${name}` }),
              });
              if (!progress.complete) {
                unfinished.push(
                  progress.failed && Date.now() <= started + SHEET_BUDGET_MS
                    ? `${name}: ${progress.failed} of ${progress.total} pages could not be read yet.`
                    : `${name}: ${progress.read} of ${progress.total} pages read so far.`,
                );
                if (progress.failed) stalled += progress.failed;
                continue;
              }
              sources.push({ ...base, prepared: { kind: "text", text: `SHEET NOTES for ${name} (${progress.total} pages, read page by page)\n\n${await sheetNotes(a.id)}` }, bodyText: a.body_text });
              continue;
            }
          }
          const prepared = await prepareForModel(a.file_name ?? "file", a.mime_type ?? "", data);
          if (prepared.kind === "image" && ++images > MAX_IMAGES) {
            failures.push(`${a.label || a.file_name}: more than ${MAX_IMAGES} photos in one update; run Update scope again to read the rest.`);
            continue;
          }
          if (prepared.kind === "none") failures.push(prepared.reason);
          sources.push({ ...base, prepared, bodyText: a.body_text });
        } catch (error) {
          failures.push(`${a.label || a.file_name}: ${(error as Error).message}`);
        }
      }
    }
    // A long document is still being read: stop here and continue on the next
    // call, so the scope is only built from documents read in full.
    if (unfinished.length) {
      const stuck = stalled > 0 && Date.now() <= started + SHEET_BUDGET_MS;
      return { ok: true, partial: !stuck, message: `${unfinished.join(" ")}${stuck ? " Tap Update scope to try those pages again." : " Still reading."}` };
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

    const extractInput = {
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
    };
    let raw: unknown;
    try {
      raw = await extractScope(extractInput);
    } catch (error) {
      // A PDF the model cannot open (too many pages, scanned at huge size) must
      // not sink the whole scope: retry once with PDFs as extracted text only.
      if (!sources.some((x) => x.prepared?.kind === "pdf")) throw error;
      raw = await extractScope({
        ...extractInput,
        sources: sources.map((x) => (x.prepared?.kind === "pdf" ? { ...x, prepared: { kind: "text" as const, text: x.prepared.text || "(no readable text in this PDF)" } } : x)),
      });
      failures.push(`PDFs were read as text only (${(error as Error).message.slice(0, 120)})`);
    }
    const generated = carryForward(
      current ? currentScope : null,
      normalizeScope(raw, { assetIds: assets.map((a) => a.id), validCostCode: (c) => Boolean(costBookEntry(c)) }),
    );

    let message: string;
    const sourceIds = sources.map((x) => x.assetId);
    const markUsed = async (versionId: number) => {
      for (const id of sourceIds) await updateAsset(id, { used_in_version: versionId });
    };
    if (!current) {
      const { version, computed } = await commitDoc(project, generated, "generated", "First scope from the project material", userId);
      await markUsed(version.id);
      const need = computed.questions.filter((q) => q.blocking).length;
      message = need ? `Scope ready for review. ${need} detail(s) still needed.` : "Scope ready for review. Nothing else is needed.";
    } else {
      const changes = diffScopes(currentScope, generated);
      const applicable = changes.filter((c) => !c.informational).length;
      if (!changes.length) {
        await setProjectState(projectId, { pending_proposal: null });
        await markUsed(current.id);
        message = "The new material did not change the scope.";
      } else {
        // Files stay "not yet in the scope" until the proposal is accepted or dismissed.
        const proposal: Proposal = { changes, generated, createdAt: new Date().toISOString(), sourceIds };
        await setProjectState(projectId, { pending_proposal: proposal });
        message = applicable ? `${applicable} proposed change(s) to review.` : "No changes to apply. Some differences were noted for review.";
      }
    }
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
  for (const id of project.pending_proposal.sourceIds ?? []) await updateAsset(id, { used_in_version: version.id });
  await logEvent(projectId, "proposal-accepted", { accepted: acceptedIds.length, of: project.pending_proposal.changes.length }, userId);
  return version;
}

export async function rejectProposal(projectId: number, userId: number): Promise<void> {
  const project = (await getProject(projectId))!;
  if (project.pending_proposal && project.current_version_id) {
    for (const id of project.pending_proposal.sourceIds ?? []) await updateAsset(id, { used_in_version: project.current_version_id });
  }
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
        const clean = sanitizeTask(o.task, before, (c) => Boolean(costBookEntry(c)), new Set(doc.measurements.map((m) => m.id)));
        const task = markEdited(before, clean);
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
    // A one-time acknowledgement, not a scope change. "Not yet" keeps it open.
    if ("value" in input.answer && input.answer.value === true) await reprice(input.projectId, input.userId, "Cost book prices confirmed current");
    return;
  }
  const { doc } = await currentDoc(project);
  // One answer can settle the same quantity on several tasks.
  const also = (await compute(project, doc)).questions.find((q) => q.key === input.key)?.also ?? [];
  let next = applyAnswer(doc, input.key, input.answer);
  for (const key of also) next = applyAnswer(next, key, input.answer);
  await commitDoc(project, next, "answer", input.prompt ? `Answered: ${input.prompt}` : `Answered ${input.key}`, input.userId);
}

/** Re-price after a settings change, a tier or service change. No-op when nothing moved. */
export async function reprice(projectId: number, userId: number, note: string): Promise<void> {
  const project = (await getProject(projectId))!;
  const { version, doc } = await currentDoc(project);
  if (!version) return;
  const computed = await compute(project, doc);
  if (canonical(computed.pricing) === canonical(version.pricing)) {
    if (computed.readiness.status !== project.scope_status) await setProjectState(projectId, { scope_status: computed.readiness.status });
    return;
  }
  await commitDoc(project, doc, "repriced", note, userId);
}
