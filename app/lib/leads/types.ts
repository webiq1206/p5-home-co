/**
 * Domain vocabulary for the P5 always-on lead manager.
 *
 * These values are the contract between the website forms, the admin panel,
 * the rules engine, and (later) HubSpot. Changing a stored value here is a
 * migration, not an edit.
 */

/** The six P5 operating brands. Brand lives on the deal, never only on the contact. */
export const BRANDS = [
  "P5 Home Co",
  "Boise Construction Co",
  "Boise Remodeling Co",
  "Boise Handyman Co",
  "Boise ADU Co",
  "Boise Cabinet Co",
] as const;
export type Brand = (typeof BRANDS)[number];

/** Where a lead came from. Mirrors the HubSpot Lead Source property. */
export const LEAD_SOURCES = [
  "Facebook Lead Ad",
  "Organic Website",
  "Google Business Profile",
  "Direct Email",
  "Phone",
  "Referral",
  "Manual Entry",
  "Paid Search",
  "Social Media",
  "Other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** One shared pipeline across all brands, filtered by brand in views. */
export const DEAL_STAGES = [
  "New Lead",
  "Contacting",
  "Appointment Scheduled",
  "Estimate in Progress",
  "Estimate Sent",
  "Decision Pending",
  "Closed Won",
  "Closed Lost",
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/** Stages that no longer need a next action. */
export const CLOSED_STAGES: readonly DealStage[] = ["Closed Won", "Closed Lost"];

export function isClosed(stage: DealStage): boolean {
  return CLOSED_STAGES.includes(stage);
}

/** Outcomes an employee can log against a contact attempt. */
export const OUTCOMES = [
  "Connected",
  "Left Voicemail",
  "No Answer",
  "Sent Email",
  "Sent Text",
  "Appointment Scheduled",
  "Not Ready",
  "Not a Fit",
  "Wrong Number",
  "Follow-Up Required",
  "Other",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Outcomes that count as genuine two-way contact with a human.
 *
 * An automatic acknowledgment is never one of these, which is what keeps an
 * after-hours auto-reply from silently satisfying the response SLA.
 */
export const TWO_WAY_OUTCOMES: readonly Outcome[] = ["Connected", "Appointment Scheduled"];

/**
 * Every outcome is a human contact *attempt*, which stops the first-attempt
 * clock even when nobody picked up.
 */
export function isTwoWayContact(outcome: Outcome): boolean {
  return TWO_WAY_OUTCOMES.includes(outcome);
}

/** Internal roles. Permissions are enforced server-side on every action. */
export const ROLES = [
  "administrator",
  "lead_coordinator",
  "manager",
  "sales_rep",
  "project_manager",
] as const;
export type Role = (typeof ROLES)[number];

/** SLA state for a lead awaiting its first human response. */
export type SlaStatus = "on_track" | "due_soon" | "breached" | "met" | "after_hours" | "not_applicable";

/** Health of an outbound integration, surfaced to administrators only. */
export type IntegrationState = "connected" | "degraded" | "failed" | "planned" | "not_connected";

/**
 * Integrations the system knows about. Handoff and QuickBooks are deliberately
 * "planned": they must never raise alerts, create tasks, appear in Needs Your
 * Attention, or fail a deployment while their feature flags are off.
 */
export const PLANNED_INTEGRATIONS = ["handoff", "quickbooks"] as const;
export type PlannedIntegration = (typeof PLANNED_INTEGRATIONS)[number];

/** A normalized lead as it enters the system, before storage. */
export type InboundLead = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  brand: Brand;
  projectType: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  summary: string | null;
  /** Stable id from the originating system, used as an idempotency key. */
  externalLeadId: string | null;
  originalForm: string | null;
  originalCampaign: string | null;
  utm: Record<string, string> | null;
  receivedAt: Date;
  /**
   * Optional, from the two-step forms (docs/lead-intake-contract.md). Every
   * existing caller leaves them out and stores exactly what it stored before.
   */
  /** The brand site's own request id, unique per brand. */
  brandExternalId?: string | null;
  requestKind?: RequestKind | null;
  contactPreference?: LeadContactPreference | null;
  bestTime?: string | null;
  timeline?: string | null;
  /** Links to files the brand site stored; P5 keeps the link, not a copy. */
  files?: readonly LeadFileLink[];
  /** State and ZIP as sent, for the HubSpot contact's own address fields. */
  propertyState?: string | null;
  propertyZip?: string | null;
  /**
   * Every field the submission carried (submittedFields.ts), kept verbatim and
   * sent to HubSpot as a note, so nothing without a property is lost.
   */
  submittedFields?: readonly { label: string; value: string }[];
  /** Where the submission came from, e.g. "Website form" or "Facebook Lead Ad". */
  submissionChannel?: string | null;
};

/** A quote request or a "Have us call you" request. */
export const REQUEST_KINDS = ["quote", "callback"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

/** How the visitor asked to be reached. */
export const LEAD_CONTACT_PREFERENCES = ["call", "text", "email"] as const;
export type LeadContactPreference = (typeof LEAD_CONTACT_PREFERENCES)[number];

/** A file the visitor sent, stored by the site that received it. */
export type LeadFileLink = {
  name: string;
  url: string;
  contentType: string | null;
  size: number | null;
};
