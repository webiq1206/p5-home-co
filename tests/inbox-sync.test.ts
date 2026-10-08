import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { classify, parseMail, MAILBOX, type Mail } from "../app/lib/integrations/inbox-policy.ts";
import { inboxConfiguration, inboxFolders, deliverReceipt, runInboxSync, captureMailbox } from "../app/lib/integrations/inbox-sync.ts";
import type { ImapFlow } from "imapflow";
import { InboxStore } from "../app/lib/integrations/inbox-store.ts";
import { InboxHubSpot } from "../app/lib/integrations/inbox-hubspot.ts";
import { emailContent, htmlMatches, sourcePrefix } from "../app/lib/integrations/inbox-content.ts";

const received = new Date("2026-10-08T18:00:00Z"), due = new Date("2026-10-08T20:01:00Z");
function mail(overrides: Partial<Mail> = {}): Mail {
  return { messageId: "<synthetic-source@example.invalid>", subject: "Cabinet question", receivedAt: received.toISOString(), sentAt: received.toISOString(),
    from: [{ email: "customer@example.invalid", name: "Customer" }], to: [{ email: MAILBOX, name: "P5" }], cc: [],
    text: "Original question.\nLast line remains unchanged.", html: "<p>Original question.</p><p>Last line remains unchanged.</p>",
    headers: [], attachments: [], labels: ["\\All"], ...overrides };
}
function website(text: string) {
  return mail({ subject: "Project review requested: P5-QA", from: [{ email: MAILBOX, name: "P5" }], text,
    headers: [{ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=pass header.from=p5homeco.com" }] });
}
async function fixture(fn: (store: InboxStore, db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(readFileSync("migrations/018_inbox_sync.sql", "utf8"));
  const store = new InboxStore(async (sql, values = []) => (await db.query(sql, [...values])).rows as Record<string, unknown>[],
    async callback => db.transaction(tx => callback(async (sql, values = []) => (await tx.query(sql, [...values])).rows as Record<string, unknown>[])));
  try { await fn(store, db); } finally { await db.close(); }
}
async function capture(store: InboxStore, sourceId = "10000000000000000001", payload = mail(), folder = "Archive", validity = "1", uid = 5) {
  await store.capture({ sourceId, folder, validity, uid, mail: payload, decision: classify(payload) }, received);
}
function fakeCrm(overrides: Record<string, unknown> = {}) {
  return { findEmail: async () => null, findContact: async () => "contact-1", createEmail: async () => "email-1", verify: async () => {}, ...overrides } as unknown as InboxHubSpot;
}

test("default OFF performs no configured database or provider work", async () => {
  assert.equal(inboxConfiguration({}), null);
  assert.deepEqual(await runInboxSync({}), { status: "disabled", captured: 0, processed: 0 });
  assert.throws(() => inboxConfiguration({ P5_INBOX_SYNC_ENABLED: "true" }), /not-verified/);
  const env = { P5_INBOX_SYNC_ENABLED: "true", P5_INBOX_SYNC_VERIFIED_BINDING: "247066159:hello@p5homeco.com", SMTP_USER: MAILBOX,
    SMTP_PASSWORD: "synthetic-password", HUBSPOT_TOKEN: "synthetic-token", P5_INBOX_SYNC_START_AT: received.toISOString() };
  assert.equal(inboxConfiguration(env)?.start.toISOString(), received.toISOString());
  assert.throws(() => inboxConfiguration({ ...env, SMTP_USER: "hello@other.invalid" }), /wrong-mailbox/);
  assert.throws(() => inboxConfiguration({ ...env, SMTP_HOST: "attacker.invalid" }), /wrong-mailbox/);
  assert.throws(() => inboxConfiguration({ ...env, P5_INBOX_SYNC_START_AT: "" }), /explicit-utc-start/);
});

test("LIST uses reported special-use flags and localized paths, never guessed English names", () => {
  const folders = ["\\All", "\\Junk", "\\Trash"].map((use, i) => ({ path: `[Google Mail]/Synthetic-${i}`, flags: new Set([use]), specialUse: use, specialUseSource: "extension" as const }));
  assert.deepEqual(inboxFolders(folders).map(x => x.path), folders.map(x => x.path));
  assert.throws(() => inboxFolders(folders.slice(1)), /unverified/);
  assert.throws(() => inboxFolders(folders.map(f => ({ ...f, flags: new Set(), specialUseSource: "name" as const }))), /unverified/);
  assert.throws(() => inboxFolders([...folders, folders[0]]), /unverified/);
});

test("MIME decoding preserves separate original plaintext, HTML, headers and attachment metadata", async () => {
  const source = Buffer.from(["From: Customer <customer@example.invalid>", `To: ${MAILBOX}`, "Message-ID: <mime-test@example.invalid>",
    "Subject: =?UTF-8?B?Q2Fmw6kgcXVlc3Rpb24=?=", "MIME-Version: 1.0", 'Content-Type: multipart/alternative; boundary="x"', "", "--x",
    "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", Buffer.from("Café\nOriginal final line").toString("base64"),
    "--x", "Content-Type: text/html; charset=utf-8", "", '<p>Café</p><a href="https://example.invalid/source">Original link</a><img src="cid:original">', "--x--", ""].join("\r\n"));
  const parsed = await parseMail(source, received, ["\\All", "OriginalLabel"]);
  assert.equal(parsed.text, "Café\nOriginal final line");
  assert.equal(parsed.html, '<p>Café</p><a href="https://example.invalid/source">Original link</a><img src="cid:original">');
  assert.equal(parsed.subject, "Café question");
  assert.deepEqual(parsed.labels, ["\\All", "OriginalLabel"]);
  assert.ok(parsed.headers.some(h => h.key === "message-id"));
  const htmlOnly = await parseMail(Buffer.from(`From: a@example.invalid\r\nTo: ${MAILBOX}\r\nContent-Type: text/html\r\n\r\n<p>HTML only</p>`), received, []);
  assert.equal(htmlOnly.text, "");
  assert.equal(htmlOnly.html, "<p>HTML only</p>");
});

test("CRM source footer preserves original alternatives and exact Gmail identity with attachment access", () => {
  const original = mail({ headers: [{ key: "date", line: "Date: Thu, 08 Oct 2026 11:00:00 -0700" }],
    attachments: [{ name: 'Plan <v2> & "quote".pdf', size: 12345, type: "application/pdf" }] });
  const result = emailContent(original, "18446744073709551615");
  assert.ok(result.text.startsWith(original.text + "\n\n--- P5 source record ---"));
  assert.ok(result.html.startsWith(original.html + "\n<hr>"));
  assert.match(result.text, /authuser=hello%40p5homeco\.com#all\/ffffffffffffffff/);
  assert.ok(result.text.includes("Thu, 08 Oct 2026 11:00:00 -0700"));
  assert.ok(result.text.includes(original.receivedAt));
  assert.ok(result.text.includes(original.messageId));
  assert.ok(result.text.includes('Plan <v2> & "quote".pdf (12345 bytes; application/pdf)'));
  assert.match(result.html, /Plan &lt;v2&gt; &amp; &quot;quote&quot;\.pdf/);
  assert.equal(emailContent(mail({ html: "" }), "1").html, "");
  assert.throws(() => emailContent(original, "not-gmail"), /source-id-unverified/);
});

test("HTML readback tolerates formatting sanitization but rejects truncation and replaced links/images", () => {
  const original = '<style>p{color:red}</style><p>Café &amp; customer <b>details</b></p><a href="https://example.invalid/a?x=1&amp;y=2">Open plan</a><img src="cid:plan" alt="Plan">';
  const sanitized = '<div>Café &amp; customer <strong>details</strong></div><a href="https://example.invalid/a?x=1&amp;y=2">Open plan</a><img alt="Plan" src="cid:plan">';
  assert.equal(htmlMatches(original, sanitized), true);
  assert.equal(htmlMatches(original, sanitized + "<p>Source footer</p>", true), true);
  assert.equal(htmlMatches(original, "<p>Café</p>"), false);
  assert.equal(htmlMatches(original, sanitized.replace("example.invalid/a", "example.invalid/changed")), false);
  assert.equal(htmlMatches(original, sanitized.replace(' src="cid:plan"', "")), false);
  assert.equal(htmlMatches(original, ""), false);
  assert.equal(htmlMatches("<style>p{color:red}</style>", "<style>p{color:red}</style>"), false);
  assert.equal(htmlMatches("<p>Pay $10</p>", "<p>Pay $100</p>", true), false);
  assert.equal(sourcePrefix("Pay $10", "Pay $100"), false);
  assert.equal(sourcePrefix("Pay $10", "Pay $10\nSource footer"), true);
});

test("new EMAIL preserves display names and verifies complete HTML-only source and provenance", async () => {
  const original = mail({ text: "", html: '<p>Complete original HTML</p><a href="https://example.invalid/plan">Plan</a>',
    from: [{ email: "customer@example.invalid", name: 'Customer "Name"' }], cc: [{ email: "cc@example.invalid", name: "Copy Recipient" }] });
  let saved: Record<string, string> = {};
  const crm = new InboxHubSpot("synthetic-token", async (_input, init) => {
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)).properties; return new Response(JSON.stringify({ id: "new" })); }
    return new Response(JSON.stringify({ id: "new", properties: { ...saved, hs_email_from_email: original.from[0].email,
      hs_email_to_email: MAILBOX, hs_email_cc_email: "cc@example.invalid" }, associations: { contacts: { results: [] } } }));
  });
  await crm.createEmail(original, null, "18446744073709551615");
  const headers = JSON.parse(saved.hs_email_headers);
  assert.equal(headers.from.firstName, original.from[0].name);
  assert.equal(headers.to[0].firstName, "P5"); assert.equal(headers.cc[0].firstName, "Copy Recipient");
  await crm.verify("new", original, null, "18446744073709551615");
  saved.hs_email_html = "<p>Complete</p>";
  await assert.rejects(() => crm.verify("new", original, null, "18446744073709551615"), /readback-mismatch/);
  saved.hs_email_html = "";
  await assert.rejects(() => crm.verify("new", original, null, "18446744073709551615"), /readback-mismatch/);
});

test("native HTML-only EMAIL must preserve visible body and links, not just nonempty markup", async () => {
  const original = mail({ text: "", html: '<p>Complete original HTML</p><a href="https://example.invalid/plan">Plan</a>' });
  const crm = new InboxHubSpot("synthetic-token", async (_input, init) => new Response(JSON.stringify(init?.method === "POST"
    ? { total: 1, results: [{ id: "existing" }] }
    : { id: "existing", properties: { hs_email_message_id: original.messageId, hs_email_subject: original.subject,
      hs_email_from_email: original.from[0].email, hs_email_to_email: MAILBOX, hs_email_cc_email: "", hs_email_html: "<p>Complete</p>" } })));
  await assert.rejects(() => crm.findEmail(original), /crm-body-conflict/);
});

test("trusted website explicit fields identify the customer rather than the notification sender", () => {
  const result = classify(website("Reference: P5-QA\nName: Synthetic Customer\nEmail: customer@example.invalid\nPhone: 2085550123\n\nSaved project description:\nRepair a cabinet."));
  assert.deepEqual(result.identity, { kind: "email", value: "customer@example.invalid", create: true });
  assert.equal(classify(website(`Name: Team\nEmail: ${MAILBOX}\nPhone: 2084771169`)).identity, undefined);
});

test("valid multiline-name injection cannot redirect a website record to another customer", () => {
  const injected = "Name: Mallory\nEmail: victim@example.invalid\n\n\nEmail: mallory@example.invalid\nPhone: 2085550123\n\nSaved project description:\nSynthetic";
  const result = classify(website(injected));
  assert.equal(result.status, "pending");
  assert.equal(result.reason, "ambiguous-website-contact-fields");
  assert.equal(result.identity, undefined);
  assert.equal(classify(website(injected.replace("mallory@example.invalid", "Not supplied"))).identity, undefined);
});

test("injected later Authentication-Results cannot validate a website notification", () => {
  const source = website("Name: Test\nEmail: customer@example.invalid\nPhone: 2085550123");
  source.headers.unshift({ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=fail header.from=p5homeco.com" });
  assert.equal(classify(source).status, "review");
  source.headers = [{ key: "authentication-results", line: "Authentication-Results: attacker.invalid; dmarc=pass header.from=p5homeco.com" }];
  assert.equal(classify(source).status, "review");
});

test("Voice relay identity stays phone-only, with conflicts unassociated and no inferred name", () => {
  const source = mail({ from: [{ email: "12084771169.12085550123.opaque@txt.voice.google.com", name: "2085550123" }], subject: "New text message from (208) 555-0123",
    headers: [{ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=pass header.from=txt.voice.google.com" }] });
  assert.deepEqual(classify(source).identity, { kind: "phone", value: "+12085550123", create: false });
  assert.equal(classify({ ...source, subject: "New text message from (208) 555-0199" }).identity, undefined);
  assert.equal(classify({ ...source, text: "Call me back at (208) 555-0199." }).identity, undefined);
  const voicemail = { ...source, from: [{ email: "voice-noreply@google.com", name: "Google Voice" }], subject: "New voicemail from (208) 555-0123",
    headers: [{ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=pass header.from=google.com" }], text: "Play message https://voice.google.com/voicemail?itemId=synthetic" };
  assert.equal(classify(voicemail).identity?.kind, "phone");
});

test("Spam/Trash and missing IDs are held, bulk and outgoing mail are excluded", () => {
  assert.equal(classify(mail({ labels: ["\\Junk"] })).status, "review");
  assert.equal(classify(mail({ messageId: "" })).status, "review");
  assert.equal(classify(mail({ headers: [{ key: "list-unsubscribe", line: "List-Unsubscribe: <https://example.invalid>" }] })).status, "ignored");
  assert.equal(classify(mail({ from: [{ email: MAILBOX, name: "P5" }], to: [{ email: "someone@example.invalid", name: "" }] })).status, "ignored");
});

test("capture and UID checkpoint are atomic; repeated sources and UIDVALIDITY rollover preserve one receipt", async () => fixture(async (store, db) => {
  await capture(store);
  await capture(store);
  await capture(store, "10000000000000000001", mail(), "Localized Archive", "2", 1);
  assert.equal(await store.cursor("Archive", "1"), 5);
  assert.equal(await store.cursor("Localized Archive", "2"), 1);
  assert.equal((await db.query("SELECT * FROM p5_inbox_message")).rows.length, 1);
  const failing = new InboxStore(store.read, callback => db.transaction(tx => callback(async (sql, values = []) => {
    if (sql.includes("INSERT INTO p5_inbox_cursor")) throw new Error("synthetic checkpoint failure");
    return (await tx.query(sql, [...values])).rows as Record<string, unknown>[];
  })));
  await assert.rejects(() => capture(failing, "10000000000000000002", mail({ messageId: "<second@example.invalid>" }), "Archive", "1", 6), /checkpoint failure/);
  assert.equal(await store.cursor("Archive", "1"), 5);
  assert.equal((await db.query("SELECT * FROM p5_inbox_message")).rows.length, 1);
}));

test("different provider sources sharing an RFC ID are retained without a second creation candidate", async () => fixture(async (store, db) => {
  await capture(store); await capture(store, "10000000000000000002");
  const rows = (await db.query<{ status: string; reason: string }>("SELECT status,reason FROM p5_inbox_message ORDER BY source_id")).rows;
  assert.deepEqual(rows.map(r => r.status), ["pending", "review"]);
  assert.equal(rows[1].reason, "duplicate-rfc-source");
  assert.ok(await store.claim(due)); assert.equal(await store.claim(due), null);
}));

test("native logging grace period is respected before claiming", async () => fixture(async store => {
  await capture(store);
  assert.equal(await store.claim(new Date(received.getTime() + 60 * 60_000)), null);
  assert.ok(await store.claim(due));
}));

test("later Spam labels revoke a claim and stale workers cannot create or undo the hold", async () => fixture(async (store, db) => {
  await capture(store); const row = (await store.claim(due))!;
  await capture(store, "10000000000000000001", mail({ labels: ["\\Junk", "Retained"] }), "Localized Spam", "1", 2);
  assert.equal(await store.intent(row, due), false);
  await store.finish(row, "existing", due, { emailId: "should-not-win" });
  const [saved] = (await db.query<{ status: string; payload: Mail; labels: string[] }>("SELECT * FROM p5_inbox_message")).rows;
  assert.equal(saved.status, "review");
  assert.ok(saved.labels.includes("\\Junk")); assert.ok(saved.payload.labels.includes("\\Junk"));
}));

test("lost EMAIL create response never causes a second POST, even when search keeps lagging", async () => fixture(async (store, db) => {
  await capture(store); let creates = 0;
  const crm = fakeCrm({ createEmail: async () => { creates++; throw new Error("synthetic-network-loss"); } });
  const row = (await store.claim(due))!;
  await deliverReceipt(store, crm, row, () => due);
  const later = new Date(due.getTime() + 3600_000);
  await deliverReceipt(store, crm, (await store.claim(later))!, () => later);
  assert.equal(creates, 1);
  assert.equal((await db.query<{ status: string }>("SELECT status FROM p5_inbox_message")).rows[0].status, "uncertain");
}));

test("persisted create intent survives worker crash and is reconciled by full remote read", async () => fixture(async (store, db) => {
  await capture(store); const first = (await store.claim(due))!;
  assert.equal(await store.intent(first, due), true);
  const later = new Date(due.getTime() + 180_000), next = (await store.claim(later))!;
  let creates = 0;
  await deliverReceipt(store, fakeCrm({ findEmail: async () => ({ id: "recovered-id" }), createEmail: async () => { creates++; return "wrong"; } }), next, () => later);
  assert.equal(creates, 0);
  assert.equal((await db.query<{ hubspot_email_id: string }>("SELECT hubspot_email_id FROM p5_inbox_message")).rows[0].hubspot_email_id, "recovered-id");
}));

test("a known provider ID survives failed readback and is verified without re-creation", async () => fixture(async (store, db) => {
  await capture(store); let creates = 0, verifies = 0;
  const crm = fakeCrm({ createEmail: async () => { creates++; return "created-id"; }, verify: async () => { if (++verifies === 1) throw new Error("temporary-read-failure"); } });
  await deliverReceipt(store, crm, (await store.claim(due))!, () => due);
  const later = new Date(due.getTime() + 3600_000);
  await deliverReceipt(store, crm, (await store.claim(later))!, () => later);
  assert.equal(creates, 1); assert.equal(verifies, 2);
  assert.equal((await db.query<{ status: string }>("SELECT status FROM p5_inbox_message")).rows[0].status, "synced");
}));

test("existing native logging is adopted without modifying or creating an EMAIL", async () => fixture(async store => {
  await capture(store); let writes = 0;
  await deliverReceipt(store, fakeCrm({ findEmail: async () => ({ id: "native-id" }), createEmail: async () => { writes++; return "bad"; } }), (await store.claim(due))!, () => due);
  assert.equal(writes, 0);
}));

test("an existing native EMAIL attached to a notifier is preserved and flagged, never declared correctly associated", async () => fixture(async (store, db) => {
  await capture(store); let creates = 0;
  await deliverReceipt(store, fakeCrm({ findEmail: async () => ({ id: "native-id", associations: { contacts: { results: [{ id: "notifier-contact" }] } } }),
    createEmail: async () => { creates++; return "bad"; } }), (await store.claim(due))!, () => due);
  const [row] = (await db.query<{ status: string; last_error: string; hubspot_email_id: string }>("SELECT * FROM p5_inbox_message")).rows;
  assert.equal(creates, 0); assert.equal(row.status, "review"); assert.equal(row.hubspot_email_id, "native-id");
  assert.equal(row.last_error, "native-email-customer-association-unverified");
}));

test("correct native customer association is verified without mutation", async () => fixture(async (store, db) => {
  await capture(store);
  await deliverReceipt(store, fakeCrm({ findEmail: async () => ({ id: "native-id", associations: { contacts: { results: [{ id: "contact-1" }] } } }) }),
    (await store.claim(due))!, () => due);
  assert.equal((await db.query<{ status: string }>("SELECT status FROM p5_inbox_message")).rows[0].status, "existing");
}));

test("observed native ID is saved before failing contact lookup and cannot be forgotten on retry", async () => fixture(async (store, db) => {
  await capture(store); let creates = 0, searches = 0, lookups = 0;
  const existing = { id: "native-id", associations: { contacts: { results: [{ id: "contact-1" }] } } };
  const crm = fakeCrm({ findEmail: async () => { searches++; return existing; },
    readExisting: async (id: string) => { assert.equal(id, "native-id"); return existing; },
    findContact: async () => { if (++lookups === 1) throw new Error("temporary-contact-error"); return "contact-1"; },
    createEmail: async () => { creates++; return "bad"; } });
  await deliverReceipt(store, crm, (await store.claim(due))!, () => due);
  const [saved] = (await db.query<{ hubspot_email_id: string; hubspot_email_origin: string; status: string }>("SELECT * FROM p5_inbox_message")).rows;
  assert.equal(saved.hubspot_email_id, "native-id"); assert.equal(saved.hubspot_email_origin, "existing"); assert.equal(saved.status, "retry");
  const later = new Date(due.getTime() + 3600_000);
  await deliverReceipt(store, crm, (await store.claim(later))!, () => later);
  assert.equal(creates, 0); assert.equal(searches, 1); assert.equal(lookups, 2);
  assert.equal((await db.query<{ status: string }>("SELECT status FROM p5_inbox_message")).rows[0].status, "existing");
}));

test("403 readiness failure stops at EMAIL read and never selects another API", async () => {
  const paths: string[] = [];
  const crm = new InboxHubSpot("synthetic-token", async input => {
    const url = new URL(String(input)); paths.push(url.pathname);
    return new Response(JSON.stringify(paths.length === 1 ? { portalId: 247066159 } : { category: "MISSING_SCOPES" }), { status: paths.length === 1 ? 200 : 403 });
  });
  await assert.rejects(() => crm.preflight(), /hubspot-http-403/);
  assert.deepEqual(paths, ["/account-info/v3/details", "/crm/v3/objects/emails"]);
});

test("a different HubSpot portal is rejected before any CRM content is accessed", async () => {
  let requests = 0;
  const crm = new InboxHubSpot("synthetic-token", async () => { requests++; return new Response(JSON.stringify({ portalId: 999 })); });
  await assert.rejects(() => crm.preflight(), /wrong-hubspot-portal/); assert.equal(requests, 1);
});

test("phone lookup treats search as candidates and never creates a relay/phone contact", async () => {
  const bodies: unknown[] = [];
  const crm = new InboxHubSpot("synthetic-token", async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ total: 2, results: [
      { id: "correct", properties: { phone: "+1 (208) 555-0123" } }, { id: "different-country", properties: { phone: "+44 2085550123" } },
    ] }));
  });
  assert.equal(await crm.findContact({ kind: "phone", value: "+12085550123", create: false }), "correct");
  assert.equal((bodies[0] as { query: string }).query, "2085550123");
});

test("multiple exact customer matches remain ambiguous", async () => {
  const crm = new InboxHubSpot("synthetic-token", async () => new Response(JSON.stringify({ total: 2, results: [
    { id: "a", properties: { phone: "+12085550123" } }, { id: "b", properties: { mobilephone: "2085550123" } },
  ] })));
  await assert.rejects(() => crm.findContact({ kind: "phone", value: "+12085550123", create: false }), /ambiguous-contact/);
});

test("EMAIL search must read the full record and reject conflicting original headers", async () => {
  const requested: string[] = [];
  const crm = new InboxHubSpot("synthetic-token", async input => {
    requested.push(String(input));
    return new Response(JSON.stringify(requested.length === 1 ? { total: 1, results: [{ id: "existing" }] } : {
      id: "existing", properties: { hs_email_message_id: mail().messageId, hs_email_subject: mail().subject, hs_email_text: mail().text,
        hs_email_from_email: "other@example.invalid", hs_email_to_email: MAILBOX, hs_email_cc_email: "" },
    }));
  });
  await assert.rejects(() => crm.findEmail(mail()), /crm-header-conflict/);
  assert.equal(requested.length, 2);
});

test("IMAP adapter uses read-only UID operations, precise start and durable quarantine without mailbox mutations", async () => fixture(async (store, db) => {
  const sourceFetches: number[] = [], locks: string[] = [];
  let path = "", released = 0, loggedOut = false;
  const fake = {
    capabilities: new Map([["X-GM-EXT-1", true]]), usable: true,
    mailbox: { readOnly: true, uidValidity: 987654321n, uidNext: 4 },
    on: () => {}, close: () => {}, connect: async () => {}, logout: async () => { loggedOut = true; },
    list: async () => ["\\All", "\\Junk", "\\Trash"].map((use, i) => ({ path: `Localized-${i}`, flags: new Set([use]), specialUse: use, specialUseSource: "extension" })),
    getMailboxLock: async (selected: string, options: { readOnly: boolean }) => { assert.equal(options.readOnly, true); path = selected; locks.push(path); return { release: () => { released++; } }; },
    search: async (_query: unknown, options: { uid: boolean }) => { assert.equal(options.uid, true); return path === "Localized-0" ? [1,2,3] : []; },
    fetchOne: async (uid: number, fields: { source?: boolean }, options: { uid: boolean }) => {
      assert.equal(options.uid, true);
      if (fields.source) { sourceFetches.push(uid); return { uid, source: Buffer.from("malformed synthetic MIME") }; }
      return { uid, emailId: String(10000 + uid), internalDate: uid === 1 ? new Date(received.getTime() - 1) : received,
        size: uid === 2 ? 22_000_000 : 100, labels: new Set(["RetainedLabel"]), flags: new Set(["\\Seen"]),
        envelope: { messageId: `<uid-${uid}@example.invalid>`, subject: `Source ${uid}`, from: [{ address: "customer@example.invalid" }], to: [{ address: MAILBOX }] } };
    },
  };
  const count = await captureMailbox(store, { start: received, password: "synthetic-password", token: "synthetic-token" }, Date.now() + 40_000,
    options => { assert.equal(options.host, "imap.gmail.com"); assert.equal(options.logger, false); assert.equal(options.auth?.user, MAILBOX); return fake as unknown as ImapFlow; },
    async () => { throw new Error("synthetic parser refusal"); });
  assert.equal(count, 3); assert.equal(locks.length, 3); assert.equal(released, 3); assert.equal(loggedOut, true);
  assert.deepEqual(sourceFetches, [3]);
  const rows = (await db.query<{ status: string; reason: string; payload: Mail }>("SELECT status,reason,payload FROM p5_inbox_message ORDER BY source_id")).rows;
  assert.deepEqual(rows.map(r => r.reason), ["before-explicit-start", "oversize-source-retained-in-gmail", "mime-source-retained-in-gmail"]);
  assert.equal(rows[1].payload.subject, "Source 2"); assert.ok(rows[1].payload.labels.includes("RetainedLabel"));
  assert.equal(await store.cursor("Localized-0", "987654321"), 3);
}));
