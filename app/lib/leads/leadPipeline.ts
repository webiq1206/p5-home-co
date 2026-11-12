/**
 * What happens to a lead right after it is saved: an immediate HubSpot sync,
 * bounded so the visitor never waits on HubSpot, then the team alert with the
 * HubSpot links. The watchdog stays the retry path: a sync that times out or
 * fails leaves the deal pending (or failed) and the next tick sends it.
 */

import { query } from "../db.ts";
import type { SubmittedField } from "./submittedFields.ts";
import { attributionFields } from "./submittedFields.ts";
import type { LeadCreatedNotifyInput } from "../notifications/lead-created.ts";

export type HubSpotSync = (dealId: number) => Promise<unknown>;

/** How long the intake response may wait on the inline sync. */
export function inlineSyncTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HUBSPOT_INLINE_SYNC_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 0 && value <= 15_000 ? value : 4_000;
}

/** Resolve within `ms`, or give up waiting (the work itself keeps running). Never rejects. */
export async function within<T>(work: Promise<T> | null | undefined, ms: number): Promise<T | undefined> {
  if (!work) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => undefined),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Start a sync that can never throw into the caller. */
export function startSync(sync: HubSpotSync | undefined, dealId: number): Promise<unknown> | null {
  if (!sync || !(dealId > 0)) return null;
  return Promise.resolve()
    .then(() => sync(dealId))
    .catch((error: Error) => {
      console.error("[lead-pipeline] inline HubSpot sync failed; the watchdog will retry:", error.message);
      return undefined;
    });
}

type AlertRow = {
  id: string;
  brand: string;
  project_type: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  summary: string | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  original_form: string | null;
  original_campaign: string | null;
  external_lead_id: string | null;
  facebook_lead_id: string | null;
  utm: Record<string, string> | null;
  hubspot_deal_id: string | null;
  timeline: string | null;
  best_time: string | null;
  contact_preference: string | null;
  request_kind: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  hubspot_contact_id: string | null;
};

/**
 * Everything the alert needs, read back from the saved deal so the email shows
 * what was stored: the HubSpot ids written by the sync, the attribution and
 * every submitted field. Returns the caller's fallback fields on any failure.
 */
export async function loadLeadAlert(
  dealId: number,
  fallback: LeadCreatedNotifyInput,
): Promise<LeadCreatedNotifyInput> {
  try {
    const rows = await query<AlertRow>(
      `SELECT d.id, d.brand, d.project_type, d.property_address, d.property_city, d.property_state, d.property_zip,
              d.summary, d.lead_source, d.lead_source_detail, d.original_form, d.original_campaign,
              d.external_lead_id, d.facebook_lead_id, d.utm, d.hubspot_deal_id, d.timeline, d.best_time,
              d.contact_preference, d.request_kind,
              c.first_name, c.last_name, c.email, c.phone, c.hubspot_contact_id
         FROM deal d JOIN contact c ON c.id = d.contact_id
        WHERE d.id = $1`,
      [dealId],
    );
    if (!rows.length) return fallback;
    const row = rows[0];
    const submissions = await query<{ fields: SubmittedField[] }>(
      "SELECT fields FROM lead_intake_submission WHERE deal_id = $1 ORDER BY received_at, id LIMIT 1",
      [dealId],
    ).catch(() => []);
    return {
      ...fallback,
      testLead: row.lead_source === "Facebook Lead Ad" ? row.utm?.meta_test_lead === "true" : fallback.testLead,
      dealId,
      brand: row.brand ?? fallback.brand,
      projectType: row.project_type ?? fallback.projectType,
      firstName: row.first_name ?? fallback.firstName,
      lastName: row.last_name ?? fallback.lastName,
      email: row.email ?? fallback.email,
      phone: row.phone ?? fallback.phone,
      propertyAddress: row.property_address ?? fallback.propertyAddress,
      propertyCity: row.property_city ?? fallback.propertyCity,
      propertyState: row.property_state ?? fallback.propertyState ?? null,
      propertyZip: row.property_zip ?? fallback.propertyZip ?? null,
      source: row.lead_source ?? fallback.source,
      hubspotContactId: row.hubspot_contact_id,
      hubspotDealId: row.hubspot_deal_id,
      submittedFields: submissions[0]?.fields ?? fallback.submittedFields ?? [],
      attribution: attributionFields({
        source: row.lead_source,
        sourceDetail: row.lead_source_detail,
        originalForm: row.original_form,
        originalCampaign: row.original_campaign,
        externalLeadId: row.external_lead_id,
        facebookLeadId: row.facebook_lead_id,
        utm: row.utm,
      }),
    };
  } catch (error) {
    console.error("[lead-pipeline] alert context not loaded:", (error as Error).message);
    return fallback;
  }
}
