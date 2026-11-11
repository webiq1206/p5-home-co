/** Subscription upkeep shares the existing watchdog; no second scheduler. */
import { query } from "../db.ts";
import { randomUUID } from "node:crypto";
import { discoverMetaPages, MetaAdminError } from "./meta-admin.ts";
import { loadMetaMappings } from "./meta-settings.ts";

const BOOT_ID = randomUUID();
export function metaAutomationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build" &&
    Boolean(env.META_PAGE_ACCESS_TOKEN?.trim()) && /^\d+$/.test(env.META_APP_ID ?? "");
}
export async function maintainMetaSubscriptions(reason: "boot" | "nightly" = "nightly"): Promise<void> {
  if (!metaAutomationEnabled()) return;
  // Once per process boot, plus the first watchdog pass in the UTC midnight
  // hour. No extra timer or public maintenance endpoint. Failed nightly runs
  // can retry after one hour, including outside the midnight hour.
  const now = new Date();
  const key = reason === "boot" ? `meta-subscribe:boot:${BOOT_ID}` : `meta-subscribe:${now.toISOString().slice(0, 10)}`;
  if (reason === "nightly" && now.getUTCHours() !== 0) {
    const failed = await query<{ retry: boolean }>(
      "SELECT state <> 'succeeded' AND started_at < now() - interval '1 hour' AS retry FROM meta_subscription_run WHERE run_key=$1", [key],
    );
    if (!failed[0]?.retry) return;
  }
  const claim = await query<{ run_key: string }>(
    `INSERT INTO meta_subscription_run (run_key) VALUES ($1)
     ON CONFLICT (run_key) DO UPDATE SET state='running',started_at=now(),finished_at=NULL
     WHERE meta_subscription_run.state <> 'succeeded'
       AND meta_subscription_run.started_at < now() - interval '1 hour'
     RETURNING run_key`, [key],
  );
  if (!claim.length) return;
  try {
    const pages = await discoverMetaPages(await loadMetaMappings(), process.env, fetch, true);
    const count = pages.filter(p => p.subscribed && !p.error).length;
    const ok = pages.length > 0 && count === pages.length;
    await query(
      `UPDATE meta_subscription_run SET state=$2,finished_at=now(),pages_checked=$3,pages_subscribed=$4,last_category=$5 WHERE run_key=$1`,
      [key, ok ? "succeeded" : "failed", pages.length, count, ok ? null : "Some Pages were unavailable or unverified"],
    );
  } catch (error) {
    await query(`UPDATE meta_subscription_run SET state='failed',finished_at=now(),last_category=$2 WHERE run_key=$1`,
      [key, error instanceof MetaAdminError ? error.category : "Subscription maintenance unavailable"]);
  }
}
