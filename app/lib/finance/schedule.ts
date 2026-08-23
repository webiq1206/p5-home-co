/**
 * When the daily finance job should run (S143).
 *
 * The decision is a pure function because the awkward cases are the whole
 * point: a server that restarts at 3am must not run the day's job early, a
 * restart at 9am must still run it, a pass that already succeeded must not run
 * twice, and a pass that failed should get one more chance rather than leaving
 * a Wednesday Money Run unbuilt until Thursday.
 *
 * The business runs on Mountain time while the server runs on UTC, so every
 * comparison here is made in the configured business timezone. "Did today's
 * job run?" is a question about Meridian's calendar, not the server's.
 */

/** Statuses a recorded finance pass can carry (job_run.status). */
export type FinanceRunStatus = "running" | "succeeded" | "partial" | "failed";

export type LastFinanceRun = {
  /** Calendar date of the run in the business timezone, YYYY-MM-DD. */
  localDate: string;
  status: FinanceRunStatus;
  /** Minutes elapsed since the run started. */
  minutesAgo: number;
};

export type DailyRunInput = {
  /** Today in the business timezone, YYYY-MM-DD. */
  nowLocalDate: string;
  /** Current hour in the business timezone, 0-23. */
  nowLocalHour: number;
  /** Hour of the day the job is due, 0-23. */
  runAtHour: number;
  lastRun: LastFinanceRun | null;
  /** How long to wait before retrying a failed pass. */
  retryAfterMinutes: number;
};

export type DailyRunDecision = {
  run: boolean;
  /** Why, in words - this is what gets logged, so it has to be readable. */
  reason: string;
};

/**
 * A pass that is still marked 'running' blocks a second one. If the process
 * died mid-pass the row stays 'running' forever, so it stops blocking once
 * it is clearly stale rather than wedging the job until someone notices.
 */
const STALE_RUNNING_MINUTES = 90;

export function decideDailyRun(input: DailyRunInput): DailyRunDecision {
  const { nowLocalDate, nowLocalHour, runAtHour, lastRun, retryAfterMinutes } = input;

  if (nowLocalHour < runAtHour) {
    return { run: false, reason: `before ${String(runAtHour).padStart(2, "0")}:00 local` };
  }

  if (!lastRun || lastRun.localDate !== nowLocalDate) {
    return { run: true, reason: "no pass has run today" };
  }

  if (lastRun.status === "running") {
    if (lastRun.minutesAgo >= STALE_RUNNING_MINUTES) {
      return { run: true, reason: `previous pass has been running ${Math.round(lastRun.minutesAgo)}m; treating it as dead` };
    }
    return { run: false, reason: "a pass is already running" };
  }

  if (lastRun.status === "failed") {
    if (lastRun.minutesAgo >= retryAfterMinutes) {
      return { run: true, reason: `retrying after a failed pass ${Math.round(lastRun.minutesAgo)}m ago` };
    }
    return { run: false, reason: "failed pass is still inside the retry window" };
  }

  // 'succeeded' and 'partial' both count as today's pass. A partial pass
  // reported its own failing steps through integration_health and the
  // attention board, so re-running the whole job would add noise, not news.
  return { run: false, reason: `already ran today (${lastRun.status})` };
}

/**
 * Calendar date and hour at an instant, in an IANA timezone.
 *
 * Uses Intl rather than manual offset arithmetic so daylight saving is the
 * platform's problem: Boise is UTC-6 in August and UTC-7 in January, and the
 * job must fire at 6am local on both days.
 */
export function localDateAndHour(at: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}
