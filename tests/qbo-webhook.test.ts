import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  parseWebhookEvents,
  verifyWebhookSignature,
} from "../app/lib/finance/qbo/webhook.ts";

const VERIFIER = "test-verifier-token";

function sign(body: string): string {
  return createHmac("sha256", VERIFIER).update(body).digest("base64");
}

// ---------------------------------------------------------------------------
// Signature verification (S201): reject everything that is not provably
// Intuit's HMAC over the exact raw body.
// ---------------------------------------------------------------------------

test("signature: accepts the correct HMAC of the raw body", () => {
  const body = JSON.stringify({ eventNotifications: [] });
  assert.equal(verifyWebhookSignature(body, sign(body), VERIFIER), true);
});

test("signature: rejects a missing header, wrong token, or tampered body", () => {
  const body = JSON.stringify({ eventNotifications: [] });
  assert.equal(verifyWebhookSignature(body, null, VERIFIER), false);
  assert.equal(verifyWebhookSignature(body, sign(body), "other-token"), false);
  assert.equal(verifyWebhookSignature(body + " ", sign(body), VERIFIER), false);
  assert.equal(verifyWebhookSignature(body, "not-base64-hmac", VERIFIER), false);
});

// ---------------------------------------------------------------------------
// Payload parsing: Intuit's documented shape, defensively handled.
// ---------------------------------------------------------------------------

const SAMPLE = {
  eventNotifications: [
    {
      realmId: "9341457770580983",
      dataChangeEvent: {
        entities: [
          { name: "Invoice", id: "42", operation: "Update", lastUpdated: "2026-08-22T10:00:00Z" },
          { name: "Vendor", id: "7", operation: "Create", lastUpdated: "2026-08-22T10:00:01Z" },
          { name: "Bill", id: "9", operation: "Delete" },
        ],
      },
    },
  ],
};

test("parse: extracts every entity event with realm and operation", () => {
  const events = parseWebhookEvents(SAMPLE);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], {
    realmId: "9341457770580983",
    entityName: "Invoice",
    entityId: "42",
    operation: "Update",
    lastUpdated: "2026-08-22T10:00:00Z",
  });
  assert.equal(events[2].operation, "Delete");
  assert.equal(events[2].lastUpdated, null);
});

test("parse: malformed payloads produce no events rather than throwing", () => {
  assert.deepEqual(parseWebhookEvents(null), []);
  assert.deepEqual(parseWebhookEvents({}), []);
  assert.deepEqual(parseWebhookEvents({ eventNotifications: "nope" }), []);
  assert.deepEqual(
    parseWebhookEvents({ eventNotifications: [{ realmId: "1" }] }),
    [],
  );
  assert.deepEqual(
    parseWebhookEvents({
      eventNotifications: [
        { realmId: "1", dataChangeEvent: { entities: [{ name: "Invoice" }] } },
      ],
    }),
    [],
  );
});
