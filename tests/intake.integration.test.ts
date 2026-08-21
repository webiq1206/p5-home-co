/**
 * Integration tests for lead intake, run against a real PostgreSQL database.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `npm test` stays fast and
 * dependency-free for everyone else.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("lead intake", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let ingestLead: typeof import("../app/lib/leads/intake.ts").ingestLead;
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  let DEFAULT_SETTINGS: typeof import("../app/lib/leads/settings.ts").DEFAULT_SETTINGS;
  let fromZonedParts: typeof import("../app/lib/leads/time.ts").fromZonedParts;

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    ({ ingestLead } = await import("../app/lib/leads/intake.ts"));
    ({ query, getPool } = await import("../app/lib/db.ts"));
    ({ DEFAULT_SETTINGS } = await import("../app/lib/leads/settings.ts"));
    ({ fromZonedParts } = await import("../app/lib/leads/time.ts"));

    await query("TRUNCATE deal, contact, activity, task, alert, audit_log, app_user RESTART IDENTITY CASCADE");
    await query(
      `INSERT INTO app_user (email, full_name, role) VALUES
         ('coord@p5homeco.com','Coordinator One','lead_coordinator'),
         ('mgr@p5homeco.com','Manager Two','manager')`,
    );
  });

  after(async () => {
    await getPool().end();
  });

  function lead(overrides: Record<string, unknown> = {}) {
    const tz = DEFAULT_SETTINGS.calendar.timeZone;
    return {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "(208) 555-0142",
      brand: "Boise Remodeling Co" as const,
      projectType: "Kitchen remodel",
      source: "Organic Website" as const,
      sourceDetail: null,
      propertyAddress: "123 N Main St",
      propertyCity: "Boise",
      summary: "Wants a kitchen refresh.",
      externalLeadId: null,
      originalForm: "matcher",
      originalCampaign: null,
      utm: { utm_source: "google" },
      // Friday 2026-08-21, 10:00 Boise: inside business hours.
      receivedAt: fromZonedParts({ year: 2026, month: 8, day: 21, hour: 10 }, tz),
      ...overrides,
    };
  }

  test("a website lead creates a contact, deal, first task, and audit entry", async () => {
    const result = await ingestLead(lead(), DEFAULT_SETTINGS);
    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const deal = await query<Record<string, unknown>>(
      "SELECT * FROM deal WHERE id = $1",
      [result.dealId],
    );
    assert.equal(deal.length, 1);
    assert.equal(deal[0].brand, "Boise Remodeling Co");
    assert.equal(deal[0].stage, "New Lead");
    assert.equal(deal[0].name, "Doe | Boise Remodeling Co | Kitchen remodel | Boise");
    assert.equal(deal[0].sla_status, "on_track");

    // Assigned to the coordinator, not left to nobody.
    assert.equal(Number(deal[0].owner_user_id), 1);

    // SLA deadline is five business minutes after arrival.
    const received = new Date(deal[0].received_at as string);
    const sla = new Date(deal[0].sla_deadline as string);
    assert.equal((sla.getTime() - received.getTime()) / 60000, 5);

    const tasks = await query("SELECT * FROM task WHERE deal_id = $1", [result.dealId]);
    assert.equal(tasks.length, 1, "exactly one first-contact task");
    assert.equal(tasks[0].rule_key, "first_contact");

    const audits = await query(
      "SELECT * FROM audit_log WHERE record_type='deal' AND record_id=$1",
      [String(result.dealId)],
    );
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "lead_created");

    // The form submission is on the timeline but is NOT a human attempt, so it
    // must not have stopped the response clock.
    const acts = await query("SELECT * FROM activity WHERE deal_id=$1", [result.dealId]);
    assert.equal(acts.length, 1);
    assert.equal(acts[0].is_human_attempt, false);
  });

  test("resubmitting the identical form does not create a second deal", async () => {
    const before = await query("SELECT count(*)::int AS n FROM deal");
    const result = await ingestLead(lead(), DEFAULT_SETTINGS);
    assert.equal(result.status, "duplicate");
    const after = await query("SELECT count(*)::int AS n FROM deal");
    assert.equal(after[0].n, before[0].n, "deal count must not change");
  });

  test("the same person with a different brand is a separate, legitimate deal", async () => {
    const result = await ingestLead(
      lead({ brand: "Boise Cabinet Co", projectType: "Kitchen cabinets" }),
      DEFAULT_SETTINGS,
    );
    assert.equal(result.status, "created");
    const contacts = await query("SELECT count(*)::int AS n FROM contact");
    assert.equal(contacts[0].n, 1, "still one person");
  });

  test("a Facebook lead is idempotent on its external lead id", async () => {
    const fb = lead({
      email: "bob@example.com",
      phone: null,
      brand: "Boise Handyman Co",
      source: "Facebook Lead Ad",
      externalLeadId: "fb_lead_777",
      projectType: "Deck or exterior repair",
    });
    const first = await ingestLead(fb, DEFAULT_SETTINGS);
    assert.equal(first.status, "created");

    // Same webhook delivered twice.
    const second = await ingestLead(fb, DEFAULT_SETTINGS);
    assert.equal(second.status, "duplicate");
    if (second.status === "duplicate" && first.status === "created") {
      assert.equal(second.dealId, first.dealId);
    }

    const rows = await query("SELECT count(*)::int AS n FROM deal WHERE external_lead_id=$1", ["fb_lead_777"]);
    assert.equal(rows[0].n, 1);
  });

  test("a lead with no email and no phone is rejected, not stored unreachable", async () => {
    const result = await ingestLead(
      lead({ email: null, phone: null, externalLeadId: "no_contact_1" }),
      DEFAULT_SETTINGS,
    );
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") {
      assert.ok(result.errors.some((e) => e.field === "contact"));
    }
  });

  test("an after-hours lead is stored as after_hours and due at the next opening", async () => {
    const tz = DEFAULT_SETTINGS.calendar.timeZone;
    // Sunday 2026-08-23, 2pm: closed.
    const sunday = fromZonedParts({ year: 2026, month: 8, day: 23, hour: 14 }, tz);
    const result = await ingestLead(
      lead({ email: "sun@example.com", phone: null, receivedAt: sunday, brand: "Boise ADU Co", projectType: "Detached ADU" }),
      DEFAULT_SETTINGS,
    );
    assert.equal(result.status, "created");
    if (result.status !== "created") return;

    const rows = await query<Record<string, unknown>>("SELECT * FROM deal WHERE id=$1", [result.dealId]);
    assert.equal(rows[0].sla_status, "after_hours");

    // Monday 7:05am Boise.
    const expected = fromZonedParts({ year: 2026, month: 8, day: 24, hour: 7, minute: 5 }, tz);
    assert.equal(new Date(rows[0].sla_deadline as string).toISOString(), expected.toISOString());
  });

  test("intake spreads leads across owners by open-deal load", async () => {
    const owners = await query<{ owner_user_id: string | null }>(
      "SELECT owner_user_id FROM deal WHERE stage NOT IN ('Closed Won','Closed Lost')",
    );
    const assigned = owners.filter((o) => o.owner_user_id !== null);
    assert.equal(assigned.length, owners.length, "every open deal has an owner");
    const distinct = new Set(assigned.map((o) => o.owner_user_id));
    assert.ok(distinct.size >= 2, `expected load spread across owners, saw ${distinct.size}`);
  });

  test("a closed deal does not block a genuine new project later", async () => {
    await query("UPDATE deal SET stage='Closed Won', closed_at=now() WHERE dedup_key IS NOT NULL AND brand='Boise Remodeling Co'");
    const result = await ingestLead(lead({ summary: "Second project, same house." }), DEFAULT_SETTINGS);
    assert.equal(result.status, "created", "a new project must be allowed once the old one is closed");
  });
});
