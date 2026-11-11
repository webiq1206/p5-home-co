/**
 * Scope platform against a real Postgres: versions, answers, idempotent
 * uploads, proposals, list search, and QuickBooks status mirroring. No
 * network: transcription, extraction and QuickBooks writes are not called.
 *
 * Runs only with TEST_DATABASE_URL pointing at a throwaway, migrated database
 * with at least one app_user:
 *   TEST_DATABASE_URL=postgres://localhost/scope_test npm run db:migrate -- --seed-admin a@b.c
 *   TEST_DATABASE_URL=postgres://localhost/scope_test node --experimental-strip-types --test tests/scope-platform.db.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

test("scope platform over Postgres", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const db = await import("../app/lib/db.ts");
  const store = await import("../app/lib/scopes/store.ts");
  const engine = await import("../app/lib/scopes/engine.ts");
  const { loadWorkspace } = await import("../app/lib/scopes/workspace.ts");
  const { emptyScope, DEFAULT_SCOPE_SETTINGS } = await import("../app/lib/scopes/types.ts");

  const user = await db.queryOne<{ id: string }>("SELECT id FROM app_user ORDER BY id LIMIT 1");
  assert.ok(user, "seed an app_user first");
  const uid = Number(user.id);
  await store.saveScopeSettings({ ...DEFAULT_SCOPE_SETTINGS, laborTreatment: "billed-rate" }, uid);

  const id = await store.createProject(uid, { title: "Kitchen refresh", client_last_name: "Testerson", project_address: "123 Test St, Boise", service: "kitchen" });

  // Idempotent upload: the same client key returns the first row.
  const a1 = await store.insertAsset({ projectId: id, clientKey: "rec-abc-0", kind: "recording", label: "Meeting", data: Buffer.from("x"), size: 1, userId: uid });
  const a2 = await store.insertAsset({ projectId: id, clientKey: "rec-abc-0", kind: "recording", label: "Meeting", data: Buffer.from("x"), size: 1, userId: uid });
  assert.equal(a2.duplicate, true);
  assert.equal(a2.asset.id, a1.asset.id);

  // Lock: a second processing claim is refused while the first is running.
  assert.equal(await store.claimProcessing(id, "test"), true);
  assert.equal(await store.claimProcessing(id, "test"), false);
  await store.setProjectState(id, { processing_state: "idle" });

  // First version, then a wizard answer that produces a second.
  let project = (await store.getProject(id))!;
  const doc = {
    ...emptyScope(),
    summary: "Replace baseboard",
    client: { firstName: { value: "Pat", certainty: "confirmed" as const, evidence: [] }, email: { value: "pat@example.com", certainty: "confirmed" as const, evidence: [] } },
    measurements: [{ id: "base-len", label: "Baseboard length", value: 30, unit: "LF", status: "estimated" as const, evidence: [] }],
    tasks: [
      { id: "base", title: "Install baseboard", description: "Install new baseboard.", phase: "construction" as const, division: "06", bucket: "approved" as const, certainty: "confirmed" as const, costCode: "06-20-26", quantity: { measurementId: "base-len" }, performer: "subcontractor" as const, evidence: [{ assetId: a1.asset.id, t: 42 }] },
    ],
  };
  const first = await engine.commitDoc(project, doc, "generated", null, uid);
  assert.equal(first.version.version_no, 1);
  assert.equal(first.computed.readiness.status, "needs_information");
  project = (await store.getProject(id))!;
  assert.equal(project.client_first_name, "Pat", "captured client details fill empty fields");
  assert.equal(project.client_email, "pat@example.com");
  assert.equal(project.scope_status, "needs_information");

  // Suggestions from the checklist are stored but not required.
  const ws1 = (await loadWorkspace(id))!;
  const measure = ws1.questions.find((q) => q.key === "measure:base-len");
  assert.ok(measure?.blocking);
  assert.ok(ws1.doc.tasks.some((t) => t.id === "chk-protection" && t.certainty === "suggested"));

  // Deferring keeps it blocking; answering resolves it.
  await engine.answerQuestion({ projectId: id, key: "measure:base-len", answer: null, defer: true, assetId: null, userId: uid });
  assert.ok((await loadWorkspace(id))!.questions.find((q) => q.key === "measure:base-len")?.deferred);
  await engine.answerQuestion({ projectId: id, key: "measure:base-len", answer: { value: 32 }, defer: false, assetId: null, userId: uid, prompt: "Length" });
  const ws2 = (await loadWorkspace(id))!;
  assert.equal(ws2.version!.versionNo, 2);
  assert.equal(ws2.readiness.status, "ready");
  assert.equal(ws2.pricing.lines.find((l) => l.taskId === "base")!.quantity, 32);

  // Manual edit is marked and survives a proposal from regenerated material.
  await engine.editScope(id, [{ op: "task", task: { ...ws2.doc.tasks.find((t) => t.id === "base")!, title: "Install owner-supplied baseboard" } }], uid);
  const current = (await engine.currentDoc((await store.getProject(id))!)).doc;
  assert.deepEqual(current.tasks.find((t) => t.id === "base")!.edited, ["title"]);
  const { diffScopes } = await import("../app/lib/scopes/merge.ts");
  const generated = { ...current, tasks: current.tasks.map((t) => (t.id === "base" ? { ...t, title: "Install MDF baseboard", description: "Install MDF baseboard, painted." } : t)) };
  const proposal = { changes: diffScopes(current, generated), generated, createdAt: new Date().toISOString() };
  await store.setProjectState(id, { pending_proposal: proposal });
  await engine.acceptProposal(id, proposal.changes.map((c) => c.id), uid);
  const after = (await loadWorkspace(id))!;
  const base = after.doc.tasks.find((t) => t.id === "base")!;
  assert.equal(base.title, "Install owner-supplied baseboard");
  assert.equal(base.description, "Install MDF baseboard, painted.");
  assert.equal(after.proposal, null);

  // Re-pricing with nothing changed must not create a version (jsonb reorders keys).
  const countBefore = after.versions.length;
  await engine.reprice(id, uid, "no change");
  assert.equal((await loadWorkspace(id))!.versions.length, countBefore);

  // New material stays "not yet in the scope" until its proposal is accepted or dismissed.
  const doc2 = await store.insertAsset({ projectId: id, clientKey: "file-proposal-1", kind: "text", label: "Note", bodyText: "x", state: "ready", userId: uid });
  await store.setProjectState(id, { pending_proposal: { changes: [], generated: current, createdAt: new Date().toISOString(), sourceIds: [doc2.asset.id] } });
  assert.deepEqual((await loadWorkspace(id))!.proposal!.sourceIds, [doc2.asset.id]);
  await engine.rejectProposal(id, uid);
  assert.ok((await store.listAssets(id)).find((a) => a.id === doc2.asset.id)!.used_in_version);

  // Restore makes a copy as the newest version; history is kept.
  const versionsBefore = after.versions.length;
  await engine.editScope(id, [{ op: "restore-version", versionId: after.versions.at(-1)!.id }], uid);
  const restored = (await loadWorkspace(id))!;
  assert.equal(restored.versions.length, versionsBefore + 1);
  assert.equal(restored.doc.tasks.find((t) => t.id === "base")!.title, "Install baseboard");

  // List: search by client, address; archive hides from active.
  assert.equal((await store.listProjects({ q: "Testerson" })).some((r) => r.id === id), true);
  assert.equal((await store.listProjects({ q: "123 Test" })).some((r) => r.id === id), true);
  await store.setProjectState(id, { archived: true });
  assert.equal((await store.listProjects({})).some((r) => r.id === id), false);
  assert.equal((await store.listProjects({ archived: true })).some((r) => r.id === id), true);
  await store.setProjectState(id, { archived: false });

  // QuickBooks status from the webhook-fed mirror, with drift and snapshots.
  const v = (await store.currentVersion((await store.getProject(id))!))!;
  const sent = { Line: [{ DetailType: "SalesItemLineDetail", Description: "Install baseboard", Amount: 100, SalesItemLineDetail: { Qty: 1, UnitPrice: 100 } }] };
  const qboId = `T${id}`;
  const estId = await store.insertEstimate({ projectId: id, versionId: v.id, qboId, payload: sent, userId: uid });
  await store.applyEstimateStatus(estId, { raw: { Id: qboId, SyncToken: "0", TxnStatus: "Pending", EmailStatus: "NotSet", TotalAmt: 100, ...sent }, source: "create", drift: null });
  let ws = (await loadWorkspace(id))!;
  assert.equal(ws.estimate!.status, "created_unsent");
  await db.query(
    `INSERT INTO qbo_txn (qbo_id, txn_type, total, raw, synced_at) VALUES ($1, 'Estimate', 150, $2::jsonb, now() + interval '1 second')
     ON CONFLICT (txn_type, qbo_id) DO UPDATE SET raw = EXCLUDED.raw, synced_at = EXCLUDED.synced_at`,
    [qboId, JSON.stringify({ Id: qboId, SyncToken: "1", TxnStatus: "Accepted", AcceptedBy: "Pat", TotalAmt: 150, Line: [{ DetailType: "SalesItemLineDetail", Description: "Install baseboard", Amount: 150, SalesItemLineDetail: { Qty: 1, UnitPrice: 150 } }] })],
  );
  ws = (await loadWorkspace(id))!;
  assert.equal(ws.estimate!.status, "accepted");
  assert.equal(ws.estimate!.drift?.changed, true);
  assert.equal(ws.estimate!.snapshots.length, 2);
  assert.equal(ws.project.qbo_project_id, null, "accepted does not imply a linked project");
  const listed = (await store.listProjects({ q: "Testerson" })).find((r) => r.id === id)!;
  assert.equal((listed.estimate_raw as { TxnStatus?: string }).TxnStatus, "Accepted");

  // An estimate QuickBooks reports as deleted reads as deleted everywhere, with history kept.
  await store.markEstimateDeleted(estId);
  ws = (await loadWorkspace(id))!;
  assert.equal(ws.estimate!.status, "deleted");
  assert.equal(ws.estimate!.snapshots.length, 2);
  const listedAfter = (await store.listProjects({ q: "Testerson" })).find((r) => r.id === id)!;
  assert.equal((listedAfter.estimate_raw as { TxnStatus?: string }).TxnStatus, "Deleted");
});
