/**
 * Automation health (S176): integration states, sync history, the QuickBooks
 * connection itself. No silent failures - if it broke, it shows here and in
 * the attention queue.
 */

import Link from "next/link";

import { getSessionUser } from "../../../lib/auth.ts";
import { checkDatabase } from "../../../lib/db.ts";
import { isQboConfigured, isQboConnected } from "../../../lib/finance/qbo/oauth.ts";
import { syncNow } from "../actions.ts";
import { healthBoard } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Automation health</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const user = await getSessionUser();
  const [{ integrations, syncRuns, connection, writeConflicts }, configured, connected] =
    await Promise.all([healthBoard(), isQboConfigured(), isQboConnected()]);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Automation health</h1>
      <p className="admin-sub">
        Every integration and scheduled job, with its last success and failure.
      </p>

      <section className="fin-section">
        <h2>QuickBooks connection</h2>
        {connected ? (
          <div className="lead-ok">
            Connected to realm {connection?.realm_id}. Refresh token valid until{" "}
            {connection && new Date(connection.refresh_expires_at).toLocaleDateString()}.
          </div>
        ) : (
          <div className="admin-notice">
            <strong>Not connected</strong>
            {configured
              ? "Credentials are configured. An administrator can connect QuickBooks now."
              : "Set QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_TOKEN_KEY in the environment first."}
          </div>
        )}
        <div className="lead-actions">
          {user?.role === "administrator" && configured && (
            /* Full-page navigation; the route redirects to Intuit's consent screen. */
            <a className="lead-action lead-action-primary" href="/api/qbo/connect">
              {connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </a>
          )}
          {connected && (
            <form action={syncNow}>
              <button className="lead-action" type="submit">Sync now</button>
            </form>
          )}
        </div>
        {/* Disconnecting is deliberately a link to the public instructions
            rather than a button here: it is done from inside QuickBooks, and
            what happens to already-synced records is worth reading first. */}
        <p className="fin-footnote">
          <Link href="/legal/quickbooks-disconnect">How to disconnect QuickBooks</Link>{" "}
          - both routes out, and what happens to records already synced.
        </p>
      </section>

      <section className="fin-section">
        <h2>Integrations</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Integration</th><th>State</th><th>Last success</th><th>Records</th><th>Last error</th></tr>
            </thead>
            <tbody>
              {integrations.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td>
                    <span
                      className={`fin-chip ${
                        i.state === "connected"
                          ? "fin-chip-green"
                          : i.state === "degraded" || i.state === "failed"
                            ? "fin-chip-critical"
                            : "fin-chip-info"
                      }`}
                    >
                      {i.state}
                    </span>
                  </td>
                  <td>{i.last_success_at ? new Date(i.last_success_at).toLocaleString() : "—"}</td>
                  <td>{i.records_processed}</td>
                  <td>{i.last_error ?? "—"}</td>
                </tr>
              ))}
              {integrations.length === 0 && (
                <tr><td colSpan={5}>No integrations registered yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Recent sync runs</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Started</th><th>Status</th><th>Trigger</th><th>Error</th></tr>
            </thead>
            <tbody>
              {syncRuns.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td>
                    <span className={`fin-chip ${r.status === "succeeded" ? "fin-chip-green" : r.status === "failed" ? "fin-chip-critical" : "fin-chip-info"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.trigger}</td>
                  <td>{r.error ?? "—"}</td>
                </tr>
              ))}
              {syncRuns.length === 0 && <tr><td colSpan={4}>No sync runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>QuickBooks write conflicts</h2>
        {writeConflicts.length === 0 ? (
          <p className="fin-footnote">
            Every write to QuickBooks has resolved. Nothing is stuck.
          </p>
        ) : (
          <>
            <div className="admin-notice admin-notice-error">
              <strong>
                {writeConflicts.length} write{writeConflicts.length === 1 ? "" : "s"} did not
                resolve
              </strong>
              A write marked <em>needs review</em> may or may not have reached QuickBooks.
              Check the company file before retrying — retrying blindly is how one bill
              becomes two payments.
            </div>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Raised</th><th>Record</th><th>Status</th><th>Tries</th><th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {writeConflicts.map((w) => (
                    <tr key={w.id}>
                      <td>{new Date(w.created_at).toLocaleString()}</td>
                      <td>{w.entity} ({w.operation})</td>
                      <td>
                        <span
                          className={`fin-chip ${
                            w.status === "needs_review"
                              ? "fin-chip-critical"
                              : "fin-chip-warning"
                          }`}
                        >
                          {w.status === "needs_review" ? "needs review" : w.status}
                        </span>
                      </td>
                      <td>{w.attempts}</td>
                      <td>{w.last_error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
