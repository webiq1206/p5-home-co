import { randomUUID } from "node:crypto";
import { MAILBOX, type Mail, type Decision, type Identity } from "./inbox-policy.ts";

export type Read = (sql: string, values?: readonly unknown[]) => Promise<Record<string, unknown>[]>;
export type Atomic = <T>(fn: (read: Read) => Promise<T>) => Promise<T>;
export type Receipt = {
  source_id: string; payload: Mail; identity: Identity | null; status: string;
  lease_token: string; create_attempted_at: string | null; hubspot_email_id: string | null;
  hubspot_email_origin: "existing" | "created" | null;
  attempts: number;
};
export class InboxStore {
  read: Read; atomic: Atomic;
  constructor(read: Read, atomic: Atomic) { this.read = read; this.atomic = atomic; }
  async cursor(folder: string, validity: string): Promise<number> {
    const [row] = await this.read("SELECT last_uid FROM p5_inbox_cursor WHERE mailbox=$1 AND folder=$2 AND uid_validity=$3", [MAILBOX, folder, validity]);
    return Number(row?.last_uid || 0);
  }
  async capture(input: { sourceId: string; folder: string; validity: string; uid: number; mail: Mail; decision: Decision }, now: Date) {
    const { sourceId, folder, validity, uid, mail, decision } = input;
    await this.atomic(async read => {
      const rfc = /^<[^<>\s]+@[^<>\s]+>$/.test(mail.messageId) ? mail.messageId : null;
      const location = { folder, validity, uid, sourceId };
      const rows = await read(`INSERT INTO p5_inbox_message
        (mailbox,source_id,rfc_id,payload,labels,locations,status,reason,identity,next_attempt_at)
        VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)
        ON CONFLICT DO NOTHING RETURNING source_id`, [MAILBOX, sourceId, rfc, JSON.stringify(mail), JSON.stringify(mail.labels), JSON.stringify([location]),
        decision.status, decision.reason, JSON.stringify(decision.identity || null), new Date(Math.max(now.getTime(), Date.parse(mail.receivedAt)) + 2 * 60 * 60 * 1000)]);
      if (!rows.length) {
        // The same Gmail message can be in several folders. Keep every source
        // location and all observed labels without modifying the mailbox.
        const updated = await read(`UPDATE p5_inbox_message SET
          locations=(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(locations || $3::jsonb) item),
          labels=(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(labels || $4::jsonb) item),
          payload=jsonb_set(payload,'{labels}',(SELECT jsonb_agg(DISTINCT item) FROM jsonb_array_elements(labels || $4::jsonb) item)),
          status=CASE WHEN (labels || $4::jsonb) ?| $5::text[] AND create_attempted_at IS NULL
            AND status IN ('pending','retry','processing') THEN 'review' ELSE status END,
          lease_token=CASE WHEN (labels || $4::jsonb) ?| $5::text[] AND create_attempted_at IS NULL THEN NULL ELSE lease_token END,
          lease_until=CASE WHEN (labels || $4::jsonb) ?| $5::text[] AND create_attempted_at IS NULL THEN NULL ELSE lease_until END,
          reason=CASE WHEN (labels || $4::jsonb) ?| $5::text[] THEN 'spam-or-trash-retained' ELSE reason END
          WHERE mailbox=$1 AND source_id=$2 RETURNING source_id`, [MAILBOX, sourceId, JSON.stringify([location]), JSON.stringify(mail.labels), ["\\Junk", "\\Spam", "\\Trash"]]);
        if (!updated.length) {
          // Different provider IDs reusing an RFC ID never race to create two
          // CRM activities. Retain the complete second source for review.
          await read(`INSERT INTO p5_inbox_message
            (mailbox,source_id,payload,labels,locations,status,reason,next_attempt_at)
            VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'review','duplicate-rfc-source',$6)
            ON CONFLICT DO NOTHING`, [MAILBOX, sourceId, JSON.stringify(mail), JSON.stringify(mail.labels), JSON.stringify([location]), now]);
        }
      }
      await read(`INSERT INTO p5_inbox_cursor(mailbox,folder,uid_validity,last_uid) VALUES($1,$2,$3,$4)
        ON CONFLICT(mailbox,folder,uid_validity) DO UPDATE SET
        last_uid=GREATEST(p5_inbox_cursor.last_uid,EXCLUDED.last_uid),updated_at=now()`, [MAILBOX, folder, validity, uid]);
    });
  }
  async claim(now: Date): Promise<Receipt | null> {
    const token = randomUUID();
    const [row] = await this.read(`WITH candidate AS (
      SELECT mailbox,source_id FROM p5_inbox_message WHERE mailbox=$1
      AND reason<>'owner-connection-diagnostic'
      AND status IN ('pending','retry','uncertain','processing') AND next_attempt_at <= $2
      AND (lease_until IS NULL OR lease_until <= $2)
      ORDER BY next_attempt_at,source_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE p5_inbox_message m SET status='processing',lease_token=$3,lease_until=$4,attempts=m.attempts+1
      FROM candidate c WHERE m.mailbox=c.mailbox AND m.source_id=c.source_id RETURNING m.*`,
    [MAILBOX, now, token, new Date(now.getTime() + 120_000)]);
    return row ? row as unknown as Receipt : null;
  }
  async intent(row: Receipt, now: Date): Promise<boolean> {
    const rows = await this.read(`UPDATE p5_inbox_message SET create_attempted_at=$4
      WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND lease_until>$4
      AND status='processing' AND NOT (labels ?| $5::text[]) AND create_attempted_at IS NULL RETURNING source_id`,
      [MAILBOX, row.source_id, row.lease_token, now, ["\\Junk", "\\Spam", "\\Trash"]]);
    return rows.length === 1;
  }
  async adoptExisting(row: Receipt, emailId: string): Promise<boolean> {
    const rows = await this.read(`UPDATE p5_inbox_message SET hubspot_email_id=$4,hubspot_email_origin='existing'
      WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND status='processing' RETURNING source_id`,
    [MAILBOX, row.source_id, row.lease_token, emailId]);
    return rows.length === 1;
  }
  async finish(row: Receipt, status: string, now: Date, result: { emailId?: string; contactId?: string; error?: string; origin?: "existing" | "created" } = {}) {
    await this.read(`UPDATE p5_inbox_message SET status=$4,lease_token=NULL,lease_until=NULL,
      hubspot_email_id=COALESCE($5,hubspot_email_id),hubspot_contact_id=COALESCE($6,hubspot_contact_id),
      last_error=$7,next_attempt_at=$8,hubspot_email_origin=COALESCE($9,hubspot_email_origin) WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3`,
    [MAILBOX, row.source_id, row.lease_token, status, result.emailId || null, result.contactId || null, result.error || null,
      new Date(now.getTime() + Math.min(24 * 3600_000, 300_000 * 2 ** Math.min(row.attempts, 8))), result.origin || null]);
  }
}
