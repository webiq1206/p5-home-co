/**
 * Data loading for the admin panel.
 *
 * The board is assembled by running the same pure rules the watchdog uses, so
 * what an employee sees and what the alerting path believes can never drift
 * apart. Read-only: every mutation goes through an explicit server action.
 */

import { query } from "../lib/db.ts";
import { formatPhone } from "../lib/leads/normalize.ts";
import {
  evaluateDeal,
  type AttentionBucket,
  type DealEvaluation,
  type DealSnapshot,
} from "../lib/leads/rules.ts";
import { loadSettings, type LeadManagerSettings } from "../lib/leads/settings.ts";
import type { Brand, DealStage, LeadSource } from "../lib/leads/types.ts";

export type LeadCard = {
  dealId: number;
  clientName: string;
  brand: Brand;
  projectType: string | null;
  leadSource: LeadSource;
  propertyCity: string | null;
  receivedAt: Date;
  ownerName: string | null;
  stage: DealStage;
  lastActivityAt: Date | null;
  nextAction: string | null;
  nextActionAt: Date | null;
  appointmentAt: Date | null;
  proposalStatus: string | null;
  email: string | null;
  phone: string | null;
  phoneDisplay: string;
  evaluation: DealEvaluation;
};

type Row = {
  id: string;
  stage: DealStage;
  brand: Brand;
  project_type: string | null;
  lead_source: LeadSource;
  property_city: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  received_at: string;
  first_attempt_at: string | null;
  first_two_way_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  appointment_at: string | null;
  snoozed_until: string | null;
  closed_lost_reason: string | null;
  proposal_status: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  last_activity_at: string | null;
};

const d = (v: string | null) => (v ? new Date(v) : null);

/** The order buckets are shown in: most urgent first. */
export const BUCKET_ORDER: AttentionBucket[] = [
  "critical",
  "needs_response",
  "due_today",
  "waiting_on_customer",
  "upcoming",
  "recently_completed",
];

export const BUCKET_LABELS: Record<AttentionBucket, string> = {
  critical: "Critical",
  needs_response: "Needs response",
  due_today: "Due today",
  waiting_on_customer: "Waiting on customer",
  upcoming: "Upcoming",
  recently_completed: "Recently completed",
  none: "Other",
};

/**
 * Load the attention board.
 *
 * `restrictToUserId` is set for roles that only see their own leads, so the
 * filter is applied in SQL rather than trusted to the UI.
 */
export async function loadAttentionBoard(
  restrictToUserId: number | null,
  now: Date = new Date(),
): Promise<{
  settings: LeadManagerSettings;
  buckets: { bucket: AttentionBucket; label: string; cards: LeadCard[] }[];
  totals: { open: number; unassigned: number; breached: number; openAlerts: number };
}> {
  const settings = await loadSettings();

  const rows = await query<Row>(
    `SELECT d.id, d.stage, d.brand, d.project_type, d.lead_source, d.property_city,
            d.owner_user_id, u.full_name AS owner_name,
            d.received_at, d.first_attempt_at, d.first_two_way_at,
            d.next_action, d.next_action_at, d.appointment_at, d.snoozed_until,
            d.closed_lost_reason, d.proposal_status,
            c.first_name, c.last_name, c.email, c.phone,
            (SELECT max(a.occurred_at) FROM activity a WHERE a.deal_id = d.id) AS last_activity_at
       FROM deal d
       JOIN contact c ON c.id = d.contact_id
       LEFT JOIN app_user u ON u.id = d.owner_user_id
      WHERE (d.stage NOT IN ('Closed Won','Closed Lost')
             OR d.closed_at > now() - interval '3 days')
        AND ($1::bigint IS NULL OR d.owner_user_id = $1::bigint)
      ORDER BY d.received_at ASC`,
    [restrictToUserId],
  );

  const cards: LeadCard[] = rows.map((row) => {
    const snapshot: DealSnapshot = {
      id: Number(row.id),
      stage: row.stage,
      ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
      receivedAt: new Date(row.received_at),
      firstAttemptAt: d(row.first_attempt_at),
      firstTwoWayAt: d(row.first_two_way_at),
      nextAction: row.next_action,
      nextActionAt: d(row.next_action_at),
      appointmentAt: d(row.appointment_at),
      snoozedUntil: d(row.snoozed_until),
      closedLostReason: row.closed_lost_reason,
      lastActivityAt: d(row.last_activity_at),
    };

    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

    return {
      dealId: snapshot.id,
      clientName: name || "Unnamed contact",
      brand: row.brand,
      projectType: row.project_type,
      leadSource: row.lead_source,
      propertyCity: row.property_city,
      receivedAt: snapshot.receivedAt,
      ownerName: row.owner_name,
      stage: row.stage,
      lastActivityAt: snapshot.lastActivityAt,
      nextAction: row.next_action,
      nextActionAt: snapshot.nextActionAt,
      appointmentAt: snapshot.appointmentAt,
      proposalStatus: row.proposal_status,
      email: row.email,
      phone: row.phone,
      phoneDisplay: formatPhone(row.phone),
      evaluation: evaluateDeal(snapshot, settings, now),
    };
  });

  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    cards: cards
      .filter((c) => c.evaluation.bucket === bucket)
      // Within a bucket, the longest-waiting lead comes first.
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
  })).filter((group) => group.cards.length > 0);

  const openCards = cards.filter(
    (c) => c.stage !== "Closed Won" && c.stage !== "Closed Lost",
  );

  const openAlertRows = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM alert WHERE resolved_at IS NULL",
  );

  return {
    settings,
    buckets: grouped,
    totals: {
      open: openCards.length,
      unassigned: openCards.filter((c) => c.ownerName === null).length,
      breached: openCards.filter((c) => c.evaluation.slaStatus === "breached").length,
      openAlerts: openAlertRows[0]?.n ?? 0,
    },
  };
}

/** "12 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Format an instant as Boise local time for display. */
export function boiseTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
