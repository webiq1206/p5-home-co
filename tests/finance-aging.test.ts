import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agingBucket,
  daysOverdue,
  firstShortfall,
  forecastWeeks,
  summariseAging,
} from "../app/lib/finance/aging.ts";

const AS_OF = new Date("2026-08-23T15:00:00Z"); // a Sunday

// ---------------------------------------------------------------------------
// Bucket boundaries. These are where off-by-one errors hide for months.
// ---------------------------------------------------------------------------

test("something due today is not overdue", () => {
  assert.equal(daysOverdue("2026-08-23", AS_OF), 0);
  assert.equal(agingBucket("2026-08-23", AS_OF), "current");
  // Due tomorrow is even less overdue.
  assert.equal(agingBucket("2026-08-24", AS_OF), "current");
});

test("each bucket boundary lands on the right side", () => {
  assert.equal(agingBucket("2026-08-22", AS_OF), "1-30");   // 1 day
  assert.equal(agingBucket("2026-07-24", AS_OF), "1-30");   // 30 days
  assert.equal(agingBucket("2026-07-23", AS_OF), "31-60");  // 31 days
  assert.equal(agingBucket("2026-06-24", AS_OF), "31-60");  // 60 days
  assert.equal(agingBucket("2026-06-23", AS_OF), "61-90");  // 61 days
  assert.equal(agingBucket("2026-05-25", AS_OF), "61-90");  // 90 days
  assert.equal(agingBucket("2026-05-24", AS_OF), "90+");    // 91 days
});

test("a missing due date is treated as current, not invented as overdue", () => {
  assert.equal(agingBucket(null, AS_OF), "current");
  assert.equal(daysOverdue(null, AS_OF), 0);
});

test("aging totals reconcile and overdue excludes current", () => {
  const summary = summariseAging(
    [
      { dueDate: "2026-09-30", openBalance: 1000 }, // current
      { dueDate: "2026-08-01", openBalance: 500 },  // 1-30
      { dueDate: "2026-06-30", openBalance: 250 },  // 31-60
      { dueDate: "2026-01-01", openBalance: 125 },  // 90+
    ],
    AS_OF,
  );
  assert.equal(summary.buckets.current, 1000);
  assert.equal(summary.buckets["1-30"], 500);
  assert.equal(summary.buckets["31-60"], 250);
  assert.equal(summary.buckets["90+"], 125);
  assert.equal(summary.total, 1875);
  assert.equal(summary.overdue, 875);
  assert.ok(summary.oldestDays > 200);
});

test("an empty ledger ages to zero rather than NaN", () => {
  const summary = summariseAging([], AS_OF);
  assert.equal(summary.total, 0);
  assert.equal(summary.overdue, 0);
  assert.equal(summary.oldestDays, 0);
});

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

test("weeks start on Monday and carry the balance forward", () => {
  const weeks = forecastWeeks(
    10_000,
    [{ date: "2026-08-26", amount: 5_000, label: "Invoice 1001" }],
    [{ date: "2026-08-27", amount: 2_000, label: "Bill A" }],
    4,
    AS_OF,
  );
  assert.equal(weeks.length, 4);
  // 23 Aug 2026 is a Sunday, so its week began Monday 17 August.
  assert.equal(weeks[0].weekStart, "2026-08-17");
  assert.equal(weeks[1].weekStart, "2026-08-24");

  assert.equal(weeks[1].inflow, 5_000);
  assert.equal(weeks[1].outflow, 2_000);
  assert.equal(weeks[1].net, 3_000);
  assert.equal(weeks[1].closing, 13_000);
  // Nothing happens later, so the balance simply persists.
  assert.equal(weeks[3].closing, 13_000);
});

test("money already late lands in the first week rather than vanishing", () => {
  // Excluding overdue items would make the position look better than it is.
  const weeks = forecastWeeks(
    0,
    [{ date: "2026-01-15", amount: 900, label: "Very overdue invoice" }],
    [{ date: "2026-02-01", amount: 400, label: "Very overdue bill" }],
    3,
    AS_OF,
  );
  assert.equal(weeks[0].inflow, 900);
  assert.equal(weeks[0].outflow, 400);
  assert.equal(weeks[0].closing, 500);
});

test("movements beyond the horizon are excluded, not squeezed into the last week", () => {
  const weeks = forecastWeeks(
    1_000,
    [{ date: "2027-01-01", amount: 50_000, label: "Next year" }],
    [],
    4,
    AS_OF,
  );
  assert.equal(weeks[3].closing, 1_000);
});

test("undated movements are dropped rather than guessed onto a week", () => {
  const weeks = forecastWeeks(
    1_000,
    [{ date: null, amount: 9_999, label: "No date" }],
    [],
    2,
    AS_OF,
  );
  assert.equal(weeks[0].inflow, 0);
  assert.equal(weeks[1].closing, 1_000);
});

test("the first negative week is the one to act on", () => {
  const weeks = forecastWeeks(
    1_000,
    [],
    [
      { date: "2026-08-25", amount: 600, label: "Bill A" },
      { date: "2026-09-01", amount: 900, label: "Bill B" },
    ],
    4,
    AS_OF,
  );
  const shortfall = firstShortfall(weeks);
  assert.ok(shortfall);
  assert.equal(shortfall.weekStart, "2026-08-31");
  assert.equal(shortfall.closing, -500);

  assert.equal(firstShortfall(forecastWeeks(10_000, [], [], 4, AS_OF)), null);
});
