/**
 * Server startup hook.
 *
 * Runs the five-minute watchdog and the daily finance job in-process. On a
 * Reserved VM the server is always on and single-instance, so an internal
 * timer is simpler and more reliable than an external cron: nothing to
 * authenticate, no public endpoint to secure, and no scheduler that can
 * quietly stop calling.
 *
 * The HTTP endpoints at /api/jobs/watchdog and /api/jobs/finance stay, because
 * an external scheduler is still the right answer on a host that scales to
 * zero, and because being able to trigger a pass by hand is worth keeping.
 * Both paths record the same job_run rows, so running both is harmless rather
 * than double-processing.
 */

import {
  decideDailyRun,
  localDateAndHour,
  type FinanceRunStatus,
} from "./app/lib/finance/schedule.ts";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** The daily job checks in often; what stops it running twice is the date. */
const FINANCE_DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const FINANCE_DEFAULT_HOUR = 6;
const FINANCE_DEFAULT_TIMEZONE = "America/Boise";
const FINANCE_DEFAULT_RETRY_MINUTES = 60;
const FINANCE_JOB_NAME = "finance_daily";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  // Deliberately not `Number(raw) || fallback`: hour 0 is a valid midnight.
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Shared preconditions: real server runtime, not a build, database present. */
function schedulingIsPossible(label: string): boolean {
  if (process.env.NEXT_RUNTIME !== "nodejs") return false;
  if (process.env.NEXT_PHASE === "phase-production-build") return false;
  if (!process.env.DATABASE_URL) {
    console.warn(`[${label}] not starting: DATABASE_URL is not set.`);
    return false;
  }
  return true;
}

export async function register(): Promise<void> {
  await startWatchdog();
  await startFinanceDaily();
}

async function startWatchdog(): Promise<void> {
  if (!schedulingIsPossible("watchdog")) return;

  // Off in development unless asked for, so `npm run dev` does not quietly
  // mutate SLA state while someone is reading the code.
  const wanted =
    process.env.WATCHDOG_IN_PROCESS === "true" ||
    (process.env.NODE_ENV === "production" && process.env.WATCHDOG_IN_PROCESS !== "false");
  if (!wanted) return;

  const intervalMs = Number(process.env.WATCHDOG_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const { runWatchdog } = await import("./app/lib/leads/watchdog.ts");

  let running = false;
  const tick = async (): Promise<void> => {
    // Belt and braces alongside the database lock: a pass that overruns the
    // interval should not have a second one stacked on top of it in the same
    // process.
    if (running) return;
    running = true;
    try {
      const summary = await runWatchdog();
      // Silence is the normal case, so only speak when something happened.
      if (
        summary.status === "failed" ||
        summary.alertsRaised > 0 ||
        summary.alertsResolved > 0 ||
        summary.hubspotSynced > 0 ||
        summary.hubspotFailed > 0 ||
        summary.notificationsSent > 0 ||
        summary.notificationsFailed > 0
      ) {
        console.log("[watchdog]", JSON.stringify(summary));
      }
    } catch (error) {
      // Never let a bad pass kill the timer; the next one may well succeed.
      console.error("[watchdog] pass threw:", (error as Error).message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Do not hold the process open on shutdown.
  if (typeof timer.unref === "function") timer.unref();

  // A short delay on the first pass, so startup is not competing with it.
  setTimeout(tick, 15_000).unref?.();

  console.log(`[watchdog] scheduled every ${Math.round(intervalMs / 1000)}s (in-process).`);
}

/**
 * The daily finance pass (S143): QBO sync, attention scan, Money Run,
 * snapshot, daily report.
 *
 * The timer ticks every quarter hour and almost always decides to do nothing.
 * That is the point: the schedule lives in the database (did today's pass
 * run?) rather than in this process's uptime, so a restart at any hour picks
 * the job up correctly instead of missing or repeating it.
 */
async function startFinanceDaily(): Promise<void> {
  if (!schedulingIsPossible("finance-daily")) return;

  const wanted =
    process.env.FINANCE_JOB_IN_PROCESS === "true" ||
    (process.env.NODE_ENV === "production" && process.env.FINANCE_JOB_IN_PROCESS !== "false");
  if (!wanted) return;

  const intervalMs = intFromEnv("FINANCE_JOB_INTERVAL_MS", FINANCE_DEFAULT_INTERVAL_MS);
  const retryAfterMinutes = intFromEnv("FINANCE_JOB_RETRY_MINUTES", FINANCE_DEFAULT_RETRY_MINUTES);

  const hour = intFromEnv("FINANCE_JOB_HOUR", FINANCE_DEFAULT_HOUR);
  const runAtHour = Math.min(23, Math.max(0, Math.trunc(hour)));

  // Validate the timezone once, here, rather than letting every tick throw.
  let timeZone = process.env.FINANCE_JOB_TIMEZONE?.trim() || FINANCE_DEFAULT_TIMEZONE;
  try {
    localDateAndHour(new Date(), timeZone);
  } catch {
    console.warn(
      `[finance-daily] unknown timezone "${timeZone}"; falling back to ${FINANCE_DEFAULT_TIMEZONE}.`,
    );
    timeZone = FINANCE_DEFAULT_TIMEZONE;
  }

  const { query } = await import("./app/lib/db.ts");
  const { runFinanceDaily } = await import("./app/lib/finance/jobs.ts");

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const here = localDateAndHour(new Date(), timeZone);

      const rows = await query<{
        status: string;
        started_at: string;
        minutes_ago: string;
      }>(
        `SELECT status, started_at, EXTRACT(EPOCH FROM (now() - started_at)) / 60 AS minutes_ago
           FROM job_run
          WHERE job_name = $1
          ORDER BY started_at DESC
          LIMIT 1`,
        [FINANCE_JOB_NAME],
      );

      const previous = rows[0];
      const decision = decideDailyRun({
        nowLocalDate: here.date,
        nowLocalHour: here.hour,
        runAtHour,
        retryAfterMinutes,
        lastRun: previous
          ? {
              localDate: localDateAndHour(new Date(previous.started_at), timeZone).date,
              status: previous.status as FinanceRunStatus,
              minutesAgo: Number(previous.minutes_ago),
            }
          : null,
      });

      if (!decision.run) return;

      console.log(`[finance-daily] starting: ${decision.reason}`);
      const started = await query<{ id: string }>(
        "INSERT INTO job_run (job_name) VALUES ($1) RETURNING id",
        [FINANCE_JOB_NAME],
      );
      const jobRunId = Number(started[0].id);

      try {
        const summary = await runFinanceDaily("daily");
        const failedSteps = summary.steps.filter((step) => !step.ok);
        await query(
          `UPDATE job_run
              SET finished_at = now(), status = $2, records_processed = $3, error = $4
            WHERE id = $1`,
          [
            jobRunId,
            summary.status,
            summary.steps.length,
            failedSteps.length
              ? failedSteps.map((step) => `${step.name}: ${step.detail}`).join("; ")
              : null,
          ],
        );
        console.log("[finance-daily]", JSON.stringify(summary));
      } catch (error) {
        // The pass itself blew up. Record that against the row we opened, so
        // a failure is never invisible and tomorrow's decision can see it.
        const message = (error as Error).message;
        await query(
          "UPDATE job_run SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1",
          [jobRunId, message],
        ).catch(() => undefined);
        console.error("[finance-daily] pass threw:", message);
      }
    } catch (error) {
      // A failed tick (database down, say) must not kill the timer.
      console.error("[finance-daily] scheduler tick failed:", (error as Error).message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  // Later than the watchdog's first pass: startup should settle first, and the
  // daily job is never in a hurry.
  setTimeout(tick, 60_000).unref?.();

  console.log(
    `[finance-daily] due at ${String(runAtHour).padStart(2, "0")}:00 ${timeZone}; ` +
      `checking every ${Math.round(intervalMs / 60_000)}m (in-process).`,
  );
}
