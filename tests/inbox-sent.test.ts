import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { classify, emailDirection, emailTimestamp, parseMail, MAILBOX, VERIFIED_HELLO_ALIASES, type Mail } from "../app/lib/integrations/inbox-policy.ts";
import { InboxHubSpot } from "../app/lib/integrations/inbox-hubspot.ts";
import { InboxStore } from "../app/lib/integrations/inbox-store.ts";
import { deliverReceipt } from "../app/lib/integrations/inbox-sync.ts";

function sent(overrides: Partial<Mail> = {}): Mail {
  return { messageId: "<offline-sent@example.invalid>", subject: "Cabinets", sentAt: "2026-10-08T16:55:00.000Z", receivedAt: "2026-10-08T16:55:02.000Z",
    from: [{ email: MAILBOX, name: "Client Services" }], to: [{ email: "customer@example.invalid", name: "Customer" }], cc: [], bcc: [],
    text: "Original customer follow-up.", html: '<p>Original customer follow-up.</p><a href="https://example.invalid/plans">Plans</a>',
    headers: [], attachments: [], labels: ["\\All", "\\Sent"], ...overrides };
}

test("Sent correspondence requires provider label and exactly one of the six verified hello aliases", () => {
  assert.equal(VERIFIED_HELLO_ALIASES.length, 6);
  for (const alias of VERIFIED_HELLO_ALIASES) {
    const source = sent({ from: [{ email: alias, name: "P5 brand" }] });
    assert.deepEqual(classify(source).identity, { kind: "email", value: "customer@example.invalid", create: false });
    assert.equal(emailDirection(source), "EMAIL");
    assert.equal(emailTimestamp(source), source.sentAt);
  }
  assert.equal(classify(sent({ labels: ["\\All"] })).status, "ignored");
  for (const alias of ["sales@p5homeco.com", "hello@reply.boisecabinet.co", "customer@example.invalid"]) {
    assert.equal(classify(sent({ from: [{ email: alias, name: "Other" }] })).reason, "unverified-sent-alias");
  }
  assert.equal(classify(sent({ sentAt: null })).reason, "missing-original-sent-date");
});

test("To, Cc and Bcc are deduplicated for exact customer identity; ambiguous recipients are never guessed", () => {
  assert.equal(classify(sent({ cc: [{ email: "customer@example.invalid", name: "Same" }, { email: MAILBOX, name: "P5" }] })).identity?.value, "customer@example.invalid");
  const blind = sent({ to: [{ email: MAILBOX, name: "P5" }], bcc: [{ email: "customer@example.invalid", name: "Blind copy" }] });
  assert.deepEqual(classify(blind).identity, { kind: "email", value: "customer@example.invalid", create: false });
  const multiple = sent({ bcc: [{ email: "different@example.invalid", name: "Another person" }] });
  assert.equal(classify(multiple).status, "pending"); assert.equal(classify(multiple).identity, undefined);
  assert.equal(classify(sent({ cc: [{ email: "malformed", name: "Invalid" }] })).status, "review");
  assert.equal(classify(sent({ to: [{ email: "accounting@p5homeco.com", name: "Accounts" }] })).status, "ignored");
});

test("observed Gmail SMTP templates, campaigns and provider wrappers are excluded without blocking human forwards", () => {
  const subjects = ["[Partial] Anonymous Consultation form drop-off at form (0%)", "[Partial] Identified quote form drop-off at contact (67%)",
    "Callback requested: Synthetic", "Boise Cabinet Co: internal estimate record (ref abcdef12)",
    "P5 Home Co: estimate delivery needs attention (ref abcdef12)", "Project request P5-ABC · revision 15",
    "P5 Daily Snapshot October 8, 2026 - no significant issues", "[Outreach reply] Example", "P5 URGENT: Customer needs a response now"];
  for (const subject of subjects) assert.equal(classify(sent({ subject })).reason, "known-automated-sent-template", subject);
  for (const [key, value] of [["list-unsubscribe", "<https://example.invalid/unsubscribe>"], ["list-unsubscribe-post", "List-Unsubscribe=One-Click"],
    ["list-id", "campaign"], ["precedence", "bulk"], ["auto-submitted", "auto-generated"]]) {
    assert.equal(classify(sent({ headers: [{ key, line: `${key}: ${value}` }] })).reason, "bulk-or-automated-sent");
  }
  assert.equal(classify(sent({ subject: "Fwd: Customer plans" })).reason, "sent-correspondence");
  assert.equal(classify(sent({ subject: "Re: Your Boise Cabinet Co preliminary estimate P5-ABC" })).reason, "sent-correspondence");
  const wrapper = sent({ subject: "Fwd: Customer inquiry", to: [{ email: "247066159@forward.na2.hubspot.com", name: "HubSpot" }],
    text: "---------- Forwarded message ---------\nOriginal Message-ID: <source@example.invalid>\nResend received email: received-123" });
  assert.equal(classify(wrapper).status, "ignored");
  assert.equal(classify({ ...wrapper, to: [{ email: "customer@example.invalid", name: "Customer" }] }).reason, "sent-correspondence");
  const loggingBcc = sent({ bcc: [{ email: "247066159@bcc.na2.hubspot.com", name: "CRM logging" }] });
  assert.equal(classify(loggingBcc).identity?.value, "customer@example.invalid");
});

test("client estimates and saved-project receipts remain business correspondence despite automatic generation", () => {
  for (const subject of ["Your saved project request P5-ABC · revision 15", "Your Boise Cabinet Co preliminary estimate P5-ABC", "Your P5 Home Co preliminary estimate P5-ABC"]) {
    const source = sent({ subject, messageId: "<p5-intake-customer-receipt@p5homeco.com>" });
    assert.equal(classify(source).reason, "sent-correspondence");
    assert.deepEqual(classify(source).identity, { kind: "email", value: "customer@example.invalid", create: false });
    assert.equal(emailDirection(source), "EMAIL");
    assert.equal(classify({ ...source, headers: [{ key: "list-unsubscribe", line: "List-Unsubscribe: <https://example.invalid>" }] }).status, "ignored");
  }
});

test("Sent-labeled trusted website notifications retain their incoming customer-field behavior", () => {
  const source = sent({ subject: "New consultation request: Synthetic", to: [{ email: MAILBOX, name: "P5" }],
    text: "Name: Synthetic Customer\nEmail: customer@example.invalid\nPhone: 2085550123",
    headers: [{ key: "authentication-results", line: "Authentication-Results: mx.google.com; dmarc=pass header.from=p5homeco.com" }] });
  assert.deepEqual(classify(source).identity, { kind: "email", value: "customer@example.invalid", create: true });
  assert.equal(emailDirection(source), "INCOMING_EMAIL"); assert.equal(emailTimestamp(source), source.receivedAt);
});

test("MIME Bcc survives parsing and Sent EMAIL uses supported direction, original sent date and strict Bcc readback", async () => {
  const raw = Buffer.from([`From: Client Services <${MAILBOX}>`, "To: Customer <customer@example.invalid>", "Cc: Colleague <colleague@example.invalid>",
    'Bcc: "Blind Recipient" <blind@example.invalid>', "Subject: New Builds", "Message-ID: <sent-bcc@example.invalid>",
    "Date: Thu, 08 Oct 2026 11:00:26 -0600", "Content-Type: text/plain; charset=utf-8", "", "Original plans: https://example.invalid/plans"].join("\r\n"));
  const source = await parseMail(raw, new Date("2026-10-08T17:00:28Z"), ["\\All", "\\Sent"]);
  assert.deepEqual(source.bcc, [{ email: "blind@example.invalid", name: "Blind Recipient" }]);
  let saved: Record<string, string> = {};
  const crm = new InboxHubSpot("synthetic-token", async (_input, init) => {
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)).properties; return new Response(JSON.stringify({ id: "sent-created" })); }
    return new Response(JSON.stringify({ id: "sent-created", properties: { ...saved, hs_email_from_email: MAILBOX,
      hs_email_to_email: "customer@example.invalid", hs_email_cc_email: "colleague@example.invalid" }, associations: { contacts: { results: [{ id: "known-contact" }] } } }));
  });
  await crm.createEmail(source, "known-contact", "1878499354188792726");
  assert.equal(saved.hs_email_direction, "EMAIL"); assert.equal(saved.hs_timestamp, "2026-10-08T17:00:26.000Z");
  const headers = JSON.parse(saved.hs_email_headers);
  assert.deepEqual(headers.bcc, [{ email: "blind@example.invalid", firstName: "Blind Recipient" }]);
  assert.equal(headers.from.firstName, "Client Services"); assert.equal(headers.cc[0].firstName, "Colleague");
  assert.ok(saved.hs_email_text.startsWith(source.text)); assert.ok(saved.hs_email_text.includes(source.receivedAt));
  await crm.verify("sent-created", source, "known-contact", "1878499354188792726");
  saved.hs_email_headers = JSON.stringify({ ...headers, bcc: [] });
  await assert.rejects(() => crm.verify("sent-created", source, "known-contact", "1878499354188792726"), /header-mismatch/);
  saved.hs_email_headers = JSON.stringify(headers); saved.hs_email_direction = "INCOMING_EMAIL";
  await assert.rejects(() => crm.verify("sent-created", source, "known-contact", "1878499354188792726"), /readback-mismatch/);
});

test("an existing Sent EMAIL with incoming direction or the wrong chronology is held instead of declared synced", async () => {
  const source = sent();
  const crm = new InboxHubSpot("synthetic-token", async () => new Response(JSON.stringify({ id: "existing", properties: {
    hs_email_message_id: source.messageId, hs_email_subject: source.subject, hs_email_from_email: MAILBOX,
    hs_email_to_email: "customer@example.invalid", hs_email_cc_email: "", hs_email_headers: JSON.stringify({ bcc: [] }),
    hs_email_text: source.text, hs_email_html: source.html, hs_email_direction: "INCOMING_EMAIL", hs_timestamp: source.receivedAt,
  } })));
  await assert.rejects(() => crm.readExisting("existing", source), /sent-metadata-conflict/);
});

test("unknown or ambiguous Sent customer identities never create contacts or select the alias sender", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("migrations/018_inbox_sync.sql", "utf8"));
    const store = new InboxStore(async (sql, values = []) => (await db.query(sql, [...values])).rows as Record<string, unknown>[],
      callback => db.transaction(tx => callback(async (sql, values = []) => (await tx.query(sql, [...values])).rows as Record<string, unknown>[])));
    const now = new Date("2026-10-08T20:00:00Z"), payload = sent();
    await store.capture({ sourceId: "1878499354188792726", folder: "All Mail", validity: "1", uid: 40, mail: payload, decision: classify(payload) }, now);
    await store.capture({ sourceId: "1878499354188792726", folder: "Sent", validity: "2", uid: 9, mail: { ...payload, labels: ["\\Sent"] }, decision: classify(payload) }, now);
    let associations: unknown;
    const crm = { findEmail: async () => null, findContact: async (identity: { value: string; create: boolean }) => {
      assert.equal(identity.value, "customer@example.invalid"); assert.equal(identity.create, false); return null;
    }, createEmail: async (_mail: Mail, contact: unknown) => { associations = contact; return "unassociated"; }, verify: async () => {} } as unknown as InboxHubSpot;
    const due = new Date("2026-10-08T23:00:00Z"), row = (await store.claim(due))!;
    await deliverReceipt(store, crm, row, () => due);
    assert.equal(associations, null); assert.equal(emailDirection(row.payload), "EMAIL");
    assert.equal((await db.query("SELECT * FROM p5_inbox_message")).rows.length, 1);
    assert.equal(await store.cursor("All Mail", "1"), 40); assert.equal(await store.cursor("Sent", "2"), 9);
  } finally { await db.close(); }
});

test("new EMAIL company links require a fresh exact-contact relationship and cannot relax contact/deal/ticket checks", async () => {
  const source = sent(), sourceId = "1878499354188792726";
  let saved: Record<string, string> = {}, relationReads = 0;
  let associations: Record<string, { results: { id: string }[]; paging?: unknown }> = {
    contacts: { results: [{ id: "owner-contact" }] }, companies: { results: [{ id: "owner-company" }] },
  };
  let contact = { id: "owner-contact", archived: false, properties: { email: "customer@example.invalid" },
    associations: { companies: { results: [{ id: "owner-company" }, { id: "owner-company" }], paging: undefined as unknown } } };
  const crm = new InboxHubSpot("synthetic-token", async (input, init) => {
    if (init?.method === "POST") { saved = JSON.parse(String(init.body)).properties; return new Response(JSON.stringify({ id: "created" })); }
    if (String(input).includes("/contacts/")) { relationReads++; assert.ok(String(input).endsWith("/owner-contact?properties=email&associations=companies")); return new Response(JSON.stringify(contact)); }
    return new Response(JSON.stringify({ id: "created", properties: { ...saved, hs_email_from_email: MAILBOX, hs_email_to_email: "customer@example.invalid", hs_email_cc_email: "" }, associations }));
  });
  await crm.createEmail(source, "owner-contact", sourceId);
  await crm.verify("created", source, "owner-contact", sourceId);
  await crm.verify("created", source, "owner-contact", sourceId);
  assert.equal(relationReads, 2); // No cached relationship authorizes later verification.
  for (const invalid of [
    { ...contact, id: "different-contact" }, { ...contact, archived: true },
    { ...contact, associations: { companies: { results: [{ id: "unrelated-company" }], paging: undefined } } },
    { ...contact, associations: { companies: { results: [{ id: "owner-company" }], paging: { next: {} } } } },
  ]) {
    const original = contact; contact = invalid;
    await assert.rejects(() => crm.verify("created", source, "owner-contact", sourceId), /unexpected-email-association/);
    contact = original;
  }
  const clean = associations;
  for (const extra of [
    { contacts: { results: [{ id: "owner-contact" }, { id: "extra-contact" }] } },
    { deals: { results: [{ id: "deal" }] } }, { tickets: { results: [{ id: "ticket" }] } },
    { companies: { results: [{ id: "owner-company" }], paging: { next: {} } } },
  ]) {
    associations = { ...clean, ...extra };
    await assert.rejects(() => crm.verify("created", source, "owner-contact", sourceId), /contact-mismatch|unexpected-email-association/);
  }
  associations = { companies: { results: [{ id: "owner-company" }] } };
  await assert.rejects(() => crm.verify("created", source, null, sourceId), /unexpected-email-association/);
});

test("native internal recipient context is freshly verified separately from the exact external customer", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("migrations/018_inbox_sync.sql", "utf8"));
    const store = new InboxStore(async (sql, values = []) => (await db.query(sql, [...values])).rows as Record<string, unknown>[],
      callback => db.transaction(tx => callback(async (sql, values = []) => (await tx.query(sql, [...values])).rows as Record<string, unknown>[])));
    const cases = [
      { address: MAILBOX, recipient: "hello@boisecabinet.co", ok: true },
      { address: "replies@reply.boisecabinet.co", recipient: "replies@reply.boisecabinet.co", ok: true },
      { address: "extra@example.invalid", recipient: MAILBOX, ok: false },
      { address: "accounting@p5homeco.com", recipient: MAILBOX, ok: false },
      { address: MAILBOX, recipient: "replies@reply.boisecabinet.co", ok: false },
      { address: MAILBOX, recipient: MAILBOX, archived: true, ok: false },
      { address: MAILBOX, recipient: MAILBOX, paging: true, ok: false },
    ];
    let reads = 0, creates = 0;
    for (const [index, scenario] of cases.entries()) {
      const payload = sent({ messageId: `<native-${index}@example.invalid>`, labels: ["\\All"],
        from: [{ email: "customer@example.invalid", name: "Customer" }], to: [{ email: scenario.recipient, name: "P5" }] });
      const now = new Date("2026-10-08T20:00:00Z"), due = new Date("2026-10-08T23:00:00Z"), id = `native-${index}`;
      await store.capture({ sourceId: id, folder: "All Mail", validity: "1", uid: index + 1, mail: payload, decision: classify(payload) }, now);
      const crm = { findEmail: async () => ({ id, associations: {
        contacts: { results: [{ id: "customer" }, { id: "internal" }, { id: "internal" }], ...(scenario.paging ? { paging: { next: {} } } : {}) },
        companies: { results: [{ id: "native-company" }] }, deals: { results: [{ id: "native-existing-deal" }] },
      } }), findContact: async () => "customer", call: async (path: string) => {
        reads++; assert.equal(path, "/crm/v3/objects/contacts/internal?properties=email");
        return { id: "internal", archived: scenario.archived, properties: { email: scenario.address } };
      }, createEmail: async () => { creates++; return "forbidden"; } } as unknown as InboxHubSpot;
      await deliverReceipt(store, crm, (await store.claim(due))!, () => due);
      const [receipt] = await store.read("SELECT * FROM p5_inbox_message WHERE source_id=$1", [id]);
      assert.equal(receipt.status, scenario.ok ? "existing" : "review", JSON.stringify(scenario));
      assert.equal(receipt.hubspot_email_id, id);
      if (scenario.ok) {
        assert.equal(receipt.hubspot_contact_id, "customer");
        const context = (receipt.locations as { nativeAssociationContext?: { customerContactId: string; internalContacts: { id: string; email: string }[] } }[]).find(item => item.nativeAssociationContext)?.nativeAssociationContext;
        assert.deepEqual(context?.internalContacts, [{ id: "internal", email: scenario.address }]);
        assert.equal(context?.customerContactId, "customer");
      }
    }
    assert.equal(reads, cases.length - 1); assert.equal(creates, 0);
  } finally { await db.close(); }
});
