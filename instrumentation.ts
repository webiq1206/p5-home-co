/**
 * Server startup hook.
 *
 * Runs the five-minute watchdog in-process. On a Reserved VM the server is
 * always on and single-instance, so an internal timer is simpler and more
 * reliable than an external cron: nothing to authenticate, no public endpoint
 * to secure, and no scheduler that can quietly stop calling.
 *
 * The HTTP endpoint at /api/jobs/watchdog stays, because an external scheduler
 * is still the right answer on a host that scales to zero, and because being
 * able to trigger a pass by hand is worth keeping. Both paths take the same
 * job lock, so running both is harmless rather than double-processing.
 */

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export async function register(): Promise<void> {
  // Only in the Node.js server runtime. The edge runtime has no database, and
  // this must never run during a build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Off in development unless asked for, so `npm run dev` does not quietly
  // mutate SLA state while someone is reading the code.
  const wanted =
    process.env.WATCHDOG_IN_PROCESS === "true" ||
    (process.env.NODE_ENV === "production" && process.env.WATCHDOG_IN_PROCESS !== "false");
  if (!wanted) return;

  if (!process.env.DATABASE_URL) {
    console.warn("[watchdog] not starting: DATABASE_URL is not set.");
    return;
  }

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
