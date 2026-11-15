/**
 * Guided estimator emails. Renders HTML and text. Does not send mail.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BRAND_CONFIGS } from "../app/lib/estimator/brands.ts";
import { customerFailureAlert } from "../app/lib/estimator/emails.ts";
import { isTransientSmtpError, sendWithRetry } from "../app/lib/notifications/transport.ts";
import {
  ESTIMATE_DISCLAIMER,
  VALUE_TIERS,
  assertCopy,
  estimatorTestMode,
  formatMoney,
  isRealHref,
  valueTier,
} from "../lib/p5/emailKit.ts";
import { EMAIL_FIXTURES, renderFixture, rowForFixture } from "./estimator-email-render.ts";

test("value tiers are config, and every send stays From P5 Home Co", () => {
  assert.deepEqual(VALUE_TIERS, { smallUnder: 10_000, majorOver: 75_000 });
  assert.equal(valueTier(330), "small");
  assert.equal(valueTier(10_000), "standard");
  assert.equal(valueTier(75_000), "standard");
  assert.equal(valueTier(75_001), "major");
  assert.match(readFileSync("app/lib/notifications/smtp-config.ts", "utf8"), /P5 Home Co <hello@p5homeco\.com>/);
  for (const file of ["lib/p5/estimateEmail.ts", "lib/p5/intakeEmail.ts", "lib/p5/outbox.ts", "lib/p5/reviewRequest.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /P5 Home Co|p5homeco\.com/);
  }
  const kit = readFileSync("lib/p5/emailKit.ts", "utf8");
  assert.doesNotMatch(kit, /P5 Home Co/);
  assert.equal(kit.match(/p5homeco\.com/g)?.length, 1);
  assert.equal(BRAND_CONFIGS.adu.live, false);
  assert.equal(BRAND_CONFIGS.adu.logoUrl, BRAND_CONFIGS.p5.logoUrl);
  assert.equal(isRealHref("https://qbo.intuit.com/app/estimate"), false);
  assert.equal(isRealHref("https://qbo.intuit.com/app/estimate?txnId=73"), true);
  assert.equal(isRealHref(""), false);
});

test("a name containing test, or ESTIMATOR_TEST_MODE, is test mode", () => {
  assert.equal(estimatorTestMode("[QA] Ada Small", {}), false);
  assert.equal(estimatorTestMode("TEST Ada", {}), true);
  assert.equal(estimatorTestMode("Ada", { ESTIMATOR_TEST_MODE: "on" }), true);
  assert.equal(estimatorTestMode("Ada", { ESTIMATOR_TEST_MODE: "off" }), false);
});

test("smtp retries once for a dropped connection and not for auth or a permanent refusal", async () => {
  assert.equal(isTransientSmtpError(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })), true);
  assert.equal(isTransientSmtpError(new Error("421 try again")), true);
  assert.equal(isTransientSmtpError(Object.assign(new Error("invalid login"), { code: "EAUTH" })), false);
  assert.equal(isTransientSmtpError(new Error("550 mailbox unavailable")), false);
  let calls = 0;
  const slept: number[] = [];
  const recovered = await sendWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  }, async (ms) => {
    slept.push(ms);
  });
  assert.deepEqual(recovered, { ok: true });
  assert.deepEqual(slept, [2000]);
  const refused = await sendWithRetry(async () => {
    throw new Error("535 authentication failed");
  }, async () => {
    throw new Error("should not sleep");
  });
  assert.equal(refused.ok, false);
});

test("every p5 fixture renders admin and customer html and text from the estimator output", () => {
  assert.ok(EMAIL_FIXTURES.length >= 4);
  const roles = new Set<string>();
  for (const fixture of EMAIL_FIXTURES) {
    const { estimate, admin, customer } = renderFixture(fixture);
    for (const message of [admin, customer]) {
      assert.ok(message.html.startsWith("<!doctype html>"));
      assert.ok(message.text.trim().length > 0);
      assert.ok(message.html.includes("https://"));
      assertCopy(message.html, message.text, {
        requireDisclaimer: message === customer && !fixture.withhold,
        customerAddresses: ["100 Example Ave, Boise, ID 83702"],
      });
      assert.doesNotMatch(message.html, /<script>|undefined|\{\{/);
      assert.doesNotMatch(message.text, /\bundefined\b|\{\{/);
      assert.doesNotMatch(`${message.html}\n${message.text}`, new RegExp(`${"40" + "31"}|${"wa" + "poot"}|showroom`, "i"));
    }
    assert.match(admin.html, /Gross margin/);
    assert.match(admin.text, /Gross profit/);
    assert.match(admin.html, /tel:\+12084771169/);
    if (!fixture.withhold && estimate.range) {
      roles.add(valueTier(estimate.range.high) === "small" ? "small" : estimate.range.high > VALUE_TIERS.majorOver ? "large" : "mid");
      const low = formatMoney(estimate.range.low);
      const high = formatMoney(estimate.range.high);
      assert.equal(estimate.range.low, customerViewLow(fixture), "email must use the stored customer range");
      for (const part of [customer.html, customer.text, admin.html, admin.text]) {
        assert.ok(part.includes(low), `${fixture.id} missing ${low}`);
        assert.ok(part.includes(high), `${fixture.id} missing ${high}`);
      }
      assert.match(customer.text, /Preliminary estimate|preliminary/i);
      assert.ok(customer.text.includes(ESTIMATE_DISCLAIMER));
      const tier = valueTier(estimate.range.high);
      if (tier === "small") {
        assert.match(customer.text, /quick visit/);
        assert.match(customer.text, /by phone/);
        assert.doesNotMatch(customer.text, /planning consultation|home walkthrough/);
      } else if (tier === "major") {
        assert.match(customer.text, /planning consultation/);
        assert.match(customer.text, /plans and permits/);
        assert.doesNotMatch(customer.text, /quick visit|home walkthrough/);
      } else {
        assert.match(customer.text, /home walkthrough/);
        assert.doesNotMatch(customer.text, /quick visit|planning consultation/);
      }
    } else {
      roles.add("withheld");
      assert.match(customer.text, /closer look/);
      assert.doesNotMatch(customer.text, /\$\d/);
    }
    if (fixture.uploads.length) {
      assert.match(customer.text, new RegExp(`We received ${fixture.uploads.length} file`));
      assert.match(admin.html, /View uploaded files/);
      assert.doesNotMatch(customer.html, /href="https?:\/\/[^\"]+\/admin(?:\/|\")/);
      assert.doesNotMatch(customer.text, /Submit your plans/);
    } else {
      assert.doesNotMatch(admin.html, /View uploaded files/);
    }
    if (fixture.qboUrl && fixture.qboUrl.includes("txnId=")) assert.match(admin.html, /Open in QuickBooks/);
    else assert.doesNotMatch(admin.html, /Open in QuickBooks/);
    if (fixture.phone) assert.match(admin.html, new RegExp(`tel:\\+1${fixture.phone.replace(/\D/g, "")}`));
    else assert.doesNotMatch(admin.html, /Call \(208\) 555/);
    const viewAt = admin.html.indexOf(">View full estimate<");
    assert.ok(viewAt > 0, `${fixture.id} admin is missing View full estimate`);
    const tableAt = admin.html.lastIndexOf("<table", viewAt);
    const leadIn = admin.html.slice(Math.max(0, tableAt - 180), tableAt);
    const gap = leadIn.match(/margin-top:\s*(\d+(?:\.\d+)?)px/);
    assert.ok(gap, `${fixture.id} admin has no space above the first button`);
    assert.ok(Number(gap[1]) >= 16, `${fixture.id} space above the first button is ${gap[1]}px`);
    if (fixture.brand === "p5") {
      assert.match(customer.html, /#a58c72/i);
      assert.match(admin.html, /#a58c72/i);
      assert.doesNotMatch(`${customer.html}\n${admin.html}`, /#ceb391/i);
      const primary = [...customer.html.matchAll(/font-size:18px;font-weight:(?:700|bold);[^"]*">([^<]+)</g)].map((match) => match[1]);
      assert.deepEqual([...new Set(primary)], ["Schedule now"]);
      const noticeAt = customer.html.lastIndexOf("Preliminary estimate, not a contract.");
      assert.ok(noticeAt > customer.html.indexOf(">Schedule now<"));
      assert.match(customer.html, /margin:24px 0;/);
    }
    if (!fixture.withhold && !/fail/i.test(admin.text)) {
      const ready = admin.html.match(/border-left:4px solid (#[0-9a-fA-F]{6});[^>]*>Ready/i);
      if (ready) assert.notEqual(ready[1].toLowerCase(), "#9e3324");
    }
    assert.match(customer.html, /View my estimate/);
    assert.match(customer.html, /Schedule now/);
    assert.ok(customer.html.indexOf("View my estimate") < customer.html.indexOf("Schedule now"));
  }
  assert.ok(roles.has("small") && roles.has("large") && roles.has("withheld"));
  assert.ok(EMAIL_FIXTURES.some((fixture) => fixture.uploads.length > 0));
  assert.ok(EMAIL_FIXTURES.some((fixture) => fixture.uploads.length === 0));
  assert.ok(EMAIL_FIXTURES.some((fixture) => fixture.project === "addition" || fixture.project === "custom-home"));
});

function customerViewLow(fixture: (typeof EMAIL_FIXTURES)[number]): number {
  return rowForFixture(fixture).customer_view.range!.low;
}

test("a script in a name is escaped and the failure alert has call and email buttons", () => {
  const fixture = EMAIL_FIXTURES.find((item) => item.withhold)!;
  const row = rowForFixture(fixture);
  const alert = customerFailureAlert(row, "ETIMEDOUT", "P5-AAAAAAAA");
  assert.match(alert.html, /<!doctype html>/);
  assert.match(alert.text, /P5-AAAAAAAA/);
  assert.match(alert.text, /ETIMEDOUT/);
  assert.match(alert.html, /tel:\+12085550105/);
  assert.match(alert.html, /mailto:script.home@example.com/);
  assert.doesNotMatch(alert.html, /<script>/);
  assert.match(alert.text, /does not resend/i);
  assert.doesNotMatch(readFileSync(new URL("../app/lib/estimator/emails.ts", import.meta.url), "utf8"), /priceEstimate|priceScope/);
});
