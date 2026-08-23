/**
 * The admin dashboard: one screen that answers "how is the company doing
 * right now", and the menu that reaches everything else.
 *
 * This used to be the lead manager board, which meant /admin was one of the
 * four sections rather than the way into them. The board now lives at
 * /admin/lead-manager and this page summarises it alongside finance.
 *
 * What it shows is deliberately limited to figures that can name their source:
 * leads come from the deal table, money from the QuickBooks read model and the
 * persisted money runs. Anything that cannot be computed is listed under Data
 * notes with the reason, never rendered as a confident zero.
 *
 * Finance blocks are omitted entirely for roles that cannot open /admin/finance,
 * rather than shown and refused.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "../lib/auth.ts";
import { checkDatabase } from "../lib/db.ts";
import { loadSettings } from "../lib/leads/settings.ts";
import { seesAllLeads } from "../lib/leads/permissions.ts";
import AdminChrome, { canSeeFinance } from "./AdminChrome.tsx";
import { BarRows, CHART_COLORS, ColumnChart, StackedBar, TrendLine } from "./Charts.tsx";
import {
  financePulse,
  isUnavailable,
  leadPulse,
  type FinancePulse,
  type LeadPulse,
  type Unavailable,
} from "./dashboard-queries.ts";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Tile-sized money: a headline number must not wrap on a phone. */
function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`;
  return `${Math.round(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

function Panel({
  title,
  hint,
  href,
  linkLabel,
  children,
  wide,
}: {
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={`dash-panel${wide ? " dash-panel-wide" : ""}`}>
      <div className="dash-panel-head">
        <h3>{title}</h3>
        {href && (
          <Link href={href} className="dash-panel-link">
            {linkLabel ?? "Open"} →
          </Link>
        )}
      </div>
      {hint && <p className="dash-panel-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Tile({
  value,
  label,
  tone,
  note,
  href,
}: {
  value: string;
  label: string;
  tone?: "alarm" | "good" | "muted";
  note?: string;
  href?: string;
}) {
  const body = (
    <>
      <b>{value}</b>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </>
  );
  const className = `dash-tile${tone ? ` dash-tile-${tone}` : ""}`;
  return href ? (
    <Link href={href} className={`${className} dash-tile-link`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function SectionUnavailable({ title, problem }: { title: string; problem: Unavailable }) {
  return (
    <Panel title={title} wide>
      <div className="admin-notice admin-notice-error" style={{ margin: 0 }}>
        <strong>{problem.problem}</strong>
        {problem.detail}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Lead panels
// ---------------------------------------------------------------------------

function LeadPanels({ pulse }: { pulse: LeadPulse }) {
  const stageRows = pulse.stages.map((s) => ({
    label: s.stage,
    value: s.count,
    display: String(s.count),
    note:
      s.valueKnown > 0
        ? `${money(s.value)} estimated${s.valueKnown < s.count ? ` from ${s.valueKnown} of ${s.count}` : ""}`
        : s.count > 0
          ? "no estimated value recorded"
          : undefined,
  }));

  const r = pulse.response;
  const measured = r.answeredInTarget + r.answeredLate + r.neverAnswered;

  return (
    <>
      <Panel
        title="Open pipeline by stage"
        hint="Every lead that is not closed, and what it is estimated to be worth."
        href="/admin/lead-manager"
        linkLabel="Lead manager"
      >
        <BarRows rows={stageRows} emptyMessage="No open leads." />
        {pulse.valueUnknownCount > 0 && (
          <p className="dash-foot">
            {pulse.valueUnknownCount} open lead{pulse.valueUnknownCount === 1 ? " has" : "s have"} no
            estimated value, so pipeline totals understate the real number.
          </p>
        )}
      </Panel>

      <Panel title="New leads, last 14 days" hint="Counted on the day the enquiry arrived.">
        <ColumnChart
          columns={pulse.daily.map((d) => ({
            label: d.weekday,
            value: d.count,
            caption: `${d.weekdayLong} ${d.dateLabel}`,
          }))}
          emptyMessage="No leads received in the last 14 days."
        />
        {pulse.daily.length > 0 && (
          <p className="dash-foot">
            {pulse.daily[0].dateLabel} to {pulse.daily[pulse.daily.length - 1].dateLabel} ·{" "}
            {pulse.daily.reduce((sum, d) => sum + d.count, 0)} leads in total.
          </p>
        )}
      </Panel>

      <Panel
        title="First response, last 30 days"
        hint="Measured from arrival to the first call, text or email that actually went out."
      >
        {measured === 0 ? (
          <p className="dash-empty">
            No leads with a response target arrived in the last 30 days.
          </p>
        ) : (
          <>
            <StackedBar
              segments={[
                {
                  label: "Answered inside target",
                  value: r.answeredInTarget,
                  color: CHART_COLORS.good,
                },
                { label: "Answered late", value: r.answeredLate, color: CHART_COLORS.bronze },
                { label: "Never answered", value: r.neverAnswered, color: CHART_COLORS.alarm },
              ]}
            />
            <p className="dash-foot">
              {Math.round((r.answeredInTarget / measured) * 100)}% inside target
              {r.medianMinutes !== null && ` · median response ${duration(r.medianMinutes)}`}
              {r.noTargetSet > 0 &&
                ` · ${r.noTargetSet} lead${r.noTargetSet === 1 ? "" : "s"} had no target set and ${r.noTargetSet === 1 ? "is" : "are"} excluded`}
            </p>
          </>
        )}
      </Panel>

      <Panel title="Where leads came from" hint="Last 30 days, by lead source.">
        <BarRows
          rows={pulse.sources.map((s) => ({ label: s.source, value: s.count }))}
          emptyMessage="No leads in the last 30 days."
        />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Finance panels
// ---------------------------------------------------------------------------

function FinancePanels({ pulse }: { pulse: FinancePulse }) {
  const p = pulse.projects;
  const measuredProjects = p.green + p.yellow + p.red;

  return (
    <>
      <Panel
        title="Cash on hand"
        hint="Straight from the QuickBooks bank accounts. Reserves are protected, not spendable."
        href="/admin/finance/money-run"
        linkLabel="Money run"
      >
        {!pulse.cash.hasData ? (
          <p className="dash-empty">
            No bank accounts have synced from QuickBooks, so cash is unknown rather than zero.
          </p>
        ) : (
          <>
            <StackedBar
              segments={[
                {
                  label: "Operating",
                  value: pulse.cash.operating,
                  display: money(pulse.cash.operating),
                  color: CHART_COLORS.ink,
                },
                {
                  label: "Tax reserve (1030)",
                  value: pulse.cash.taxReserve,
                  display: money(pulse.cash.taxReserve),
                  color: CHART_COLORS.sage,
                },
                {
                  label: "Operating reserve (1040)",
                  value: pulse.cash.operatingReserve,
                  display: money(pulse.cash.operatingReserve),
                  color: CHART_COLORS.bronze,
                },
                {
                  label: "Undeposited",
                  value: pulse.cash.undeposited,
                  display: money(pulse.cash.undeposited),
                  color: "#c2a37f",
                },
              ]}
            />
            {pulse.cash.asOf && (
              <p className="dash-foot">
                Source: QuickBooks, synced {new Date(pulse.cash.asOf).toLocaleString("en-US")}.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        title="Safe cash trend"
        hint="What the last saved money runs said was genuinely available."
        href="/admin/finance/money-run"
        linkLabel="Money run"
      >
        <TrendLine
          points={pulse.safeCashTrend.map((t) => ({ label: t.label, value: t.amount }))}
          emptyMessage="Fewer than two money runs have been saved, so there is no trend to draw yet."
        />
        {pulse.safeCashTrend.length >= 2 && (
          <p className="dash-foot">
            Latest {money(pulse.safeCashTrend[pulse.safeCashTrend.length - 1].amount)} on{" "}
            {pulse.safeCashTrend[pulse.safeCashTrend.length - 1].label}.
          </p>
        )}
      </Panel>

      <Panel
        title="Money owed to P5"
        hint="Open invoices by how late they are. Overdue money is chased, never counted as cash."
      >
        <BarRows
          rows={[
            {
              label: "Not yet due",
              value: pulse.ar.notYetDue,
              display: money(pulse.ar.notYetDue),
              color: CHART_COLORS.good,
            },
            {
              label: "1–30 days late",
              value: pulse.ar.late1to30,
              display: money(pulse.ar.late1to30),
              color: CHART_COLORS.sage,
            },
            {
              label: "31–60 days late",
              value: pulse.ar.late31to60,
              display: money(pulse.ar.late31to60),
              color: CHART_COLORS.bronze,
            },
            {
              label: "61–90 days late",
              value: pulse.ar.late61to90,
              display: money(pulse.ar.late61to90),
              color: "#b4622a",
            },
            {
              label: "Over 90 days late",
              value: pulse.ar.late90plus,
              display: money(pulse.ar.late90plus),
              color: CHART_COLORS.alarm,
            },
          ]}
          emptyMessage="No open invoices."
        />
        <p className="dash-foot">
          {pulse.ar.count} open invoice{pulse.ar.count === 1 ? "" : "s"} totalling{" "}
          {money(pulse.ar.total)}, of which {money(pulse.ar.overdue)} is overdue.
        </p>
      </Panel>

      <Panel
        title="Money P5 owes"
        hint="Open vendor bills, by when they fall due."
        href="/admin/finance/vendors"
        linkLabel="Vendors"
      >
        <BarRows
          rows={[
            {
              label: "Already overdue",
              value: pulse.ap.overdue,
              display: money(pulse.ap.overdue),
              color: CHART_COLORS.alarm,
            },
            {
              label: "Due within 7 days",
              value: pulse.ap.dueIn7,
              display: money(pulse.ap.dueIn7),
              color: CHART_COLORS.bronze,
            },
            {
              label: "Due within 14 days",
              value: pulse.ap.dueIn14,
              display: money(pulse.ap.dueIn14),
              color: CHART_COLORS.sage,
            },
            {
              label: "All open bills",
              value: pulse.ap.total,
              display: money(pulse.ap.total),
              color: CHART_COLORS.ink,
            },
          ]}
          emptyMessage="No open bills."
        />
        <p className="dash-foot">
          {pulse.ap.count} open bill{pulse.ap.count === 1 ? "" : "s"}. The 7 and 14 day bands
          overlap: the 14 day figure includes the 7 day one.
        </p>
      </Panel>

      <Panel
        title="Project margin health"
        hint="Forecast gross profit against each project's target."
        href="/admin/finance/projects"
        linkLabel="Projects"
      >
        {p.active === 0 ? (
          <p className="dash-empty">No projects are in flight.</p>
        ) : (
          <>
            <StackedBar
              segments={[
                { label: "On target", value: p.green, color: CHART_COLORS.good },
                { label: "Watch", value: p.yellow, color: CHART_COLORS.bronze },
                { label: "Action required", value: p.red, color: CHART_COLORS.alarm },
                { label: "Not measurable", value: p.unmeasurable, color: "#8d8d84" },
              ]}
              emptyMessage="No project has enough data to score."
            />
            {p.worst.length > 0 && (
              <ul className="dash-list">
                {p.worst.map((w) => (
                  <li key={w.p5Id}>
                    <span
                      className={`fin-chip ${
                        w.health === "red"
                          ? "fin-chip-critical"
                          : w.health === "yellow"
                            ? "fin-chip-warning"
                            : "fin-chip-info"
                      }`}
                    >
                      {w.health === "unknown" ? "no data" : w.health}
                    </span>
                    <span className="dash-list-main">
                      {w.p5Id} · {w.name}
                    </span>
                    <span className="dash-list-note">{w.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="dash-foot">
              {measuredProjects} of {p.active} in-flight project
              {p.active === 1 ? "" : "s"} scored · {money(p.backlog)} of contracted work not yet
              invoiced.
            </p>
          </>
        )}
      </Panel>

      <Panel
        title="Finance attention queue"
        hint="Open exceptions waiting on a decision."
        href="/admin/finance"
        linkLabel="Attention"
      >
        {pulse.attention.total === 0 ? (
          <p className="dash-empty">Nothing open. Every monitored condition is clear.</p>
        ) : (
          <BarRows
            rows={[
              { label: "Critical", value: pulse.attention.critical, color: CHART_COLORS.alarm },
              { label: "Urgent", value: pulse.attention.urgent, color: "#b4622a" },
              { label: "Warning", value: pulse.attention.warning, color: CHART_COLORS.bronze },
              { label: "Information", value: pulse.attention.info, color: CHART_COLORS.sage },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

type MenuGroup = { title: string; blurb: string; links: { href: string; label: string }[] };

const LEAD_MENU: MenuGroup = {
  title: "Lead Manager",
  blurb: "Every open enquiry, ordered by what needs doing first.",
  links: [{ href: "/admin/lead-manager", label: "Needs your attention" }],
};

const FINANCE_MENU: MenuGroup = {
  title: "Finance",
  blurb: "Cash, projects, vendors and the reports that go with them.",
  links: [
    { href: "/admin/finance", label: "Attention queue" },
    { href: "/admin/finance/daily-report", label: "Daily report" },
    { href: "/admin/finance/money-run", label: "Money run" },
    { href: "/admin/finance/projects", label: "Projects" },
    { href: "/admin/finance/vendors", label: "Vendors" },
    { href: "/admin/finance/draws", label: "Draws" },
    { href: "/admin/finance/registries", label: "Registries" },
    { href: "/admin/finance/owners", label: "Owners" },
    { href: "/admin/finance/portal", label: "Portal" },
    { href: "/admin/finance/settings", label: "Settings" },
    { href: "/admin/finance/health", label: "Automation health" },
  ],
};

const KB_MENU: MenuGroup = {
  title: "Knowledge Center",
  blurb: "How everything works, written down. Ask it a question in plain English.",
  links: [
    { href: "/admin/kb", label: "Home" },
    { href: "/admin/kb/search", label: "Search" },
    { href: "/admin/kb/ask", label: "Ask P5" },
  ],
};

function Menu({ finance }: { finance: boolean }) {
  const groups = finance ? [LEAD_MENU, FINANCE_MENU, KB_MENU] : [LEAD_MENU, KB_MENU];
  return (
    <section className="dash-section">
      <h2 className="dash-section-head">Everything in the panel</h2>
      <div className="dash-menu">
        {groups.map((group) => (
          <div key={group.title} className="dash-menu-group">
            <h3>{group.title}</h3>
            <p>{group.blurb}</p>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminDashboard() {
  // Diagnose first, so a setup problem explains itself rather than surfacing
  // as an unexplained 500 further down.
  const health = await checkDatabase();
  if (!health.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">P5 Operations</h1>
        <div className="admin-notice admin-notice-error">
          <strong>{health.problem}</strong>
          {health.detail}
        </div>
        <p className="lead-note">
          Nothing is broken in the app itself. Until this is resolved the panel cannot show
          anything, but no lead is lost: intake refuses submissions with a clear message rather
          than accepting one it cannot store.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const finance = canSeeFinance(user.role);
  const settings = await loadSettings();
  const timeZone = settings.calendar.timeZone;
  const restrictTo = seesAllLeads(user.role) ? null : user.id;

  const [leads, finances] = await Promise.all([
    leadPulse(restrictTo, timeZone),
    finance ? financePulse() : Promise.resolve(null),
  ]);

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  const leadsOk = isUnavailable(leads) ? null : leads;
  const financeOk = finances === null || isUnavailable(finances) ? null : finances;
  const limitations = financeOk?.limitations ?? [];

  return (
    <>
      <AdminChrome user={user} active="dashboard" subtitle="Operations" />

      <main className="admin-main">
        <h1 className="admin-h1">Today at P5</h1>
        <p className="admin-sub">
          {today} · {restrictTo ? "your assigned leads" : "the whole company"}
          {finance ? " and company finances" : ""}
        </p>

        {settings.automation.testMode && (
          <div className="admin-notice">
            <strong>Test mode is on.</strong>
            Client-facing automatic messages are disabled. Turn this off in settings only after the
            workflow has been approved.
          </div>
        )}

        {financeOk && !financeOk.qboConnected && (
          <div className="admin-notice">
            <strong>QuickBooks is not connected.</strong>
            Every financial figure below is only as fresh as the last successful sync
            {financeOk.lastSyncAt
              ? ` (${new Date(financeOk.lastSyncAt).toLocaleString("en-US")})`
              : ", and nothing has ever synced"}
            . Connect it from{" "}
            <Link href="/admin/finance/health" style={{ textDecoration: "underline" }}>
              Automation health
            </Link>
            .
          </div>
        )}

        {/* Headline numbers ------------------------------------------------ */}
        <div className="dash-tiles">
          {leadsOk && (
            <>
              <Tile
                value={String(leadsOk.totals.open)}
                label="Open leads"
                note={`${leadsOk.totals.newToday} arrived today`}
                href="/admin/lead-manager"
              />
              <Tile
                value={String(leadsOk.totals.breached)}
                label="Past response time"
                tone={leadsOk.totals.breached > 0 ? "alarm" : undefined}
                href="/admin/lead-manager"
              />
              <Tile
                value={String(leadsOk.totals.unassigned)}
                label="Unassigned"
                tone={leadsOk.totals.unassigned > 0 ? "alarm" : undefined}
                href="/admin/lead-manager"
              />
              <Tile
                value={String(leadsOk.totals.dueToday)}
                label="Actions due"
                note="today or already overdue"
                href="/admin/lead-manager"
              />
            </>
          )}

          {financeOk && (
            <>
              <Tile
                value={financeOk.safeCash ? moneyShort(financeOk.safeCash.amount) : "—"}
                label={
                  financeOk.safeCash?.provisional ? "Safe cash (provisional)" : "Safe cash"
                }
                tone={
                  !financeOk.safeCash
                    ? "muted"
                    : financeOk.safeCash.amount < 0
                      ? "alarm"
                      : undefined
                }
                note={financeOk.safeCash ? "last saved money run" : "no money run saved yet"}
                href="/admin/finance/money-run"
              />
              <Tile
                value={financeOk.cash.hasData ? moneyShort(financeOk.cash.total) : "—"}
                label="Cash in the bank"
                tone={financeOk.cash.hasData ? undefined : "muted"}
                note={financeOk.cash.hasData ? "all accounts" : "nothing synced"}
                href="/admin/finance/money-run"
              />
              <Tile
                value={moneyShort(financeOk.ar.overdue)}
                label="Overdue receivables"
                tone={financeOk.ar.overdue > 0 ? "alarm" : undefined}
                note={`${moneyShort(financeOk.ar.total)} owed in total`}
              />
              <Tile
                value={moneyShort(financeOk.ap.dueIn7)}
                label="Bills due in 7 days"
                note={
                  financeOk.ap.overdue > 0
                    ? `${moneyShort(financeOk.ap.overdue)} already overdue`
                    : "nothing overdue"
                }
                tone={financeOk.ap.overdue > 0 ? "alarm" : undefined}
                href="/admin/finance/money-run"
              />
              <Tile
                value={String(financeOk.attention.critical + financeOk.attention.urgent)}
                label="Finance items needing a decision"
                tone={financeOk.attention.critical > 0 ? "alarm" : undefined}
                note={`${financeOk.attention.total} open in total`}
                href="/admin/finance"
              />
              <Tile
                value={String(financeOk.projects.active)}
                label="Projects in flight"
                note={
                  financeOk.projects.red > 0
                    ? `${financeOk.projects.red} need action`
                    : `${financeOk.projects.green} on target`
                }
                tone={financeOk.projects.red > 0 ? "alarm" : undefined}
                href="/admin/finance/projects"
              />
            </>
          )}
        </div>

        {/* Leads ----------------------------------------------------------- */}
        <section className="dash-section">
          <h2 className="dash-section-head">Leads</h2>
          <div className="dash-grid">
            {isUnavailable(leads) ? (
              <SectionUnavailable title="Leads" problem={leads} />
            ) : (
              <LeadPanels pulse={leads} />
            )}
          </div>
        </section>

        {/* Money ----------------------------------------------------------- */}
        {finance && (
          <section className="dash-section">
            <h2 className="dash-section-head">Money</h2>
            <div className="dash-grid">
              {finances === null ? null : isUnavailable(finances) ? (
                <SectionUnavailable title="Finance" problem={finances} />
              ) : (
                <FinancePanels pulse={finances} />
              )}
            </div>
          </section>
        )}

        <Menu finance={finance} />

        {limitations.length > 0 && (
          <section className="dash-section">
            <h2 className="dash-section-head">Data notes</h2>
            <ul className="dash-notes">
              {limitations.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
