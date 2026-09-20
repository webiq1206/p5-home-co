import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * This is an opt-in check against the development database. It deliberately
 * uses one random, synthetic draft and never reads or changes customer data.
 *
 * Run with:
 *   P5_DATABASE_REGRESSION=1 node --import tsx scripts/test-p5-database-regression.mts
 */
if (process.env.P5_DATABASE_REGRESSION !== "1") {
  console.log("SKIP: set P5_DATABASE_REGRESSION=1 to run the development database regression.");
  process.exit(0);
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run the synthetic database regression with NODE_ENV=production.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the opt-in development database regression.");
}

const { query } = await import("../lib/p5/database.ts");
const { saveDraft } = await import("../lib/p5/store.ts");
const { claimWork, writeWork, releaseWork } = await import("../lib/p5/workStore.ts");

const draftId = randomUUID();
const draftKey = randomBytes(32).toString("hex");
const keyHash = createHash("sha256").update(draftKey).digest("hex");
const brand = "synthetic-driver-regression";
const workKey = `driver-regression:${randomUUID()}`;
const initialCheckpoint = {
  prepared: 1,
  units: [{ name: "synthetic-section", attempts: 1 }],
  notes: ["synthetic checkpoint"],
};

const payload = {
  text: "Synthetic driver regression draft",
  answers: {},
  extraction: null,
  reviewed: null,
  contact: { name: "", email: "", phone: "" },
};

let schemaAvailable = false;
try {
  // The tables are provisioned by the application. Do not run migrations or
  // create/drop anything here: this check must be safe for a development DB.
  const [tables] = await query(
    `SELECT to_regclass('public.p5_estimator_drafts') AS drafts,
            to_regclass('public.p5_estimator_work') AS work`,
  );
  assert.ok(tables?.drafts, "p5_estimator_drafts is not available");
  assert.ok(tables?.work, "p5_estimator_work is not available");
  schemaAvailable = true;

  const [scalars] = await query(
    "SELECT $1::jsonb AS json_true, $2::jsonb AS json_false, $3::jsonb AS json_null",
    ["true", "false", "null"],
  );
  assert.equal(scalars?.json_true, true, "JSON true should decode as boolean true");
  assert.equal(scalars?.json_false, false, "JSON false should decode as boolean false");
  assert.equal(scalars?.json_null, null, "JSON null should decode as JavaScript null");

  const empty = await query("SELECT 1 AS value WHERE false");
  assert.deepEqual(empty, [], "an empty SELECT should be represented as an empty array");

  await assert.rejects(
    () => query("SELECT * FROM p5_driver_regression_relation_that_does_not_exist"),
    (error: unknown) =>
      error instanceof Error &&
      /relation|does not exist|undefined table/i.test(error.message),
    "a genuine SQL error must remain an error",
  );

  // saveDraft exercises both INSERT ... RETURNING and UPDATE ... RETURNING.
  const inserted = await saveDraft(draftId, draftKey, brand, payload, 0);
  assert.equal(inserted.id, draftId);
  assert.equal(inserted.revision, 1, "INSERT RETURNING should acknowledge revision 1");
  assert.equal(inserted.text, payload.text);

  const updatedPayload = { ...payload, text: "Synthetic checkpoint resume draft" };
  const updated = await saveDraft(draftId, draftKey, brand, updatedPayload, 1);
  assert.equal(updated.revision, 2, "UPDATE RETURNING should acknowledge revision 2");
  assert.equal(updated.text, updatedPayload.text);

  const [storedDraft] = await query(
    "SELECT revision,payload FROM p5_estimator_drafts WHERE id=$1 AND key_hash=$2 AND brand=$3",
    [draftId, keyHash, brand],
  );
  assert.equal(Number(storedDraft?.revision), 2);
  assert.deepEqual(storedDraft?.payload, updatedPayload);

  // Two real claimers contend for the same active lease. Exactly one may win.
  const claims = await Promise.all([
    claimWork(draftId, workKey, initialCheckpoint, 300),
    claimWork(draftId, workKey, initialCheckpoint, 300),
  ]);
  assert.equal(claims.filter(Boolean).length, 1, "only one owner may claim an active lease");
  const owner = claims.find(Boolean);
  assert.ok(owner, "one synthetic work owner should win the contention");

  const wrongToken = randomUUID();
  await assert.rejects(
    () => writeWork(draftId, workKey, wrongToken, { forged: true }),
    /retried in another tab/,
    "a mismatched owner token must not write work",
  );
  await releaseWork(draftId, workKey, wrongToken);
  const [afterWrongOwner] = await query(
    "SELECT payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",
    [draftId, workKey],
  );
  assert.deepEqual(afterWrongOwner?.payload, initialCheckpoint);
  assert.equal(afterWrongOwner?.lease_token, owner.token);

  // Write a checkpoint, then reclaim that same synthetic lease after expiring
  // it. The new owner must resume the durable payload, not the initial value.
  await writeWork(draftId, workKey, owner.token, initialCheckpoint);
  await query(
    "UPDATE p5_estimator_work SET lease_until=now()-interval '1 second' WHERE draft_id=$1 AND work_key=$2 AND lease_token=$3",
    [draftId, workKey, owner.token],
  );
  const reclaimed = await claimWork(draftId, workKey, { ignored: true }, 300);
  assert.ok(reclaimed, "an expired synthetic lease should be reclaimable");
  assert.notEqual(reclaimed.token, owner.token, "reclaim must issue a new owner token");
  assert.deepEqual(reclaimed.payload, initialCheckpoint, "reclaim should resume the checkpoint payload");

  await assert.rejects(
    () => writeWork(draftId, workKey, owner.token, { staleOwner: true }),
    /retried in another tab/,
    "the old owner must be fenced after lease reclaim",
  );
  await releaseWork(draftId, workKey, owner.token);
  const [afterOldOwner] = await query(
    "SELECT payload,lease_token FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",
    [draftId, workKey],
  );
  assert.deepEqual(afterOldOwner?.payload, initialCheckpoint);
  assert.equal(afterOldOwner?.lease_token, reclaimed.token, "old release must not release the new owner");

  const resumedCheckpoint = { ...initialCheckpoint, prepared: 2, resumed: true };
  await writeWork(draftId, workKey, reclaimed.token, resumedCheckpoint);
  const [resumed] = await query(
    "SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",
    [draftId, workKey],
  );
  assert.deepEqual(resumed?.payload, resumedCheckpoint, "the new owner should persist resumed progress");
  await releaseWork(draftId, workKey, reclaimed.token);
  const [released] = await query(
    "SELECT lease_token,lease_until FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",
    [draftId, workKey],
  );
  assert.equal(released?.lease_token, null);
  assert.equal(released?.lease_until, null);

  console.log(
    "PASS: JSON booleans/null, empty SELECT, INSERT/UPDATE RETURNING, preserved SQL errors, lease contention/fencing/reclaim, and checkpoint resume.",
  );
} finally {
  if (schemaAvailable) {
    // Delete only this run's random work key and draft, in FK order. No
    // customer files, outbox entries, policies, or tables are touched.
    await query(
      "DELETE FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",
      [draftId, workKey],
    );
    await query(
      "DELETE FROM p5_estimator_drafts WHERE id=$1 AND key_hash=$2 AND brand=$3",
      [draftId, keyHash, brand],
    );
  }
}