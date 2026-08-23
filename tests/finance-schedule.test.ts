import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideDailyRun,
  localDateAndHour,
  type LastFinanceRun,
} from "../app/lib/finance/schedule.ts";

const BASE = {
  nowLocalDate: "2026-08-23",
  nowLocalHour: 6,
  runAtHour: 6,
  retryAfterMinutes: 60,
};

function lastRun(over: Partial<LastFinanceRun> = {}): LastFinanceRun {
  return { localDate: "2026-08-23", status: "succeeded", minutesAgo: 30, ...over };
}

// ---------------------------------------------------------------------------
// S143: the job is due once a day, at or after the configured hour.
// ---------------------------------------------------------------------------

test("waits until the scheduled hour", () => {
  const decision = decideDailyRun({ ...BASE, nowLocalHour: 5, lastRun: null });
  assert.equal(decision.run, false);
  assert.match(decision.reason, /before 06:00/);
});

test("runs when the hour has arrived and nothing has run today", () => {
  assert.equal(decideDailyRun({ ...BASE, lastRun: null }).run, true);
  // A restart late in the day must still run the pass, not skip the day.
  assert.equal(decideDailyRun({ ...BASE, nowLocalHour: 22, lastRun: null }).run, true);
});

test("yesterday's pass does not count as today's", () => {
  const decision = decideDailyRun({
    ...BASE,
    lastRun: lastRun({ localDate: "2026-08-22", minutesAgo: 1_400 }),
  });
  assert.equal(decision.run, true);
  assert.match(decision.reason, /no pass has run today/);
});

test("does not run twice in a day", () => {
  assert.equal(decideDailyRun({ ...BASE, lastRun: lastRun() }).run, false);
  // A partial pass reported its own failures; re-running adds noise, not news.
  assert.equal(
    decideDailyRun({ ...BASE, lastRun: lastRun({ status: "partial" }) }).run,
    false,
  );
});

// ---------------------------------------------------------------------------
// Failure handling: one retry, not a retry storm.
// ---------------------------------------------------------------------------

test("a failed pass retries only after the retry window", () => {
  const inside = decideDailyRun({
    ...BASE,
    lastRun: lastRun({ status: "failed", minutesAgo: 59 }),
  });
  assert.equal(inside.run, false);

  const outside = decideDailyRun({
    ...BASE,
    lastRun: lastRun({ status: "failed", minutesAgo: 60 }),
  });
  assert.equal(outside.run, true);
  assert.match(outside.reason, /retrying/);
});

test("a running pass blocks a second one until it is clearly dead", () => {
  assert.equal(
    decideDailyRun({ ...BASE, lastRun: lastRun({ status: "running", minutesAgo: 10 }) }).run,
    false,
  );
  // A process that died mid-pass leaves 'running' behind forever; that must
  // not wedge the job permanently.
  const stale = decideDailyRun({
    ...BASE,
    lastRun: lastRun({ status: "running", minutesAgo: 90 }),
  });
  assert.equal(stale.run, true);
  assert.match(stale.reason, /dead/);
});

// ---------------------------------------------------------------------------
// Timezone: the business runs on Mountain time, the server on UTC.
// ---------------------------------------------------------------------------

test("local date and hour follow the business timezone, including DST", () => {
  // 05:30 UTC on 23 Aug is still 23:30 on 22 Aug in Boise (MDT, UTC-6).
  const summer = localDateAndHour(new Date("2026-08-23T05:30:00Z"), "America/Boise");
  assert.deepEqual(summer, { date: "2026-08-22", hour: 23 });

  // 14:00 UTC in January is 07:00 the same day (MST, UTC-7).
  const winter = localDateAndHour(new Date("2026-01-15T14:00:00Z"), "America/Boise");
  assert.deepEqual(winter, { date: "2026-01-15", hour: 7 });

  // Midnight local must report hour 0, not 24.
  const midnight = localDateAndHour(new Date("2026-08-23T06:00:00Z"), "America/Boise");
  assert.deepEqual(midnight, { date: "2026-08-23", hour: 0 });
});

test("the timezone actually changes the answer", () => {
  const at = new Date("2026-08-23T05:30:00Z");
  assert.equal(localDateAndHour(at, "UTC").date, "2026-08-23");
  assert.equal(localDateAndHour(at, "America/Boise").date, "2026-08-22");
});
