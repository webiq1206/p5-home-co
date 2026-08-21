/**
 * Lead detail: everything known about one lead, and the actions to move it on.
 *
 * The board answers "what needs me?"; this answers "what do I do about it?".
 * Contact details are links, not text, because the next step is almost always
 * a call.
 */

import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { getSessionUser } from "../../../lib/auth.ts";
import { isDatabaseConfigured, query } from "../../../lib/db.ts";
import { can, seesAllLeads } from "../../../lib/leads/permissions.ts";
import { formatPhone } from "../../../lib/leads/normalize.ts";
import { evaluateDeal, type DealSnapshot } from "../../../lib/leads/rules.ts";
import { loadSettings } from "../../../lib/leads/settings.ts";
import type { DealStage } from "../../../lib/leads/types.ts";
import { boiseTime, timeAgo } from "../../queries.ts";
import { LogOutcomeForm } from "../../LogOutcomeForm.tsx";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  brand: string;
  stage: DealStage;
  project_type: string | null;
  lead_source: string;
  property_address: string | null;
  property_city: string | null;
  summary: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  received_at: string;
  sla_deadline: string | null;
  first_attempt_at: string | null;
  first_two_way_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  appointment_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  closed_lost_reason: string | null;
  handoff_project_url: string | null;
  handoff_status: string | null;
  proposal_status: string | null;
  integration_sync_status: string;
  last_integration_error: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  last_activity_at: string | null;
};

type ActivityRow = {
  id: string;
  kind: string;
  outcome: string | null;
  body: string | null;
  is_human_attempt: boolean;
  is_two_way: boolean;
  occurred_at: string;
  who: string | null;
};

const d = (v: string | null) => (v ? new Date(v) : null);

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) redirect("/admin");

  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const { id } = await params;
  const dealId = Number(id);
  if (!Number.isInteger(dealId) || dealId <= 0) notFound();

  const rows = await query<Row>(
    `SELECT d.*, c.first_name, c.last_name, c.email, c.phone,
            u.full_name AS owner_name,
            (SELECT max(a.occurred_at) FROM activity a WHERE a.deal_id = d.id) AS last_activity_at
       FROM deal d
       JOIN contact c ON c.id = d.contact_id
       LEFT JOIN app_user u ON u.id = d.owner_user_id
      WHERE d.id = $1`,
    [dealId],
  );
  if (!rows.length) notFound();
  const row = rows[0];

  // Roles that see only their own leads must not reach someone else's by URL.
  // The board filters in SQL; this is the direct-link equivalent.
  if (!seesAllLeads(user.role) && Number(row.owner_user_id) !== user.id) {
    notFound();
  }

  const settings = await loadSettings();
  const now = new Date();
  const tz = settings.calendar.timeZone;

  const snapshot: DealSnapshot = {
    id: dealId,
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
  const evaluation = evaluateDeal(snapshot, settings, now);

  const activity = await query<ActivityRow>(
    `SELECT a.id, a.kind, a.outcome, a.body, a.is_human_attempt, a.is_two_way,
            a.occurred_at, u.full_name AS who
       FROM activity a
       LEFT JOIN app_user u ON u.id = a.user_id
      WHERE a.deal_id = $1
      ORDER BY a.occurred_at DESC
      LIMIT 50`,
    [dealId],
  );

  const clientName =
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Unnamed contact";

  return (
    <>
      <header className="admin-bar">
        <Link href="/admin" className="admin-brand">
          ← <small>Needs your attention</small>
        </Link>
        <span className="admin-who">{user.fullName}</span>
      </header>

      <main className="admin-main">
        <h1 className="admin-h1">{clientName}</h1>
        <p className="admin-sub">{row.name}</p>

        {evaluation.headline && (
          <div
            className={`admin-notice${evaluation.bucket === "critical" ? " admin-notice-error" : ""}`}
          >
            <strong>Needs attention</strong>
            {evaluation.headline}
          </div>
        )}

        <div className="lead-actions">
          {row.phone && (
            <a className="lead-action lead-action-primary" href={`tel:${row.phone}`}>
              Call {formatPhone(row.phone)}
            </a>
          )}
          {row.phone && (
            <a className="lead-action" href={`sms:${row.phone}`}>Text</a>
          )}
          {row.email && (
            <a className="lead-action" href={`mailto:${row.email}`}>Email</a>
          )}
        </div>

        <div className="lead-meta lead-meta-wide">
          <div><b>Brand</b>{row.brand}</div>
          <div><b>Project</b>{row.project_type ?? "Not stated"}</div>
          <div><b>Source</b>{row.lead_source}</div>
          <div><b>Stage</b>{row.stage}</div>
          <div><b>Owner</b>{row.owner_name ?? "Unassigned"}</div>
          <div><b>Inquired</b>{timeAgo(new Date(row.received_at), now)}</div>
          <div>
            <b>Response</b>
            {row.first_attempt_at
              ? `Answered in ${evaluation.responseMinutes} business min`
              : `${evaluation.responseMinutes} min waiting`}
          </div>
          <div>
            <b>Next action</b>
            {row.next_action
              ? `${row.next_action}${row.next_action_at ? ` — ${boiseTime(new Date(row.next_action_at), tz)}` : ""}`
              : "None set"}
          </div>
          {row.appointment_at && (
            <div><b>Appointment</b>{boiseTime(new Date(row.appointment_at), tz)}</div>
          )}
          {(row.property_address || row.property_city) && (
            <div>
              <b>Property</b>
              {[row.property_address, row.property_city].filter(Boolean).join(", ")}
            </div>
          )}
        </div>

        {row.summary && (
          <div className="lead-summary">
            <b>What they asked for</b>
            <p>{row.summary}</p>
          </div>
        )}

        {can(user.role, "log_outcome") ? (
          <section className="lead-panel">
            <h2>Log what happened</h2>
            <LogOutcomeForm
              dealId={dealId}
              currentStage={row.stage}
              lostReasons={settings.lostReasons}
            />
          </section>
        ) : (
          <p className="lead-note">You have read-only access to this lead.</p>
        )}

        <section className="lead-panel">
          <h2>History</h2>
          {activity.length === 0 ? (
            <p className="lead-note">Nothing logged yet.</p>
          ) : (
            <ol className="lead-timeline">
              {activity.map((a) => (
                <li key={a.id}>
                  <div className="lead-timeline-head">
                    <strong>{a.outcome ?? a.kind}</strong>
                    <span>{boiseTime(new Date(a.occurred_at), tz)}</span>
                  </div>
                  {a.body && <p>{a.body}</p>}
                  <small>
                    {a.who ?? "System"}
                    {a.is_human_attempt ? " · counted as a contact attempt" : " · not a contact attempt"}
                    {a.is_two_way ? " · spoke with them" : ""}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>

        {can(user.role, "view_integration_health") && (
          <section className="lead-panel">
            <h2>Integrations</h2>
            <div className="lead-meta">
              <div><b>HubSpot sync</b>{row.integration_sync_status}</div>
              <div><b>Handoff</b>{row.handoff_status ?? "Planned — not connected"} <em>(manual)</em></div>
              <div><b>Proposal</b>{row.proposal_status ?? "—"} <em>(manual)</em></div>
            </div>
            {row.last_integration_error && (
              <p className="lead-error lead-error-block">{row.last_integration_error}</p>
            )}
          </section>
        )}
      </main>
    </>
  );
}
