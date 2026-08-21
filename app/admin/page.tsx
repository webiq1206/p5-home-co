/**
 * Needs Your Attention: the default screen of the lead manager.
 *
 * Everything an employee has to do today, ordered by urgency, with the reason
 * stated in a sentence rather than implied by a colour. Most people using this
 * are on a phone between jobs, so the primary actions are call, text, and
 * email, and they are big enough to hit one-handed.
 */

import { redirect } from "next/navigation";

import { getSessionUser } from "../lib/auth.ts";
import { isDatabaseConfigured } from "../lib/db.ts";
import { seesAllLeads } from "../lib/leads/permissions.ts";
import {
  boiseTime,
  loadAttentionBoard,
  timeAgo,
  type LeadCard,
} from "./queries.ts";

export const dynamic = "force-dynamic";

function SetupNotice({ title, body }: { title: string; body: string }) {
  return (
    <main className="admin-main">
      <h1 className="admin-h1">Lead manager</h1>
      <div className="admin-notice admin-notice-error">
        <strong>{title}</strong>
        {body}
      </div>
    </main>
  );
}

function Card({ card, timeZone, now }: { card: LeadCard; timeZone: string; now: Date }) {
  const { evaluation } = card;
  const critical = evaluation.bucket === "critical";
  const warn = evaluation.slaStatus === "breached" || evaluation.slaStatus === "due_soon";

  const telHref = card.phone ? `tel:${card.phone}` : null;
  const smsHref = card.phone ? `sms:${card.phone}` : null;
  const mailHref = card.email ? `mailto:${card.email}` : null;

  return (
    <article
      className={`lead-card${critical ? " lead-card-critical" : warn ? " lead-card-warn" : ""}`}
    >
      <div className="lead-top">
        <h3 className="lead-name">{card.clientName}</h3>
        <span className="lead-age">Inquired {timeAgo(card.receivedAt, now)}</span>
      </div>

      <div className="lead-tags">
        <span className="lead-tag lead-tag-brand">{card.brand}</span>
        {card.projectType && <span className="lead-tag">{card.projectType}</span>}
        <span className="lead-tag">{card.leadSource}</span>
        {card.propertyCity && <span className="lead-tag">{card.propertyCity}</span>}
        <span className="lead-tag">{card.stage}</span>
      </div>

      {evaluation.headline && (
        <p className={`lead-why${critical ? " lead-why-critical" : ""}`}>{evaluation.headline}</p>
      )}

      <div className="lead-meta">
        <div>
          <b>Owner</b>
          {card.ownerName ?? "Unassigned"}
        </div>
        <div>
          <b>Next action</b>
          {card.nextAction
            ? `${card.nextAction}${card.nextActionAt ? ` — ${boiseTime(card.nextActionAt, timeZone)}` : ""}`
            : "None set"}
        </div>
        <div>
          <b>Response</b>
          {evaluation.slaStatus === "met"
            ? `Answered in ${evaluation.responseMinutes} min`
            : evaluation.slaStatus === "after_hours"
              ? "Arrived after hours"
              : evaluation.slaStatus === "not_applicable"
                ? "Closed"
                : `${evaluation.responseMinutes} min waiting`}
        </div>
        <div>
          <b>Last activity</b>
          {card.lastActivityAt ? timeAgo(card.lastActivityAt, now) : "None"}
        </div>
        {card.appointmentAt && (
          <div>
            <b>Appointment</b>
            {boiseTime(card.appointmentAt, timeZone)}
          </div>
        )}
        {card.proposalStatus && (
          <div>
            <b>Proposal</b>
            {card.proposalStatus} <em>(manual)</em>
          </div>
        )}
      </div>

      <div className="lead-actions">
        {telHref && (
          <a className="lead-action lead-action-primary" href={telHref}>
            Call {card.phoneDisplay}
          </a>
        )}
        {smsHref && (
          <a className="lead-action" href={smsHref}>
            Text
          </a>
        )}
        {mailHref && (
          <a className="lead-action" href={mailHref}>
            Email
          </a>
        )}
      </div>
    </article>
  );
}

export default async function AdminHome() {
  if (!isDatabaseConfigured()) {
    return (
      <SetupNotice
        title="No database is configured."
        body="Set DATABASE_URL in your host's secrets and apply migrations/001_init.sql, then reload this page."
      />
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const now = new Date();
  const restrictTo = seesAllLeads(user.role) ? null : user.id;
  const { settings, buckets, totals } = await loadAttentionBoard(restrictTo, now);
  const timeZone = settings.calendar.timeZone;

  return (
    <>
      <header className="admin-bar">
        <span className="admin-brand">
          P5 <small>Lead manager</small>
        </span>
        <span className="admin-who">
          {user.fullName} · {user.role.replace(/_/g, " ")}
        </span>
      </header>

      <main className="admin-main">
        <h1 className="admin-h1">Needs your attention</h1>
        <p className="admin-sub">
          {restrictTo ? "Your assigned leads" : "Every open lead"} ·{" "}
          {new Intl.DateTimeFormat("en-US", {
            timeZone,
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(now)}
        </p>

        {settings.automation.testMode && (
          <div className="admin-notice">
            <strong>Test mode is on.</strong>
            Client-facing automatic messages are disabled. Turn this off in settings only after
            the workflow has been approved.
          </div>
        )}

        <div className="admin-stats">
          <div className="admin-stat">
            <b>{totals.open}</b>
            <span>Open leads</span>
          </div>
          <div className={`admin-stat${totals.breached ? " admin-stat-alarm" : ""}`}>
            <b>{totals.breached}</b>
            <span>Past response time</span>
          </div>
          <div className={`admin-stat${totals.unassigned ? " admin-stat-alarm" : ""}`}>
            <b>{totals.unassigned}</b>
            <span>Unassigned</span>
          </div>
          <div className="admin-stat">
            <b>{totals.openAlerts}</b>
            <span>Open alerts</span>
          </div>
        </div>

        {buckets.length === 0 ? (
          <div className="admin-empty">
            <h2>Nothing needs you right now.</h2>
            <p>Every lead has an owner, a next action, and a response inside target.</p>
          </div>
        ) : (
          buckets.map((group) => (
            <section
              key={group.bucket}
              className={`admin-bucket${group.bucket === "critical" ? " admin-bucket-critical" : ""}`}
            >
              <div className="admin-bucket-head">
                <h2>{group.label}</h2>
                <span className="admin-bucket-count">{group.cards.length}</span>
              </div>
              <div className="admin-cards">
                {group.cards.map((card) => (
                  <Card key={card.dealId} card={card} timeZone={timeZone} now={now} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </>
  );
}
