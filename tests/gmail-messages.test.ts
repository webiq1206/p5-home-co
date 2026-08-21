import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addressFrom,
  addressesFrom,
  brandForAddress,
  customerIsWaiting,
  isIgnorable,
  isOurAddress,
  parseMessage,
  type RawMessage,
} from "../app/lib/integrations/gmail-messages.ts";

const OURS = [
  "p5homeco.com", "boiseconstruction.co", "boiseremodeling.co",
  "boisehandyman.co", "boiseadu.co", "boisecabinet.co",
];

function msg(o: Partial<RawMessage> & { headers?: Record<string, string> } = {}): RawMessage {
  return {
    id: "m1", threadId: "t1", labelIds: ["INBOX"],
    internalDate: String(new Date("2026-08-21T16:00:00Z").getTime()),
    snippet: "Thanks, a couple of questions…",
    headers: {
      from: "Maria Alvarez <maria@example.com>",
      to: "Client Services <hello@p5homeco.com>",
      subject: "Re: Your kitchen quote",
      ...(o.headers ?? {}),
    },
    ...o,
  } as RawMessage;
}

// --- Address parsing --------------------------------------------------------

test("addresses are extracted from display-name form and lowercased", () => {
  assert.equal(addressFrom("Maria Alvarez <Maria@Example.com>"), "maria@example.com");
  assert.equal(addressFrom("bare@example.com"), "bare@example.com");
  assert.equal(addressFrom("not an address"), null);
  assert.equal(addressFrom(undefined), null);
});

test("multi-recipient headers yield every address", () => {
  assert.deepEqual(
    addressesFrom("A <a@example.com>, b@p5homeco.com, broken"),
    ["a@example.com", "b@p5homeco.com"],
  );
});

test("our addresses are recognised by domain, aliases included", () => {
  assert.equal(isOurAddress("hello@p5homeco.com", OURS), true);
  assert.equal(isOurAddress("anyone@boisecabinet.co", OURS), true);
  assert.equal(isOurAddress("maria@example.com", OURS), false);
  // Not a subdomain match: this address belongs to evil.com.
  assert.equal(isOurAddress("someone@p5homeco.com.evil.com", OURS), false);
});

// --- What must never start a clock ------------------------------------------

test("spam, promotions and drafts are ignored", () => {
  for (const label of ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS"]) {
    assert.equal(isIgnorable(msg({ labelIds: [label] })).ignore, true, `${label} should be ignored`);
  }
});

test("an out-of-office is not a customer waiting for an answer", () => {
  assert.equal(isIgnorable(msg({ headers: { "auto-submitted": "auto-replied" } })).ignore, true);
  assert.equal(isIgnorable(msg({ headers: { "x-autoreply": "yes" } })).ignore, true);
});

test("bulk mail with an unsubscribe header is ignored", () => {
  assert.equal(isIgnorable(msg({ headers: { "list-unsubscribe": "<mailto:x@y.com>" } })).ignore, true);
});

test("automated senders are ignored, so nobody chases a mail server", () => {
  for (const from of [
    "no-reply@houzz.com", "noreply@yelp.com", "mailer-daemon@google.com",
    "bounces+123@sendgrid.net", "notifications@hubspot.com",
  ]) {
    assert.equal(isIgnorable(msg({ headers: { from } })).ignore, true, `${from} should be ignored`);
  }
});

test("a genuine customer reply is not ignored", () => {
  assert.equal(isIgnorable(msg()).ignore, false);
});

test("a real person whose name merely starts like an automated one is kept", () => {
  // "supporter@" is a person; "support@" is a queue.
  assert.equal(isIgnorable(msg({ headers: { from: "supporter@example.com" } })).ignore, false);
  assert.equal(isIgnorable(msg({ headers: { from: "support@example.com" } })).ignore, true);
});

// --- Direction --------------------------------------------------------------

test("a message from outside is inbound, and names the customer", () => {
  const p = parseMessage(msg(), OURS);
  assert.equal(p?.direction, "inbound");
  assert.equal(p?.counterpartyEmail, "maria@example.com");
  assert.equal(p?.ourAddress, "hello@p5homeco.com");
});

test("a message from us is outbound, and names who we wrote to", () => {
  const p = parseMessage(
    msg({ headers: { from: "Boise Cabinet Co. <hello@boisecabinet.co>", to: "maria@example.com" } }),
    OURS,
  );
  assert.equal(p?.direction, "outbound");
  assert.equal(p?.counterpartyEmail, "maria@example.com");
  assert.equal(p?.ourAddress, "hello@boisecabinet.co");
});

test("direction follows the sender, not Gmail's SENT label", () => {
  // A reply in a thread we did not start can still carry SENT.
  const p = parseMessage(msg({ labelIds: ["SENT", "INBOX"] }), OURS);
  assert.equal(p?.direction, "inbound", "the sender is what is actually true");
});

test("our own colleagues are skipped when picking the counterparty", () => {
  const p = parseMessage(
    msg({ headers: { from: "hello@p5homeco.com", to: "dana@p5homeco.com, maria@example.com" } }),
    OURS,
  );
  assert.equal(p?.counterpartyEmail, "maria@example.com");
});

test("a message with no usable sender or date is skipped rather than guessed at", () => {
  assert.equal(parseMessage(msg({ headers: { from: "garbage" } }), OURS), null);
  assert.equal(parseMessage(msg({ internalDate: "not-a-number" }), OURS), null);
});

// --- Brand attribution ------------------------------------------------------

test("the receiving address identifies the brand", () => {
  const aliases = {
    "P5 Home Co": { address: "hello@p5homeco.com" },
    "Boise Cabinet Co": { address: "hello@boisecabinet.co" },
  };
  assert.equal(brandForAddress("hello@boisecabinet.co", aliases), "Boise Cabinet Co");
  assert.equal(brandForAddress("HELLO@P5HOMECO.COM", aliases), "P5 Home Co");
  // Unrecognised returns null rather than guessing a brand for a real client.
  assert.equal(brandForAddress("hello@boiseadu.co", aliases), null);
  assert.equal(brandForAddress(null, aliases), null);
});

// --- The question that matters ---------------------------------------------

test("the customer is waiting when their message is the newest", () => {
  const r = customerIsWaiting([
    { direction: "outbound", occurredAt: new Date("2026-08-20T10:00:00Z") },
    { direction: "inbound", occurredAt: new Date("2026-08-21T09:00:00Z") },
  ]);
  assert.equal(r.waiting, true);
  if (r.waiting) assert.equal(r.since.toISOString(), "2026-08-21T09:00:00.000Z");
});

test("once we reply, the customer is no longer waiting", () => {
  assert.equal(
    customerIsWaiting([
      { direction: "inbound", occurredAt: new Date("2026-08-21T09:00:00Z") },
      { direction: "outbound", occurredAt: new Date("2026-08-21T09:30:00Z") },
    ]).waiting,
    false,
  );
});

test("order of the input does not matter, only which message is newest", () => {
  const messages = [
    { direction: "inbound" as const, occurredAt: new Date("2026-08-21T11:00:00Z") },
    { direction: "outbound" as const, occurredAt: new Date("2026-08-21T10:00:00Z") },
  ];
  assert.equal(customerIsWaiting(messages).waiting, true);
  assert.equal(customerIsWaiting([...messages].reverse()).waiting, true);
});

test("an empty conversation is nobody waiting", () => {
  assert.equal(customerIsWaiting([]).waiting, false);
});

test("several customer messages in a row still date from the first unanswered one... or the newest", () => {
  // Deliberate: the clock runs from the newest, because each new message is a
  // fresh prompt. Chasing from the first would escalate on chatter alone.
  const r = customerIsWaiting([
    { direction: "outbound", occurredAt: new Date("2026-08-20T10:00:00Z") },
    { direction: "inbound", occurredAt: new Date("2026-08-21T09:00:00Z") },
    { direction: "inbound", occurredAt: new Date("2026-08-21T11:00:00Z") },
  ]);
  assert.equal(r.waiting, true);
  if (r.waiting) assert.equal(r.since.toISOString(), "2026-08-21T11:00:00.000Z");
});
