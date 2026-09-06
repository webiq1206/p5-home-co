import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_OPTIONS,
  QUOTE_CITIES,
  brandForProject,
  buildIntakePayload,
  isValidQuoteForm,
  projectBrandsAreKnown,
  validateQuoteForm,
  type QuoteFormValues,
} from "../app/quote/options.ts";
import { BRANDS } from "../app/lib/leads/types.ts";
import { validateInboundLead } from "../app/lib/leads/normalize.ts";
import type { InboundLead } from "../app/lib/leads/types.ts";

const base: QuoteFormValues = {
  name: "Dana Reeves",
  phone: "",
  email: "dana@example.com",
  city: "Meridian",
  project: "Kitchen remodel",
  summary: "Galley kitchen, want to open the wall to the dining room.",
};

// --- Routing ----------------------------------------------------------------

test("every project option routes to a brand the lead manager knows", () => {
  assert.equal(projectBrandsAreKnown(), true);
  for (const option of PROJECT_OPTIONS) {
    assert.ok(
      (BRANDS as readonly string[]).includes(option.brand),
      `${option.value} routes to unknown brand ${option.brand}`,
    );
  }
});

test("projects route to the company that does that craft", () => {
  assert.equal(brandForProject("Kitchen remodel"), "Boise Remodeling Co");
  assert.equal(brandForProject("New custom home"), "Boise Construction Co");
  assert.equal(brandForProject("Garage conversion"), "Boise ADU Co");
  assert.equal(brandForProject("Custom cabinets or built-ins"), "Boise Cabinet Co");
  assert.equal(brandForProject("Home repairs or handyman work"), "Boise Handyman Co");
});

test("an unrecognised or missing project falls back to the parent, never undefined", () => {
  for (const value of ["", "Something we do not offer", null, undefined]) {
    assert.equal(brandForProject(value), "P5 Home Co");
  }
});

test("all five operating companies are reachable from the form", () => {
  const routed = new Set(PROJECT_OPTIONS.map((o) => o.brand));
  for (const brand of BRANDS) {
    assert.ok(routed.has(brand), `${brand} cannot be reached from the quote form`);
  }
});

// --- Service area -----------------------------------------------------------

test("the city list covers the nine cities P5 takes work in", () => {
  for (const city of [
    "Boise",
    "Meridian",
    "Eagle",
    "Nampa",
    "Kuna",
    "Star",
    "Middleton",
    "Caldwell",
    "Garden City",
  ]) {
    assert.ok((QUOTE_CITIES as readonly string[]).includes(city), `${city} is missing`);
  }
});

test("someone outside the named cities can still ask", () => {
  assert.ok(QUOTE_CITIES.some((c) => c.startsWith("Somewhere else")));
});

// --- Validation -------------------------------------------------------------

test("a complete enquiry passes", () => {
  assert.deepEqual(validateQuoteForm(base), {});
  assert.equal(isValidQuoteForm(base), true);
});

test("a name is required", () => {
  assert.equal(validateQuoteForm({ ...base, name: "   " }).name !== undefined, true);
});

test("some way to reply is required, and either one alone is enough", () => {
  assert.ok(validateQuoteForm({ ...base, email: "", phone: "" }).contact);
  assert.deepEqual(validateQuoteForm({ ...base, email: "", phone: "(208) 477-1169" }), {});
  assert.deepEqual(validateQuoteForm({ ...base, phone: "", email: "a@b.co" }), {});
});

test("malformed contact details are caught before the round trip", () => {
  assert.ok(validateQuoteForm({ ...base, email: "not-an-email" }).email);
  assert.ok(validateQuoteForm({ ...base, email: "", phone: "12345" }).phone);
});

/**
 * The form must never reject something the server would have accepted, or a
 * real lead is lost on the client for no reason.
 */
test("client validation never rejects an enquiry the server would accept", () => {
  const cases: QuoteFormValues[] = [
    { ...base, phone: "208-477-1169", email: "" },
    { ...base, email: "  Dana.Reeves@Example.COM  " },
    { ...base, summary: "", city: "", project: "" },
  ];
  for (const values of cases) {
    const payload = buildIntakePayload(values);
    const lead = {
      firstName: payload.name.split(" ")[0] ?? null,
      lastName: payload.name.split(" ").slice(1).join(" ") || null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
    } as InboundLead;
    assert.deepEqual(
      validateQuoteForm(values),
      {},
      "client rejected something it should have allowed",
    );
    assert.deepEqual(
      validateInboundLead(lead),
      [],
      "server would reject what the client accepted",
    );
  }
});

// --- Payload ----------------------------------------------------------------

test("the payload attributes the lead to paid search and names the form", () => {
  const payload = buildIntakePayload(base);
  assert.equal(payload.source, "Paid Search");
  assert.equal(payload.form, "Quote Landing Page");
  assert.equal(payload.brand, "Boise Remodeling Co");
  assert.equal(payload.city, "Meridian");
  assert.equal(payload.projectType, "Kitchen remodel");
});

test("empty optional fields are omitted rather than sent blank", () => {
  const payload = buildIntakePayload({ ...base, phone: "", summary: "", city: "", project: "" });
  for (const key of ["phone", "summary", "city", "projectType"]) {
    assert.equal(key in payload, false, `${key} should be absent`);
  }
  assert.equal(payload.brand, "P5 Home Co");
});

test("'somewhere else' is not sent as a city, because it is not one", () => {
  const payload = buildIntakePayload({ ...base, city: "Somewhere else in the Treasure Valley" });
  assert.equal("city" in payload, false);
});

test("the Google click id and utm parameters are carried through", () => {
  const search = new URLSearchParams(
    "gclid=EAIaIQ123&utm_source=google&utm_medium=cpc&utm_campaign=treasure-valley-remodel",
  );
  const payload = buildIntakePayload(base, search);
  assert.equal(payload.sourceDetail, "gclid:EAIaIQ123");
  assert.equal(payload.utm_source, "google");
  assert.equal(payload.utm_medium, "cpc");
  assert.equal(payload.campaign, "treasure-valley-remodel");
});

test("a visitor arriving with no tracking parameters still submits cleanly", () => {
  const payload = buildIntakePayload(base, new URLSearchParams(""));
  assert.equal("sourceDetail" in payload, false);
  assert.equal(payload.source, "Paid Search");
});

test("values are trimmed so stored leads are not padded with whitespace", () => {
  const payload = buildIntakePayload({ ...base, name: "  Dana Reeves  ", email: " a@b.co " });
  assert.equal(payload.name, "Dana Reeves");
  assert.equal(payload.email, "a@b.co");
});
