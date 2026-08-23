import { test } from "node:test";
import assert from "node:assert/strict";

import {
  REQUIRED_PREFERENCES,
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
  const findings = checkPreferences({});
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
