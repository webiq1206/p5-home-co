/**
 * Needs Your Attention: the finance home screen (S149, S213).
 *
 * Every item states what happened, why it matters, the amount, the due date
 * and a recommended action. Severity orders the queue; resolving requires a
 * note so the audit trail says what was actually done (S174).
 */

import { checkDatabase } from "../../lib/db.ts";
import { isQboConnected } from "../../lib/finance/qbo/oauth.ts";
import { resolveAttentionItem, runDailyNow } from "./actions.ts";
import { money, openAttention, type AttentionRow } from "./queries.ts";

export const dynamic = "force-dynamic";

function Item({ item }: { item: AttentionRow }) {
  const cardClass =
    item.severity === "critical"
      ? "lead-card lead-card-critical"
      : item.severity === "urgent" || item.severity === "warning"
        ? "lead-card lead-card-warn"
        : "lead-card";
  return (
    <article className={cardClass}>
      <div className="lead-top">
        <h3 className="lead-name">{item.title}</h3>
        <span className={`fin-chip fin-chip-${item.severity}`}>{item.severity}</span>
      </div>
      <p className={item.severity === "critical" ? "lead-why lead-why-critical" : "lead-why"}>
        {item.detail}
      </p>
      <div className="lead-meta">
        {item.amount !== null && (
          <div>
            <b>Amount</b>
            {money(item.amount)}
          </div>
        )}
        {item.dueOn && (
          <div>
            <b>Due</b>
            {item.dueOn}
          </div>
        )}
        {item.recommendedAction && (
          <div>
            <b>Recommended</b>
            {item.recommendedAction}
          </div>
        )}
      </div>
      <form action={resolveAttentionItem} className="fin-inline-form" style={{ marginTop: 12 }}>
        <input type="hidden" name="id" value={item.id} />
        <label className="lead-field" style={{ flex: 1 }}>
          <span>Resolution note</span>
          <input name="resolution" required placeholder="What was done?" />
        </label>
        <button className="lead-action" type="submit">
          Resolve
        </button>
      </form>
    </article>
  );
}

export default async function AttentionPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Needs your attention</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const [items, qboConnected] = await Promise.all([openAttention(), isQboConnected()]);
  const counts = {
    critical: items.filter((i) => i.severity === "critical").length,
    urgent: items.filter((i) => i.severity === "urgent").length,
    warning: items.filter((i) => i.severity === "warning").length,
  };

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Needs your attention</h1>
      <p className="admin-sub">
        The exception queue. Normal, safe activity runs itself; anything that
        needs judgment surfaces here (S2).
      </p>

      {!qboConnected && (
        <div className="admin-notice">
          <strong>QuickBooks is not connected</strong>
          Financial figures cannot sync until an administrator connects
          QuickBooks from the Health page.
        </div>
      )}

      <div className="admin-stats">
        <div className={counts.critical ? "admin-stat admin-stat-alarm" : "admin-stat"}>
          <b>{counts.critical}</b>
          <span>Critical</span>
        </div>
        <div className="admin-stat">
          <b>{counts.urgent}</b>
          <span>Urgent</span>
        </div>
        <div className="admin-stat">
          <b>{counts.warning}</b>
          <span>Warning</span>
        </div>
        <div className="admin-stat">
          <b>{items.length}</b>
          <span>Open items</span>
        </div>
      </div>

      <form action={runDailyNow} style={{ marginBottom: 22 }}>
        <button className="lead-action" type="submit">
          Refresh now (sync + rescan)
        </button>
      </form>

      {items.length === 0 ? (
        <div className="admin-empty">
          <h2>Nothing needs you</h2>
          <p>Every monitored condition is clear. The scanners run daily.</p>
        </div>
      ) : (
        <div className="admin-cards">
          {items.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
