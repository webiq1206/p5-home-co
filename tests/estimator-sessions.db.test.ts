/**
 * Partial-completion tracking against a real Postgres.
 *
 * Runs only when TEST_DATABASE_URL points at a throwaway database that has an
 * `app_user` table with at least one active manager or administrator (the
 * recipients). It exercises the claim, retry, completion and callback rules
 * that the pure tests cannot: no partial staff email while the kill switch
 * is off (one summary per session when it is on), no email after completion,
 * and a callback sent once.
 *
 *   createdb p5_recovery_test
 *   TEST_DATABASE_URL=postgres://localhost/p5_recovery_test npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

test("abandonment sweep over Postgres", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const db = await import("../app/lib/db.ts");
  const svc = await import("../app/lib/leads/estimatorSessions.ts");
  await db.query("DROP TABLE IF EXISTS estimator_sessions");
  const sent: Array<{ to: string; subject: string; text: string }> = [];
  let failNext = 0;
  svc.installEstimatorSessionsSender(async (to, message) => {
    if (failNext > 0) { failNext -= 1; throw new Error("simulated outage"); }
    sent.push({ to, subject: message.subject, text: message.text });
  });

  const t0 = new Date("2026-09-08T10:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const idle = svc.INACTIVITY_MS + 5 * 60_000;
  const A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const B = "aaaaaaaa-0000-4000-8000-00000000000b";
  const C = "aaaaaaaa-0000-4000-8000-00000000000c";
  const D = "aaaaaaaa-0000-4000-8000-00000000000d";

  // Not engaged: never emails.
  await svc.recordProgress({ sessionId: A, flow: "quote", currentStep: "form", currentStepIndex: 0, totalSteps: 2, startedAt: t0.getTime() }, t0);
  let r = await svc.sweepAbandonedSessions({ now: at(idle) });
  assert.equal(r.sent, 0);

  // Engaged and idle. Partial staff mail is off, so the row stays active and
  // nothing with a [Partial] subject is sent. Sensitive fields stay out of
  // storage either way. Turning the kill switch on restores one summary.
  await svc.recordProgress({ sessionId: B, flow: "quote", currentStep: "filling", currentStepIndex: 1, totalSteps: 2, lastCompletedStep: "form", startedAt: t0.getTime(), pagePath: "/quote/adu?gclid=secret", selections: { project: "adu", email: "leak@example.com", fields_filled: 2 }, validationErrors: ["phone"] }, at(60_000));
  r = await svc.sweepAbandonedSessions({ now: at(idle) });
  let row = await db.queryOne<{ status: string; selections: { email?: string }; page_path: string }>("SELECT status, selections, page_path FROM estimator_sessions WHERE id = $1", [B]);
  assert.equal(row?.selections.email, undefined);
  assert.equal(row?.page_path, "/quote/adu");
  if (svc.PARTIAL_COMPLETION_EMAILS_ENABLED) {
    assert.equal(r.partialEmails, "enabled");
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "manager@example.test");
    assert.match(sent[0].subject, /^\[Partial\] Anonymous/);
    assert.doesNotMatch(sent[0].text, /leak@example\.com|gclid/);
    assert.match(sent[0].text, /Page: .*\/quote\/adu$/m);
    r = await svc.sweepAbandonedSessions({ now: at(idle + 600_000) });
    assert.equal(r.sent, 0, "one summary per session");
    await svc.recordProgress({ sessionId: B, flow: "quote", currentStep: "submitted", currentStepIndex: 2, totalSteps: 2, status: "completed" }, at(idle + 700_000));
    row = await db.queryOne<{ status: string }>("SELECT status FROM estimator_sessions WHERE id = $1", [B]);
    assert.equal(row?.status, "recovered");
  } else {
    assert.equal(r.partialEmails, "disabled");
    assert.equal(r.sent, 0);
    assert.equal(r.failed, 0);
    assert.equal(sent.length, 0);
    assert.equal(row?.status, "active");
    r = await svc.sweepAbandonedSessions({ now: at(idle + 600_000) });
    assert.equal(r.sent, 0);
    await svc.recordProgress({ sessionId: B, flow: "quote", currentStep: "submitted", currentStepIndex: 2, totalSteps: 2, status: "completed" }, at(idle + 700_000));
    row = await db.queryOne<{ status: string }>("SELECT status FROM estimator_sessions WHERE id = $1", [B]);
    assert.equal(row?.status, "completed");
  }

  // Completed before the sweep: never emailed, and a late beacon cannot downgrade it.
  await svc.recordProgress({ sessionId: C, flow: "quote", currentStep: "filling", currentStepIndex: 1, totalSteps: 2, startedAt: t0.getTime() }, at(30_000));
  await svc.recordProgress({ sessionId: C, flow: "quote", currentStep: "submitted", currentStepIndex: 2, totalSteps: 2, status: "completed" }, at(40_000));
  await svc.recordProgress({ sessionId: C, flow: "quote", currentStep: "filling", currentStepIndex: 1, totalSteps: 2 }, at(50_000));
  r = await svc.sweepAbandonedSessions({ now: at(idle + 900_000) });
  assert.equal(r.sent, 0);
  row = await db.queryOne<{ status: string }>("SELECT status FROM estimator_sessions WHERE id = $1", [C]);
  assert.equal(row?.status, "completed");

  // Callback: one email, a retry does not send twice, the sweep skips it.
  // Partial mail, when enabled, is the only earlier message in `sent`.
  const beforeCallback = sent.length;
  await svc.recordProgress({ sessionId: D, flow: "quote", currentStep: "filling", currentStepIndex: 1, totalSteps: 2, startedAt: t0.getTime() }, at(20_000));
  let cb = await svc.recordCallbackRequest({ sessionId: D, flow: "quote", phone: "(208) 555-0100", name: "Test Caller" }, at(25_000));
  assert.equal(cb.notified, true);
  assert.equal(sent.length, beforeCallback + 1);
  assert.match(sent[beforeCallback].subject, /^Callback requested: Test Caller, \(208\) 555-0100/);
  cb = await svc.recordCallbackRequest({ sessionId: D, flow: "quote", phone: "2085550100" }, at(26_000));
  assert.equal(cb.notified, false);
  assert.equal(sent.length, beforeCallback + 1);
  r = await svc.sweepAbandonedSessions({ now: at(idle + 2_000_000) });
  assert.equal(r.sent, 0);

  // Outage retry applies only while partial mail is enabled. While it is off,
  // a sender failure cannot create a [Partial] attempt.
  const E = "aaaaaaaa-0000-4000-8000-00000000000e";
  await svc.recordProgress({ sessionId: E, flow: "quote", currentStep: "filling", currentStepIndex: 1, totalSteps: 2, startedAt: t0.getTime() }, at(40_000));
  failNext = 1;
  const beforeOutage = sent.length;
  r = await svc.sweepAbandonedSessions({ now: at(idle + 3_000_000) });
  row = await db.queryOne<{ status: string; notify_last_error?: string | null }>("SELECT status, notify_last_error FROM estimator_sessions WHERE id = $1", [E]);
  if (svc.PARTIAL_COMPLETION_EMAILS_ENABLED) {
    assert.equal(r.failed, 1);
    assert.equal(row?.status, "active");
    assert.match(row?.notify_last_error ?? "", /simulated outage/);
    r = await svc.sweepAbandonedSessions({ now: at(idle + 3_100_000) });
    assert.equal(r.sent, 1);
  } else {
    assert.equal(r.failed, 0);
    assert.equal(r.sent, 0);
    assert.equal(sent.length, beforeOutage);
    assert.equal(row?.status, "active");
    assert.equal(row?.notify_last_error ?? null, null);
  }

  svc.installEstimatorSessionsSender(null);
  await db.query("DROP TABLE IF EXISTS estimator_sessions");
});
