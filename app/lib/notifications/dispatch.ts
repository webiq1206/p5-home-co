/**
 * Send the alerts that are due, to the people who need them.
 *
 * Runs on every watchdog pass. Records last_notified_at *before* attempting
 * delivery is deliberately not done -- it is recorded after a successful send,
 * so a transport outage means the alert is retried next pass rather than
 * marked as delivered and forgotten. The cost of that choice is a possible
 * duplicate if the mail is sent but the update fails; a duplicate nudge is a
 * far better failure than a lead nobody hears about.
 */

import { query } from "../db.ts";
import { loadSettings } from "../leads/settings.ts";
import type { EscalationTier } from "../leads/time.ts";
import { renderBundle } from "./render.ts";
import {
  bundleByRecipient,
  recipientsFor,
  shouldSendNow,
  type Notifiable,
  type Recipient,
} from "./routing.ts";
import { activeTransport } from "./transport.ts";

export type DispatchSummary = {
  considered: number;
  sent: number;
  suppressed: number;
  failed: number;
  transport: string;
};

type AlertRow = {
  alert_id: string;
  deal_id: string;
  kind: string;
  tier: EscalationTier;
  reason: string;
  raised_at: string;
  received_at: string;
  last_notified_at: string | null;
  client_first: string | null;
  client_last: string | null;
  brand: string;
  owner_email: string | null;
  owner_name: string | null;
  owner_user_id: string | null;
};

async function peopleWithRole(roles: string[]): Promise<Recipient[]> {
  const rows = await query<{ id: string; email: string; full_name: string }>(
    `SELECT id, email, full_name FROM app_user
      WHERE is_active AND role = ANY($1::text[])
      ORDER BY id`,
    [roles],
  );
  return rows.map((r) => ({ userId: Number(r.id), email: r.email, name: r.full_name }));
}

/** Where links in the email should point. */
function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
}

export async function dispatchNotifications(now: Date = new Date()): Promise<DispatchSummary> {
  const settings = await loadSettings();
  const transport = activeTransport();

  const rows = await query<AlertRow>(
    `SELECT a.id AS alert_id, a.deal_id, a.kind, a.tier, a.reason,
            a.raised_at, a.last_notified_at, d.received_at,
            c.first_name AS client_first, c.last_name AS client_last,
            d.brand, u.email AS owner_email, u.full_name AS owner_name,
            d.owner_user_id
       FROM alert a
       JOIN deal d ON d.id = a.deal_id
       JOIN contact c ON c.id = d.contact_id
       LEFT JOIN app_user u ON u.id = d.owner_user_id AND u.is_active
      WHERE a.resolved_at IS NULL
      ORDER BY a.raised_at ASC
      LIMIT 200`,
  );

  if (!rows.length) {
    return { considered: 0, sent: 0, suppressed: 0, failed: 0, transport: transport.name };
  }

  const managers = await peopleWithRole(["manager"]);
  const administrators = await peopleWithRole(["administrator"]);

  const due: { item: Notifiable; recipients: Recipient[] }[] = [];
  let suppressed = 0;

  for (const row of rows) {
    const item: Notifiable = {
      alertId: Number(row.alert_id),
      dealId: Number(row.deal_id),
      kind: row.kind,
      tier: row.tier,
      reason: row.reason,
      clientName:
        [row.client_first, row.client_last].filter(Boolean).join(" ").trim() || "Unnamed contact",
      brand: row.brand,
      raisedAt: new Date(row.raised_at),
      receivedAt: new Date(row.received_at),
      lastNotifiedAt: row.last_notified_at ? new Date(row.last_notified_at) : null,
      ownerEmail: row.owner_email,
      ownerName: row.owner_name,
      ownerUserId: row.owner_user_id === null ? null : Number(row.owner_user_id),
    };

    const verdict = shouldSendNow(item, now, settings.calendar, settings.alertCooldownMinutes);
    if (!verdict.send) {
      suppressed += 1;
      continue;
    }

    const recipients = recipientsFor(item, managers, administrators);
    if (!recipients.length) {
      // Nobody to tell. Loud, because it means an alert is going nowhere.
      console.warn(
        `[notify] alert ${item.alertId} (${item.kind}) has no recipient. ` +
          "Add an active manager or administrator in app_user.",
      );
      suppressed += 1;
      continue;
    }
    due.push({ item, recipients });
  }

  const bundles = bundleByRecipient(due);
  let sent = 0;
  let failed = 0;
  const delivered = new Set<number>();

  for (const bundle of bundles) {
    const message = renderBundle(bundle, baseUrl(), now);
    const result = await transport.send(bundle.recipient.email, message);
    if (result.ok) {
      sent += 1;
      for (const i of bundle.items) delivered.add(i.alertId);
    } else {
      failed += 1;
      console.error(`[notify] send to ${bundle.recipient.email} failed: ${result.error}`);
    }
  }

  // Stamped only for alerts that reached at least one person, so a failed
  // send is retried on the next pass rather than silently written off.
  if (delivered.size) {
    await query("UPDATE alert SET last_notified_at = $2 WHERE id = ANY($1::bigint[])", [
      [...delivered],
      now,
    ]);
  }

  return { considered: rows.length, sent, suppressed, failed, transport: transport.name };
}
