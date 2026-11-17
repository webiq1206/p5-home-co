/**
 * Stage alignment between QuickBooks estimates, the P5 lead and HubSpot
 * (owner decision, 17 November 2026): "when one action happens in another,
 * both locations need to update."
 *
 * P5 already keeps the lead stage and the HubSpot deal stage in step, both
 * ways. This module adds QuickBooks, with the lead as the hinge:
 *
 *   QuickBooks estimate status  <->  P5 lead stage  <->  HubSpot deal stage
 *
 *   A. An estimate changes in QuickBooks  ->  the lead's stage follows, and
 *      the existing HubSpot sync carries it on.
 *   B. Every invoice on the estimate is paid  ->  the HubSpot deal moves to
 *      the team's "Job Complete" stage. P5 has no such stage; the lead stays
 *      Closed Won.
 *   C. A lead is closed (in HubSpot or in the P5 admin)  ->  its open
 *      QuickBooks estimate is marked accepted (won) or rejected (lost).
 *
 * QuickBooks is the accounting record, so the rules are narrow:
 *   - Only estimates that came from the websites are linked to a lead
 *     (`guided_estimate.lead_deal_id`). Anything else is left alone.
 *   - An estimate the website created by itself moves nothing: a brand new
 *     lead stays "New Lead" until a person works the estimate.
 *   - An open stage only moves forward. A won lead is never moved. A lead
 *     closed because it was deleted or merged stays closed.
 *   - Before any QuickBooks write the estimate is read live, and only an
 *     estimate that is still open (unsent, or sent and unanswered) is written.
 *   - Won with more than one open estimate writes nothing: a person chooses.
 *   - A lead that is reopened never changes QuickBooks.
 *
 * `STAGE_ALIGNMENT=off` turns all of it off. `STAGE_ALIGNMENT_QUICKBOOKS_WRITE=off`
 * turns off only the writes to QuickBooks (rule C). Every step is on the
 * lead's audit trail and the scope project's event log. Nothing here throws
 * into its caller.
 */
import { query, queryOne, transaction } from "../db.ts";
import { MERGED_IN_HUBSPOT, REMOVED_IN_HUBSPOT } from "../integrations/hubspot-removed.ts";
import { REMOVED_IN_QUICKBOOKS } from "./removed-everywhere.ts";
import { DEAL_STAGES, type DealStage } from "./types.ts";

const NO_EMPLOYEE = null as unknown as number;

/** Why a lead was closed when its estimate was declined in QuickBooks. */
export const DECLINED_IN_QUICKBOOKS = "Estimate declined in QuickBooks";
/** The stage the team added in HubSpot for finished, fully paid work. Matched by label. */
export const JOB_COMPLETE_LABEL = "Job Complete";

const off = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "off";

export function stageAlignmentEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !off(env.STAGE_ALIGNMENT);
}

/** Rule C only: may a closed lead change an estimate in QuickBooks? */
export function quickBooksStageWriteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return stageAlignmentEnabled(env) && !off(env.STAGE_ALIGNMENT_QUICKBOOKS_WRITE);
}

/** Closed because the record was deleted or merged somewhere. Those leads stay closed, and the deletion logic owns their estimates. */
export function isRemovalReason(reason: string | null | undefined): boolean {
  const value = (reason ?? "").trim();
  return value === REMOVED_IN_HUBSPOT || value === MERGED_IN_HUBSPOT || value === REMOVED_IN_QUICKBOOKS;
}

// ---------------------------------------------------------------------------
// Pure rules (unit tested without a database)
// ---------------------------------------------------------------------------

/** Estimate states that are still only a proposal waiting for an answer. */
const OPEN_ESTIMATE = new Set(["created_unsent", "sent"]);
/** Estimate states that mean the customer said yes. */
const WON_ESTIMATE = new Set(["accepted", "converted", "paid"]);

/**
 * Has a person worked this estimate? The website creates the QuickBooks
 * estimate the moment a visitor finishes, before anyone has looked at the
 * lead, and that must not move the lead out of "New Lead". A person has
 * worked it when a staff member created it from the scope platform
 * (`scope_estimate.created_by`), or when it has been saved again since it was
 * created: QuickBooks starts every record at SyncToken "0" and adds one on
 * every save, whether the save came from a staff revision here or from an
 * edit in QuickBooks. An unreadable token counts as not worked.
 */
export function estimateWorked(raw: { SyncToken?: unknown } | null | undefined, createdBy: number | string | null | undefined): boolean {
  if (createdBy !== null && createdBy !== undefined && String(createdBy) !== "") return true;
  const token = raw?.SyncToken;
  if (typeof token !== "string" && typeof token !== "number") return false;
  const text = String(token).trim();
  return /^\d+$/.test(text) && Number(text) > 0;
}

/** The lead stage an estimate status asks for, before the lead's own state is considered. */
export function stageForEstimate(status: string, worked: boolean): DealStage | null {
  switch (status) {
    case "created_unsent":
      return worked ? "Estimate in Progress" : null;
    case "sent":
      return "Estimate Sent";
    case "accepted":
    case "converted":
    case "paid":
      return "Closed Won";
    case "declined":
      return "Closed Lost";
    default:
      // closed, deleted, not_created, unavailable: no change.
      return null;
  }
}

export type StageDecision = { stage: DealStage; closedLostReason: string | null };

/**
 * Rule A, whole: where the lead should move for this estimate, or null when
 * it stays where it is. `otherLiveEstimate` is whether the lead has another
 * live website estimate that is still open or was accepted (a decline of one
 * estimate does not lose a lead that has another).
 */
export function alignedStage(
  lead: { stage: string; closedLostReason: string | null },
  estimate: { status: string; worked: boolean; otherLiveEstimate: boolean },
): StageDecision | null {
  const target = stageForEstimate(estimate.status, estimate.worked);
  if (!target || target === lead.stage) return null;
  const from = (DEAL_STAGES as readonly string[]).indexOf(lead.stage);
  if (from < 0) return null; // A stage this code does not know is never guessed at.
  if (lead.stage === "Closed Won") return null;
  if (lead.stage === "Closed Lost") {
    // Only an acceptance brings a lost lead back, and never one that was removed or merged.
    if (target !== "Closed Won" || isRemovalReason(lead.closedLostReason)) return null;
    return { stage: "Closed Won", closedLostReason: null };
  }
  if (target === "Closed Won") return { stage: "Closed Won", closedLostReason: null };
  if (target === "Closed Lost") {
    return estimate.otherLiveEstimate ? null : { stage: "Closed Lost", closedLostReason: DECLINED_IN_QUICKBOOKS };
  }
  // Open stages only move forward.
  return (DEAL_STAGES as readonly string[]).indexOf(target) > from ? { stage: target, closedLostReason: lead.closedLostReason } : null;
}

/** What rule C writes to QuickBooks for one open estimate of a closed lead, or null for nothing. */
export function quickBooksStatusForClosedLead(stage: string, closedLostReason: string | null): "Accepted" | "Rejected" | null {
  if (stage === "Closed Won") return "Accepted";
  if (stage !== "Closed Lost") return null;
  if (isRemovalReason(closedLostReason) || (closedLostReason ?? "").trim() === DECLINED_IN_QUICKBOOKS) return null;
  return "Rejected";
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

async function audit(
  dealId: number,
  action: string,
  detail: unknown,
  options: { source?: "quickbooks" | "hubspot"; succeeded?: boolean; error?: string | null; previous?: unknown } = {},
): Promise<void> {
  await query(
    `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,previous_value,new_value,succeeded,error)
     VALUES ('deal',$1,$2,'integration',$3,$4::jsonb,$5::jsonb,$6,$7)`,
    [
      String(dealId), action, options.source ?? "quickbooks",
      options.previous === undefined ? null : JSON.stringify(options.previous),
      JSON.stringify(detail), options.succeeded ?? true, options.error ?? null,
    ],
  );
}

/** Work that could not finish is remembered on the audit trail and retried by `settleStageAlignment`. */
async function markPending(dealId: number, action: string, reason: string, source: "quickbooks" | "hubspot"): Promise<void> {
  await audit(dealId, action, { reason }, { source, succeeded: false, error: reason.slice(0, 300) });
}
async function clearPending(dealId: number, action: string): Promise<void> {
  await query(
    "UPDATE audit_log SET succeeded = TRUE WHERE record_type='deal' AND record_id=$1 AND action=$2 AND succeeded = FALSE",
    [String(dealId), action],
  );
}

/** Work started without making the caller wait. Tests wait for it with `stageAlignmentSettled`. */
const background = new Set<Promise<void>>();
function inBackground(work: () => Promise<unknown>): Promise<void> {
  const running: Promise<void> = (async () => {
    try { await work(); }
    catch (error) { console.error("[stage-alignment] follow-up failed:", (error as Error).message); }
  })();
  background.add(running);
  void running.finally(() => background.delete(running));
  return running;
}
/** Resolves once nothing started in the background is still running. */
export async function stageAlignmentSettled(): Promise<void> {
  while (background.size) await Promise.all([...background]);
}

type EstimateRecord = {
  id: number; project_id: number; qbo_estimate_id: string | null; doc_number: string | null;
  txn_status: string | null; qbo_snapshot: Record<string, unknown> | null; sent_payload: Record<string, unknown> | null;
  created_by: string | null;
};

/** The project's current estimate (one QuickBooks estimate per project; a replaced one is older). */
async function currentEstimate(projectId: number): Promise<EstimateRecord | null> {
  return queryOne<EstimateRecord>(
    `SELECT id::int AS id, project_id::int AS project_id, qbo_estimate_id, doc_number, txn_status, qbo_snapshot, sent_payload, created_by::text AS created_by
       FROM scope_estimate WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [projectId],
  );
}

/** Live scope projects the websites' estimator made for this lead. */
async function leadProjects(dealId: number): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT sp.id::int AS id FROM guided_estimate ge JOIN scope_project sp ON sp.id = ge.scope_project_id
      WHERE ge.lead_deal_id = $1 AND sp.deleted_at IS NULL ORDER BY 1`,
    [dealId],
  );
  return rows.map((row) => row.id);
}

/** The estimate's state from P5's stored copy and the mirrored invoices. No QuickBooks call. */
async function storedStatus(estimate: EstimateRecord): Promise<string> {
  if (!estimate.qbo_estimate_id) return "not_created";
  if (estimate.txn_status === "Deleted") return "deleted";
  const { estimateStatus } = await import("../scopes/estimate.ts");
  const { linkedInvoices } = await import("../scopes/store.ts");
  const invoices = await linkedInvoices(estimate.qbo_snapshot).catch(() => null);
  return estimateStatus(estimate.qbo_snapshot as never, true, invoices);
}

// ---------------------------------------------------------------------------
// A. QuickBooks estimate status -> lead stage (-> HubSpot)
// ---------------------------------------------------------------------------

/**
 * Called at the end of `applyEstimateStatus`, the one place every estimate
 * status passes through. An estimate with no linked lead costs one query.
 */
export async function onEstimateStatusApplied(estimateId: number): Promise<void> {
  try {
    if (!stageAlignmentEnabled()) return;
    const linked = await queryOne<{ project_id: number }>(
      `SELECT se.project_id::int AS project_id FROM scope_estimate se
        WHERE se.id = $1 AND EXISTS (SELECT 1 FROM guided_estimate ge WHERE ge.scope_project_id = se.project_id AND ge.lead_deal_id IS NOT NULL)`,
      [estimateId],
    );
    if (!linked) return; // Not an estimate from the websites.
    await alignLeadsWithProject(linked.project_id, { estimateId });
  } catch (error) {
    console.error("[stage-alignment] the lead stage was not aligned with QuickBooks:", (error as Error).message);
  }
}

/**
 * Bring the lead (or leads) behind one website estimate in line with the
 * estimate's status. Safe to call any number of times: nothing is written,
 * and nothing is put on the audit trail, when the stage would not change.
 * `wait` makes the caller wait for the HubSpot follow-up; without it the
 * follow-up runs on its own and the watchdog picks up anything unfinished.
 */
export async function alignLeadsWithProject(projectId: number, options: { estimateId?: number; wait?: boolean } = {}): Promise<{ moved: number[] }> {
  const moved: number[] = [];
  if (!stageAlignmentEnabled()) return { moved };
  const links = await query<{ deal_id: number }>(
    `SELECT DISTINCT ge.lead_deal_id::int AS deal_id FROM guided_estimate ge JOIN scope_project sp ON sp.id = ge.scope_project_id
      WHERE ge.scope_project_id = $1 AND ge.lead_deal_id IS NOT NULL AND sp.deleted_at IS NULL ORDER BY 1`,
    [projectId],
  );
  if (!links.length) return { moved };
  const estimate = await currentEstimate(projectId);
  if (!estimate?.qbo_estimate_id) return { moved };
  // A status applied to an estimate that has since been replaced says nothing about the lead.
  if (options.estimateId !== undefined && options.estimateId !== estimate.id) return { moved };
  const status = await storedStatus(estimate);
  const worked = estimateWorked(estimate.qbo_snapshot, estimate.created_by);

  for (const { deal_id: dealId } of links) {
    const changed = await moveLead(dealId, projectId, estimate, status, worked);
    if (changed) moved.push(dealId);
    if (!changed && status !== "paid") continue;
    const followUp = async () => {
      if (changed) await pushLeadToHubSpot(dealId);
      if (status === "paid") await completeJobInHubSpot(dealId);
    };
    if (options.wait) await inBackground(followUp);
    else void inBackground(followUp);
  }
  return { moved };
}

/** One lead, one decision, one UPDATE and one audit row, under a row lock. */
async function moveLead(dealId: number, projectId: number, estimate: EstimateRecord, status: string, worked: boolean): Promise<boolean> {
  // Only a decline needs to know about the lead's other estimates. Read before the row lock is taken.
  const otherLiveEstimate = status === "declined" ? await hasOtherLiveEstimate(dealId, projectId) : false;
  return transaction(async (client) => {
    const found = await client.query<{ stage: string; closed_lost_reason: string | null }>(
      "SELECT stage, closed_lost_reason FROM deal WHERE id = $1 FOR UPDATE",
      [dealId],
    );
    const lead = found.rows[0];
    if (!lead) return false;
    const decision = alignedStage({ stage: lead.stage, closedLostReason: lead.closed_lost_reason }, { status, worked, otherLiveEstimate });
    if (!decision) return false;
    const closing = decision.stage === "Closed Won" || decision.stage === "Closed Lost";
    await client.query(
      `UPDATE deal SET
         stage = $2,
         -- As in logOutcomeAction: the first close date is kept (a lost lead that is won keeps it), an open stage has none.
         closed_at = CASE WHEN $3::boolean THEN COALESCE(closed_at, now()) ELSE NULL END,
         closed_lost_reason = $4,
         next_action = CASE WHEN $3::boolean THEN NULL ELSE next_action END,
         next_action_at = CASE WHEN $3::boolean THEN NULL ELSE next_action_at END,
         integration_sync_status = 'pending',
         updated_at = now()
       WHERE id = $1`,
      [dealId, decision.stage, closing, decision.closedLostReason],
    );
    await client.query(
      `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,previous_value,new_value)
       VALUES ('deal',$1,'stage_aligned_with_quickbooks','integration','quickbooks',$2::jsonb,$3::jsonb)`,
      [
        String(dealId),
        JSON.stringify({ stage: lead.stage, closedLostReason: lead.closed_lost_reason }),
        JSON.stringify({ stage: decision.stage, closedLostReason: decision.closedLostReason, estimateStatus: status, docNumber: estimate.doc_number, projectId }),
      ],
    );
    return true;
  });
}

/** Another live website estimate for this lead that is still open, or was accepted. Stored copies only. */
async function hasOtherLiveEstimate(dealId: number, exceptProjectId: number): Promise<boolean> {
  for (const projectId of await leadProjects(dealId)) {
    if (projectId === exceptProjectId) continue;
    const estimate = await currentEstimate(projectId);
    if (!estimate?.qbo_estimate_id) continue;
    const status = await storedStatus(estimate);
    if (OPEN_ESTIMATE.has(status) || WON_ESTIMATE.has(status)) return true;
  }
  return false;
}

/** The existing P5 -> HubSpot sync. It records its own failures; the watchdog retries `pending`. */
async function pushLeadToHubSpot(dealId: number): Promise<void> {
  try {
    const { syncDealToHubSpot } = await import("../integrations/hubspot.ts");
    await syncDealToHubSpot(dealId);
  } catch (error) {
    console.error("[stage-alignment] HubSpot push deferred to the watchdog:", (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// B. Paid in full -> the HubSpot deal moves to "Job Complete"
// ---------------------------------------------------------------------------

type QboTxnRow = { Id?: unknown; LinkedTxn?: unknown; Line?: unknown };
const linkedIds = (linked: unknown, type: string): string[] =>
  Array.isArray(linked)
    ? linked.filter((t) => t && t.TxnType === type && t.TxnId).map((t) => String(t.TxnId))
    : [];

/**
 * Called by the QuickBooks read model for every invoice and payment it
 * stores (webhook and daily sync). A payment does not touch the estimate, so
 * this is where "paid in full" is noticed. A transaction that has nothing to
 * do with a website estimate costs one query.
 */
export async function onQuickBooksTxn(entity: string, row: QboTxnRow): Promise<void> {
  try {
    if (!stageAlignmentEnabled() || !row?.Id) return;
    if (entity === "Invoice") await onInvoiceChanged(String(row.Id), linkedIds(row.LinkedTxn, "Estimate"));
    else if (entity === "Payment") await onPaymentChanged(row);
  } catch (error) {
    console.error("[stage-alignment] an invoice change was not applied:", (error as Error).message);
  }
}

/** Website estimates this invoice was made from: by the estimate's own link, or by the invoice's. */
async function projectsForInvoice(invoiceId: string, estimateIds: string[]): Promise<number[]> {
  const rows = await query<{ project_id: number }>(
    `SELECT DISTINCT se.project_id::int AS project_id FROM scope_estimate se
      WHERE (se.linked_invoice = $1 OR se.qbo_snapshot->'LinkedTxn' @> $2::jsonb OR se.qbo_estimate_id = ANY($3::text[]))
        AND EXISTS (SELECT 1 FROM guided_estimate ge WHERE ge.scope_project_id = se.project_id AND ge.lead_deal_id IS NOT NULL)
      ORDER BY 1`,
    [invoiceId, JSON.stringify([{ TxnId: invoiceId, TxnType: "Invoice" }]), estimateIds],
  );
  return rows.map((row) => row.project_id);
}

async function onInvoiceChanged(invoiceId: string, estimateIds: string[]): Promise<void> {
  for (const projectId of await projectsForInvoice(invoiceId, estimateIds)) {
    // Not a page view: the webhook and the daily sync can wait for HubSpot.
    await alignLeadsWithProject(projectId, { wait: true });
  }
}

/**
 * A payment names the invoices it pays. When one of them belongs to a website
 * estimate and P5's copy of it still shows money owed, the invoice is read
 * again from QuickBooks and stored, which runs the invoice rule above. This
 * does not depend on QuickBooks also reporting the invoice as changed.
 */
async function onPaymentChanged(payment: QboTxnRow): Promise<void> {
  const lines = Array.isArray(payment.Line) ? payment.Line : [];
  const invoiceIds = [...new Set(lines.flatMap((line) => linkedIds((line as { LinkedTxn?: unknown })?.LinkedTxn, "Invoice")))];
  for (const invoiceId of invoiceIds) {
    if (!(await projectsForInvoice(invoiceId, [])).length) continue;
    const mirrored = await queryOne<{ balance: number | null }>(
      "SELECT balance::float8 AS balance FROM qbo_txn WHERE txn_type = 'Invoice' AND qbo_id = $1",
      [invoiceId],
    );
    if (mirrored && mirrored.balance !== null && mirrored.balance <= 0.005) continue; // Already known to be paid.
    const { qboRequest } = await import("../finance/qbo/client.ts");
    const { upsertTxn } = await import("../finance/qbo/sync.ts");
    const live = await qboRequest<{ Invoice?: Record<string, unknown> & { Id: string } }>(`/invoice/${encodeURIComponent(invoiceId)}`);
    if (live.Invoice?.Id) await upsertTxn("Invoice", live.Invoice);
  }
}

type JobOutcome = "moved" | "already" | "no-stage" | "left" | "pending" | "skipped";

const STAGE_CACHE_FOUND_MS = 6 * 60 * 60 * 1000;
const STAGE_CACHE_ABSENT_MS = 10 * 60 * 1000;
const jobCompleteStages = new Map<string, { stageId: string | null; until: number }>();
/** Tests reset the cached pipeline lookup between cases. */
export function resetStageAlignmentCache(): void {
  jobCompleteStages.clear();
}

async function hubspotFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.HUBSPOT_TOKEN ?? "";
  // Never read or write any portal but P5's (hubspot-portal.ts).
  const { ensureP5HubSpotPortal } = await import("../integrations/hubspot-portal.ts");
  await ensureP5HubSpotPortal(token);
  return fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
}

/** The id of the "Job Complete" stage in this pipeline, or null when the pipeline has none. Looked up by label. */
async function jobCompleteStageId(pipelineId: string): Promise<string | null> {
  const cached = jobCompleteStages.get(pipelineId);
  if (cached && cached.until > Date.now()) return cached.stageId;
  const response = await hubspotFetch(`/crm/v3/pipelines/deals/${encodeURIComponent(pipelineId)}`);
  if (!response.ok) throw new Error(`HubSpot would not list the pipeline stages (HTTP ${response.status}).`);
  const body = await response.json() as { stages?: { id?: string; label?: string; archived?: boolean }[] };
  const wanted = JOB_COMPLETE_LABEL.toLowerCase();
  const stage = (body.stages ?? []).find((s) => !s.archived && String(s.label ?? "").trim().toLowerCase() === wanted);
  const stageId = stage?.id ? String(stage.id) : null;
  jobCompleteStages.set(pipelineId, { stageId, until: Date.now() + (stageId ? STAGE_CACHE_FOUND_MS : STAGE_CACHE_ABSENT_MS) });
  return stageId;
}

/** Is the lead's work finished and paid? Some website estimate is paid in full, and none is accepted or invoiced and still owed. */
async function leadJobPaid(dealId: number): Promise<{ paid: boolean; docNumbers: string[] }> {
  const docNumbers: string[] = [];
  let unfinished = false;
  for (const projectId of await leadProjects(dealId)) {
    const estimate = await currentEstimate(projectId);
    if (!estimate?.qbo_estimate_id) continue;
    const status = await storedStatus(estimate);
    if (status === "paid") docNumbers.push(estimate.doc_number ?? estimate.qbo_estimate_id);
    else if (status === "accepted" || status === "converted") unfinished = true;
  }
  return { paid: docNumbers.length > 0 && !unfinished, docNumbers };
}

const JOB_PENDING = "hubspot_job_complete_pending";

/** One audit row per outcome for a HubSpot deal, however many times the same thing is found again. */
async function noteJobOutcome(dealId: number, hubspotDealId: string, outcome: JobOutcome, detail: Record<string, unknown>): Promise<void> {
  const last = await queryOne<{ outcome: string | null; deal: string | null }>(
    `SELECT new_value->>'outcome' AS outcome, new_value->>'hubspotDealId' AS deal FROM audit_log
      WHERE record_type='deal' AND record_id=$1 AND action='hubspot_deal_job_complete' ORDER BY id DESC LIMIT 1`,
    [String(dealId)],
  );
  if (last?.outcome === outcome && last.deal === hubspotDealId) return;
  await audit(dealId, "hubspot_deal_job_complete", { outcome, hubspotDealId, ...detail }, { source: "hubspot" });
}

/**
 * Move the lead's HubSpot deal to "Job Complete", once. Does nothing unless
 * the lead is Closed Won and its work is paid in full. The P5 lead is not
 * changed: the read-back leaves a stage P5 has no name for alone, and a push
 * never drags the deal back (`keepRemoteStage` in hubspot.ts). Never throws.
 */
export async function completeJobInHubSpot(dealId: number): Promise<JobOutcome> {
  if (!stageAlignmentEnabled()) return "skipped";
  try {
    const outcome = await moveToJobComplete(dealId);
    if (outcome !== "pending") await clearPending(dealId, JOB_PENDING);
    return outcome;
  } catch (error) {
    const reason = (error as Error).message.slice(0, 300);
    await markPending(dealId, JOB_PENDING, reason, "hubspot").catch(() => undefined);
    return "pending";
  }
}

type LeadForJob = { stage: string; hubspot_deal_id: string | null; integration_sync_status: string | null };
const leadForJob = (dealId: number) =>
  queryOne<LeadForJob>("SELECT stage, hubspot_deal_id, integration_sync_status FROM deal WHERE id = $1", [dealId]);

async function moveToJobComplete(dealId: number): Promise<JobOutcome> {
  let lead = await leadForJob(dealId);
  if (!lead || lead.stage !== "Closed Won") return "skipped";
  const job = await leadJobPaid(dealId);
  if (!job.paid) return "skipped";
  const { loadSettings } = await import("./settings.ts");
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !process.env.HUBSPOT_TOKEN) return "skipped";

  const finished = async (hubspotDealId: string) => Boolean(await queryOne(
    `SELECT 1 FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action='hubspot_deal_job_complete'
        AND new_value->>'hubspotDealId'=$2 AND new_value->>'outcome' IN ('moved','already') LIMIT 1`,
    [String(dealId), hubspotDealId],
  ));
  if (lead.hubspot_deal_id && (await finished(lead.hubspot_deal_id))) return "skipped"; // Done once; not rewritten.

  // HubSpot must hold "Closed Won" first, so the deal is moved on from there.
  if (!lead.hubspot_deal_id || lead.integration_sync_status !== "synced") {
    await pushLeadToHubSpot(dealId);
    lead = await leadForJob(dealId);
    if (!lead || lead.stage !== "Closed Won") return "skipped";
  }
  const hubspotDealId = lead.hubspot_deal_id;
  if (!hubspotDealId) throw new Error("The lead has not reached HubSpot yet.");

  // The same short lease the lead sync takes, so a push that read the deal a
  // moment ago cannot write "Closed Won" back over the move.
  const leased = await query<{ id: string }>(
    `UPDATE deal SET hubspot_sync_lease_until = now() + interval '2 minutes'
      WHERE id = $1 AND (hubspot_sync_lease_until IS NULL OR hubspot_sync_lease_until < now()) RETURNING id`,
    [dealId],
  );
  if (!leased.length) throw new Error("A HubSpot sync for this lead is running.");
  try {
    const path = `/crm/v3/objects/deals/${encodeURIComponent(hubspotDealId)}`;
    const current = await hubspotFetch(`${path}?properties=dealstage,pipeline`);
    if (current.status === 404) return "skipped"; // Deleted in HubSpot: the removal mirror owns that.
    if (!current.ok) throw new Error(`HubSpot would not return the deal (HTTP ${current.status}).`);
    const properties = ((await current.json()) as { properties?: Record<string, string | null> }).properties ?? {};
    const pipeline = properties.pipeline || "default";
    const remoteStage = properties.dealstage ?? "";
    const stageId = await jobCompleteStageId(pipeline);
    const detail = { pipeline, docNumbers: job.docNumbers };
    if (!stageId) {
      await noteJobOutcome(dealId, hubspotDealId, "no-stage", { ...detail, note: `The pipeline has no "${JOB_COMPLETE_LABEL}" stage, so the deal was left at Closed Won.` });
      return "no-stage";
    }
    if (remoteStage === stageId) {
      await noteJobOutcome(dealId, hubspotDealId, "already", { ...detail, stageId });
      return "already";
    }
    const { STAGE_BY_ID, STAGE_IDS } = await import("../integrations/hubspot-map.ts");
    if (remoteStage !== STAGE_IDS["Closed Won"]) {
      // Not yet won in HubSpot: the push has not landed, try again later.
      if (STAGE_BY_ID[remoteStage]) throw new Error("HubSpot does not show the deal as Closed Won yet.");
      // Some other stage the team added. That stage is HubSpot's to keep.
      await noteJobOutcome(dealId, hubspotDealId, "left", { ...detail, remoteStage, note: "The deal is in a HubSpot stage the team chose, so it was left there." });
      return "left";
    }
    const patched = await hubspotFetch(path, { method: "PATCH", body: JSON.stringify({ properties: { dealstage: stageId } }) });
    if (!patched.ok) {
      jobCompleteStages.delete(pipeline);
      throw new Error(`HubSpot would not move the deal to ${JOB_COMPLETE_LABEL} (HTTP ${patched.status}).`);
    }
    await noteJobOutcome(dealId, hubspotDealId, "moved", { ...detail, stageId, from: remoteStage });
    return "moved";
  } finally {
    await query("UPDATE deal SET hubspot_sync_lease_until = NULL WHERE id = $1", [dealId]).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// C. Lead closed -> QuickBooks estimate status
// ---------------------------------------------------------------------------

type ClosedOutcome = { set: string[]; kept: string[]; pending: string | null };
const QBO_PENDING = "quickbooks_stage_pending";

const isGone = (error: Error) => /QBO 400/.test(error.message) && /Object Not Found|"code":"610"/i.test(error.message);
const isStale = (error: Error) => /QBO 400/.test(error.message) && /Stale Object|"code":"5010"/i.test(error.message);

type LiveEstimate = Record<string, unknown> & { Id?: string; SyncToken?: string; TxnStatus?: string; DocNumber?: string; CustomerRef?: unknown };

/** The estimate as QuickBooks has it now, or null when it is gone there. Any other error is thrown. */
async function readLiveEstimate(qboEstimateId: string): Promise<LiveEstimate | null> {
  const { qboRequest } = await import("../finance/qbo/client.ts");
  try {
    const res = await qboRequest<{ Estimate?: LiveEstimate }>(`/estimate/${encodeURIComponent(qboEstimateId)}`);
    if (!res.Estimate) throw new Error("QuickBooks returned no estimate.");
    return res.Estimate;
  } catch (error) {
    if (isGone(error as Error)) return null;
    throw error;
  }
}

/**
 * The stage hooks call this. It does nothing unless the lead moved INTO a
 * closed stage: a lead that is reopened, or changed between open stages,
 * never changes QuickBooks. With `waitMs` the caller is answered after that
 * long at most; work still running then is noted as pending, so the watchdog
 * finishes it even if this process does not.
 */
export async function onLeadStageChanged(dealId: number, previousStage: string | null | undefined, newStage: string, options: { waitMs?: number } = {}): Promise<void> {
  try {
    if (newStage !== "Closed Won" && newStage !== "Closed Lost") return;
    if (previousStage === newStage) return;
    if (!quickBooksStageWriteEnabled()) return;
    const work = inBackground(() => alignQuickBooksWithClosedLead(dealId));
    if (options.waitMs === undefined) { await work; return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      work.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), options.waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
    if (!finished) await markPending(dealId, QBO_PENDING, "Still writing to QuickBooks when the form was answered.", "quickbooks");
  } catch (error) {
    console.error("[stage-alignment] a closed lead was not carried to QuickBooks:", (error as Error).message);
  }
}

/**
 * A lead is closed: bring its open QuickBooks estimates in line. Reads the
 * lead and every estimate as they are now, so it is safe to call again at any
 * time (a retry, a second hook, the watchdog): an estimate already answered
 * is left alone. Never throws.
 */
export async function alignQuickBooksWithClosedLead(dealId: number): Promise<ClosedOutcome> {
  const outcome: ClosedOutcome = { set: [], kept: [], pending: null };
  // Switched off: nothing is read, written or forgotten. Work already noted as pending waits.
  if (!quickBooksStageWriteEnabled()) return outcome;
  try {
    await closedLeadToQuickBooks(dealId, outcome);
  } catch (error) {
    outcome.pending = (error as Error).message.slice(0, 300);
  }
  try {
    if (outcome.pending) await markPending(dealId, QBO_PENDING, outcome.pending, "quickbooks");
    else await clearPending(dealId, QBO_PENDING);
  } catch (error) {
    console.error("[stage-alignment] the QuickBooks retry note was not saved:", (error as Error).message);
  }
  return outcome;
}

async function closedLeadToQuickBooks(dealId: number, outcome: ClosedOutcome): Promise<void> {
  const lead = await queryOne<{ stage: string; closed_lost_reason: string | null }>("SELECT stage, closed_lost_reason FROM deal WHERE id = $1", [dealId]);
  if (!lead) return;
  const target = quickBooksStatusForClosedLead(lead.stage, lead.closed_lost_reason);
  if (!target) return; // Reopened since, or closed by a deletion, a merge or a QuickBooks decline.
  const projectIds = await leadProjects(dealId);
  if (!projectIds.length) return;

  const { isQboConnected } = await import("../finance/qbo/oauth.ts");
  if (!(await isQboConnected().catch(() => false))) {
    outcome.pending = "QuickBooks is not connected.";
    return;
  }
  const { estimateStatus } = await import("../scopes/estimate.ts");

  // Every estimate is read from QuickBooks before anything is decided.
  type Candidate = { projectId: number; estimate: EstimateRecord; live: LiveEstimate; status: string };
  const open: Candidate[] = [];
  let accepted = false;
  for (const projectId of projectIds) {
    const estimate = await currentEstimate(projectId);
    if (!estimate?.qbo_estimate_id || estimate.txn_status === "Deleted") continue;
    try {
      const live = await readLiveEstimate(estimate.qbo_estimate_id);
      if (!live) continue; // Deleted in QuickBooks: nothing to set.
      const status = estimateStatus(live as never, true);
      if (OPEN_ESTIMATE.has(status)) open.push({ projectId, estimate, live, status });
      else {
        if (status === "accepted" || status === "converted") accepted = true;
        outcome.kept.push(`estimate ${live.DocNumber ?? estimate.doc_number ?? estimate.qbo_estimate_id} (${status})`);
      }
    } catch (error) {
      outcome.pending = (error as Error).message.slice(0, 300);
    }
  }

  if (target === "Accepted") {
    // Which estimate was accepted cannot be decided on a partial reading.
    if (outcome.pending || accepted || !open.length) return;
    if (open.length > 1) {
      await askWhichEstimate(dealId, open.map((c) => ({ projectId: c.projectId, docNumber: String(c.live.DocNumber ?? c.estimate.doc_number ?? c.estimate.qbo_estimate_id) })));
      return;
    }
  }
  for (const candidate of open) {
    try {
      if (!(await setEstimateStatus(dealId, candidate, target, lead.stage))) continue;
      outcome.set.push(`estimate ${candidate.live.DocNumber ?? candidate.estimate.doc_number ?? candidate.estimate.qbo_estimate_id} (${target})`);
    } catch (error) {
      outcome.pending = (error as Error).message.slice(0, 300);
    }
  }
}

/** Won, with more than one open estimate: nothing is written. Said once per set of estimates. */
async function askWhichEstimate(dealId: number, estimates: { projectId: number; docNumber: string }[]): Promise<void> {
  const key = estimates.map((e) => `${e.projectId}:${e.docNumber}`).sort().join(",");
  const said = await queryOne(
    `SELECT 1 FROM audit_log WHERE record_type='deal' AND record_id=$1 AND action='quickbooks_estimate_choice_needed' AND new_value->>'key'=$2 LIMIT 1`,
    [String(dealId), key],
  );
  if (said) return;
  const note = "The lead was closed as won and has more than one open estimate. Mark the accepted one in QuickBooks; nothing was changed.";
  const store = await import("../scopes/store.ts");
  for (const estimate of estimates) {
    await store.logEvent(estimate.projectId, "estimate-choice-needed", { dealId, docNumber: estimate.docNumber, note }, NO_EMPLOYEE);
  }
  await audit(dealId, "quickbooks_estimate_choice_needed", { key, estimates: estimates.map((e) => e.docNumber), note });
}

/**
 * Write one status to one estimate. The live copy read a moment ago carries
 * the SyncToken; when QuickBooks says it is stale (someone saved the estimate
 * in between) the estimate is read once more and written only if it is still
 * open. Returns false when it was left alone. What QuickBooks returns is
 * stored through `applyEstimateStatus`, which re-enters rule A as a no-op,
 * and an acceptance gets its QuickBooks project exactly as one made in
 * QuickBooks does (`settleAccepted`).
 */
async function setEstimateStatus(
  dealId: number,
  candidate: { projectId: number; estimate: EstimateRecord; live: LiveEstimate; status: string },
  target: "Accepted" | "Rejected",
  leadStage: string,
): Promise<boolean> {
  const { qboRequest } = await import("../finance/qbo/client.ts");
  const { estimateStatus, compareEstimate } = await import("../scopes/estimate.ts");
  const { estimate, projectId } = candidate;
  let live = candidate.live;
  let from = candidate.status;
  let written: LiveEstimate | undefined;
  for (let attempt = 1; !written; attempt++) {
    try {
      const res = await qboRequest<{ Estimate?: LiveEstimate }>("/estimate", {
        method: "POST",
        // Sparse: only the status changes. The customer is sent back as it is, as the revision path does.
        body: JSON.stringify({ Id: live.Id, SyncToken: live.SyncToken, sparse: true, TxnStatus: target, ...(live.CustomerRef ? { CustomerRef: live.CustomerRef } : {}) }),
      });
      written = res.Estimate;
      if (!written) throw new Error("QuickBooks returned no estimate.");
    } catch (error) {
      if (attempt > 1 || !isStale(error as Error)) throw error;
      const again = await readLiveEstimate(String(estimate.qbo_estimate_id));
      if (!again) return false; // Deleted in between.
      from = estimateStatus(again as never, true);
      if (!OPEN_ESTIMATE.has(from)) return false; // Answered in between: leave it.
      live = again;
    }
  }
  if (written.TxnStatus !== target) throw new Error(`QuickBooks did not set the estimate to ${target} (it reads ${String(written.TxnStatus ?? "unknown")}).`);

  const store = await import("../scopes/store.ts");
  await store.applyEstimateStatus(estimate.id, {
    raw: written,
    source: "stage-alignment",
    drift: estimate.sent_payload ? compareEstimate(estimate.sent_payload as { Line: unknown }, written as { Line?: unknown; TotalAmt?: number }) : null,
  });
  const docNumber = String(written.DocNumber ?? estimate.doc_number ?? estimate.qbo_estimate_id);
  const why = `The lead was closed as ${leadStage === "Closed Won" ? "won" : "lost"}.`;
  await store.logEvent(projectId, "estimate-status-set", { docNumber, from, to: target, why, dealId }, NO_EMPLOYEE);
  await audit(dealId, "quickbooks_estimate_status_set", { docNumber, qboEstimateId: estimate.qbo_estimate_id, projectId, from, to: target, why });
  if (target === "Accepted") {
    // The status is written and recorded; the project step records its own failures and is tried again at the next change.
    try {
      const scopes = await import("../scopes/qbo.ts");
      await scopes.settleAccepted(projectId);
    } catch (error) {
      console.error("[stage-alignment] the QuickBooks project was not created:", (error as Error).message);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Retry from the watchdog
// ---------------------------------------------------------------------------

async function pendingLeads(action: string, limit: number): Promise<number[]> {
  const rows = await query<{ deal_id: string }>(
    `SELECT record_id AS deal_id FROM audit_log
      WHERE record_type='deal' AND action=$1 AND NOT succeeded
      GROUP BY record_id
     HAVING max(occurred_at) < now() - interval '6 hours' AND min(occurred_at) > now() - interval '14 days'
      ORDER BY max(occurred_at) LIMIT $2`,
    [action, limit],
  );
  return rows.map((row) => Number(row.deal_id));
}

/**
 * Retry what could not finish (QuickBooks disconnected or busy, HubSpot not
 * answering). One attempt per lead every six hours, a few leads per pass, and
 * only for a fortnight: after that a person can set it by hand.
 */
export async function settleStageAlignment(limit = 5): Promise<{ attempted: number; finished: number }> {
  if (!stageAlignmentEnabled()) return { attempted: 0, finished: 0 };
  let attempted = 0;
  let finished = 0;
  if (quickBooksStageWriteEnabled()) {
    for (const dealId of await pendingLeads(QBO_PENDING, limit)) {
      attempted++;
      const outcome = await alignQuickBooksWithClosedLead(dealId);
      if (!outcome.pending) finished++;
    }
  }
  for (const dealId of await pendingLeads(JOB_PENDING, limit)) {
    attempted++;
    if ((await completeJobInHubSpot(dealId)) !== "pending") finished++;
  }
  return { attempted, finished };
}
