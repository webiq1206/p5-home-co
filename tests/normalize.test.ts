import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addressKey,
  contactIdentityKey,
  dealIdentityKey,
  dealName,
  formatPhone,
  isDuplicateSubmission,
  normalizeEmail,
  normalizePhone,
  validateInboundLead,
} from "../app/lib/leads/normalize.ts";
import type { InboundLead } from "../app/lib/leads/types.ts";

// --- Email ------------------------------------------------------------------

test("emails normalize to lowercase and trimmed", () => {
  assert.equal(normalizeEmail("  Jane.Doe@Example.COM "), "jane.doe@example.com");
});

test("malformed emails are rejected rather than stored", () => {
  for (const bad of ["", "  ", "nope", "a@b", "a b@c.com", "@example.com", null, undefined]) {
    assert.equal(normalizeEmail(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- Phone ------------------------------------------------------------------

test("the P5 business number normalizes to E.164 from every common format", () => {
  for (const form of [
    "(208) 477-1169",
    "208-477-1169",
    "208.477.1169",
    "2084771169",
    "12084771169",
    "+1 208 477 1169",
    "  +1 (208) 477-1169  ",
  ]) {
    assert.equal(normalizePhone(form), "+12084771169", `failed for ${form}`);
  }
});

test("invalid NANP numbers are rejected", () => {
  for (const bad of ["", "123", "0123456789", "1084771169", "20847711690000", null, undefined]) {
    assert.equal(normalizePhone(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("an explicit non-US country code is preserved, not mangled into +1", () => {
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

test("phones render back to the display format used across the site", () => {
  assert.equal(formatPhone("+12084771169"), "(208) 477-1169");
  assert.equal(formatPhone(null), "");
});

// --- Address ----------------------------------------------------------------

test("address keys survive abbreviation and punctuation differences", () => {
  assert.equal(addressKey("123 North Main Street."), addressKey("123 N Main St"));
  assert.notEqual(addressKey("123 N Main St"), addressKey("125 N Main St"));
});

// --- Identity ---------------------------------------------------------------

test("email wins over phone as the contact identity", () => {
  assert.equal(
    contactIdentityKey({ email: "A@Example.com", phone: "(208) 477-1169" }),
    "email:a@example.com",
  );
});

test("phone is the fallback identity when there is no email", () => {
  assert.equal(
    contactIdentityKey({ email: null, phone: "208-477-1169" }),
    "phone:+12084771169",
  );
});

test("a lead with no reachable contact has no identity and cannot be deduplicated", () => {
  assert.equal(contactIdentityKey({ email: null, phone: null }), null);
  assert.equal(
    dealIdentityKey({
      email: null,
      phone: null,
      brand: "Boise Cabinet Co",
      projectType: "Kitchen cabinets",
      propertyAddress: "1 Main St",
    }),
    null,
  );
});

test("the same person with two brands produces two distinct deals", () => {
  const base = { email: "jane@example.com", phone: null, propertyAddress: "1 Main St" };
  const cabinet = dealIdentityKey({ ...base, brand: "Boise Cabinet Co", projectType: "Kitchen" });
  const remodel = dealIdentityKey({ ...base, brand: "Boise Remodeling Co", projectType: "Kitchen" });
  assert.notEqual(cabinet, remodel);
});

test("the same person, brand, and address is one deal despite formatting differences", () => {
  const a = dealIdentityKey({
    email: "Jane@Example.com",
    phone: null,
    brand: "Boise Remodeling Co",
    projectType: "Kitchen remodel",
    propertyAddress: "123 North Main Street.",
  });
  const b = dealIdentityKey({
    email: "jane@example.com",
    phone: null,
    brand: "Boise Remodeling Co",
    projectType: "kitchen remodel",
    propertyAddress: "123 N Main St",
  });
  assert.equal(a, b);
});

// --- Duplicate submissions --------------------------------------------------

test("a matching external lead id is authoritative and makes intake idempotent", () => {
  const now = new Date("2026-08-21T16:00:00Z");
  const later = new Date("2026-08-25T16:00:00Z"); // days apart
  assert.equal(
    isDuplicateSubmission(
      { externalLeadId: "fb_123", dealKey: "a", receivedAt: now },
      { externalLeadId: "fb_123", dealKey: "b", receivedAt: later },
    ),
    true,
  );
});

test("a resubmitted form within the window is a duplicate, outside it is a new project", () => {
  const t0 = new Date("2026-08-21T16:00:00Z");
  const within = new Date("2026-08-21T16:10:00Z");
  const outside = new Date("2026-08-21T17:30:00Z");

  assert.equal(
    isDuplicateSubmission(
      { externalLeadId: null, dealKey: "k", receivedAt: t0 },
      { externalLeadId: null, dealKey: "k", receivedAt: within },
    ),
    true,
  );
  assert.equal(
    isDuplicateSubmission(
      { externalLeadId: null, dealKey: "k", receivedAt: t0 },
      { externalLeadId: null, dealKey: "k", receivedAt: outside },
    ),
    false,
  );
});

test("different deal keys are never duplicates", () => {
  const t = new Date("2026-08-21T16:00:00Z");
  assert.equal(
    isDuplicateSubmission(
      { externalLeadId: null, dealKey: "a", receivedAt: t },
      { externalLeadId: null, dealKey: "b", receivedAt: t },
    ),
    false,
  );
});

// --- Validation -------------------------------------------------------------

function lead(overrides: Partial<InboundLead> = {}): InboundLead {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: null,
    brand: "Boise Remodeling Co",
    projectType: "Kitchen remodel",
    source: "Organic Website",
    sourceDetail: null,
    propertyAddress: null,
    propertyCity: "Boise",
    summary: null,
    externalLeadId: null,
    originalForm: null,
    originalCampaign: null,
    utm: null,
    receivedAt: new Date("2026-08-21T16:00:00Z"),
    ...overrides,
  };
}

test("a well-formed lead validates", () => {
  assert.deepEqual(validateInboundLead(lead()), []);
});

test("a lead with no email and no phone is rejected", () => {
  const errors = validateInboundLead(lead({ email: null, phone: null }));
  assert.ok(errors.some((e) => e.field === "contact"));
});

test("a malformed email is reported on its own field", () => {
  const errors = validateInboundLead(lead({ email: "not-an-email", phone: "2084771169" }));
  assert.ok(errors.some((e) => e.field === "email"));
  assert.ok(!errors.some((e) => e.field === "contact"), "phone still makes it reachable");
});

test("a nameless lead is rejected", () => {
  const errors = validateInboundLead(lead({ firstName: null, lastName: null }));
  assert.ok(errors.some((e) => e.field === "name"));
});

// --- Deal naming ------------------------------------------------------------

test("deal names follow Last Name | Brand | Project Type | City", () => {
  assert.equal(
    dealName({
      firstName: "Jane",
      lastName: "Doe",
      brand: "Boise Cabinet Co",
      projectType: "Kitchen cabinets",
      propertyCity: "Kuna",
    }),
    "Doe | Boise Cabinet Co | Kitchen cabinets | Kuna",
  );
});

test("deal names degrade gracefully when optional parts are missing", () => {
  assert.equal(
    dealName({ firstName: "Jane", lastName: null, brand: "P5 Home Co", projectType: null, propertyCity: null }),
    "Jane | P5 Home Co",
  );
});
