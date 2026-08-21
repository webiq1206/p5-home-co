import { test } from "node:test";
import assert from "node:assert/strict";

import {
  P5_CALENDAR,
  addBusinessMinutes,
  businessMinutesBetween,
  escalationTierFor,
  fromZonedParts,
  isWithinBusinessHours,
  nextBusinessOpening,
  toZonedParts,
  type BusinessCalendar,
} from "../app/lib/leads/time.ts";

const CAL = P5_CALENDAR;
const TZ = CAL.timeZone;

/** Build an instant from Boise wall-clock, for readable test setup. */
function boise(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return fromZonedParts({ year: y, month: mo, day: d, hour: h, minute: mi }, TZ);
}

/** Render an instant as Boise wall-clock, for readable assertions. */
function show(instant: Date): string {
  const p = toZonedParts(instant, TZ);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} (wd${p.weekday})`;
}

// --- Timezone correctness, including DST -----------------------------------

test("DST: 7am Boise is UTC-7 in winter and UTC-6 in summer", () => {
  assert.equal(boise(2026, 1, 15, 7).toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(boise(2026, 7, 15, 7).toISOString(), "2026-07-15T13:00:00.000Z");
});

test("DST transition dates for 2026 fall on the expected Sundays", () => {
  assert.equal(toZonedParts(boise(2026, 3, 8, 12), TZ).weekday, 0, "Mar 8 2026 is a Sunday");
  assert.equal(toZonedParts(boise(2026, 11, 1, 12), TZ).weekday, 0, "Nov 1 2026 is a Sunday");
});

test("DST: a wall time inside the spring-forward gap resolves to the transition", () => {
  // 2:30am on 2026-03-08 never happens; the clock jumps 2:00 -> 3:00.
  const gap = boise(2026, 3, 8, 2, 30);
  const parts = toZonedParts(gap, TZ);
  assert.equal(parts.hour, 3, `expected the 3am side of the gap, got ${show(gap)}`);
});

test("round-trip: wall clock survives conversion in both DST regimes", () => {
  for (const [mo, d] of [[1, 15], [3, 9], [7, 15], [11, 2]] as const) {
    const instant = boise(2026, mo, d, 9, 45);
    const p = toZonedParts(instant, TZ);
    assert.equal(p.hour, 9);
    assert.equal(p.minute, 45);
    assert.equal(p.day, d);
  }
});

// --- Business hours: Monday-Saturday, 7:00am-6:00pm -------------------------

test("Saturday is a business day and Sunday is not", () => {
  // 2026-08-22 is a Saturday, 2026-08-23 a Sunday.
  assert.equal(toZonedParts(boise(2026, 8, 22, 12), TZ).weekday, 6);
  assert.equal(toZonedParts(boise(2026, 8, 23, 12), TZ).weekday, 0);

  assert.equal(isWithinBusinessHours(boise(2026, 8, 22, 10), CAL), true, "Sat 10am open");
  assert.equal(isWithinBusinessHours(boise(2026, 8, 23, 10), CAL), false, "Sun 10am closed");
});

test("open and close boundaries are half-open [07:00, 18:00)", () => {
  assert.equal(isWithinBusinessHours(boise(2026, 8, 21, 6, 59), CAL), false);
  assert.equal(isWithinBusinessHours(boise(2026, 8, 21, 7, 0), CAL), true);
  assert.equal(isWithinBusinessHours(boise(2026, 8, 21, 17, 59), CAL), true);
  assert.equal(isWithinBusinessHours(boise(2026, 8, 21, 18, 0), CAL), false);
});

test("nextBusinessOpening skips Sunday and lands on Monday 7am", () => {
  const sundayAfternoon = boise(2026, 8, 23, 14);
  assert.equal(show(nextBusinessOpening(sundayAfternoon, CAL)), "2026-08-24 07:00 (wd1)");
});

test("nextBusinessOpening from Saturday evening skips to Monday", () => {
  const satEvening = boise(2026, 8, 22, 20);
  assert.equal(show(nextBusinessOpening(satEvening, CAL)), "2026-08-24 07:00 (wd1)");
});

test("nextBusinessOpening before opening returns the same morning", () => {
  assert.equal(show(nextBusinessOpening(boise(2026, 8, 21, 6), CAL)), "2026-08-21 07:00 (wd5)");
});

test("nextBusinessOpening inside hours is a no-op", () => {
  const inside = boise(2026, 8, 21, 10, 17);
  assert.equal(nextBusinessOpening(inside, CAL).getTime(), inside.getTime());
});

// --- Elapsed business minutes ----------------------------------------------

test("businessMinutesBetween within a single day", () => {
  assert.equal(businessMinutesBetween(boise(2026, 8, 21, 10), boise(2026, 8, 21, 10, 30), CAL), 30);
});

test("businessMinutesBetween excludes closed overnight time", () => {
  // Fri 17:30 -> Sat 07:30 = 30 min Friday + 30 min Saturday.
  assert.equal(businessMinutesBetween(boise(2026, 8, 21, 17, 30), boise(2026, 8, 22, 7, 30), CAL), 60);
});

test("businessMinutesBetween skips Sunday entirely", () => {
  // Sat 17:00 -> Mon 08:00 = 60 min Saturday + 60 min Monday, Sunday ignored.
  assert.equal(businessMinutesBetween(boise(2026, 8, 22, 17), boise(2026, 8, 24, 8), CAL), 120);
});

test("businessMinutesBetween counts zero across a closed Sunday", () => {
  assert.equal(businessMinutesBetween(boise(2026, 8, 23, 9), boise(2026, 8, 23, 17), CAL), 0);
});

test("businessMinutesBetween is zero when end precedes start", () => {
  assert.equal(businessMinutesBetween(boise(2026, 8, 21, 12), boise(2026, 8, 21, 9), CAL), 0);
});

test("businessMinutesBetween is DST-correct across the spring-forward weekend", () => {
  // Sat 2026-03-07 17:00 -> Mon 2026-03-09 08:00. Sunday Mar 8 is closed and is
  // also the DST day. Expect 60 (Sat) + 60 (Mon) = 120 wall-clock business min.
  assert.equal(businessMinutesBetween(boise(2026, 3, 7, 17), boise(2026, 3, 9, 8), CAL), 120);
});

// --- SLA deadline arithmetic ------------------------------------------------

test("addBusinessMinutes rolls overnight into the next business morning", () => {
  assert.equal(show(addBusinessMinutes(boise(2026, 8, 21, 17, 45), 30, CAL)), "2026-08-22 07:15 (wd6)");
});

test("an after-hours lead starts its clock at the next opening, not instantly overdue", () => {
  // Sunday 2pm inquiry, 5-minute response target -> Monday 7:05am.
  assert.equal(show(addBusinessMinutes(boise(2026, 8, 23, 14), 5, CAL)), "2026-08-24 07:05 (wd1)");
});

test("addBusinessMinutes spans a full closed Sunday", () => {
  // Sat 17:30 + 60 business minutes -> 30 min Sat, then Mon 07:30.
  assert.equal(show(addBusinessMinutes(boise(2026, 8, 22, 17, 30), 60, CAL)), "2026-08-24 07:30 (wd1)");
});

test("addBusinessMinutes crosses the spring-forward DST boundary correctly", () => {
  // Sat 2026-03-07 17:30 + 60 business minutes -> Mon 2026-03-09 07:30 MDT.
  const due = addBusinessMinutes(boise(2026, 3, 7, 17, 30), 60, CAL);
  assert.equal(show(due), "2026-03-09 07:30 (wd1)");
  // After the transition Boise is UTC-6, so 07:30 local is 13:30Z.
  assert.equal(due.toISOString(), "2026-03-09T13:30:00.000Z");
});

test("holidays remove a day from the calendar", () => {
  const withHoliday: BusinessCalendar = { ...CAL, holidays: ["2026-08-24"] };
  // Monday Aug 24 closed -> next opening is Tuesday Aug 25.
  assert.equal(show(nextBusinessOpening(boise(2026, 8, 23, 14), withHoliday)), "2026-08-25 07:00 (wd2)");
});

test("a calendar with no open days fails loudly instead of hanging", () => {
  const broken: BusinessCalendar = { ...CAL, businessDays: [] };
  assert.throws(() => nextBusinessOpening(boise(2026, 8, 21, 9), broken), /No business day found/);
});

// --- Escalation -------------------------------------------------------------

test("escalation tiers match the 5/15/30/60 business-minute thresholds", () => {
  assert.equal(escalationTierFor(0), "none");
  assert.equal(escalationTierFor(4), "none");
  assert.equal(escalationTierFor(5), "owner");
  assert.equal(escalationTierFor(14), "owner");
  assert.equal(escalationTierFor(15), "owner_manager");
  assert.equal(escalationTierFor(29), "owner_manager");
  assert.equal(escalationTierFor(30), "critical");
  assert.equal(escalationTierFor(59), "critical");
  assert.equal(escalationTierFor(60), "administrator");
  assert.equal(escalationTierFor(600), "administrator");
});
