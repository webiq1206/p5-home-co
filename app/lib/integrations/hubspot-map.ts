/**
 * Mapping between P5 records and HubSpot properties.
 *
 * Pure and dependency-free so every mapping decision is testable without a
 * network call. The HubSpot client imports this; it holds no logic of its own.
 */

import type { Brand, DealStage, LeadSource } from "../leads/types.ts";

/**
 * P5 deal stage -> HubSpot internal stage ID, for portal 247066159.
 *
 * These do NOT match the visible labels, and that is the point. HubSpot keeps
 * a stage's original internal id when the stage is renamed, so the pipeline
 * that reads "New Lead" in the UI is stored as `appointmentscheduled`. Mapping
 * by label would look correct, compile fine, and silently file every new lead
 * under the wrong stage.
 *
 * Only `Decision Pending` was created fresh, which is why it alone has a
 * numeric id. If the pipeline is ever rebuilt these must be re-read from
 * HubSpot rather than assumed.
 */
export const STAGE_IDS: Record<DealStage, string> = {
  "New Lead": "appointmentscheduled",
  Contacting: "qualifiedtobuy",
  "Appointment Scheduled": "presentationscheduled",
  "Estimate in Progress": "decisionmakerboughtin",
  "Estimate Sent": "contractsent",
  "Decision Pending": "4182226638",
  "Closed Won": "closedwon",
  "Closed Lost": "closedlost",
};

/** The one pipeline, shared by every brand. */
export const PIPELINE_ID = "default";

/** Reverse lookup, for reading a deal back out of HubSpot. */
export const STAGE_BY_ID: Record<string, DealStage> = Object.fromEntries(
  Object.entries(STAGE_IDS).map(([stage, id]) => [id, stage as DealStage]),
) as Record<string, DealStage>;

export function stageIdFor(stage: DealStage): string {
  const id = STAGE_IDS[stage];
  if (!id) throw new Error(`No HubSpot stage id mapped for "${stage}"`);
  return id;
}

/** SLA status values as configured on the p5_sla_status property. */
const SLA_LABELS: Record<string, string> = {
  on_track: "On track",
  due_soon: "Due soon",
  breached: "Breached",
  met: "Met",
  after_hours: "After hours",
  not_applicable: "Not applicable",
};

/** HubSpot datetime properties take epoch milliseconds. */
function ms(value: Date | null): string | undefined {
  return value ? String(value.getTime()) : undefined;
}

/**
 * HubSpot date-only properties must be UTC midnight, or the API rejects them.
 * A local timestamp would otherwise land on the previous day for anyone west
 * of UTC, which is everyone here.
 */
function utcMidnight(value: Date | null): string | undefined {
  if (!value) return undefined;
  return String(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export type ContactSyncInput = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

/** Contact properties. Only non-empty values are sent, so a sync never blanks
 *  a field a human filled in on the HubSpot side. */
export function contactProperties(c: ContactSyncInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (c.firstName) out.firstname = c.firstName;
  if (c.lastName) out.lastname = c.lastName;
  if (c.email) out.email = c.email;
  if (c.phone) out.phone = c.phone;
  return out;
}

export type DealSyncInput = {
  name: string;
  brand: Brand;
  stage: DealStage;
  leadSource: LeadSource;
  leadSourceDetail: string | null;
  projectType: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  serviceArea: string | null;
  summary: string | null;
  estimatedValue: number | null;
  assignedTeamMember: string | null;
  hubspotOwnerId: string | null;
  receivedAt: Date;
  slaDeadline: Date | null;
  slaStatus: string;
  firstAttemptAt: Date | null;
  firstTwoWayAt: Date | null;
  nextAction: string | null;
  nextActionAt: Date | null;
  appointmentAt: Date | null;
  externalLeadId: string | null;
  facebookLeadId: string | null;
  originalForm: string | null;
  originalCampaign: string | null;
  closedLostReason: string | null;
};

/**
 * Deal properties.
 *
 * Undefined entries are stripped rather than sent as empty strings: HubSpot
 * treats "" as "clear this field", so sending every key on every sync would
 * erase anything a person had typed in HubSpot that P5 does not track.
 */
export function dealProperties(d: DealSyncInput): Record<string, string> {
  const raw: Record<string, string | undefined> = {
    dealname: d.name,
    pipeline: PIPELINE_ID,
    dealstage: stageIdFor(d.stage),

    p5_brand: d.brand,
    p5_lead_source: d.leadSource,
    p5_lead_source_detail: d.leadSourceDetail ?? undefined,
    p5_project_type: d.projectType ?? undefined,
    p5_property_address: d.propertyAddress ?? undefined,
    p5_property_city: d.propertyCity ?? undefined,
    p5_service_area: d.serviceArea ?? undefined,
    p5_assigned_team_member: d.assignedTeamMember ?? undefined,

    p5_sla_deadline: ms(d.slaDeadline),
    p5_sla_status: SLA_LABELS[d.slaStatus],
    p5_first_attempt_at: ms(d.firstAttemptAt),
    p5_first_two_way_at: ms(d.firstTwoWayAt),
    p5_next_action: d.nextAction ?? undefined,
    p5_next_action_at: ms(d.nextActionAt),
    p5_appointment_at: ms(d.appointmentAt),

    p5_external_lead_id: d.externalLeadId ?? undefined,
    p5_facebook_lead_id: d.facebookLeadId ?? undefined,
    p5_original_form: d.originalForm ?? undefined,
    p5_original_campaign: d.originalCampaign ?? undefined,
    p5_integration_sync_status: "Synced",

    description: d.summary ?? undefined,
    amount: d.estimatedValue === null ? undefined : String(d.estimatedValue),
    hubspot_owner_id: d.hubspotOwnerId ?? undefined,
    closed_lost_reason: d.closedLostReason ?? undefined,
  };

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** Exported for the tests that guard the date-only conversion. */
export const __internal = { ms, utcMidnight };
