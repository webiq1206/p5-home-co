/**
 * Google Voice texts and voicemails as native HubSpot engagements.
 *
 * The inbox sync already mirrors each Google Voice notification email into
 * HubSpot as an EMAIL record and matches the contact by phone (inbox-policy.ts
 * reason "voice-notification"). That mirror stays: it is the source record.
 * This adds the engagement the team actually looks for, on the same contact:
 *
 *   text      -> COMMUNICATION, channel SMS, when the portal accepts the
 *                communications object (checked before anything is posted);
 *                otherwise a NOTE headed "Google Voice text message (SMS)"
 *   voicemail -> CALL, inbound, titled "Google Voice voicemail"
 *
 * Runs only inside the gated inbox pass (P5_INBOX_SYNC_* env vars), with the
 * same durable rule as voice-activity.ts: an attempt is saved before the POST,
 * and an attempt whose result is unknown goes to review, never a repost.
 */

import { randomUUID } from "node:crypto";

import { MAILBOX, phone as normalizePhone, type Mail } from "./inbox-policy.ts";
import { InboxApiError, type InboxHubSpot } from "./inbox-hubspot.ts";
import type { Read } from "./inbox-store.ts";

type Row = {
  source_id: string; contact_id: string | null; kind: "sms" | "voicemail";
  lease_token: string; attempted_at: string | null; object_id: string | null;
};
type Assoc = { results: { category: string; typeId: number }[] };

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A text or a voicemail, from the Google Voice notification itself. */
export function voiceMessageKind(mail: Pick<Mail, "subject" | "from">): "sms" | "voicemail" | null {
  if (/voicemail/i.test(mail.subject)) return "voicemail";
  const sender = mail.from[0]?.email ?? "";
  if (/@txt\.voice\.google\.com$/i.test(sender) || /\btext message\b|\bmessage from\b/i.test(mail.subject)) return "sms";
  return null;
}

/** The caller's number, as the classifier found it (relay address or subject). */
export function voiceMessageNumber(mail: Pick<Mail, "subject" | "from">): string | null {
  const relay = mail.from[0]?.email.match(/^\d+\.(\d+)\.[^@]+@txt\.voice\.google\.com$/)?.[1];
  const subject = mail.subject.match(/(?:voicemail|message) from\s+([+()\d .-]+)/i)?.[1];
  return (relay ? normalizePhone(`+${relay}`) : null) ?? (subject ? normalizePhone(subject) : null);
}

/** The message as Google Voice sent it, without the footer boilerplate. */
export function voiceMessageText(mail: Pick<Mail, "text">): string {
  const lines = mail.text.replace(/\r/g, "").split("\n");
  const end = lines.findIndex((line) => /^(?:To respond to this text message|YOUR ACCOUNT|HELP CENTER|Google LLC)/i.test(line.trim()));
  return (end > 0 ? lines.slice(0, end) : lines).join("\n").trim().slice(0, 20_000);
}

function sourceUrl(id: string): string {
  return `https://mail.google.com/mail/?authuser=hello%40p5homeco.com#all/${BigInt(id).toString(16)}`;
}

export function voiceMessageEngagement(mail: Mail, sourceId: string, kind: "sms" | "voicemail", object: "communications" | "notes" | "calls") {
  if (!/^\d+$/.test(sourceId)) throw new Error("unverified-voice-source-id");
  const number = voiceMessageNumber(mail) ?? "unknown number";
  const text = voiceMessageText(mail);
  const footer = `Source Gmail: ${sourceUrl(sourceId)}\nSource RFC Message-ID: ${mail.messageId}`;
  if (object === "calls") {
    return {
      hs_timestamp: mail.receivedAt,
      hs_call_title: `Google Voice voicemail from ${number}`,
      hs_call_body: `Voicemail transcript (Google-generated, verify before use):\n${text}\n\n${footer}`,
      hs_call_direction: "INBOUND",
      hs_call_status: "COMPLETED",
    };
  }
  if (object === "communications") {
    return {
      hs_timestamp: mail.receivedAt,
      hs_communication_channel_type: "SMS",
      hs_communication_logged_from: "CRM",
      hs_communication_body: `Google Voice text message from ${number}:\n${text}\n\n${footer}`,
    };
  }
  return {
    hs_timestamp: mail.receivedAt,
    hs_note_body: [
      `<p><strong>Google Voice ${kind === "sms" ? "text message (SMS)" : "voicemail"} from ${escape(number)}</strong></p>`,
      `<pre>${escape(text)}</pre>`,
      `<p>Source Gmail message: <a href="${escape(sourceUrl(sourceId))}">view the original</a></p>`,
      `<p>Source RFC Message-ID: ${escape(mail.messageId)}</p>`,
    ].join("\n"),
  };
}

function associationTypes(labels: Assoc, code: number) {
  if (!labels.results.some((x) => x.category === "HUBSPOT_DEFINED" && x.typeId === code)) throw new Error("voice-message-association-unverified");
  return [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: code }];
}

function fixedError(error: unknown): string {
  const s = error instanceof Error ? error.message : "";
  return /^[a-z0-9-]{1,80}$/.test(s) ? s : "voice-message-provider-error";
}

/** Communications object available for this token and portal? Decided before any POST. */
async function smsObject(crm: InboxHubSpot): Promise<{ object: "communications" | "notes"; types: ReturnType<typeof associationTypes> }> {
  try {
    await crm.call("/crm/v3/objects/communications?limit=1");
    const labels = await crm.call<Assoc>("/crm/v4/associations/communications/contacts/labels");
    return { object: "communications", types: associationTypes(labels, 81) };
  } catch (error) {
    if (!(error instanceof InboxApiError) || ![400, 403, 404].includes(error.status)) {
      if (error instanceof Error && error.message === "voice-message-association-unverified") {
        // Fall through to notes: the association could not be proven.
      } else throw error;
    }
    const labels = await crm.call<Assoc>("/crm/v4/associations/notes/contacts/labels");
    return { object: "notes", types: associationTypes(labels, 202) };
  }
}

export async function processVoiceMessages(read: Read, crm: InboxHubSpot, opts: { limit?: number; deadline?: number } = {}) {
  const limit = Math.min(5, Math.max(1, opts.limit || 3));
  const deadline = opts.deadline || Date.now() + 45_000;
  // Only receipts the inbox sync delivered and matched to one contact by phone.
  const candidates = await read(`SELECT source_id, hubspot_contact_id, payload FROM p5_inbox_message m
    WHERE mailbox=$1 AND reason='voice-notification' AND status IN ('synced','existing') AND hubspot_contact_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM p5_voice_message_activity v WHERE v.mailbox=m.mailbox AND v.source_id=m.source_id)
    ORDER BY created_at LIMIT 40`, [MAILBOX]);
  for (const candidate of candidates) {
    const kind = voiceMessageKind(candidate.payload as Mail);
    if (!kind) continue;
    await read(`INSERT INTO p5_voice_message_activity(mailbox,source_id,contact_id,kind) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [MAILBOX, candidate.source_id, candidate.hubspot_contact_id, kind]);
  }
  const [pending] = await read(`SELECT count(*)::integer AS n FROM p5_voice_message_activity WHERE mailbox=$1 AND state IN ('pending','processing')`, [MAILBOX]);
  if (!Number(pending?.n || 0)) return { completed: 0, review: 0 };
  const sms = await smsObject(crm);
  const callTypes = associationTypes(await crm.call<Assoc>("/crm/v4/associations/calls/contacts/labels"), 194);
  let completed = 0, review = 0;
  for (let i = 0; i < limit && Date.now() < deadline - 10_000; i++) {
    const token = randomUUID();
    const [claimed] = await read(`WITH candidate AS (SELECT mailbox,source_id FROM p5_voice_message_activity
      WHERE mailbox=$1 AND state IN ('pending','processing') AND (lease_until IS NULL OR lease_until<=now())
      ORDER BY created_at,source_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE p5_voice_message_activity a SET state='processing',lease_token=$2,lease_until=now()+interval '120 seconds',updated_at=now()
      FROM candidate c WHERE a.mailbox=c.mailbox AND a.source_id=c.source_id RETURNING a.*`, [MAILBOX, token]);
    if (!claimed) break;
    const row = claimed as unknown as Row;
    const done = async (state: "complete" | "review", error: string | null, extra: { object?: string; id?: string } = {}) => {
      await read(`UPDATE p5_voice_message_activity SET state=$4,lease_token=NULL,lease_until=NULL,last_error=$5,
        object_type=COALESCE($6,object_type),object_id=COALESCE($7,object_id),updated_at=now()
        WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3`, [MAILBOX, row.source_id, row.lease_token, state, error, extra.object ?? null, extra.id ?? null]);
    };
    try {
      if (row.object_id) { await done("complete", null); completed++; continue; }
      if (row.attempted_at) throw new Error("voice-message-create-uncertain-no-repost");
      const [source] = await read(`SELECT payload,hubspot_contact_id,status,reason FROM p5_inbox_message WHERE mailbox=$1 AND source_id=$2`, [MAILBOX, row.source_id]);
      if (!source || source.reason !== "voice-notification" || !row.contact_id || source.hubspot_contact_id !== row.contact_id) throw new Error("voice-message-contact-review");
      const mail = source.payload as Mail;
      const number = voiceMessageNumber(mail);
      // Same rule as the call notes: the phone must still match this one contact.
      if (!number || (await crm.findContact({ kind: "phone", value: number, create: false })) !== row.contact_id) throw new Error("voice-message-contact-review");
      const object = row.kind === "voicemail" ? "calls" as const : sms.object;
      const types = row.kind === "voicemail" ? callTypes : sms.types;
      const intent = await read(`UPDATE p5_voice_message_activity SET attempted_at=now() WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3
        AND attempted_at IS NULL AND lease_until>now() RETURNING source_id`, [MAILBOX, row.source_id, row.lease_token]);
      if (!intent.length) throw new Error("voice-message-intent-not-verified");
      const created = await crm.call<{ id: string }>(`/crm/v3/objects/${object}`, "POST", {
        properties: voiceMessageEngagement(mail, row.source_id, row.kind, object),
        associations: [{ to: { id: row.contact_id }, types }],
      });
      if (!/^\d+$/.test(String(created.id))) throw new Error("voice-message-create-uncertain-no-repost");
      await done("complete", null, { object, id: String(created.id) });
      completed++;
    } catch (error) {
      await done("review", fixedError(error));
      review++;
    }
  }
  return { completed, review };
}
