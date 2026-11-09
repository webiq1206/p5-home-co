import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { InboxApiError, type InboxHubSpot } from "../app/lib/integrations/inbox-hubspot.ts";
import type { Mail } from "../app/lib/integrations/inbox-policy.ts";
import type { Read } from "../app/lib/integrations/inbox-store.ts";
import { processVoiceMessages, voiceMessageKind, voiceMessageNumber } from "../app/lib/integrations/voice-messages.ts";

// Google Voice texts and voicemails already mirrored as EMAIL records become
// SMS communications (or notes) and CALLs on the phone-matched contact.

const text: Mail = {
  messageId: "<voice-text@txt.voice.google.com>", subject: "New text message from (208) 555-0123",
  from: [{ email: "12084771169.12085550123.opaque@txt.voice.google.com", name: "(208) 555-0123" }],
  to: [{ email: "hello@p5homeco.com", name: "" }], cc: [], bcc: [],
  text: "Can you look at my deck this week?\n\nTo respond to this text message, reply to this email.\nYOUR ACCOUNT",
  html: "", labels: ["\\All"], attachments: [], sentAt: null, receivedAt: "2026-11-09T18:00:00Z", headers: [],
};
const voicemail: Mail = { ...text, messageId: "<vm@google.com>", from: [{ email: "voice-noreply@google.com", name: "Google Voice" }],
  subject: "New voicemail from (208) 555-0123", text: "Hi, this is Kim about the cabinets. Call me back.\n\nYOUR ACCOUNT" };

async function voiceDb(fn: (read: Read) => Promise<void>) {
  const db = new PGlite();
  await db.exec(readFileSync("migrations/018_inbox_sync.sql", "utf8"));
  await db.exec(readFileSync("migrations/023_voice_messages.sql", "utf8"));
  const read: Read = async (sql, values = []) => (await db.query(sql, [...values])).rows as Record<string, unknown>[];
  try { await fn(read); } finally { await db.close(); }
}

async function seed(read: Read, sourceId: string, original: Mail, contact: string | null = "100") {
  const mail = { ...original, messageId: `<${sourceId}@voice.example>` };
  await read(`INSERT INTO p5_inbox_message(mailbox,source_id,rfc_id,payload,labels,locations,status,reason,identity,next_attempt_at,hubspot_contact_id)
    VALUES($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb,'synced','voice-notification',$5::jsonb,now(),$6)`,
  ["hello@p5homeco.com", sourceId, mail.messageId, JSON.stringify(mail), JSON.stringify({ kind: "phone", value: "+12085550123", create: false }), contact]);
}

function crm(options: { communications?: boolean; match?: string; lose?: boolean } = {}) {
  const posts: { path: string; body: { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] } }[] = [];
  const client = {
    findContact: async () => options.match ?? "100",
    call: async (path: string, method = "GET", body?: unknown) => {
      if (path.startsWith("/crm/v3/objects/communications?") && options.communications === false) throw new InboxApiError(403, path, method);
      if (path.includes("associations/communications/contacts/labels")) return { results: [{ category: "HUBSPOT_DEFINED", typeId: 81 }] };
      if (path.includes("associations/notes/contacts/labels")) return { results: [{ category: "HUBSPOT_DEFINED", typeId: 202 }] };
      if (path.includes("associations/calls/contacts/labels")) return { results: [{ category: "HUBSPOT_DEFINED", typeId: 194 }] };
      if (method === "POST") {
        posts.push({ path, body: body as (typeof posts)[number]["body"] });
        if (options.lose) throw new InboxApiError(0, path, method);
        return { id: String(700 + posts.length) };
      }
      return { results: [] };
    },
  };
  return { client: client as unknown as InboxHubSpot, posts };
}

test("kind and number come from the Google Voice notification", () => {
  assert.equal(voiceMessageKind(text), "sms");
  assert.equal(voiceMessageKind(voicemail), "voicemail");
  assert.equal(voiceMessageNumber(text), "+12085550123");
  assert.equal(voiceMessageNumber(voicemail), "+12085550123");
});

test("a text is an SMS communication and a voicemail is an inbound CALL, on the matched contact", () => voiceDb(async (read) => {
  await seed(read, "1883000000000000001", text);
  await seed(read, "1883000000000000002", voicemail);
  const hub = crm();
  assert.deepEqual(await processVoiceMessages(read, hub.client, { limit: 5 }), { completed: 2, review: 0 });
  const sms = hub.posts.find((p) => p.path === "/crm/v3/objects/communications")!;
  assert.equal(sms.body.properties.hs_communication_channel_type, "SMS");
  assert.match(sms.body.properties.hs_communication_body, /^Google Voice text message from \+12085550123:\nCan you look at my deck this week\?\n\nSource Gmail/);
  assert.deepEqual(sms.body.associations, [{ to: { id: "100" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 81 }] }]);
  const call = hub.posts.find((p) => p.path === "/crm/v3/objects/calls")!;
  assert.equal(call.body.properties.hs_call_direction, "INBOUND");
  assert.match(call.body.properties.hs_call_title, /voicemail from \+12085550123/);
  assert.match(call.body.properties.hs_call_body, /Kim about the cabinets/);
  // Done is done: the next pass posts nothing.
  const again = crm();
  assert.deepEqual(await processVoiceMessages(read, again.client), { completed: 0, review: 0 });
  assert.equal(again.posts.length, 0);
}));

test("without the communications object, a text is a NOTE with a clear header", () => voiceDb(async (read) => {
  await seed(read, "1883000000000000003", text);
  const hub = crm({ communications: false });
  assert.deepEqual(await processVoiceMessages(read, hub.client), { completed: 1, review: 0 });
  assert.equal(hub.posts[0].path, "/crm/v3/objects/notes");
  assert.match(hub.posts[0].body.properties.hs_note_body, /<strong>Google Voice text message \(SMS\) from \+12085550123<\/strong>/);
  assert.equal(hub.posts[0].body.associations[0].types[0].associationTypeId, 202);
}));

test("an unmatched contact or a lost response goes to review and is never reposted", () => voiceDb(async (read) => {
  await seed(read, "1883000000000000004", text);
  await seed(read, "1883000000000000005", text, null);
  const lost = crm({ lose: true });
  assert.deepEqual(await processVoiceMessages(read, lost.client), { completed: 0, review: 1 });
  assert.equal(lost.posts.length, 1, "only the matched one was attempted");
  await read("UPDATE p5_voice_message_activity SET state='pending'");
  const retry = crm();
  assert.deepEqual(await processVoiceMessages(read, retry.client), { completed: 0, review: 1 });
  assert.equal(retry.posts.length, 0, "an attempt with an unknown result is never posted again");
  const moved = crm({ match: "999" });
  await seed(read, "1883000000000000006", voicemail);
  assert.deepEqual(await processVoiceMessages(read, moved.client), { completed: 0, review: 1 });
  assert.equal(moved.posts.length, 0);
}));
