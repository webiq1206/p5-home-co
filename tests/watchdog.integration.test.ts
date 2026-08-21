/**
 * Integration tests for the five-minute watchdog.
 *
 * The properties that matter are idempotency and silence: a second pass over
 * unchanged data must raise nothing new, and a resolved condition must close
 * its alert. Skipped unless TEST_DATABASE_URL is set.
 */

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("watchdog", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let runWatchdog: typeof import("../app/lib/leads/watchdog.ts").runWatchdog;
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  let fromZonedParts: typeof import("../app/lib/leads/time.ts").fromZonedParts;

  const TZ = "America/Boise";
  /** Friday 2026-08-21 10:00 Boise. */
  let received: Date;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ runWatchdog } = await import("../app/lib/leads/watchdog.ts"));
    ({ query, getPool } = await import("../app/lib/db.ts"));
    ({ fromZonedParts } = await import("../app/lib/leads/time.ts"));
    received = fromZonedParts({ year: 2026, month: 8, day: 21, hour: 10 }, TZ);
  });

  after(async () => {
    await getPool().end();
  });

  beforeEach(async () => {
    await query("TRUNCATE deal, contact, activity, task, alert, audit_log, app_user, job_run, job_lock RESTART IDENTITY CASCADE");
    await query("INSERT INTO app_user (email, full_name, role) VALUES ('c@p5homeco.com','Coord','lead_coordinator')");
    await query(
      "INSERT INTO contact (identity_key, first_name, last_name, email) VALUES ('email:a@example.com','A','Person','a@example.com')",
    );
    await query(
      `INSERT INTO deal (contact_id, name, brand, lead_source, stage, owner_user_id,
                         received_at, sla_deadline, next_action, next_action_at)
       VALUES (1,'Person | Boise Remodeling Co','Boise Remodeling Co','Organic Website','New Lead',1,
               $1::timestamptz, $1::timestamptz + interval '5 minutes',
               'Make first contact', $1::timestamptz + interval '5 minutes')`,
      [received],
    );
  });

  /** 31 business minutes after arrival: past the Critical threshold. */
  const at31 = () => new Date(received.getTime() + 31 * 60_000);

  test("an unanswered lead past its deadline raises exactly one SLA alert", async () => {
    const summary = await runWatchdog(at31());
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.dealsProcessed, 1);

    const alerts = await query<{ kind: string; tier: string }>(
      "SELECT kind, tier FROM alert WHERE resolved_at IS NULL",
    );
    const sla = alerts.filter((a) => a.kind === "sla_breach");
    assert.equal(sla.length, 1);
    assert.equal(sla[0].tier, "critical");
  });

  test("running the watchdog again over unchanged data raises nothing new", async () => {
    await runWatchdog(at31());
    const first = await query<{ n: number }>("SELECT count(*)::int AS n FROM alert");

    const second = await runWatchdog(at31());
    assert.equal(second.alertsRaised, 0, "a repeat pass must raise no alerts");
    assert.equal(second.slaUpdates, 0, "a repeat pass must change no SLA state");

    const after = await query<{ n: number }>("SELECT count(*)::int AS n FROM alert");
    assert.equal(after[0].n, first[0].n, "alert count must not grow");
  });

  test("escalating to a higher tier resolves the lower tier, leaving one live severity", async () => {
    // 6 minutes -> owner tier.
    await runWatchdog(new Date(received.getTime() + 6 * 60_000));
    let open = await query<{ tier: string }>(
      "SELECT tier FROM alert WHERE kind='sla_breach' AND resolved_at IS NULL",
    );
    assert.deepEqual(open.map((o) => o.tier), ["owner"]);

    // 31 minutes -> critical; owner must close.
    await runWatchdog(at31());
    open = await query<{ tier: string }>(
      "SELECT tier FROM alert WHERE kind='sla_breach' AND resolved_at IS NULL",
    );
    assert.deepEqual(open.map((o) => o.tier), ["critical"], "only the current tier stays open");
  });

  test("logging a human contact attempt resolves the SLA alert", async () => {
    await runWatchdog(at31());
    assert.equal(
      (await query<{ n: number }>("SELECT count(*)::int AS n FROM alert WHERE kind='sla_breach' AND resolved_at IS NULL"))[0].n,
      1,
    );

    await query("UPDATE deal SET first_attempt_at = $1 WHERE id = 1", [
      new Date(received.getTime() + 32 * 60_000),
    ]);
    await runWatchdog(new Date(received.getTime() + 40 * 60_000));

    const stillOpen = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM alert WHERE kind='sla_breach' AND resolved_at IS NULL",
    );
    assert.equal(stillOpen[0].n, 0, "the alert must resolve once a human responded");
  });

  test("the job lock stops two overlapping passes both processing", async () => {
    const [a, b] = await Promise.all([runWatchdog(at31()), runWatchdog(at31())]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ["skipped_locked", "succeeded"], `got ${statuses.join(",")}`);
  });

  test("a completed pass releases the lock so the next tick runs", async () => {
    await runWatchdog(at31());
    const held = await query<{ n: number }>("SELECT count(*)::int AS n FROM job_lock");
    assert.equal(held[0].n, 0, "lock must be released");
    const next = await runWatchdog(at31());
    assert.equal(next.status, "succeeded");
  });

  test("each pass records what it actually processed, not merely that it ran", async () => {
    await runWatchdog(at31());
    const runs = await query<Record<string, unknown>>(
      "SELECT status, records_processed, alerts_raised FROM job_run ORDER BY id DESC LIMIT 1",
    );
    assert.equal(runs[0].status, "succeeded");
    assert.equal(runs[0].records_processed, 1);
    assert.ok(Number(runs[0].alerts_raised) >= 1);
  });

  test("an SLA state change is written to the audit log", async () => {
    await runWatchdog(at31());
    const rows = await query<{ action: string }>(
      "SELECT action FROM audit_log WHERE record_type='deal' AND action='sla_state_changed'",
    );
    assert.ok(rows.length >= 1);
  });

  test("watchdog health is reported as connected after a good pass", async () => {
    await runWatchdog(at31());
    const rows = await query<{ state: string; last_error: string | null }>(
      "SELECT state, last_error FROM integration_health WHERE name='watchdog'",
    );
    assert.equal(rows[0].state, "connected");
    assert.equal(rows[0].last_error, null);
  });

  test("the deferred integrations never raise an alert", async () => {
    await runWatchdog(at31());
    const rows = await query<{ kind: string }>("SELECT kind FROM alert");
    const offenders = rows.filter((r) => /handoff|quickbooks/i.test(r.kind));
    assert.deepEqual(offenders, [], "Handoff and QuickBooks must stay silent while disabled");
  });

  test("HubSpot sync is a silent no-op while the feature flag is off", async () => {
    // No HUBSPOT_TOKEN is set in tests and hubspotIntegrationEnabled defaults
    // to false. The watchdog must complete normally and report zero, rather
    // than erroring or quietly claiming a sync happened.
    const summary = await runWatchdog(at31());
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.hubspotSynced, 0);
    assert.equal(summary.hubspotFailed, 0);

    // Nothing should have been marked synced, and no failure recorded.
    const deals = await query<{ integration_sync_status: string; last_integration_error: string | null }>(
      "SELECT integration_sync_status, last_integration_error FROM deal",
    );
    for (const d of deals) {
      assert.equal(d.integration_sync_status, "pending", "stays pending, not falsely synced");
      assert.equal(d.last_integration_error, null, "a disabled integration is not an error");
    }

    const health = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM integration_health WHERE name = 'hubspot'",
    );
    assert.equal(health[0].n, 0, "a disabled integration must not report health at all");
  });

  test("a lead still inside its response window raises nothing at all", async () => {
    const summary = await runWatchdog(new Date(received.getTime() + 60_000));
    assert.equal(summary.alertsRaised, 0, "the watchdog stays silent when nothing is wrong");
    const open = await query<{ n: number }>("SELECT count(*)::int AS n FROM alert WHERE resolved_at IS NULL");
    assert.equal(open[0].n, 0);
  });
});
