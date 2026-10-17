import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { trackAcceptedInquiry } from "../app/analytics.ts";
import { trackGoogleAdsLeadConversion } from "../lib/googleAdsConversion.ts";
import {
  allowEnhancedConversions,
  decorateEstimatorSubmission,
  insertSuppression,
  suppressionRecords,
  type SuppressionRecord,
} from "../lib/p5/enhancedConversionSuppression.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const SEND_TO = "AW-18354188204/cEzmCPOagKAdEKzf-q9E";
const FORM_SEND_TO = "AW-18354188204/LE2vCPXstO8cEKzf-q9E";

function installQueue() {
  const queued: unknown[][] = [];
  Object.assign(globalThis, { window: { dataLayer: queued } });
  return queued;
}

test("suppression stores only hashes of a trimmed email and a 10-digit phone", async () => {
  const raw = { email: "  Ada@Example.COM ", phone: "(208) 477-1169", name: "Ada Lovelace", street: "4031 W Wapoot St" };
  const records = suppressionRecords(raw);
  assert.deepEqual(records, [
    { kind: "email", valueHash: hash("ada@example.com") },
    { kind: "phone", valueHash: hash("+12084771169") },
  ]);
  const serialized = JSON.stringify(records);
  for (const forbidden of ["Ada", "Example", "208", "Wapoot", "Lovelace"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(suppressionRecords({ phone: "12084771169", email: "   " }), []);
  assert.deepEqual(suppressionRecords({ phone: "477-1169" }), []);

  const stored: SuppressionRecord[] = [];
  const written = await insertSuppression(raw, async (next) => {
    stored.push(...next);
  });
  assert.deepEqual(written, records);
  assert.equal(JSON.stringify(stored).includes("Ada"), false);
  assert.deepEqual(await insertSuppression({ phone: "call me" }, async () => {
    throw new Error("invalid phone must not be written");
  }), []);
});

test("either matching hash refuses enhanced conversions", async () => {
  const email = hash("ada@example.com");
  const phone = hash("+12084771169");
  assert.equal(await allowEnhancedConversions({ email: "Ada@Example.com", phone: "2085550100" }, async (records) => records.some((record) => record.valueHash === email)), false);
  assert.equal(await allowEnhancedConversions({ email: "other@example.com", phone: "(208) 477-1169" }, async (records) => records.some((record) => record.valueHash === phone)), false);
  assert.equal(await allowEnhancedConversions({ email: "other@example.com", phone: "2085550100" }, async () => false), true);
  assert.equal(await allowEnhancedConversions({ name: "Ada" } as { email?: string }), true);
  assert.equal(await allowEnhancedConversions({ email: "ada@example.com" }, async () => {
    throw new Error("relation enhanced_conversion_suppression does not exist");
  }), true);
});

test("a suppressed lead skips user_data and still records the conversion", () => {
  const queued = installQueue();
  try {
    trackAcceptedInquiry(
      { name: "Ada Lovelace", email: "ada@example.com", phone: "2084771169", summary: "Remodel the kitchen", city: "Meridian" } as { name: string; email: string; phone: string },
      false,
    );
    assert.equal(queued.some((entry) => entry[1] === "user_data"), false);
    assert.deepEqual(queued, [
      ["event", "generate_lead", { form: "quote_landing_page" }],
      ["event", "conversion", { send_to: FORM_SEND_TO }],
    ]);
    const serialized = JSON.stringify(queued);
    assert.equal(serialized.includes("ada@example.com"), false);
    assert.equal(serialized.includes("Meridian"), false);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("a suppressed estimator finish skips user_data and still fires the conversion", () => {
  const queued = installQueue();
  try {
    assert.equal(
      trackGoogleAdsLeadConversion(
        {
          service: "addition",
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "2084771169",
          accepted: true,
          allowEnhancedConversions: false,
          transactionId: "sub-suppressed",
        },
        "estimator:sub-suppressed",
      ),
      true,
    );
    assert.equal(queued.some((entry) => entry[1] === "user_data"), false);
    assert.deepEqual(queued, [["event", "conversion", { send_to: SEND_TO, transaction_id: "sub-suppressed" }]]);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("the estimator response gains the flag without changing the saved result", async () => {
  const original = {
    accepted: true,
    duplicate: false,
    id: "sub-9",
    result: { range: { low: 100, high: 200 } },
    document: { customer: { name: "Ada Lovelace", email: "ada@example.com", phone: "2084771169" } },
  };
  const response = new Response(JSON.stringify(original), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const decorated = await decorateEstimatorSubmission(response, true, async () => false);
  const body = await decorated.json();
  assert.equal(body.allowEnhancedConversions, false);
  assert.equal(body.accepted, true);
  assert.equal(body.id, "sub-9");
  assert.deepEqual(body.result, original.result);
  assert.deepEqual(body.document, original.document);

  const pricing = new Response(JSON.stringify({ pricingReviewRequired: true, error: "Needs details" }), {
    status: 422,
    headers: { "content-type": "application/json" },
  });
  const unchanged = await decorateEstimatorSubmission(pricing, true, async () => false);
  assert.equal(unchanged.status, 422);
  assert.deepEqual(await unchanged.json(), { pricingReviewRequired: true, error: "Needs details" });
});

test("suppression stays off the pricing and email paths and out of the privacy opt-out line", () => {
  const endpoint = readFileSync(new URL("../lib/p5/submitEndpoint.ts", import.meta.url), "utf8");
  const email = readFileSync(new URL("../lib/p5/estimateEmail.ts", import.meta.url), "utf8");
  const privacy = readFileSync(new URL("../app/legal/privacy/page.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");
  const intake = readFileSync(new URL("../app/api/leads/intake/route.ts", import.meta.url), "utf8");
  assert.equal(endpoint.includes("allowEnhancedConversions"), false);
  assert.equal(endpoint.includes("enhancedConversionSuppression"), false);
  assert.equal(email.includes("enhancedConversionSuppression"), false);
  assert.equal(privacy.includes("opt out of enhanced"), false);
  assert.match(intake, /const result = await ingestLead\(/);
  assert.match(intake, /allowEnhancedConversions: enhancedConversionsAllowed/);
  const quote = readFileSync(new URL("../app/quote/QuoteForm.tsx", import.meta.url), "utf8");
  assert.match(quote, /payload\.allowEnhancedConversions !== false/);
  const route = readFileSync(new URL("../app/api/p5-estimator/submit/route.ts", import.meta.url), "utf8");
  assert.match(route, /ENHANCED_CONVERSION_SUPPRESSION = true/);
  assert.match(route, /return decorateEstimatorSubmission\(response, ENHANCED_CONVERSION_SUPPRESSION\)/);
});
