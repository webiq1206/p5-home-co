/**
 * Meta (Facebook and Instagram) Instant Form leads into the hub.
 *
 * Meta's webhook only carries a leadgen_id. The delivery is saved first
 * (meta_leadgen_event), then the full lead is read from the Graph API with the
 * Page token, mapped to a brand, and ingested exactly like a website lead:
 * source "Facebook Lead Ad", the same inline HubSpot sync and the same team
 * alert. Anything that fails after the save stays pending and the watchdog
 * retries it, so a Graph or HubSpot outage never loses a lead.
 *
 * The brand mapping is ported from boise-remodeling-co shared/metaLeadAttribution.ts
 * (PR #138): form id first, then a "P5 | <Brand> | ..." campaign name, and an
 * unknown form falls back to P5 Home Co with the form's own name kept.
 * Setup: docs/meta-leadgen-setup.md.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { query } from "../db.ts";
import { ingestLead } from "../leads/intake.ts";
import { composeAddress } from "../leads/intakeContract.ts";
import { loadLeadAlert, startSync, within, inlineSyncTimeoutMs, type HubSpotSync } from "../leads/leadPipeline.ts";
import { loadSettings } from "../leads/settings.ts";
import type { SubmittedField } from "../leads/submittedFields.ts";
import type { Brand, InboundLead } from "../leads/types.ts";
import { notifyLeadCreated, type LeadCreatedNotifyInput } from "../notifications/lead-created.ts";

export const GRAPH_VERSION = "v21.0";
const LOG = "[meta-leadgen]";

/** Instant Forms on the P5 Home Co Page (1228704823655951). Add a row per new form. */
export const META_LEAD_FORMS: Record<string, { brand: Brand; service: string; formName: string }> = {
  "3570634953094714": { brand: "Boise Handyman Co", service: "repair-list", formName: "Boise Handyman Co | Repair List Quote | 2026-11" },
  "1152385197288111": { brand: "Boise Remodeling Co", service: "remodel", formName: "Boise Remodeling Co | Remodel Quote | 2026-11" },
  "965115442960999": { brand: "Boise Construction Co", service: "custom-home", formName: "Boise Construction Co | Custom Home Consult | 2026-11" },
  "1636211868536619": { brand: "Boise Cabinet Co", service: "cabinetry", formName: "Boise Cabinet Co | Cabinetry Quote | 2026-11" },
  "1807836587099476": { brand: "P5 Home Co", service: "routing", formName: "P5 Home Co | Find Your Specialist | 2026-11" },
};

/** Brands a campaign name may name, "P5 | <Brand> | ...". */
const CAMPAIGN_BRANDS: readonly Brand[] = [
  "P5 Home Co", "Boise Construction Co", "Boise Remodeling Co", "Boise Cabinet Co", "Boise Handyman Co", "Boise ADU Co",
];

/** The service a form sells, as a HubSpot p5_project_type the portal accepts. */
const SERVICE_PROJECT_TYPES: Record<string, string> = {
  "repair-list": "handyman",
  remodel: "remodel",
  "custom-home": "Custom home",
};

export const GRAPH_LEAD_FIELDS = [
  "id", "created_time", "form_id", "field_data", "ad_id", "ad_name", "adset_id", "adset_name",
  "campaign_id", "campaign_name", "platform", "is_organic",
] as const;

export type GraphFieldDatum = { name?: string; values?: string[] };
export type GraphLead = {
  id: string;
  created_time?: string;
  form_id?: string;
  field_data?: GraphFieldDatum[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
};

export type MetaAttribution = {
  brand: Brand;
  resolvedBy: "form" | "campaign-name" | "none";
  service: string | null;
  formId: string;
  formName: string;
  pageId: string;
};

export function brandFromCampaignName(name: string | undefined): Brand | null {
  if (!name) return null;
  const segments = name.split("|").map((part) => part.trim().toLowerCase());
  return CAMPAIGN_BRANDS.find((brand) => segments.includes(brand.toLowerCase())) ?? null;
}

/** Form id, then campaign name, then P5 Home Co with the form name kept. */
export function resolveMetaBrand(lead: GraphLead, event: { formId?: string | null; pageId?: string | null }, fetchedFormName?: string | null): MetaAttribution {
  const formId = lead.form_id || event.formId || "";
  const known = formId ? META_LEAD_FORMS[formId] : undefined;
  const byCampaign = known ? null : brandFromCampaignName(lead.campaign_name);
  return {
    brand: known?.brand ?? byCampaign ?? "P5 Home Co",
    resolvedBy: known ? "form" : byCampaign ? "campaign-name" : "none",
    service: known?.service ?? null,
    formId,
    formName: known?.formName ?? fetchedFormName ?? (formId ? `Meta Instant Form ${formId}` : "Meta Instant Form"),
    pageId: event.pageId ?? "",
  };
}

// ---------------------------------------------------------------------------
// Configuration and signature
// ---------------------------------------------------------------------------

export type MetaConfig = {
  verifyToken: string;
  appSecret: string;
  /** page id -> Page access token, from META_PAGE_TOKENS. */
  pageTokens: Record<string, string>;
  /** META_PAGE_ACCESS_TOKEN, for any page not in the map. */
  defaultToken: string;
};

export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig {
  const pageTokens: Record<string, string> = {};
  if (env.META_PAGE_TOKENS?.trim()) {
    try {
      const parsed = JSON.parse(env.META_PAGE_TOKENS) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [page, token] of Object.entries(parsed as Record<string, unknown>)) {
          if (/^\d+$/.test(page) && typeof token === "string" && token.trim()) pageTokens[page] = token.trim();
        }
      }
    } catch {
      console.error(`${LOG} META_PAGE_TOKENS is not valid JSON ({"<page id>": "<token>"}); it is ignored.`);
    }
  }
  return {
    verifyToken: env.META_LEADGEN_VERIFY_TOKEN?.trim() ?? "",
    appSecret: env.META_APP_SECRET?.trim() ?? "",
    pageTokens,
    defaultToken: env.META_PAGE_ACCESS_TOKEN?.trim() ?? "",
  };
}

export function pageToken(config: MetaConfig, pageId: string | null | undefined): string {
  return (pageId && config.pageTokens[pageId]) || config.defaultToken;
}

/** Timing-safe X-Hub-Signature-256 check on the raw body. */
export function signatureIsValid(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice(7).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export type LeadgenEvent = { leadgenId: string; pageId: string | null; formId: string | null; adId: string | null; change: unknown };

/** Every leadgen change in one delivery (Meta may batch several). */
export function leadgenEvents(body: unknown): LeadgenEvent[] {
  const events: LeadgenEvent[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return events;
  for (const entry of entries as { id?: unknown; changes?: unknown[] }[]) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []) as { field?: unknown; value?: Record<string, unknown> }[]) {
      if (change?.field !== "leadgen") continue;
      const value = change.value ?? {};
      const id = value.leadgen_id;
      const leadgenId = typeof id === "string" || typeof id === "number" ? String(id) : "";
      if (!/^\d{1,40}$/.test(leadgenId)) continue;
      const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
      events.push({
        leadgenId,
        pageId: text(value.page_id) ?? text(entry.id),
        formId: text(value.form_id),
        adId: text(value.ad_id),
        change: value,
      });
    }
  }
  return events;
}

/** Save deliveries before Meta gets its 200. Returns the ids that were new. */
export async function saveLeadgenEvents(events: readonly LeadgenEvent[]): Promise<string[]> {
  const fresh: string[] = [];
  for (const event of events) {
    const rows = await query<{ leadgen_id: string }>(
      `INSERT INTO meta_leadgen_event (leadgen_id, page_id, form_id, ad_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (leadgen_id) DO NOTHING
       RETURNING leadgen_id`,
      [event.leadgenId, event.pageId, event.formId, event.adId, JSON.stringify(event.change)],
    );
    if (rows.length) fresh.push(event.leadgenId);
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Graph lead to an InboundLead
// ---------------------------------------------------------------------------

function fieldValue(data: readonly GraphFieldDatum[], ...names: string[]): string | null {
  for (const name of names) {
    const match = data.find((field) => field.name?.toLowerCase() === name);
    const value = match?.values?.filter((v) => typeof v === "string" && v.trim()).join(", ").trim();
    if (value) return value.slice(0, 2000);
  }
  return null;
}

/** Meta's standard contact fields; every other field is a custom question. */
const STANDARD_FIELDS = new Set([
  "first_name", "last_name", "full_name", "email", "phone_number", "phone", "street_address",
  "city", "state", "province", "zip_code", "zip", "post_code", "postal_code", "country",
]);

/** Every field_data entry verbatim, question name as Meta sent it. */
export function metaSubmittedFields(lead: GraphLead, attribution: MetaAttribution): SubmittedField[] {
  const fields: SubmittedField[] = (lead.field_data ?? [])
    .filter((field) => field.name)
    .map((field) => ({ label: field.name!, value: (field.values ?? []).join(", ").trim() }))
    .filter((field) => field.value);
  return [
    ...fields,
    { label: "Meta lead id", value: lead.id },
    ...(lead.created_time ? [{ label: "Submitted at (Meta)", value: lead.created_time }] : []),
    { label: "Meta form", value: attribution.formName },
  ];
}

export function metaInboundLead(lead: GraphLead, attribution: MetaAttribution, receivedAt = new Date()): InboundLead {
  const data = lead.field_data ?? [];
  let firstName = fieldValue(data, "first_name");
  let lastName = fieldValue(data, "last_name");
  const full = fieldValue(data, "full_name");
  if (!firstName && !lastName && full) {
    const parts = full.split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }
  const zip = fieldValue(data, "zip_code", "zip", "post_code", "postal_code");
  const custom = data
    .filter((field) => field.name && !STANDARD_FIELDS.has(field.name.toLowerCase()) && (field.values ?? []).some(Boolean))
    .map((field) => `${field.name}: ${(field.values ?? []).join(", ")}`);
  const projectAnswer = fieldValue(data, "project", "project_type", "service", "what_project", "what_service");
  const platform = (lead.platform ?? "").toLowerCase();
  const utm: Record<string, string> = {
    utm_source: platform === "ig" || platform === "instagram" ? "instagram" : "facebook",
    utm_medium: lead.is_organic ? "social" : "paid_social",
  };
  const put = (key: string, value: string | null | undefined) => { if (value) utm[key] = String(value).slice(0, 300); };
  put("utm_campaign", lead.campaign_name);
  put("meta_page_id", attribution.pageId);
  put("meta_form_id", attribution.formId);
  put("meta_form_name", attribution.formName);
  put("meta_campaign_id", lead.campaign_id);
  put("meta_campaign_name", lead.campaign_name);
  put("meta_adset_id", lead.adset_id);
  put("meta_adset_name", lead.adset_name);
  put("meta_ad_id", lead.ad_id);
  put("meta_ad_name", lead.ad_name);
  put("meta_platform", lead.platform);
  if (lead.is_organic) utm.meta_is_organic = "Yes";
  if (attribution.service) utm.service = attribution.service;

  const summary = [
    `Facebook Lead Ad (Instant Form): ${attribution.formName}`,
    lead.campaign_name ? `Campaign: ${lead.campaign_name}` : "",
    lead.ad_name ? `Ad: ${lead.ad_name}` : "",
    attribution.resolvedBy === "none" ? "Brand: not mapped to a form or campaign; filed under P5 Home Co." : "",
    ...custom,
  ].filter(Boolean).join("\n");

  return {
    firstName,
    lastName,
    email: fieldValue(data, "email"),
    phone: fieldValue(data, "phone_number", "phone"),
    brand: attribution.brand,
    projectType: projectAnswer ?? (attribution.service ? SERVICE_PROJECT_TYPES[attribution.service] ?? null : null),
    source: "Facebook Lead Ad",
    sourceDetail: lead.ad_name ?? lead.campaign_name ?? attribution.formName,
    propertyAddress: composeAddress(fieldValue(data, "street_address"), zip),
    propertyCity: fieldValue(data, "city"),
    propertyState: fieldValue(data, "state", "province"),
    propertyZip: zip,
    summary,
    // The leadgen id is the idempotency key (deal.external_lead_id and
    // facebook_lead_id), so a redelivery can never make a second deal.
    externalLeadId: lead.id,
    originalForm: attribution.formName,
    originalCampaign: lead.campaign_name ?? null,
    utm,
    receivedAt,
    submittedFields: metaSubmittedFields(lead, attribution),
    submissionChannel: "Facebook Lead Ad",
  };
}

// ---------------------------------------------------------------------------
// Processing a saved delivery
// ---------------------------------------------------------------------------

export type MetaDeps = {
  fetch?: typeof fetch;
  syncHubSpot?: HubSpotSync;
  notify?: typeof notifyLeadCreated;
  env?: Record<string, string | undefined>;
  inlineSyncTimeoutMs?: number;
};

export type ProcessOutcome =
  | { status: "ingested"; dealId: number; created: boolean }
  | { status: "rejected"; error: string }
  | { status: "retry"; error: string }
  | { status: "skipped"; reason: string };

class GraphError extends Error {}

async function graphGet<T>(fetcher: typeof fetch, path: string, token: string): Promise<T> {
  let response: Response;
  try {
    // The token rides in the Authorization header, never the URL.
    response = await fetcher(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GraphError("graph-network-error");
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: { code?: number } };
  if (!response.ok || body.error) throw new GraphError(`graph-http-${response.status}${body.error?.code ? `-code-${body.error.code}` : ""}`);
  return body;
}

const MAX_ATTEMPTS = 12;

async function finish(leadgenId: string, state: "pending" | "ingested" | "rejected" | "failed", error: string | null, extra: { dealId?: number; lead?: unknown } = {}): Promise<void> {
  await query(
    `UPDATE meta_leadgen_event SET state = $2, last_error = $3, deal_id = COALESCE($4, deal_id),
            lead = COALESCE($5::jsonb, lead), lease_until = NULL, updated_at = now()
      WHERE leadgen_id = $1`,
    [leadgenId, state, error, extra.dealId ?? null, extra.lead === undefined ? null : JSON.stringify(extra.lead)],
  );
}

/**
 * Read one saved delivery's lead from Graph, ingest it, sync it and alert.
 * Idempotent: a leased row is processed by one caller at a time, and the
 * leadgen id dedupes the deal, so a retry can never make a second lead.
 */
export async function processMetaLeadEvent(leadgenId: string, deps: MetaDeps = {}): Promise<ProcessOutcome> {
  const claimed = await query<{ page_id: string | null; form_id: string | null; attempts: number; lead: GraphLead | null }>(
    `UPDATE meta_leadgen_event SET lease_until = now() + interval '2 minutes', attempts = attempts + 1, updated_at = now()
      WHERE leadgen_id = $1 AND state = 'pending' AND (lease_until IS NULL OR lease_until < now())
      RETURNING page_id, form_id, attempts, lead`,
    [leadgenId],
  );
  if (!claimed.length) return { status: "skipped", reason: "not pending or already in progress" };
  const event = claimed[0];
  const config = metaConfig(deps.env);
  const fetcher = deps.fetch ?? fetch;
  try {
    const token = pageToken(config, event.page_id);
    if (!token) {
      // Fail closed, never drop: the delivery waits until a token is set.
      console.error(`${LOG} no Page token for page ${event.page_id ?? "unknown"} (META_PAGE_TOKENS / META_PAGE_ACCESS_TOKEN); lead ${leadgenId} kept pending.`);
      await finish(leadgenId, "pending", "missing-page-token");
      return { status: "retry", error: "missing-page-token" };
    }
    const lead = event.lead?.id ? event.lead : await graphGet<GraphLead>(fetcher, `${encodeURIComponent(leadgenId)}?fields=${GRAPH_LEAD_FIELDS.join(",")}`, token);
    if (String(lead.id) !== leadgenId) throw new GraphError("graph-lead-id-mismatch");
    let formName: string | null = null;
    const formId = lead.form_id || event.form_id;
    if (formId && !META_LEAD_FORMS[formId]) {
      formName = await graphGet<{ name?: string }>(fetcher, `${encodeURIComponent(formId)}?fields=name`, token)
        .then((form) => form.name?.trim().slice(0, 200) || null)
        .catch(() => null);
    }
    const attribution = resolveMetaBrand(lead, { formId: event.form_id, pageId: event.page_id }, formName);
    if (attribution.resolvedBy === "none") console.warn(`${LOG} lead ${leadgenId} form ${attribution.formId || "unknown"} is not mapped; filed under P5 Home Co. Add it to META_LEAD_FORMS.`);
    const inbound = metaInboundLead(lead, attribution);
    const result = await ingestLead(inbound, await loadSettings());
    if (result.status === "rejected") {
      // The full Graph lead stays on the row, so nothing is lost.
      await finish(leadgenId, "rejected", result.errors.map((e) => `${e.field}: ${e.message}`).join("; ").slice(0, 500), { lead });
      console.error(`${LOG} lead ${leadgenId} rejected by intake validation; kept in meta_leadgen_event for review.`);
      return { status: "rejected", error: "validation" };
    }
    await finish(leadgenId, "ingested", null, { dealId: result.dealId > 0 ? result.dealId : undefined, lead });
    const sync = result.dealId > 0 ? startSync(deps.syncHubSpot, result.dealId) : null;
    await within(sync, deps.inlineSyncTimeoutMs ?? inlineSyncTimeoutMs(deps.env));
    if (result.status === "created") {
      const notice: LeadCreatedNotifyInput = {
        dealId: result.dealId,
        brand: inbound.brand,
        projectType: inbound.projectType,
        firstName: inbound.firstName,
        lastName: inbound.lastName,
        email: inbound.email,
        phone: inbound.phone,
        propertyCity: inbound.propertyCity,
        propertyAddress: inbound.propertyAddress,
        propertyState: inbound.propertyState,
        propertyZip: inbound.propertyZip,
        summary: inbound.summary,
        source: inbound.source,
        originalForm: inbound.originalForm,
        submittedFields: inbound.submittedFields,
      };
      await (deps.notify ?? notifyLeadCreated)({
        ...notice,
        prepare: async () => {
          await within(sync, 10_000);
          return loadLeadAlert(result.dealId, notice);
        },
      });
    }
    return { status: "ingested", dealId: result.dealId, created: result.status === "created" };
  } catch (error) {
    const code = error instanceof GraphError ? error.message : "meta-processing-error";
    if (!(error instanceof GraphError)) console.error(`${LOG} lead ${leadgenId} failed:`, (error as Error).message);
    const state = event.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    await finish(leadgenId, state, code).catch(() => undefined);
    return { status: "retry", error: code };
  }
}

/** Watchdog retry path: anything saved and still pending. */
export async function processPendingMetaLeads(limit = 10, deps: MetaDeps = {}): Promise<{ attempted: number; ingested: number }> {
  const rows = await query<{ leadgen_id: string }>(
    `SELECT leadgen_id FROM meta_leadgen_event
      WHERE state = 'pending' AND (lease_until IS NULL OR lease_until < now())
      ORDER BY received_at LIMIT $1`,
    [limit],
  ).catch(() => []);
  let ingested = 0;
  for (const row of rows) {
    const outcome = await processMetaLeadEvent(row.leadgen_id, deps);
    if (outcome.status === "ingested") ingested++;
  }
  return { attempted: rows.length, ingested };
}
