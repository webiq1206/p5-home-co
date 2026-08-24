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
import { runKbDriftScan } from "../kb/drift.ts";
import { activeTransport } from "../notifications/transport.ts";
import { runAttentionScan } from "./attention.ts";
import { sendDueVendorDocumentReminders } from "./vendor-reminders.ts";
import { runQboAudit } from "./qbo/audit-scan.ts";
import {
  assembleDailyReport,
  diffReports,
  loadPreviousReport,
  persistReport,
} from "./daily-report.ts";
import { renderDailyReport } from "./daily-report-render.ts";
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

  // 2a. Subcontractor document reminders (S89). Runs after the scan so it sees
  // the same document state, and emails the sub directly on the reminder ladder.
  // A send failure is reported, never swallowed.
  try {
    const r = await sendDueVendorDocumentReminders(settings, today);
    steps.push({
      name: "vendor_doc_reminders",
      ok: r.failures.length === 0,
      detail: settings.vendorDocumentReminders.enabled
        ? `${r.sent} emailed, ${r.alreadySent} already current-cycle, ` +
          `${r.skippedNoContact} with no portal contact` +
          (r.failures.length ? `; failed: ${r.failures.join("; ")}` : ".")
        : "Disabled in settings; no reminders sent.",
    });
  } catch (error) {
    steps.push({ name: "vendor_doc_reminders", ok: false, detail: (error as Error).message });
  }

  // 2b. QuickBooks data-quality inspection (S214).
  //
  // Runs after the sync so it judges today's data, and after the attention scan
  // so both feed the same queue before the daily report reads it. Findings land
  // in attention_item, so a setup problem reaches the Today page and the 6am
  // email by the same route as everything else that needs a person.
  try {
    if (await isQboConnected()) {
      const audit = await runQboAudit(settings, "daily");
      steps.push({
        name: "qbo_audit",
        ok: true,
        detail:
          `${audit.counts.total} finding(s): ${audit.counts.critical} critical, ` +
          `${audit.counts.urgent} urgent. ${audit.opened} new, ${audit.resolved} fixed since yesterday.`,
      });
    } else {
      steps.push({ name: "qbo_audit", ok: true, detail: "Skipped: QuickBooks not connected." });
    }
  } catch (error) {
    steps.push({ name: "qbo_audit", ok: false, detail: (error as Error).message });
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

  // 5. Documentation drift: compare live configuration against what the
  // Knowledge Center documents; flag pages and raise attention on mismatch.
  try {
    const drift = await runKbDriftScan(today);
    const drifted = drift.checks.filter((c) => c.status === "drift");
    steps.push({
      name: "kb_drift",
      ok: true,
      detail: drifted.length
        ? `${drifted.length} check(s) drifted: ${drifted.map((c) => c.key).join(", ")}. Pages flagged.`
        : `All checks passed; ${drift.verifiedArticles} article(s) re-verified.`,
    });
  } catch (error) {
    steps.push({ name: "kb_drift", ok: false, detail: (error as Error).message });
  }

  // 6. Daily financial report: assemble, persist, diff against yesterday,
  // and email. Persisting before sending means a send failure never loses
  // the report - it is still in the panel, and the status says what failed.
  try {
    const summary = await runDailyReportStep(today);
    steps.push({ name: "daily_report", ok: summary.ok, detail: summary.detail });
  } catch (error) {
    steps.push({ name: "daily_report", ok: false, detail: (error as Error).message });
  }

  const failed = steps.filter((s) => !s.ok).length;
  return {
    status: failed === 0 ? "succeeded" : failed === steps.length ? "failed" : "partial",
    steps,
  };
}

/**
 * Build, persist, and send the daily report. Exported so the admin panel's
 * "generate and send now" action runs exactly what the scheduler runs.
 */
export async function runDailyReportStep(
  today: Date = new Date(),
): Promise<{ ok: boolean; detail: string }> {
  const settings = await loadFinanceSettings();
  const report = await assembleDailyReport(settings, today);
  const previous = await loadPreviousReport(report.coversDate);
  await persistReport(report, null, null);

  if (!settings.dailyReport.enabled) {
    await persistReport(report, [], "disabled");
    return { ok: true, detail: "Report generated; email disabled in settings." };
  }
  if (!report.qboConnected && !settings.dailyReport.sendWhenNotConnected) {
    await persistReport(report, [], "skipped: QBO not connected");
    return { ok: true, detail: "Report generated; send skipped (QuickBooks not connected)." };
  }
  const recipients = settings.dailyReport.recipients.filter((r) => r.includes("@"));
  if (recipients.length === 0) {
    await persistReport(report, [], "no recipients");
    return { ok: true, detail: "Report generated; no recipients configured." };
  }

  const changes = diffReports(previous, report);
  const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
  const message = renderDailyReport(report, changes, base);

  const transport = activeTransport();
  const failures: string[] = [];
  for (const to of recipients) {
    const result = await transport.send(to, message);
    if (!result.ok) failures.push(`${to}: ${result.error}`);
  }

  const status =
    failures.length === 0
      ? transport.name === "console"
        ? "logged (SMTP not configured)"
        : `sent via ${transport.name}`
      : `failed: ${failures.join("; ")}`;
  await persistReport(report, recipients, status);

  if (failures.length) return { ok: false, detail: `Email failed - ${failures.join("; ")}` };
  return {
    ok: true,
    detail:
      transport.name === "console"
        ? "Report generated and logged; SMTP is not configured, so no email was sent."
        : `Report emailed to ${recipients.join(", ")}.`,
  };
}
