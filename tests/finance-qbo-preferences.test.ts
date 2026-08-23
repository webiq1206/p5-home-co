import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REQUIRED_PREFERENCES,
  UI_VERIFIED,
  checkPreferences,
  readPreference,
} from "../app/lib/finance/qbo/preferences.ts";

const byKey = (key: string) => {
  const check = REQUIRED_PREFERENCES.find((c) => c.key === key);
  assert.ok(check, `no such preference check: ${key}`);
  return check;
};

// ---------------------------------------------------------------------------
// The distinction the whole file exists for: off is not the same as unseen.
// ---------------------------------------------------------------------------

test("a setting QuickBooks does not report is unknown, never assumed off", () => {
  // Assuming off would raise a false alarm every morning for a setting that is
  // probably fine - and a list with permanent false alarms on it gets ignored.
  const { state, foundAt } = readPreference({}, byKey("projects_on"));
  assert.equal(state, "unknown");
  assert.equal(foundAt, null);
});

test("a setting reported off is off", () => {
  const { state } = readPreference(
    { ProjectsPrefs: { isProjectsEnabled: false } },
    byKey("projects_on"),
  );
  assert.equal(state, "off");
});

test("a setting reported on is on, and reports where it was found", () => {
  const { state, foundAt } = readPreference(
    { ProjectsPrefs: { isProjectsEnabled: true } },
    byKey("projects_on"),
  );
  assert.equal(state, "on");
  assert.equal(foundAt, "ProjectsPrefs.isProjectsEnabled");
});

// ---------------------------------------------------------------------------
// Reading values QuickBooks returns in more than one shape.
// ---------------------------------------------------------------------------

test("the strings true and false are read as booleans, not as truthy text", () => {
  // "false" is a non-empty string. Read naively, a switched-off setting would
  // report as on - the worst possible failure for a checker.
  assert.equal(
    readPreference({ SalesFormsPrefs: { CustomTxnNumbers: "false" } }, byKey("custom_transaction_numbers")).state,
    "off",
  );
  assert.equal(
    readPreference({ SalesFormsPrefs: { CustomTxnNumbers: "true" } }, byKey("custom_transaction_numbers")).state,
    "on",
  );
});

test("later candidate paths are tried when the first is absent", () => {
  // Field names differ by QuickBooks edition, so a single assumed path would
  // report unknown on a perfectly configured file.
  const { state, foundAt } = readPreference(
    { ExpensePrefs: { EnableExpenseTracking: true } },
    byKey("track_expenses_by_customer"),
  );
  assert.equal(state, "on");
  assert.equal(foundAt, "ExpensePrefs.EnableExpenseTracking");
});

test("a nested path does not throw when something in the middle is missing", () => {
  assert.equal(
    readPreference({ SalesFormsPrefs: "not an object" }, byKey("default_invoice_terms")).state,
    "unknown",
  );
  assert.equal(readPreference({ SalesFormsPrefs: null }, byKey("default_invoice_terms")).state, "unknown");
});

// ---------------------------------------------------------------------------
// "Present" settings: a value exists at all, rather than a switch being on.
// ---------------------------------------------------------------------------

test("default terms count as set when any value is present", () => {
  assert.equal(
    readPreference({ SalesFormsPrefs: { DefaultTerms: { value: "3" } } }, byKey("default_invoice_terms")).state,
    "on",
  );
  assert.equal(
    readPreference({ SalesFormsPrefs: { DefaultTerms: { value: "" } } }, byKey("default_invoice_terms")).state,
    "off",
  );
});

test("a book close date counts as closing the books", () => {
  assert.equal(
    readPreference({ AccountingInfoPrefs: { BookCloseDate: "2026-07-31" } }, byKey("close_the_books")).state,
    "on",
  );
});

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

test("only settings that are not confirmed on come back", () => {
  const prefs = {
    ProjectsPrefs: { isProjectsEnabled: true },
    VendorAndPurchasesPrefs: { TrackingByCustomer: false },
  };
  const findings = checkPreferences(prefs);
  const keys = findings.map((f) => f.key);
  assert.ok(!keys.includes("projects_on"), "a confirmed setting is not a finding");
  assert.ok(keys.includes("track_expenses_by_customer"));

  const tracking = findings.find((f) => f.key === "track_expenses_by_customer");
  assert.equal(tracking?.state, "off");
});

test("an empty payload reports every setting as unknown, not as broken", () => {
  // No attestations, so this tests the reading alone.
  const findings = checkPreferences({}, "2026-08-24", {});
  assert.equal(findings.length, REQUIRED_PREFERENCES.length);
  assert.ok(findings.every((f) => f.state === "unknown"));
});

test("every required setting says where to find it and why it matters", () => {
  for (const check of REQUIRED_PREFERENCES) {
    assert.ok(check.path.includes(">"), `${check.key}: must name the settings path`);
    assert.ok(check.plain.length > 40, `${check.key}: plain explanation is too thin`);
    assert.ok(check.consequence.length > 40, `${check.key}: consequence is too thin`);
    assert.ok(check.paths.length > 0, `${check.key}: needs at least one candidate path`);
  }
});

test("preference keys are unique", () => {
  const keys = REQUIRED_PREFERENCES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------------------
// Attestations: for the settings QuickBooks genuinely will not report.
// ---------------------------------------------------------------------------

test("a person's confirmation closes a setting the API cannot report", () => {
  // Otherwise these nag every morning forever, and a permanently unfixable
  // item is how the whole list gets ignored.
  const findings = checkPreferences({}, "2026-08-24", {
    projects_on: { verifiedOn: "2026-08-23", state: "on", verifiedBy: "someone" },
  });
  assert.ok(!findings.some((f) => f.key === "projects_on"));
});

test("a live reading beats an attestation, in both directions", () => {
  // Somebody's memory of looking in August must not override QuickBooks
  // saying "off" this morning.
  const findings = checkPreferences(
    { ProjectsPrefs: { isProjectsEnabled: false } },
    "2026-08-24",
    { projects_on: { verifiedOn: "2026-08-23", state: "on", verifiedBy: "someone" } },
  );
  const projects = findings.find((f) => f.key === "projects_on");
  assert.equal(projects?.state, "off");
  assert.equal(projects?.attestation, undefined, "a live reading is not an attestation");
});

test("an attestation someone confirmed as OFF stays a finding", () => {
  const findings = checkPreferences({}, "2026-08-24", {
    projects_on: { verifiedOn: "2026-08-23", state: "off", verifiedBy: "someone" },
  });
  const projects = findings.find((f) => f.key === "projects_on");
  assert.equal(projects?.state, "off");
  assert.equal(projects?.attestation?.state, "off");
});

test("an attestation goes stale and has to be renewed", () => {
  // Evidence that somebody looked on a day is not a permanent truth.
  const findings = checkPreferences({}, "2028-01-01", {
    projects_on: { verifiedOn: "2026-08-23", state: "on", verifiedBy: "someone" },
  });
  const projects = findings.find((f) => f.key === "projects_on");
  assert.equal(projects?.state, "unknown", "an expired attestation is worth no more than none");
  assert.equal(projects?.attestation?.expired, true);
});

test("the attestation records who looked and when, not just the answer", () => {
  const findings = checkPreferences({}, "2026-08-24", {
    projects_on: { verifiedOn: "2026-08-23", state: "off", verifiedBy: "accounting@p5homeco.com" },
  });
  const projects = findings.find((f) => f.key === "projects_on");
  assert.equal(projects?.attestation?.verifiedBy, "accounting@p5homeco.com");
  assert.equal(projects?.attestation?.verifiedOn, "2026-08-23");
  assert.equal(projects?.foundAt, null, "an attestation has no API path");
});

test("every attestation names a setting that actually exists", () => {
  // An attestation for a key no check uses is silently dead, and the setting
  // it was meant to cover goes unwatched - which is how this was found.
  const keys = new Set(REQUIRED_PREFERENCES.map((c) => c.key));
  for (const key of Object.keys(UI_VERIFIED)) {
    assert.ok(keys.has(key), `UI_VERIFIED has ${key}, which is not a required preference`);
  }
});

test("attestations are only for settings the API cannot report", () => {
  // If QuickBooks can answer, we should ask it rather than trust a memory.
  for (const key of Object.keys(UI_VERIFIED)) {
    const check = REQUIRED_PREFERENCES.find((c) => c.key === key);
    assert.ok(check, key);
    assert.ok(check.paths.length > 0, `${key}: still needs a candidate path to try first`);
  }
});
