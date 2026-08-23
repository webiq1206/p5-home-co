/**
 * Finance job orchestration (S143, S155, S176).
 *
 * One entry point the scheduler calls daily (and admins can trigger manually):
 *   1. Sync QBO into the read model - when connected.
 *   2. Run the attention scan so exceptions surface themselves.
 *   3. Assemble the Money Run: preliminary Wednesdays, final Fridays (S143);
 *      any other day computes without persisting a formal run.
 *   4. Store the daily trend snapshot (S195).
 *
 * Each step reports individually; one failing step must not silently take the
 * others down (S176: every important failure is visible).
 */

import { query } from "../db.ts";
import { runAttentionScan } from "./attention.ts";
import { buildMoneyRun, persistMoneyRun } from "./money-run.ts";
import { isQboConnected } from "./qbo/oauth.ts";
import { runQboSync } from "./qbo/sync.ts";
import { processPendingWebhookEvents } from "./qbo/webhook.ts";
import { loadFinanceSettings } from "./settings.ts";

export type FinanceJobSummary = {
  status: "succeeded" | "partial" | "failed";
  steps: { name: string; ok: boolean; detail: string }[];
};

export async function runFinanceDaily(
  trigger: "manual" | "daily" = "daily",
): Promise<FinanceJobSummary> {
  const steps: FinanceJobSummary["steps"] = [];
  const settings = await loadFinanceSettings();
  const today = new Date();

  // 1. QBO sync. Not being connected is a state to report, not an error.
  try {
    if (await isQboConnected()) {
      const sync = await runQboSync(trigger);
      steps.push({
        name: "qbo_sync",
        ok: sync.status === "succeeded",
        detail:
          sync.status === "succeeded"
            ? `Synced ${Object.entries(sync.counts).map(([k, v]) => `${k}:${v}`).join(", ")}`
            : sync.error ?? "Sync failed.",
      });
    } else {
      steps.push({ name: "qbo_sync", ok: true, detail: "QuickBooks not connected; skipped." });
    }
  } catch (error) {
    steps.push({ name: "qbo_sync", ok: false, detail: (error as Error).message });
  }

  // 1b. Webhook backlog: the scheduled reconciliation fallback (S155). Any
  // event the post-response pass missed gets processed here.
  try {
    if (await isQboConnected()) {
      const wh = await processPendingWebhookEvents();
      steps.push({
        name: "webhook_backlog",
        ok: wh.failed === 0,
        detail:
          wh.processed === 0 && wh.failed === 0
            ? "No pending webhook events."
            : `Processed ${wh.processed}, failed ${wh.failed}.`,
      });
    }
  } catch (error) {
    steps.push({ name: "webhook_backlog", ok: false, detail: (error as Error).message });
  }

  // 2. Attention scan.
  try {
    const open = await runAttentionScan(settings);
    steps.push({ name: "attention_scan", ok: true, detail: `${open} open item(s).` });
  } catch (error) {
    steps.push({ name: "attention_scan", ok: false, detail: (error as Error).message });
  }

  // 3. Money run cadence (S143): Wed=preliminary, Fri=final.
  try {
    const run = await buildMoneyRun(settings, today);
    const dow = today.getDay(); // 0 Sun ... 3 Wed ... 5 Fri
    if (dow === 3) {
      await persistMoneyRun(run, "preliminary", null);
      steps.push({ name: "money_run", ok: true, detail: "Preliminary run persisted." });
    } else if (dow === 5) {
      await persistMoneyRun(run, "final", null);
      steps.push({ name: "money_run", ok: true, detail: "Final run persisted." });
    } else {
      steps.push({ name: "money_run", ok: true, detail: "Computed; no scheduled persist today." });
    }

    // 4. Daily trend snapshot (S195) - reporting history only.
    await query(
      `INSERT INTO finance_snapshot (covers_date, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (covers_date) DO UPDATE SET payload = EXCLUDED.payload`,
      [
        run.coversDate,
        JSON.stringify({
          cash: run.cash,
          inflows: run.inflows,
          requiredTotal: run.required.total,
          safeCash: run.safeCash.safeCashAvailable,
        }),
      ],
    );
    steps.push({ name: "snapshot", ok: true, detail: "Daily snapshot stored." });
  } catch (error) {
    steps.push({ name: "money_run", ok: false, detail: (error as Error).message });
  }

  const failed = steps.filter((s) => !s.ok).length;
  return {
    status: failed === 0 ? "succeeded" : failed === steps.length ? "failed" : "partial",
    steps,
  };
}
