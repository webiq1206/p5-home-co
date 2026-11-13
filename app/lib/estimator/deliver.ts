/**
 * What happens after a customer sees their estimate. Server only.
 *
 * Every step is recorded on the estimate row and skipped when it already
 * succeeded, so the whole delivery can be run again safely: after a timeout,
 * from the retry pass, or by hand.
 *
 *   1. scope      The estimate becomes a project in the scope platform, with
 *                 the same scope document and priced lines. That is the
 *                 review workflow: the team opens it in /scopes.
 *   2. lead       The lead goes through the family lead intake, which
 *                 deduplicates the contact, syncs HubSpot and alerts the team.
 *   3. QuickBooks Customer matched or created, estimate created from the same
 *                 lines the customer saw, and sent, according to
 *                 ESTIMATOR_QBO (below) and only when the estimate qualified.
 *   4. team email The full internal report.
 *   5. customer   A short confirmation, only when QuickBooks is not sending
 *                 the official estimate right now.
 *
 * ESTIMATOR_QBO controls how far step 3 goes without a person:
 *   create  (default, owner decision 13 November 2026) every estimate a
 *           customer was shown a range for becomes a customer and an UNSENT
 *           estimate in QuickBooks, budgetary ones included. The team
 *           revises it there, sends it, and converts it to an invoice and
 *           project once the customer approves.
 *   send    a line-by-line estimate that needs no review is also emailed to
 *           the customer by QuickBooks. A budgetary estimate is never sent
 *           without a person, whatever this says.
 *   off     nothing is written to QuickBooks.
 * Only an estimate is ever created here: never an invoice, payment or
 * project. QuickBooks holds one figure per line, so it gets the base price;
 * the range the customer saw is written on the estimate's message and in its
 * private note. An estimate whose price was withheld is not written at all.
 */

import { handleIntake } from "../../api/leads/intake/handler.ts";
import { queryOne } from "../db.ts";
import { qboRequest } from "../finance/qbo/client.ts";
import { isQboConnected } from "../finance/qbo/oauth.ts";
import { syncDealToHubSpot } from "../integrations/hubspot.ts";
import { activeTransport } from "../notifications/transport.ts";
import { ESTIMATE_STATUS_LABEL, estimateStatus, qboWebUrl } from "../scopes/estimate.ts";
import { buildPayloadFor, createOrReviseEstimate, ensureCustomer, findCustomerCandidates, isSandbox, refreshEstimate } from "../scopes/qbo.ts";
import { getProject, latestEstimate, loadScopeSettings, logEvent, saveVersion, syncProjectTitle } from "../scopes/store.ts";
import type { PricingResult, ScopeDoc } from "../scopes/types.ts";
import { brandConfig } from "./brands.ts";
import { TEAM_INBOX, customerConfirmation, teamReport } from "./emails.ts";
import { guidedById, recordDelivery, setGuidedLinks, type Delivery, type GuidedRow } from "./store.ts";
import { CLASS_LABELS, type BrandId, type EstimateClass } from "./types.ts";

export type QboMode = "off" | "create" | "send";

export function qboMode(env: Record<string, string | undefined> = process.env): QboMode {
  const value = (env.ESTIMATOR_QBO ?? "").trim().toLowerCase();
  return value === "off" || value === "send" ? value : "create";
}

/**
 * The scope platform records who did something as an app_user id. A customer
 * submission has no employee behind it; those columns are nullable.
 */
const NO_EMPLOYEE = null as unknown as number;

const step = (ok: boolean, detail?: string | null) => ({ at: new Date().toISOString(), ok, detail: detail ?? null });
const done = (delivery: Delivery, key: keyof Delivery) => (delivery[key] as { ok?: boolean } | undefined)?.ok === true;

export type DeliverInput = {
  id: number;
  /** Public origin of this deployment, for links in email. */
  origin: string;
  /** The visitor's address, so the lead intake's limits count the visitor and not this server. */
  clientAddress?: string | null;
  /** The priced scope. Present on first delivery; a retry reads it back from the scope platform. */
  doc?: ScopeDoc;
  pricing?: PricingResult;
  service?: string;
};

async function ensureScopeProject(row: GuidedRow, input: DeliverInput): Promise<{ projectId: number; versionId: number } | null> {
  if (row.scope_project_id && row.scope_version_id) return { projectId: row.scope_project_id, versionId: row.scope_version_id };
  if (!input.doc || !input.pricing || !input.service) return null;
  const created = await queryOne<{ id: string }>(
    `INSERT INTO scope_project (title, client_first_name, client_last_name, client_email, client_phone, project_address, service, finish_tier)
     VALUES ('', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [row.first_name, row.last_name, row.email, row.phone, row.address, input.service, row.tier],
  );
  const projectId = Number(created!.id);
  await syncProjectTitle(projectId);
  const brand = brandConfig(row.brand as BrandId);
  await logEvent(projectId, "created", { source: "online-estimator", brand: brand?.name ?? row.brand, guidedEstimateId: row.id }, NO_EMPLOYEE);
  const blocked = row.review.some((r) => r.code !== "budgetary");
  const version = await saveVersion({
    projectId,
    doc: input.doc,
    pricing: input.pricing,
    source: "online-estimator",
    note: `Built by the customer on ${brand?.name ?? row.brand}. ${CLASS_LABELS[row.estimate_class as EstimateClass]?.label ?? row.estimate_class}.`,
    status: blocked ? "needs_information" : "ready",
    userId: null,
  });
  await setGuidedLinks(row.id, { scopeProjectId: projectId, scopeVersionId: version.id });
  return { projectId, versionId: version.id };
}

async function sendLead(row: GuidedRow, origin: string, scopeProjectId: number | null, service: string | null, clientAddress: string | null): Promise<{ ok: boolean; detail: string; dealId: number | null }> {
  const brand = brandConfig(row.brand as BrandId);
  const view = row.customer_view;
  const summary = [
    `Online estimate: ${view.projectName}.`,
    `Selections: ${view.summary.join("; ")}.`,
    row.price_withheld ? "Estimate held for review; the customer was not shown a price." : `${view.classLabel}: $${Number(row.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`,
    scopeProjectId ? `Scope platform: ${origin}/scopes/${scopeProjectId}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const body = {
    brand: brand?.name ?? "P5 Home Co",
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    projectType: service ?? view.projectName,
    address: row.address ?? undefined,
    summary,
    form: "Online estimator",
    request_kind: "quote",
    external_id: `guided-${row.token}`,
    ...(row.attribution ?? {}),
  };
  const request = new Request(`${origin}/api/leads/intake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientAddress || "estimator-retry" },
    body: JSON.stringify(body),
  });
  const pending: Promise<void>[] = [];
  const response = await handleIntake(request, (task) => void pending.push(task().catch((error) => console.error("[estimator] lead follow-up failed:", (error as Error).message))), {
    syncHubSpot: syncDealToHubSpot,
  });
  await Promise.all(pending);
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; duplicate?: boolean; error?: string };
  const deal = json.ok
    ? await queryOne<{ deal_id: number }>("SELECT deal_id::int FROM lead_external_ref WHERE brand = $1 AND external_id = $2", [body.brand, body.external_id]).catch(() => null)
    : null;
  return {
    ok: response.ok && json.ok === true,
    detail: json.ok ? (json.duplicate ? "matched an existing lead" : "lead created") : json.error ?? `intake returned ${response.status}`,
    dealId: deal?.deal_id ?? null,
  };
}

/**
 * Find the QuickBooks customer for this person, or create one. Only a match
 * on email or phone links automatically: a shared name or street is not
 * enough to put one family's estimate on another family's account.
 */
async function ensureQboCustomer(projectId: number): Promise<string> {
  const project = (await getProject(projectId))!;
  if (project.qbo_customer_id) return project.qbo_customer_id;
  const candidates = await findCustomerCandidates(project);
  const match = candidates.find((c) => c.reasons.includes("same email")) ?? candidates.find((c) => c.reasons.includes("same phone"));
  const linked = await ensureCustomer(project, match ? { qboId: match.qboId } : { create: true }, NO_EMPLOYEE);
  return linked.qboId;
}

/** The range the customer saw. QuickBooks totals one figure, so the range travels as words. */
export function rangeNote(row: Pick<GuidedRow, "customer_view" | "total">): string {
  const range = row.customer_view.range;
  if (!range) return "";
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  return `Preliminary range given online: ${money(range.low)} to ${money(range.high)}. The total on this estimate (${money(Number(row.total))}) is the base figure that range is built on.`;
}

/**
 * May this estimate be written to QuickBooks without a person? Yes when the
 * customer was shown a price and nothing is wrong with it. "Budgetary" is not
 * something wrong: it only means a person sends it.
 */
export function qboAction(row: Pick<GuidedRow, "review" | "price_withheld">, mode: QboMode): QboMode {
  if (mode === "off" || row.price_withheld || row.review.some((r) => r.code !== "budgetary")) return "off";
  return mode === "send" && row.review.length === 0 ? "send" : "create";
}

async function qboEstimate(row: GuidedRow, projectId: number, mode: QboMode): Promise<Delivery> {
  const patch: Delivery = {};
  const customerId = await ensureQboCustomer(projectId);
  patch.qboCustomer = step(true, customerId);
  const project = (await getProject(projectId))!;
  const version = await queryOne<{ id: number; project_id: number; version_no: number; source: string; note: string | null; doc: ScopeDoc; pricing: PricingResult; created_by: number | null; created_at: Date }>(
    "SELECT id::int, project_id::int, version_no, source, note, doc, pricing, created_by::int, created_at FROM scope_version WHERE id = $1",
    [project.current_version_id],
  );
  if (!version) throw new Error("The scope version for this estimate is missing.");
  const settings = await loadScopeSettings();
  const built = await buildPayloadFor(project, version, version.pricing, version.doc, settings);
  if (!built.payload) throw new Error(`QuickBooks is missing these products and services: ${built.missingItems.join(", ")}. Map them in Pricing setup.`);
  // The customer reads what kind of estimate this is on the document itself.
  const klass = CLASS_LABELS[row.estimate_class as EstimateClass];
  const memo = [klass ? `${klass.label}. ${klass.statement}` : "", rangeNote(row), built.payload.CustomerMemo?.value ?? ""].filter(Boolean).join("\n");
  built.payload.CustomerMemo = { value: memo.slice(0, 1000) };
  built.payload.PrivateNote = [rangeNote(row), `Online estimate ${row.customer_view.estimateNumber}. Created unsent; review before sending.`, built.payload.PrivateNote].filter(Boolean).join("\n").slice(0, 4000);
  const result = await createOrReviseEstimate({ project, version, payload: built.payload, userId: NO_EMPLOYEE });
  const estimate = await latestEstimate(projectId);
  // The QuickBooks total must equal what the customer was shown, to the cent.
  const qboTotal = estimate?.total ? Number(estimate.total) : null;
  const shown = Number(row.total);
  if (qboTotal !== null && Math.abs(qboTotal - shown) > 0.005) {
    patch.qboEstimate = step(false, `QuickBooks total ${qboTotal} does not equal the customer's ${shown}. Not sent.`);
    patch.qboEstimateId = result.qboId;
    return patch;
  }
  patch.qboEstimate = step(true, result.qboId);
  patch.qboEstimateId = result.qboId;
  patch.qboDocNumber = estimate?.doc_number ?? null;
  if (mode === "send") {
    await qboRequest(`/estimate/${encodeURIComponent(result.qboId)}/send?sendTo=${encodeURIComponent(row.email)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
    });
    patch.qboSend = step(true, row.email);
    if (estimate) await refreshEstimate(estimate).catch(() => undefined);
  }
  return patch;
}

/** Plain-language status for the team report and the admin view. */
export async function officialStatus(row: GuidedRow): Promise<{ status: string; qboUrl: string | null; estimateNumber: string | null }> {
  const delivery = row.delivery ?? {};
  const qboId = delivery.qboEstimateId ?? null;
  if (qboId && row.scope_project_id) {
    const estimate = await latestEstimate(row.scope_project_id).catch(() => null);
    const name = estimate ? estimateStatus(estimate.qbo_snapshot as never, true) : null;
    return {
      status: name ? ESTIMATE_STATUS_LABEL[name] : done(delivery, "qboSend") ? "Sent to the customer from QuickBooks" : "Created in QuickBooks, not sent",
      qboUrl: qboWebUrl("estimate", qboId, isSandbox()),
      estimateNumber: estimate?.doc_number ?? delivery.qboDocNumber ?? null,
    };
  }
  if (delivery.qboEstimate && !delivery.qboEstimate.ok) return { status: `QuickBooks estimate failed: ${delivery.qboEstimate.detail ?? "unknown error"}`, qboUrl: null, estimateNumber: null };
  if (row.price_withheld || row.review.some((r) => r.code !== "budgetary")) return { status: "Waiting for team review", qboUrl: null, estimateNumber: null };
  return { status: "Not in QuickBooks yet. Create the estimate from the scope platform", qboUrl: null, estimateNumber: null };
}

export async function deliverEstimate(input: DeliverInput): Promise<Delivery> {
  let row = await guidedById(input.id);
  if (!row) throw new Error("Estimate not found.");
  const brand = brandConfig(row.brand as BrandId);
  const viewUrl = `${input.origin}/estimator/e/${row.token}`;

  // 1. Scope platform project.
  let scope: { projectId: number; versionId: number } | null = null;
  if (done(row.delivery, "scope") && row.scope_project_id && row.scope_version_id) {
    scope = { projectId: row.scope_project_id, versionId: row.scope_version_id };
  } else {
    try {
      scope = await ensureScopeProject(row, input);
      await recordDelivery(row.id, { scope: step(Boolean(scope), scope ? String(scope.projectId) : "priced scope not available for retry") });
    } catch (error) {
      await recordDelivery(row.id, { scope: step(false, (error as Error).message) });
    }
  }

  // 2. Lead, HubSpot and the standard lead alert.
  if (!done(row.delivery, "lead")) {
    try {
      const lead = await sendLead(row, input.origin, scope?.projectId ?? null, input.service ?? null, input.clientAddress ?? null);
      if (lead.dealId) await setGuidedLinks(row.id, { leadDealId: lead.dealId });
      await recordDelivery(row.id, { lead: step(lead.ok, lead.detail) });
      row = (await guidedById(input.id))!;
    } catch (error) {
      await recordDelivery(row.id, { lead: step(false, (error as Error).message) });
    }
  }

  // 3. QuickBooks: an unsent estimate for every price the customer was shown.
  const mode = qboAction(row, qboMode());
  if (scope && mode !== "off" && !done(row.delivery, "qboSend") && !(mode === "create" && done(row.delivery, "qboEstimate"))) {
    try {
      if (!(await isQboConnected())) throw new Error("QuickBooks is not connected.");
      await recordDelivery(row.id, await qboEstimate(row, scope.projectId, mode));
    } catch (error) {
      await recordDelivery(row.id, { qboEstimate: step(false, (error as Error).message) });
    }
  }

  row = (await guidedById(input.id))!;
  const transport = activeTransport();

  // 4. The team's report.
  if (!done(row.delivery, "teamEmail")) {
    const official = await officialStatus(row);
    const message = teamReport(row, {
      scopeUrl: row.scope_project_id ? `${input.origin}/scopes/${row.scope_project_id}` : null,
      qboUrl: official.qboUrl,
      estimateNumber: official.estimateNumber,
      status: official.status,
      customerViewUrl: viewUrl,
    });
    const sent = await transport.send(TEAM_INBOX, message);
    await recordDelivery(row.id, { teamEmail: step(sent.ok, sent.ok ? TEAM_INBOX : sent.error) });
  }

  // 5. The customer hears from QuickBooks when the official estimate was
  //    sent. Otherwise one short confirmation, with no figures in it.
  if (!done(row.delivery, "qboSend") && !done(row.delivery, "customerEmail")) {
    const sent = await transport.send(row.email, customerConfirmation(row, viewUrl));
    await recordDelivery(row.id, { customerEmail: step(sent.ok, sent.ok ? brand?.name ?? null : sent.error) });
  }

  return (await guidedById(input.id))!.delivery;
}
