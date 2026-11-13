/**
 * Storage for guided estimates. Server only.
 */

import { randomBytes } from "node:crypto";

import { query, queryOne } from "../db.ts";
import type { InternalReport, PricedEstimate, ReviewReason } from "./price.ts";
import type { CustomerEstimate, Submission } from "./types.ts";

export type DeliveryStep = { at: string; ok: boolean; detail?: string | null };
export type Delivery = Partial<Record<"scope" | "lead" | "qboCustomer" | "qboEstimate" | "qboSend" | "teamEmail" | "customerEmail", DeliveryStep>> & {
  qboEstimateId?: string | null;
  qboDocNumber?: string | null;
};

export type GuidedRow = {
  id: number;
  token: string;
  brand: string;
  client_key: string;
  project: string;
  tier: string;
  answers: Record<string, unknown>;
  address: string | null;
  property: Record<string, unknown> | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  marketing_consent: boolean;
  attribution: Record<string, string> | null;
  elapsed_ms: number | null;
  estimate_class: string;
  total: string;
  total_cost: string | null;
  margin: string | null;
  price_withheld: boolean;
  review: ReviewReason[];
  customer_view: CustomerEstimate;
  internal_report: InternalReport;
  rules_version: string;
  cost_book_version: string;
  scope_project_id: number | null;
  scope_version_id: number | null;
  lead_deal_id: number | null;
  delivery: Delivery;
  created_at: Date;
};

const COLS = `id::int, token, brand, client_key, project, tier, answers, address, property, first_name, last_name, email, phone,
  marketing_consent, attribution, elapsed_ms, estimate_class, total::text, total_cost::text, margin::text, price_withheld, review,
  customer_view, internal_report, rules_version, cost_book_version, scope_project_id::int, scope_version_id::int,
  lead_deal_id::int, delivery, created_at`;

export function newToken(): string {
  return randomBytes(20).toString("hex");
}

/**
 * Store a completed estimate. The same browser key on the same brand returns
 * the row already stored, so a retry never produces a second estimate.
 */
export async function insertGuided(input: {
  submission: Submission;
  estimate: PricedEstimate;
  customerView: CustomerEstimate;
  internal: InternalReport;
  priceWithheld: boolean;
}): Promise<{ row: GuidedRow; created: boolean }> {
  const { submission: s, estimate: e } = input;
  const inserted = await queryOne<GuidedRow>(
    `INSERT INTO guided_estimate
       (token, brand, client_key, project, tier, answers, address, property, first_name, last_name, email, phone,
        marketing_consent, attribution, elapsed_ms, estimate_class, total, total_cost, margin, price_withheld, review,
        customer_view, internal_report, rules_version, cost_book_version)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21::jsonb,
             $22::jsonb,$23::jsonb,$24,$25)
     ON CONFLICT (brand, client_key) DO NOTHING
     RETURNING ${COLS}`,
    [
      input.customerView.token,
      s.brand,
      s.clientKey,
      e.project,
      e.tier,
      JSON.stringify(e.answers),
      s.address,
      s.property ? JSON.stringify(s.property) : null,
      s.contact.firstName,
      s.contact.lastName,
      s.contact.email,
      s.contact.phone,
      s.contact.marketingConsent,
      JSON.stringify(s.attribution ?? {}),
      s.elapsedMs,
      e.estimateClass,
      e.pricing.totals.basePrice,
      e.pricing.totals.baseCost,
      e.pricing.totals.margin,
      input.priceWithheld,
      JSON.stringify(e.review),
      JSON.stringify(input.customerView),
      JSON.stringify(input.internal),
      e.versions.rules,
      e.versions.costBook,
    ],
  );
  if (inserted) return { row: inserted, created: true };
  const existing = await queryOne<GuidedRow>(`SELECT ${COLS} FROM guided_estimate WHERE brand = $1 AND client_key = $2`, [s.brand, s.clientKey]);
  if (!existing) throw new Error("The estimate could not be stored.");
  return { row: existing, created: false };
}

export async function guidedByToken(token: string): Promise<GuidedRow | null> {
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  return queryOne<GuidedRow>(`SELECT ${COLS} FROM guided_estimate WHERE token = $1`, [token]);
}

export async function guidedById(id: number): Promise<GuidedRow | null> {
  return queryOne<GuidedRow>(`SELECT ${COLS} FROM guided_estimate WHERE id = $1`, [id]);
}

export async function setGuidedLinks(id: number, fields: { scopeProjectId?: number; scopeVersionId?: number; leadDealId?: number }): Promise<void> {
  await query(
    `UPDATE guided_estimate SET
        scope_project_id = COALESCE($2, scope_project_id),
        scope_version_id = COALESCE($3, scope_version_id),
        lead_deal_id = COALESCE($4, lead_deal_id),
        updated_at = now()
      WHERE id = $1`,
    [id, fields.scopeProjectId ?? null, fields.scopeVersionId ?? null, fields.leadDealId ?? null],
  );
}

/** Merge one delivery step into the row. */
export async function recordDelivery(id: number, patch: Delivery): Promise<void> {
  await query("UPDATE guided_estimate SET delivery = delivery || $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(patch)]);
}

/** Estimates whose delivery never finished, oldest first, for the retry pass. */
export async function unfinishedDeliveries(limit = 20): Promise<GuidedRow[]> {
  return query<GuidedRow>(
    `SELECT ${COLS} FROM guided_estimate
      WHERE created_at > now() - interval '3 days'
        AND created_at < now() - interval '2 minutes'
        AND (NOT (delivery ? 'scope') OR NOT (delivery ? 'lead') OR NOT (delivery ? 'teamEmail')
             OR delivery->'scope'->>'ok' = 'false' OR delivery->'lead'->>'ok' = 'false' OR delivery->'teamEmail'->>'ok' = 'false')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
}

const EVENT_NAMES = new Set(["started", "project_selected", "step_viewed", "address_selected", "property_confirmed", "completed", "contact_submitted", "estimate_viewed", "consultation_requested", "abandoned"]);

export async function recordEvent(e: { session: string; brand: string; project: string | null; name: string; step: string | null; attribution: Record<string, string> | null }): Promise<boolean> {
  if (!EVENT_NAMES.has(e.name) || !/^[A-Za-z0-9-]{8,64}$/.test(e.session)) return false;
  await query(
    "INSERT INTO guided_estimate_event (session, brand, project, name, step, attribution) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
    [e.session, e.brand, e.project, e.name, e.step?.slice(0, 60) ?? null, e.attribution ? JSON.stringify(e.attribution) : null],
  );
  return true;
}
