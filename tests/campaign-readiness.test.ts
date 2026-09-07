import assert from "node:assert/strict";
import test from "node:test";

import { trackAcceptedInquiry } from "../app/analytics.ts";
import { clientAddress } from "../app/api/leads/intake/abuse.ts";

test("accepted conversion queues both GA4 and native Ads events before gtag loads", () => {
  const queued: unknown[][] = [];
  Object.assign(globalThis, { window: { dataLayer: queued } });
  trackAcceptedInquiry();
  assert.deepEqual(queued, [
    ["event", "generate_lead", { form: "quote_landing_page" }],
    ["event", "conversion", { send_to: "AW-18354188204/LE2vCPXstO8cEKzf-q9E" }],
  ]);
  Reflect.deleteProperty(globalThis, "window");
});

test("rate limiting uses the trusted proxy appended address", () => {
  const request = new Request("https://p5homeco.com/api/leads/intake", {
    headers: { "x-forwarded-for": "198.51.100.77, 203.0.113.20" },
  });
  assert.equal(clientAddress(request), "203.0.113.20");
});