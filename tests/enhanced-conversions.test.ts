import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { trackAcceptedInquiry } from "../app/analytics.ts";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import {
  enhancedConversionUserData,
  trackGoogleAdsLeadConversion,
  type EnhancedConversionContact,
} from "../lib/googleAdsConversion.ts";

const SEND_TO = "AW-18354188204/cEzmCPOagKAdEKzf-q9E";
const FORM_SEND_TO = "AW-18354188204/LE2vCPXstO8cEKzf-q9E";

function installQueue() {
  const queued: unknown[][] = [];
  Object.assign(globalThis, { window: { dataLayer: queued } });
  return queued;
}

function restore() {
  Reflect.deleteProperty(globalThis, "window");
}

test("enhanced conversion user_data keeps only normalized contact fields", () => {
  const raw = {
    email: "  Ada@Example.COM ",
    phone: "(208) 477-1169",
    name: "  Ada   Lovelace ",
    postalCode: "83646",
    street: "4031 W Wapoot St",
    description: "Remodel the kitchen and add a deck",
    summary: "free text summary",
    city: "Meridian",
    address: "4031 W Wapoot St",
    service: "kitchen",
  };
  const user = enhancedConversionUserData(raw as EnhancedConversionContact);
  assert.deepEqual(user, {
    email: "ada@example.com",
    phone_number: "+12084771169",
    address: { first_name: "Ada", last_name: "Lovelace", postal_code: "83646", country: "US" },
  });
  const serialized = JSON.stringify(user);
  for (const forbidden of ["Wapoot", "Remodel", "Meridian", "summary", "street", "description", "kitchen"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(user?.address ?? {}).sort(), ["country", "first_name", "last_name", "postal_code"]);
});

test("phone is omitted unless it is exactly 10 digits, and a single name has no last name", () => {
  assert.equal(enhancedConversionUserData({ phone: "477-1169", email: "a@b.co" })?.phone_number, undefined);
  assert.equal(enhancedConversionUserData({ phone: "12084771169", email: "a@b.co" })?.phone_number, undefined);
  assert.equal(enhancedConversionUserData({ phone: "+1 208 477 1169", email: "a@b.co" })?.phone_number, undefined);
  assert.equal(enhancedConversionUserData({ phone: "call me", email: "a@b.co" })?.phone_number, undefined);
  assert.equal(enhancedConversionUserData({ phone: "", email: "a@b.co" })?.phone_number, undefined);
  assert.equal(enhancedConversionUserData({ phone: "2084771169" })?.phone_number, "+12084771169");
  const single = enhancedConversionUserData({ name: "Ada" });
  assert.deepEqual(single, { address: { first_name: "Ada", country: "US" } });
  assert.equal("last_name" in (single?.address ?? {}), false);
  assert.equal(enhancedConversionUserData({ postalCode: "4031 W Wapoot St", email: "a@b.co" })?.address, undefined);
  assert.deepEqual(enhancedConversionUserData({ postalCode: "83646-1234" }), {
    address: { postal_code: "83646-1234", country: "US" },
  });
  assert.equal(enhancedConversionUserData({ email: "   ", phone: "555", name: "  " }), null);
});

test("estimator conversion fires the cEzm label after user_data and only on success", () => {
  const queued = installQueue();
  try {
    assert.equal(
      trackGoogleAdsLeadConversion(
        {
          service: "kitchen",
          name: "Ada Lovelace",
          email: " Ada@Example.com ",
          phone: "208-477-1169",
          accepted: false,
          transactionId: "draft-rejected",
          ...({ description: "Add a deck", street: "4031 W Wapoot St" } as object),
        },
        "estimator:draft-rejected",
      ),
      false,
    );
    assert.deepEqual(queued, []);

    assert.equal(
      trackGoogleAdsLeadConversion(
        { name: "Ada Lovelace", email: "ada@example.com", phone: "2084771169", transactionId: "proj-intake" },
        "intake:proj-intake",
      ),
      false,
    );
    assert.deepEqual(queued, []);

    assert.equal(
      trackGoogleAdsLeadConversion(
        {
          service: "addition",
          name: "Ada Lovelace",
          email: " Ada@Example.com ",
          phone: "(208) 477-1169",
          accepted: true,
          transactionId: "sub-100",
        },
        "estimator:draft-100",
      ),
      true,
    );
    assert.deepEqual(queued[0], [
      "set",
      "user_data",
      {
        email: "ada@example.com",
        phone_number: "+12084771169",
        address: { first_name: "Ada", last_name: "Lovelace", country: "US" },
      },
    ]);
    assert.deepEqual(queued[1], ["event", "conversion", { send_to: SEND_TO, transaction_id: "sub-100" }]);
    const setAt = queued.findIndex((entry) => entry[0] === "set" && entry[1] === "user_data");
    const conversionAt = queued.findIndex((entry) => entry[0] === "event" && entry[1] === "conversion");
    assert.ok(setAt !== -1 && conversionAt > setAt);
    const conversion = queued[conversionAt]?.[2] as Record<string, unknown>;
    assert.equal(JSON.stringify(conversion).includes("Lovelace"), false);
    assert.equal(JSON.stringify(queued[0]).includes("Wapoot"), false);
    assert.equal("postal_code" in ((queued[0]?.[2] as { address?: object }).address ?? {}), false);

    const before = queued.length;
    assert.equal(
      trackGoogleAdsLeadConversion(
        { email: "ada@example.com", transactionId: "sub-100", accepted: true },
        "estimator:draft-100",
      ),
      false,
    );
    assert.equal(queued.length, before);

    assert.equal(trackGoogleAdsLeadConversion({ service: "adu", transactionId: "sub-200" }, "estimator:sub-200"), true);
    assert.deepEqual(queued.at(-1), ["event", "conversion", { send_to: SEND_TO, transaction_id: "sub-200" }]);
    assert.equal(queued.filter((entry) => entry[0] === "set").length, 1);
  } finally {
    restore();
  }
});

test("accepted quote lead sets user_data before the form conversion and omits city and summary", () => {
  const queued = installQueue();
  try {
    assert.equal(isNewAcceptedInquiry(201, { accepted: true }, false), true);
    assert.equal(isNewAcceptedInquiry(200, { accepted: false }, false), false);
    assert.equal(isNewAcceptedInquiry(422, { accepted: false }, false), false);
    trackAcceptedInquiry({
      name: "Mary Ann Smith",
      email: " Mary@P5HomeCo.com ",
      phone: "2085550100",
      ...({ city: "Meridian", summary: "Please remodel the kitchen", project: "kitchen" } as object),
    });
    assert.deepEqual(queued[0], [
      "set",
      "user_data",
      {
        email: "mary@p5homeco.com",
        phone_number: "+12085550100",
        address: { first_name: "Mary", last_name: "Ann Smith", country: "US" },
      },
    ]);
    assert.deepEqual(queued[1], ["event", "generate_lead", { form: "quote_landing_page" }]);
    assert.deepEqual(queued[2], ["event", "conversion", { send_to: FORM_SEND_TO }]);
    const serialized = JSON.stringify(queued);
    assert.equal(serialized.includes("Meridian"), false);
    assert.equal(serialized.includes("remodel"), false);
    assert.equal(serialized.includes("kitchen"), false);
    const setAt = queued.findIndex((entry) => entry[1] === "user_data");
    const conversionAt = queued.findIndex((entry) => entry[1] === "conversion");
    assert.ok(conversionAt > setAt);
  } finally {
    restore();
  }
});

test("quote and estimator call sites pass only collected contact fields", () => {
  const quote = readFileSync(new URL("../app/quote/QuoteForm.tsx", import.meta.url), "utf8");
  const callAt = quote.indexOf("trackAcceptedInquiry(");
  const gateAt = quote.indexOf("isNewAcceptedInquiry(");
  assert.ok(gateAt !== -1 && callAt > gateAt);
  const call = quote.slice(callAt, quote.indexOf(");", callAt));
  assert.match(call, /name: values\.name/);
  assert.match(call, /email: values\.email/);
  assert.match(call, /phone: values\.phone/);
  assert.equal(call.includes("summary"), false);
  assert.equal(call.includes("city"), false);
  assert.equal(call.includes("project"), false);

  const estimator = readFileSync(new URL("../components/P5Estimator.tsx", import.meta.url), "utf8");
  assert.match(estimator, /estimatorAds=\{service:d\.answers\.service,name:d\.contact\?\.name,email:d\.contact\?\.email,phone:d\.contact\?\.phone,accepted:data\.accepted!==false,transactionId:/);
  assert.match(estimator, /trackGoogleAdsLeadConversion\(estimatorAds,`estimator:\$\{d\.id\}`\)/);
  const estimatorAds = estimator.slice(estimator.indexOf("const estimatorAds"), estimator.indexOf("trackGoogleAdsLeadConversion(estimatorAds"));
  for (const forbidden of ["text:", "summary:", "description:", "address:", "street:", "city:", "postal"]) {
    assert.equal(estimatorAds.includes(forbidden), false, forbidden);
  }

  const privacy = readFileSync(new URL("../app/legal/privacy/page.tsx", import.meta.url), "utf8");
  assert.match(privacy, /TODO: Enhanced conversions disclosure pending Priya/);
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /googleTagBootstrap\(\{ hostname: "p5homeco\.com", measurementId: gaMeasurementId, adsId: googleAdsDestinationId \}\)/);
  assert.equal(layout.includes("cEzmCPOagKAdEKzf-q9E"), false);
});
