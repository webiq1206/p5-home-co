/**
 * QuickBooks webhooks (S155, S201).
 *
 * Intuit signs each delivery with HMAC-SHA256 of the raw body using the app's
 * webhook verifier token, sent in the `intuit-signature` header (base64).
 * Verification and payload parsing are pure functions, unit-tested; anything
 * unverified is rejected before touching the database.
 *
 * Delivery contract: Intuit expects a fast 2xx and retries on failure. The
 * route therefore verifies, persists the events, and responds - processing
 * (fetching each changed entity and upserting the read model) runs after the
 * response, with the daily job re-processing anything left pending as the
 * scheduled reconciliation fallback the spec requires (S155). Event handling
 * is idempotent end to end: replays re-upsert the same rows.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { query } from "../../db.ts";
import { qboRequest } from "./client.ts";
import {
  TXN_ENTITIES,
  upsertAccount,
  upsertClass,
  upsertCustomer,
  upsertTxn,
  upsertVendor,
  type QboRow,
} from "./sync.ts";

// ---------------------------------------------------------------------------
// Pure: signature verification and payload parsing.
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  verifierToken: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", verifierToken)
    .update(rawBody)
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEvent = {
  realmId: string;
  entityName: string;
  entityId: string;
  operation: string;         // Create | Update | Delete | Merge | Void | ...
  lastUpdated: string | null;
};

type IntuitPayload = {
  eventNotifications?: {
    realmId?: string;
    dataChangeEvent?: {
      entities?: {
        name?: string;
        id?: string;
        operation?: string;
        lastUpdated?: string;
      }[];
    };
  }[];
};

export function parseWebhookEvents(payload: unknown): WebhookEvent[] {
  const out: WebhookEvent[] = [];
  const notifications = (payload as IntuitPayload)?.eventNotifications;
  if (!Array.isArray(notifications)) return out;
  for (const n of notifications) {
    const realmId = n?.realmId;
    const entities = n?.dataChangeEvent?.entities;
    if (!realmId || !Array.isArray(entities)) continue;
    for (const e of entities) {
      if (!e?.name || !e?.id || !e?.operation) continue;
      out.push({
        realmId,
        entityName: e.name,
        entityId: e.id,
        operation: e.operation,
        lastUpdated: e.lastUpdated ?? null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence + processing.
// ---------------------------------------------------------------------------

export async function storeWebhookEvents(events: WebhookEvent[]): Promise<number> {
  let stored = 0;
  for (const e of events) {
    // One pending row per (entity, id): a burst of updates to the same record
    // needs one refetch, not five. Processed rows stay for audit.
    const rows = await query(
      `INSERT INTO qbo_webhook_event (realm_id, entity_name, entity_id, operation, event_time)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (entity_name, entity_id) WHERE processed_at IS NULL
       DO UPDATE SET operation = EXCLUDED.operation, event_time = EXCLUDED.event_time
       RETURNING id`,
      [e.realmId, e.entityName, e.entityId, e.operation, e.lastUpdated],
    );
    stored += rows.length;
  }
  return stored;
}

const NAME_ENTITIES = new Set(["Account", "Class", "Customer", "Vendor"]);
const TXN_SET = new Set<string>(TXN_ENTITIES);

async function fetchEntity(name: string, id: string): Promise<QboRow | null> {
  const data = await qboRequest<{ QueryResponse: Record<string, unknown> }>(
    `/query?query=${encodeURIComponent(`SELECT * FROM ${name} WHERE Id = '${id.replace(/'/g, "")}'`)}`,
  );
  const rows = data.QueryResponse[name] as QboRow[] | undefined;
  return rows?.[0] ?? null;
}

async function applyEvent(e: {
  entity_name: string;
  entity_id: string;
  operation: string;
}): Promise<void> {
  const { entity_name: name, entity_id: id, operation } = e;

  // Deletes remove from the read model. Merge/Void arrive as fetch-and-see:
  // a voided txn still exists in QBO (zeroed), a merged entity 404s and is
  // treated as removed.
  if (operation === "Delete" || operation === "Remove") {
    if (TXN_SET.has(name)) {
      await query(`DELETE FROM qbo_txn WHERE txn_type = $1 AND qbo_id = $2`, [name, id]);
    } else if (name === "Customer") {
      await query(`DELETE FROM qbo_customer WHERE qbo_id = $1`, [id]);
    } else if (name === "Vendor") {
      await query(`DELETE FROM qbo_vendor WHERE qbo_id = $1`, [id]);
    } else if (name === "Account") {
      await query(`DELETE FROM qbo_account WHERE qbo_id = $1`, [id]);
    } else if (name === "Class") {
      await query(`DELETE FROM qbo_class WHERE qbo_id = $1`, [id]);
    }
    return;
  }

  if (!NAME_ENTITIES.has(name) && !TXN_SET.has(name)) return; // not modeled

  const row = await fetchEntity(name, id);
  if (!row) {
    // Gone by the time we fetched (merge, immediate delete): mirror removal.
    await applyEvent({ entity_name: name, entity_id: id, operation: "Delete" });
    return;
  }
  if (name === "Account") await upsertAccount(row);
  else if (name === "Class") await upsertClass(row);
  else if (name === "Customer") await upsertCustomer(row);
  else if (name === "Vendor") await upsertVendor(row);
  else await upsertTxn(name as (typeof TXN_ENTITIES)[number], row);
}

export type WebhookProcessSummary = {
  processed: number;
  failed: number;
};

/**
 * Process pending events, oldest first. Called after the webhook response and
 * again from the daily job so nothing stays pending forever (S155 fallback).
 * A failing event records its error and is retried on the next pass rather
 * than blocking the queue.
 */
export async function processPendingWebhookEvents(
  limit: number = 50,
): Promise<WebhookProcessSummary> {
  const pending = await query<{
    id: string;
    entity_name: string;
    entity_id: string;
    operation: string;
  }>(
    `SELECT id, entity_name, entity_id, operation
     FROM qbo_webhook_event
     WHERE processed_at IS NULL
     ORDER BY received_at
     LIMIT $1`,
    [limit],
  );

  let processed = 0;
  let failed = 0;
  for (const e of pending) {
    try {
      await applyEvent(e);
      await query(
        `UPDATE qbo_webhook_event SET processed_at = now(), error = NULL WHERE id = $1`,
        [e.id],
      );
      processed++;
    } catch (error) {
      failed++;
      await query(
        `UPDATE qbo_webhook_event SET error = $2 WHERE id = $1`,
        [e.id, (error as Error).message],
      );
    }
  }

  if (processed > 0 || failed > 0) {
    await query(
      `INSERT INTO integration_health (name, state, last_success_at, last_attempt_at, records_processed, last_error)
       VALUES ('quickbooks-webhooks', $1, CASE WHEN $2 > 0 THEN now() END, now(), $2, $3)
       ON CONFLICT (name) DO UPDATE SET
         state = EXCLUDED.state,
         last_success_at = COALESCE(EXCLUDED.last_success_at, integration_health.last_success_at),
         last_attempt_at = now(),
         records_processed = integration_health.records_processed + $2,
         last_error = $3,
         updated_at = now()`,
      [failed > 0 ? "degraded" : "connected", processed, failed > 0 ? `${failed} event(s) failed; will retry.` : null],
    );
  }
  return { processed, failed };
}
