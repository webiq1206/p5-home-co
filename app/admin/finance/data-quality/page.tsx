/**
 * QuickBooks data quality (S214).
 *
 * Everything currently set up wrong or missing in QuickBooks, most serious
 * first, each one explained in plain language with the fix attached.
 *
 * The findings themselves live in attention_item alongside every other thing
 * that needs a person, so they also appear on Today and in the 6am email. This
 * page is the full view: all of them at once, grouped, plus the rulebook that
 * produced them and which of those rules QuickBooks itself is enforcing.
 */

import Link from "next/link";

import { getSessionUser } from "../../../lib/auth.ts";
import { checkDatabase, query } from "../../../lib/db.ts";
import { isQboConnected } from "../../../lib/finance/qbo/oauth.ts";
import { lastAuditRun } from "../../../lib/finance/qbo/audit-scan.ts";
import {
  RULES,
  allRules,
  detectOnlyRules,
  qboEnforceableRules,
  type AuditSeverity,
} from "../../../lib/finance/qbo/audit-rules.ts";
import {
  REQUIRED_PREFERENCES,
  checkPreferences,
  fetchPreferences,
  type PreferenceFinding,
  type QboPreferences,
} from "../../../lib/finance/qbo/preferences.ts";
import { runQboAuditNow } from "../actions.ts";

export const dynamic = "force-dynamic";

const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  critical: "Fix today",
  urgent: "Fix this week",
  warning: "Worth cleaning up",
  info: "Tidy when convenient",
};

const SEVERITY_BLURB: Record<AuditSeverity, string> = {
  critical: "These cost money or trust right now - a customer billed twice, a payment about to go out that should not.",
  urgent: "These will cost money soon, usually at tax time or when somebody chases a payment that was never tracked.",
  warning: "These make the numbers less reliable and the work harder than it needs to be.",
  info: "Nothing breaks today, but the gap will be inconvenient the day someone needs it.",
};

const ORDER: AuditSeverity[] = ["critical", "urgent", "warning", "info"];

type OpenFinding = {
  id: string;
  kind: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  amount: string | null;
  entity_url: string | null;
  recommended_action: string | null;
  created_at: string;
};

export default async function DataQualityPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">QuickBooks data quality</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const ruleCodes = allRules().map((r) => r.code);
  const [user, connected, lastRun, findings] = await Promise.all([
    getSessionUser(),
    isQboConnected(),
    lastAuditRun(),
    query<OpenFinding>(
      `SELECT id::text, kind, severity, title, detail, amount, entity_url,
              recommended_action, created_at::text
       FROM attention_item
       WHERE resolved_at IS NULL AND kind = ANY($1::text[])
       ORDER BY created_at DESC`,
      [ruleCodes],
    ),
  ]);

  // The company settings, read live. Deliberately not fatal: a settings read
  // that fails must not take down the findings list, which is the part of this
  // page somebody came here to act on.
  let prefs: QboPreferences | null = null;
  let prefFindings: PreferenceFinding[] = [];
  let prefsError: string | null = null;
  if (connected) {
    try {
      prefs = await fetchPreferences();
      prefFindings = checkPreferences(prefs);
    } catch (error) {
      prefsError = error instanceof Error ? error.message : String(error);
    }
  }

  const byRule = new Map(allRules().map((r) => [r.code, r]));
  const grouped = new Map<AuditSeverity, OpenFinding[]>();
  for (const f of findings) {
    const list = grouped.get(f.severity) ?? [];
    list.push(f);
    grouped.set(f.severity, list);
  }

  return (
    <main className="admin-main">
      <h1 className="admin-h1">QuickBooks data quality</h1>
      <p className="admin-sub">
        Every record in QuickBooks that is set up wrong or missing something,
        checked once a day. Most serious first.
      </p>

      {!connected && (
        <div className="admin-notice">
          <strong>QuickBooks is not connected</strong>
          Nothing can be checked until it is. Open{" "}
          <Link href="/admin/finance/health">System health</Link> to reconnect.
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Where things stand                                                  */}
      {/* ------------------------------------------------------------------ */}
      <section className="fin-section">
        <h2>Where things stand</h2>
        {lastRun ? (
          <>
            <p className="fin-hero">
              {findings.length === 0
                ? "Nothing to fix."
                : `${findings.length} thing${findings.length === 1 ? "" : "s"} to fix`}
            </p>
            <p>
              {ORDER.map((sev) => {
                const count = grouped.get(sev)?.length ?? 0;
                if (count === 0) return null;
                return (
                  <span key={sev} className={`fin-chip fin-chip-${sev}`}>
                    {count} {SEVERITY_LABEL[sev].toLowerCase()}
                  </span>
                );
              })}
              {findings.length === 0 && (
                <span className="fin-chip fin-chip-green">
                  Everything the daily check looks at is set up correctly
                </span>
              )}
            </p>
            <p className="fin-footnote">
              Last checked {new Date(lastRun.startedAt).toLocaleString()} (
              {lastRun.status}). {lastRun.opened} new since the check before,{" "}
              {lastRun.resolved} fixed and closed automatically.
              {lastRun.error && ` Last error: ${lastRun.error}`}
            </p>
          </>
        ) : (
          <p>
            The check has not run yet. It runs automatically each morning, or
            you can run it now.
          </p>
        )}

        {user?.role === "administrator" && (
          <form action={runQboAuditNow} className="fin-inline-form">
            <button type="submit" className="lead-action lead-action-primary">
              Check QuickBooks now
            </button>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The findings                                                        */}
      {/* ------------------------------------------------------------------ */}
      {ORDER.map((sev) => {
        const items = grouped.get(sev);
        if (!items || items.length === 0) return null;
        return (
          <section className="fin-section" key={sev}>
            <h2>
              <span className={`fin-chip fin-chip-${sev}`}>{SEVERITY_LABEL[sev]}</span>{" "}
              {items.length} item{items.length === 1 ? "" : "s"}
            </h2>
            <p className="fin-footnote">{SEVERITY_BLURB[sev]}</p>

            {items.map((item) => {
              const rule = byRule.get(item.kind);
              return (
                <article className="fin-finding" key={item.id}>
                  <h3>{item.title}</h3>
                  {/* The stored detail already carries the instance, the plain
                      explanation and the consequence, newline separated, so the
                      email and this page never diverge. */}
                  {item.detail.split("\n\n").map((para, i) => (
                    <p key={i} className={i === 0 ? undefined : "fin-footnote"}>
                      {para}
                    </p>
                  ))}
                  {item.recommended_action && (
                    <p>
                      <strong>What to do:</strong> {item.recommended_action}
                    </p>
                  )}
                  <p className="fin-footnote">
                    {rule?.enforcement === "qbo_setting" && rule.qboSetting
                      ? `QuickBooks can prevent this: ${rule.qboSetting}`
                      : rule?.enforcement === "qbo_blocks"
                        ? "QuickBooks blocks the obvious version of this; this is the near-miss it lets through."
                        : "QuickBooks does not check this. Only this daily inspection catches it."}
                    {" · "}
                    First seen {new Date(item.created_at).toLocaleDateString()}
                    {item.entity_url && (
                      <>
                        {" · "}
                        <Link href={item.entity_url}>Open the record</Link>
                      </>
                    )}
                  </p>
                </article>
              );
            })}
          </section>
        );
      })}

      {/* ------------------------------------------------------------------ */}
      {/* Company settings                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="fin-section">
        <h2>Company settings QuickBooks should be enforcing</h2>
        <p>
          Some of the rules above only work because a setting in QuickBooks is
          switched on. Rather than keep a checklist that slowly stops being
          true, these are read back from QuickBooks itself.
        </p>

        {!connected ? (
          <p className="fin-footnote">
            Cannot be read while QuickBooks is disconnected.
          </p>
        ) : prefsError ? (
          <div className="admin-notice">
            <strong>Could not read the company settings</strong>
            {prefsError}
          </div>
        ) : prefFindings.length === 0 ? (
          <div className="lead-ok">
            All {REQUIRED_PREFERENCES.length} required settings are confirmed on.
          </div>
        ) : (
          <>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>State</th>
                    <th>Why it matters</th>
                    <th>Where it lives</th>
                  </tr>
                </thead>
                <tbody>
                  {prefFindings.map((f) => (
                    <tr key={f.key}>
                      <td>
                        <strong>{f.label}</strong>
                        <br />
                        <span className="fin-footnote">{f.plain}</span>
                      </td>
                      <td>
                        {f.state === "off" ? (
                          <span className={`fin-chip fin-chip-${f.severity}`}>
                            Switched off
                          </span>
                        ) : (
                          <span className="fin-chip fin-chip-info">
                            Cannot see it
                          </span>
                        )}
                      </td>
                      <td>{f.consequence}</td>
                      <td>{f.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fin-footnote">
              <strong>&quot;Cannot see it&quot; is not the same as &quot;switched
              off&quot;.</strong>{" "}
              QuickBooks does not report every setting through its interface for
              other software, and the field names differ between editions. A
              setting shown that way needs a person to look once and confirm it,
              not a change to the company file. Assuming it was off would raise
              the same false alarm every morning, which is how an alert list
              becomes one people stop reading.
            </p>
          </>
        )}

        {/* The settings payload exactly as QuickBooks returned it. This is
            here so the field mapping above can be corrected against reality
            rather than against documentation - the fastest way to turn a
            "cannot see it" into a real check. */}
        {connected && prefs && (
          <details>
            <summary>What QuickBooks actually returned</summary>
            <pre className="fin-pre">{JSON.stringify(prefs, null, 2)}</pre>
          </details>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* The rulebook                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="fin-section">
        <h2>What gets checked, and who enforces it</h2>
        <p>
          {allRules().length} rules run every morning. The distinction below
          matters: a rule QuickBooks enforces is <em>prevented</em>, so nobody
          can create the problem in the first place. A rule only this inspection
          checks is <em>detected</em> - the mistake happens, and we find it the
          next morning.
        </p>

        <h3>QuickBooks prevents these ({qboEnforceableRules().length})</h3>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>The setting that prevents it</th>
              </tr>
            </thead>
            <tbody>
              {qboEnforceableRules().map((rule) => (
                <tr key={rule.code}>
                  <td>
                    <strong>{rule.label}</strong>
                    <br />
                    <span className="fin-footnote">{rule.plain}</span>
                  </td>
                  <td>{rule.qboSetting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Only this inspection catches these ({detectOnlyRules().length})</h3>
        <p className="fin-footnote">
          QuickBooks has no setting for any of these, which is exactly why the
          daily check exists.
        </p>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>What it means</th>
                <th>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {detectOnlyRules().map((rule) => (
                <tr key={rule.code}>
                  <td>
                    <span className={`fin-chip fin-chip-${rule.severity}`}>
                      {rule.severity}
                    </span>
                    <br />
                    <strong>{rule.label}</strong>
                  </td>
                  <td>{rule.plain}</td>
                  <td>{rule.consequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="fin-footnote">
          The full explanation of every rule, including the ones QuickBooks
          enforces, is in the{" "}
          <Link href="/admin/kb/quickbooks/data-quality-rules">
            Knowledge Center
          </Link>
          . Rule {RULES.bill_marked_billable.code} and{" "}
          {RULES.invoice_exceeds_contract.code} are the two worth reading first -
          both cost customer trust, not just money.
        </p>
      </section>
    </main>
  );
}
