/**
 * Writing to QuickBooks, safely.
 *
 * The failure that matters here is not "the write failed" - it is "the write
 * succeeded and we never found out". A timeout after Intuit committed the
 * record looks identical to a timeout before it, and a naive retry turns one
 * bill into two, which turns into two payments.
 *
 * Three layers stop that:
 *   1. A durable intent row keyed by a DETERMINISTIC idempotency key. The same
 *      logical write can be attempted forever and still only produce one
 *      record, because the second attempt finds the first one's qbo_id.
 *   2. Intuit's own request-id de-duplication, as a shorter-memory backstop for
 *      the window where their commit beat ours.
 *   3. A refusal to auto-retry anything left 'pending'. We do not know what
 *      happened to it, so a human resolves it rather than a loop guessing.
 *
 * Successful writes are folded straight into the read model, so P5 Admin shows
 * the new record immediately instead of waiting for the webhook or the daily
 * pass - both of which will also arrive, idempotently.
 */

import { query, queryOne } from "../../db.ts";
import { qboRequest } from "./client.ts";
import { idempotencyKey, requestId } from "./map.ts";
import {
  TXN_ENTITIES,
  upsertCustomer,
  upsertTxn,
  upsertVendor,
  type QboRow,
} from "./sync.ts";

export type WriteEntity =
  | "Customer"
  | "Vendor"
  | "Invoice"
  | "PurchaseOrder"
  | "Bill";

export type WriteResult = {
  qboId: string;
  syncToken: string | null;
  /** True when this call returned an earlier attempt's record, not a new one. */
  reused: boolean;
  entity: WriteEntity;
  raw: QboRow;
};

type IntentRow = {
  id: string;
  status: string;
  qbo_id: string | null;
  sync_token: string | null;
  attempts: number;
};

/** Minutes after which a still-'pending' intent is treated as needing a human. */
const PENDING_STALE_MINUTES = 10;

/**
 * Fold a written record into the read model immediately.
 *
 * Deliberately best-effort: the write itself has already succeeded and been
 * recorded, so a read-model hiccup must not make the caller think the write
 * failed and retry it. The webhook and the daily sync both re-apply this.
 */
async function mirrorToReadModel(entity: WriteEntity, row: QboRow): Promise<void> {
  try {
    if (entity === "Customer") await upsertCustomer(row);
    else if (entity === "Vendor") await upsertVendor(row);
    else if ((TXN_ENTITIES as readonly string[]).includes(entity)) {
      await upsertTxn(entity as (typeof TXN_ENTITIES)[number], row);
    }
  } catch (error) {
    console.error(
      `[qbo-write] ${entity} written but read-model mirror failed:`,
      (error as Error).message,
    );
  }
}

export type QboWriteInput = {
  entity: WriteEntity;
  operation?: "create" | "update";
  /**
   * Unique in P5's own terms - a project id, a draw number, a vendor's
   * invoice reference. NOT a timestamp: a retry must derive the same key.
   */
  naturalKey: string;
  payload: Record<string, unknown>;
  requestedBy?: number | null;
};

export async function qboWrite(input: QboWriteInput): Promise<WriteResult> {
  const operation = input.operation ?? "create";
  const key = idempotencyKey(input.entity, operation, input.naturalKey);

  // Claim the intent. ON CONFLICT DO NOTHING means the second caller for the
  // same logical write gets no row back and has to inspect what the first one
  // did, which is exactly the behaviour we want.
  const claimed = await query<{ id: string }>(
    `INSERT INTO qbo_write_intent
       (idempotency_key, entity, operation, payload, requested_by, attempts, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, 1, 'pending')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [key, input.entity, operation, JSON.stringify(input.payload), input.requestedBy ?? null],
  );

  let intentId: number;

  if (claimed.length) {
    intentId = Number(claimed[0].id);
  } else {
    const existing = await queryOne<IntentRow & { age_minutes: string }>(
      `SELECT id, status, qbo_id, sync_token, attempts,
              EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS age_minutes
         FROM qbo_write_intent WHERE idempotency_key = $1`,
      [key],
    );
    if (!existing) throw new Error("Write intent vanished between insert and read.");

    // Already done. This is the whole point: return the record we made before.
    if (existing.status === "succeeded" && existing.qbo_id) {
      const raw = await fetchExisting(input.entity, existing.qbo_id);
      return {
        qboId: existing.qbo_id,
        syncToken: existing.sync_token,
        reused: true,
        entity: input.entity,
        raw,
      };
    }

    if (existing.status === "pending") {
      if (Number(existing.age_minutes) >= PENDING_STALE_MINUTES) {
        await query(
          `UPDATE qbo_write_intent
              SET status = 'needs_review',
                  last_error = 'Left pending; a record may or may not exist in QuickBooks.'
            WHERE id = $1`,
          [existing.id],
        );
        throw new Error(
          `A previous ${input.entity} write was left in an unknown state and needs checking in QuickBooks before retrying.`,
        );
      }
      throw new Error(`A ${input.entity} write for this record is already in progress.`);
    }

    if (existing.status === "needs_review") {
      throw new Error(
        `This ${input.entity} write is held for review; resolve it in QuickBooks before retrying.`,
      );
    }

    // 'failed' - a genuine retry, which is safe because the key is unchanged.
    intentId = Number(existing.id);
    await query(
      `UPDATE qbo_write_intent
          SET status = 'pending', attempts = attempts + 1, last_error = NULL
        WHERE id = $1`,
      [intentId],
    );
  }

  try {
    const path = `/${input.entity.toLowerCase()}?requestid=${encodeURIComponent(requestId(key))}`;
    const response = await qboRequest<Record<string, QboRow>>(path, {
      method: "POST",
      body: JSON.stringify(input.payload),
    });

    const row = response[input.entity];
    const qboId = row && typeof row.Id === "string" ? row.Id : null;
    if (!qboId) {
      throw new Error(`QuickBooks accepted the ${input.entity} but returned no Id.`);
    }
    const syncToken = typeof row.SyncToken === "string" ? row.SyncToken : null;

    await query(
      `UPDATE qbo_write_intent
          SET status = 'succeeded', qbo_id = $2, sync_token = $3, completed_at = now()
        WHERE id = $1`,
      [intentId, qboId, syncToken],
    );

    await mirrorToReadModel(input.entity, row);

    return { qboId, syncToken, reused: false, entity: input.entity, raw: row };
  } catch (error) {
    const message = (error as Error).message;
    await query(
      `UPDATE qbo_write_intent SET status = 'failed', last_error = $2 WHERE id = $1`,
      [intentId, message],
    ).catch(() => undefined);
    throw error;
  }
}

/** Read a record back by id, used when returning an earlier attempt's result. */
async function fetchExisting(entity: WriteEntity, qboId: string): Promise<QboRow> {
  const response = await qboRequest<Record<string, QboRow>>(
    `/${entity.toLowerCase()}/${encodeURIComponent(qboId)}`,
  );
  return response[entity] ?? {};
}

/**
 * Writes that never resolved. These are the ones that can duplicate money if
 * anyone retries them blindly, so they belong in front of a human.
 */
export async function unresolvedWrites(): Promise<
  { id: number; entity: string; operation: string; status: string; error: string | null }[]
> {
  const rows = await query<{
    id: string;
    entity: string;
    operation: string;
    status: string;
    last_error: string | null;
  }>(
    `SELECT id, entity, operation, status, last_error
       FROM qbo_write_intent
      WHERE status IN ('needs_review','failed')
      ORDER BY created_at DESC
      LIMIT 50`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    entity: r.entity,
    operation: r.operation,
    status: r.status,
    error: r.last_error,
  }));
}
