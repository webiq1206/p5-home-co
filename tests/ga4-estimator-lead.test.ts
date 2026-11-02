import test from "node:test";
import assert from "node:assert/strict";
import { estimatorLeadGa4Params, trackGoogleAdsLeadConversion } from "../lib/googleAdsConversion.ts";

type Call = unknown[];

function install(): Call[] {
  const calls: Call[] = [];
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    location: { hostname: "p5homeco.com", pathname: "/estimate" },
    navigator: { webdriver: false },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    gtag: (...args: unknown[]) => void calls.push(args),
  };
  return calls;
}

function leads(calls: Call[]) {
  return calls.filter((call) => call[0] === "event" && call[1] === "generate_lead");
}

test("an accepted estimator finish sends one GA4 generate_lead and a repeat sends none", () => {
  const calls = install();
  assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "estimator:ga4-accepted", { accepted: true }), true);
  assert.deepEqual(leads(calls).map((call) => call[2]), [
    { lead_source: "estimator", project_type: "kitchen", event_id: "ga4-accepted" },
  ]);
  assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "estimator:ga4-accepted", { accepted: true }), false);
  assert.equal(leads(calls).length, 1);
  delete (globalThis as { window?: unknown }).window;
});

test("an accepted intake finish is labelled as the intake path", () => {
  const calls = install();
  assert.equal(trackGoogleAdsLeadConversion({}, "intake:p5:ga4-intake", { accepted: true }), true);
  assert.deepEqual(leads(calls).map((call) => call[2]), [
    { lead_source: "estimator_intake", project_type: "unknown", event_id: "ga4-intake" },
  ]);
  delete (globalThis as { window?: unknown }).window;
});

test("an unaccepted or replayed estimator finish sends no generate_lead", () => {
  const calls = install();
  assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "estimator:ga4-replay", { accepted: false }), true);
  assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "estimator:ga4-missing"), true);
  assert.equal(leads(calls).length, 0);
  assert.equal(calls.filter((call) => call[1] === "conversion").length, 2);
  delete (globalThis as { window?: unknown }).window;
});

test("a quote form key sends no generate_lead here, because the form already sends it", () => {
  const calls = install();
  assert.equal(trackGoogleAdsLeadConversion({ service: "kitchen" }, "conv_ga4-form"), true);
  assert.equal(leads(calls).length, 0);
  assert.equal(estimatorLeadGa4Params({}, "conv_ga4-form"), null);
  assert.equal(estimatorLeadGa4Params({}, undefined), null);
  delete (globalThis as { window?: unknown }).window;
});
