import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KEY_ACCOUNTS,
  REQUIRED_CLASSES,
  REQUIRED_DEAL_PROPERTIES,
  compareAccountsToBaseline,
  compareClasses,
  compareKeyAccounts,
  compareProperties,
  compareStages,
} from "../app/lib/kb/drift.ts";
import { STAGE_IDS } from "../app/lib/integrations/hubspot-map.ts";

// --- Classes ----------------------------------------------------------------

test("the six live classes match: no drift", () => {
  assert.deepEqual(compareClasses([...REQUIRED_CLASSES]), []);
});

test("a renamed class is reported both ways", () => {
  const live = REQUIRED_CLASSES.map((c) =>
    c === "Boise Cabinet Co" ? "Boise Cabinets Co" : c,
  );
  const problems = compareClasses(live);
  assert.equal(problems.length, 2);
  assert.match(problems.join(" "), /Boise Cabinet Co/);
  assert.match(problems.join(" "), /Boise Cabinets Co/);
});

// --- Key accounts -----------------------------------------------------------

test("matching key accounts: no drift (name comparison is case-insensitive)", () => {
  const live = Object.fromEntries(
    Object.entries(KEY_ACCOUNTS).map(([n, name]) => [n, name.toUpperCase()]),
  );
  assert.deepEqual(compareKeyAccounts(live), []);
});

test("a missing reserve account is drift", () => {
  const live = { ...KEY_ACCOUNTS };
  delete (live as Record<string, string>)["1030"];
  const problems = compareKeyAccounts(live);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /1030/);
});

// --- Baseline diff ----------------------------------------------------------

test("baseline diff reports adds, removes, and renames precisely", () => {
  const baseline = { "1010": "Operating Checking", "5040": "Project Materials" };
  const live = { "1010": "Main Checking", "5045": "Site Materials" };
  const problems = compareAccountsToBaseline(live, baseline);
  assert.equal(problems.length, 3);
  assert.match(problems.join(" "), /renamed/);
  assert.match(problems.join(" "), /removed/);
  assert.match(problems.join(" "), /New account 5045/);
});

test("identical baseline: silence", () => {
  const map = { "1010": "Operating Checking" };
  assert.deepEqual(compareAccountsToBaseline(map, { ...map }), []);
});

// --- Pipeline stages --------------------------------------------------------

const LIVE_STAGES = Object.entries(STAGE_IDS).map(([label, id]) => ({ id, label }));

test("the live pipeline as documented: no drift", () => {
  assert.deepEqual(compareStages(LIVE_STAGES), []);
});

test("a relabeled stage is caught by id, not label", () => {
  const live = LIVE_STAGES.map((s) =>
    s.id === "appointmentscheduled" ? { ...s, label: "Fresh Lead" } : s,
  );
  const problems = compareStages(live);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /appointmentscheduled/);
  assert.match(problems[0], /Fresh Lead/);
});

test("an added stage is reported", () => {
  const problems = compareStages([...LIVE_STAGES, { id: "999", label: "Ghost Stage" }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Ghost Stage/);
});

// --- Properties -------------------------------------------------------------

test("required deal properties present: no drift", () => {
  assert.deepEqual(
    compareProperties(new Set([...REQUIRED_DEAL_PROPERTIES, "dealname", "amount"])),
    [],
  );
});

test("a deleted property is reported", () => {
  const names = new Set(REQUIRED_DEAL_PROPERTIES.filter((p) => p !== "p5_brand"));
  const problems = compareProperties(names);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /p5_brand/);
});
