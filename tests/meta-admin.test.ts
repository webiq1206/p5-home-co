import assert from "node:assert/strict";
import test from "node:test";
import { leadDatabase } from "./fixtures/lead-db.ts";

// In-memory PostgreSQL and mocked HTTP only: never dial runtime databases/providers.
const db = await leadDatabase();
const { metaReadiness, discoverMetaPages, isLeadgenSubscribed, runMetaHandshakeSelfTest, safeMetaError, metaGraph, loadMetaReceipts } = await import("../app/lib/integrations/meta-admin.ts");
const { mergeMetaMappings, loadMetaMappings, saveMetaMapping } = await import("../app/lib/integrations/meta-settings.ts");
const { resolveMetaBrand, pageToken, metaConfig } = await import("../app/lib/integrations/meta-leadgen.ts");
const { metaAutomationEnabled, maintainMetaSubscriptions } = await import("../app/lib/integrations/meta-schedule.ts");
const { hubspotRetryDue, recordHubspotFailure, clearHubspotBackoff, hubspotRetryDelaySeconds } = await import("../app/lib/integrations/hubspot-backoff.ts");
const { resolveMetaPageToken, refreshMetaPageTokens } = await import("../app/lib/integrations/meta-page-tokens.ts");
const env = { SESSION_SECRET: "synthetic-session-key", META_APP_ID: "2915975045410175", META_PAGE_ACCESS_TOKEN: "synthetic-token", META_APP_SECRET: "synthetic-secret", META_LEADGEN_VERIFY_TOKEN: "p5-leadgen-verify-2026", META_PAGE_TOKENS: '{"1235083469680398":"synthetic-override"}' };

test("Page defaults and persisted form overrides respect form > Page > campaign > P5", async () => {
  const base = mergeMetaMappings(null);
  assert.equal(resolveMetaBrand({ id: "1", campaign_name: "P5 | Boise Remodeling Co | Test" }, { pageId: "1235083469680398" }, null, base).brand, "Boise Cabinet Co");
  assert.equal(resolveMetaBrand({ id: "1", form_id: "3570634953094714" }, { pageId: "1235083469680398" }, null, base).brand, "Boise Handyman Co");
  assert.equal(resolveMetaBrand({ id: "1", campaign_name: "P5 | Boise Remodeling Co | Test" }, { pageId: "999" }, null, base).resolvedBy, "campaign-name");
  assert.equal(resolveMetaBrand({ id: "1" }, { pageId: "999" }, null, base).brand, "P5 Home Co");
  const user = await db.rows<{ id: number }>("INSERT INTO app_user (email,full_name,role) VALUES ('synthetic-admin@example.com','Synthetic Admin','administrator') RETURNING id");
  await saveMetaMapping("pages", "999", "Boise ADU Co", Number(user[0].id));
  await saveMetaMapping("forms", "3570634953094714", "Boise Construction Co", Number(user[0].id), "Owner-assigned form", "custom-home");
  const stored = await loadMetaMappings();
  assert.equal(stored.pages["1228704823655951"], "P5 Home Co");
  assert.equal(stored.pages["999"], "Boise ADU Co");
  assert.equal(resolveMetaBrand({ id: "1", form_id: "3570634953094714" }, { pageId: "999" }, null, stored).brand, "Boise Construction Co");
  await assert.rejects(saveMetaMapping("pages", "../token", "P5 Home Co", Number(user[0].id)));
});

test("system-user token is never a Page fallback; per-Page overrides still win", () => {
  const config = metaConfig(env);
  assert.equal(pageToken(config, "999999999"), "");
  assert.equal(pageToken(config, "1235083469680398"), "synthetic-override");
});

function mockGraph(options: { refused?: boolean; missingSubscription?: boolean; paged?: boolean; initiallyUnsubscribed?: boolean } = {}) {
  const calls: { path: string; method: string; auth: string; body: unknown }[] = [];
  let subscribed = !options.initiallyUnsubscribed;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(url.origin, "https://graph.facebook.com");
    calls.push({ path: url.pathname, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("Authorization") ?? "", body: init?.body });
    if (options.refused && url.pathname.endsWith("/subscribed_apps")) return Response.json({ error: { code: 200, message: "Requires pages_manage_metadata; access_token=synthetic-override" } }, { status: 403 });
    if (url.pathname.endsWith("/me/accounts")) {
      if (options.paged && !url.searchParams.has("after")) return Response.json({ data: [], paging: { next: "https://forbidden.invalid/?access_token=do-not-follow", cursors: { after: "cursor-2" } } });
      assert.equal(url.searchParams.get("fields"), "id,name,access_token,tasks");
      return Response.json({ data: [{ id: "1235083469680398", name: "Boise Cabinet Co", access_token: "discovered-page-token", tasks: ["MANAGE"] }] });
    }
    if (init?.method === "POST") { subscribed = true; return Response.json({ success: true }); }
    if (url.pathname.endsWith("/subscribed_apps")) return Response.json({ data: options.missingSubscription || !subscribed ? [{ id: env.META_APP_ID, subscribed_fields: ["feed"] }] : [{ id: env.META_APP_ID, subscribed_fields: ["leadgen"] }] });
    return Response.json({ data: [{ id: "1234", name: "Cabinet form", status: "ACTIVE", questions: [{ key: "q", label: "What project?", type: "CUSTOM" }] }] });
  }) as typeof fetch;
  return { calls, fetcher };
}
test("Page discovery paginates safely, lists questions and maps by Page without any POST", async () => {
  const mock = mockGraph({ paged: true });
  const pages = await discoverMetaPages(mergeMetaMappings(null), env, mock.fetcher);
  assert.equal(pages[0].subscribed, true);
  assert.equal(pages[0].forms[0].brand, "Boise Cabinet Co");
  assert.equal(pages[0].forms[0].questions[0].label, "What project?");
  assert.equal(mock.calls.some(c => c.method === "POST"), false);
  assert.equal(mock.calls.find(c => c.path.endsWith("/leadgen_forms"))?.auth, "Bearer synthetic-override");
});
test("Subscribe all POSTs only leadgen and confirms the specific app by read-back", async () => {
  const mock = mockGraph({ initiallyUnsubscribed: true });
  const pages = await discoverMetaPages(mergeMetaMappings(null), env, mock.fetcher, true);
  assert.equal(pages[0].subscribed, true);
  assert.deepEqual(mock.calls.filter(c => c.method === "POST").map(c => c.body), ["subscribed_fields=leadgen"]);
  await discoverMetaPages(mergeMetaMappings(null), env, mock.fetcher, true);
  assert.equal(mock.calls.filter(c => c.method === "POST").length, 1, "already subscribed Pages are not POSTed again");
  const incomplete = await discoverMetaPages(mergeMetaMappings(null), env, mockGraph({ missingSubscription: true }).fetcher, true);
  assert.equal(incomplete[0].subscribed, false);
  assert.match(incomplete[0].error!, /not confirmed/);
  assert.equal(isLeadgenSubscribed([{ id: "other-app", subscribed_fields: ["leadgen"] }], env.META_APP_ID), false);
});
test("Meta denials show Graph code and message without credential values or envelopes", async () => {
  await assert.rejects(discoverMetaPages(mergeMetaMappings(null), {}, mockGraph().fetcher), /required/);
  const pages = await discoverMetaPages(mergeMetaMappings(null), env, mockGraph({ refused: true }).fetcher);
  assert.match(pages[0].error!, /Meta HTTP 403 \(code 200\).*Requires pages_manage_metadata/);
  assert.equal(JSON.stringify(pages).includes("synthetic-override"), false);
  await assert.rejects(metaGraph("https://evil.invalid", env.META_PAGE_ACCESS_TOKEN, {}, mockGraph().fetcher), /configuration/);
  assert.equal(safeMetaError("private customer content token here"), "Processing failed; inspect restricted server diagnostics");
});
test("discovered Page token handles subscription GET/POST/read-back and forms; no token reaches admin output", async () => {
  const mock = mockGraph({ initiallyUnsubscribed: true });
  const pages = await discoverMetaPages(mergeMetaMappings(null), { ...env, META_PAGE_TOKENS: "" }, mock.fetcher, true);
  assert.equal(pages[0].subscribed, true);
  assert.equal(pages[0].appPresent, true);
  assert.equal(mock.calls[0].auth, "Bearer synthetic-token");
  assert.ok(mock.calls.slice(1).every(c => c.auth === "Bearer discovered-page-token"));
  assert.equal(JSON.stringify(pages).includes("discovered-page-token"), false);
  const stored = await db.rows<{ token_ciphertext: string }>("SELECT token_ciphertext FROM meta_page_token");
  assert.ok(stored.length > 0);
  assert.ok(stored.every(row => !row.token_ciphertext.includes("discovered-page-token")));
});
test("cache miss resolves once, warm cache skips discovery, durable cache survives memory TTL, expiry refreshes", async () => {
  const isolatedEnv = { ...env, META_PAGE_ACCESS_TOKEN: "cache-test-system", META_PAGE_TOKENS: "" };
  const config = metaConfig(isolatedEnv);
  let discoveries = 0, generation = 0;
  const fetcher = (async () => {
    discoveries++;
    return Response.json({ data: [{ id: "777", name: "Synthetic", access_token: `page-token-${++generation}` }] });
  }) as typeof fetch;
  assert.equal(await resolveMetaPageToken(config, "777", isolatedEnv, fetcher), "page-token-1");
  assert.equal(await resolveMetaPageToken(config, "777", isolatedEnv, fetcher), "page-token-1");
  assert.equal(discoveries, 1);
  const now = Date.now;
  try {
    Date.now = () => now() + 6 * 60 * 1000;
    assert.equal(await resolveMetaPageToken(config, "777", isolatedEnv, fetcher), "page-token-1", "encrypted durable cache works after memory TTL");
    assert.equal(discoveries, 1);
    await db.rows("UPDATE meta_page_token SET expires_at=now()-interval '1 hour' WHERE page_id='777'");
    Date.now = () => now() + 12 * 60 * 1000;
    assert.equal(await resolveMetaPageToken(config, "777", isolatedEnv, fetcher), "page-token-2");
    assert.equal(discoveries, 2);
  } finally { Date.now = now; }
  await refreshMetaPageTokens(config, isolatedEnv, fetcher);
  assert.equal(discoveries, 3, "explicit discovery refreshes a warm cache");
});
test("missing Page token never falls back to system token, and concurrent misses share one discovery", async () => {
  const scoped = { ...env, META_PAGE_ACCESS_TOKEN: "no-pages-system", META_PAGE_TOKENS: "" };
  let calls = 0;
  const empty = (async () => { calls++; await new Promise(r => setTimeout(r, 5)); return Response.json({ data: [] }); }) as typeof fetch;
  const config = metaConfig(scoped);
  assert.deepEqual(await Promise.all([resolveMetaPageToken(config, "901", scoped, empty), resolveMetaPageToken(config, "902", scoped, empty)]), ["", ""]);
  assert.equal(calls, 1);
  const withoutToken = await discoverMetaPages(mergeMetaMappings(null), scoped, (async (url) => {
    assert.ok(String(url).includes("/me/accounts"), "no Page call when a Page token is absent");
    return Response.json({ data: [{ id: "901", name: "No token" }] });
  }) as typeof fetch);
  assert.match(withoutToken[0].error!, /did not return a Page access token/);
});
test("self-test performs only an exact same-origin handshake and does not follow redirects", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url)); calls.push(parsed.origin + parsed.pathname);
    assert.equal(parsed.searchParams.get("hub.verify_token"), env.META_LEADGEN_VERIFY_TOKEN);
    assert.equal(init?.redirect, "error");
    return new Response("p5-admin-self-test", { status: 200 });
  }) as typeof fetch;
  assert.equal(await runMetaHandshakeSelfTest("http://localhost:3000", env, fetcher), true);
  assert.deepEqual(calls, ["http://localhost:3000/api/meta/leadgen"]);
  assert.equal(await runMetaHandshakeSelfTest("http://localhost:3000", {}, fetcher), false);
  assert.equal(await runMetaHandshakeSelfTest("http://localhost:3000", env, (async () => new Response("wrong")) as typeof fetch), false);
});
test("readiness returns presence only, validates SMTP without sending, and has no secret values", () => {
  const ready = metaReadiness({ ...env, SMTP_USER: "synthetic@example.com", SMTP_PASSWORD: "synthetic-password" });
  assert.equal(ready.smtpEnabled, true);
  assert.equal(ready.secrets.META_APP_SECRET, true);
  assert.equal(JSON.stringify(ready).includes("synthetic-password"), false);
  assert.equal(JSON.stringify(ready).includes("synthetic-token"), false);
});
test("subscription automation is disabled during builds and development, enabled with token in production", () => {
  assert.equal(metaAutomationEnabled({ ...env, NODE_ENV: "development" }), false);
  assert.equal(metaAutomationEnabled({ ...env, NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }), false);
  assert.equal(metaAutomationEnabled({ ...env, NODE_ENV: "production" }), true);
  assert.equal(metaAutomationEnabled({ META_APP_ID: env.META_APP_ID, NODE_ENV: "production" }), false);
});
test("boot and nightly maintenance refresh accounts and use Page tokens for subscriptions and forms", async () => {
  const mock = mockGraph({ initiallyUnsubscribed: true });
  const keys = ["NODE_ENV", "NEXT_PHASE", "SESSION_SECRET", "META_APP_ID", "META_PAGE_ACCESS_TOKEN", "META_PAGE_TOKENS"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, { ...env, META_PAGE_TOKENS: "", NODE_ENV: "production" });
    delete process.env.NEXT_PHASE;
    globalThis.fetch = mock.fetcher;
    await maintainMetaSubscriptions("boot");
    const nightly = `meta-subscribe:${new Date().toISOString().slice(0, 10)}`;
    await db.rows("INSERT INTO meta_subscription_run (run_key,state,started_at) VALUES ($1,'failed',now()-interval '2 hours')", [nightly]);
    await maintainMetaSubscriptions("nightly");
    const runs = await db.rows<{ state: string; pages_checked: number; pages_subscribed: number }>(
      "SELECT state,pages_checked,pages_subscribed FROM meta_subscription_run");
    assert.equal(runs.length, 2);
    assert.ok(runs.every(r => r.state === "succeeded" && r.pages_checked === 1 && r.pages_subscribed === 1));
    assert.equal(mock.calls.filter(c => c.path.endsWith("/me/accounts")).length, 2);
    assert.ok(mock.calls.filter(c => !c.path.endsWith("/me/accounts")).every(c => c.auth === "Bearer discovered-page-token"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
test("retry backoff grows to six hours and persists without altering ordinary deal data", async () => {
  assert.equal(hubspotRetryDelaySeconds(1), 60);
  assert.equal(hubspotRetryDelaySeconds(2), 120);
  assert.equal(hubspotRetryDelaySeconds(30), 21600);
  const contact = await db.rows<{ id: number }>("INSERT INTO contact (identity_key,first_name) VALUES ('synthetic-backoff','Synthetic') RETURNING id");
  const deal = await db.rows<{ id: number }>("INSERT INTO deal (contact_id,name,brand,lead_source,stage,received_at,dedup_key) VALUES ($1,'Synthetic','P5 Home Co','Facebook Lead Ad','New Lead',now(),'synthetic-backoff') RETURNING id", [Number(contact[0].id)]);
  const id = Number(deal[0].id);
  assert.equal(await hubspotRetryDue(id), true);
  await recordHubspotFailure(id);
  assert.equal(await hubspotRetryDue(id), false);
  await recordHubspotFailure(id);
  assert.equal((await db.rows<{ attempts: number }>("SELECT attempts FROM lead_hubspot_retry WHERE deal_id=$1", [id]))[0].attempts, 2);
  await clearHubspotBackoff(id);
  assert.equal(await hubspotRetryDue(id), true);
});
test("receipt projection exposes only bounded operational fields, not payloads", async () => {
  const rows = await loadMetaReceipts();
  assert.deepEqual(rows, []);
});
