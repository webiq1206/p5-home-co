import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatIndexNowLog,
  loadIndexableUrls,
  planChangedUrls,
  routeForPage,
  runIndexNowPostDeploy,
  scheduleIndexNowPostDeploy,
  shouldPrepareIndexNowMarker,
  shouldRunIndexNowPostDeploy,
} from "../tools/indexnow-deploy.mjs";

const INDEXABLE = [
  "https://p5homeco.com",
  "https://p5homeco.com/contact",
  "https://p5homeco.com/legal/privacy",
];

test("IndexNow page routes skip dynamic segments", () => {
  assert.equal(routeForPage("app/page.tsx"), "/");
  assert.equal(routeForPage("app/contact/page.tsx"), "/contact");
  assert.equal(routeForPage("app/legal/privacy/page.tsx"), "/legal/privacy");
  assert.equal(routeForPage("app/quote/[service]/page.tsx"), null);
});

test("a schema change pings every indexable URL and a redirect keeps both ends", () => {
  assert.deepEqual(planChangedUrls(["app/contact/page.tsx"], INDEXABLE), {
    urls: ["https://p5homeco.com/contact"],
    retired: [],
  });
  const all = planChangedUrls(["app/structuredData.ts"], INDEXABLE);
  assert.deepEqual(all.urls, INDEXABLE);
  const redirect = planChangedUrls(["README.md"], INDEXABLE, [{ from: "/retired-page", to: "/contact" }]);
  assert.deepEqual(redirect.urls, ["https://p5homeco.com/contact"]);
  assert.deepEqual(redirect.retired, ["/retired-page"]);
});

test("the deploy log line names the sha, the count and the HTTP status", () => {
  assert.equal(formatIndexNowLog("abc123", 4, 202), "[IndexNow] sha=abc123 submitted=4 status=202");
});

test("IndexNow does not prepare or submit from CI or a pull request", () => {
  for (const env of [
    { CI: "true", P5_INDEXNOW_POST_DEPLOY: "1" },
    { GITHUB_ACTIONS: "true", P5_INDEXNOW_POST_DEPLOY: "1" },
    { GITHUB_EVENT_NAME: "pull_request", P5_INDEXNOW_POST_DEPLOY: "1" },
    { VERCEL: "1", P5_INDEXNOW_POST_DEPLOY: "1" },
    { P5_INDEXNOW_POST_DEPLOY: "1" },
  ]) {
    assert.equal(shouldPrepareIndexNowMarker(env), env.P5_INDEXNOW_POST_DEPLOY === "1" && !env.CI && !env.GITHUB_ACTIONS && !env.GITHUB_EVENT_NAME && !env.VERCEL);
  }
  assert.equal(shouldRunIndexNowPostDeploy({}), false);
  assert.equal(shouldRunIndexNowPostDeploy({ CI: "true", P5_INDEXNOW_POST_DEPLOY: "1" }), false);
  assert.equal(shouldRunIndexNowPostDeploy({ GITHUB_EVENT_NAME: "pull_request", P5_INDEXNOW_POST_DEPLOY: "1" }), false);
  assert.equal(shouldRunIndexNowPostDeploy({ P5_INDEXNOW_POST_DEPLOY: "1" }), true);
});

test("a post-deploy submit logs one IndexNow line and a repeat does not call again", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ submitted: 2, indexNowStatus: 202 }),
    };
  };
  const marker = { sha: "abc123", urls: INDEXABLE, retired: [], submittedSha: null };
  const first = await runIndexNowPostDeploy({
    env: { P5_INDEXNOW_POST_DEPLOY: "1" },
    marker,
    fetchImpl,
    log: (line: string) => logs.push(line),
    secret: "secret",
    endpoint: "http://127.0.0.1:3000/api/indexnow",
  });
  assert.equal(first.markSubmitted, true);
  assert.deepEqual(logs, ["[IndexNow] sha=abc123 submitted=2 status=202"]);
  assert.deepEqual(calls, ["http://127.0.0.1:3000/api/indexnow"]);

  calls.length = 0;
  const again = await runIndexNowPostDeploy({
    env: { P5_INDEXNOW_POST_DEPLOY: "1" },
    marker: { ...marker, submittedSha: "abc123" },
    fetchImpl,
    log: (line: string) => logs.push(line),
    secret: "secret",
    endpoint: "http://127.0.0.1:3000/api/indexnow",
  });
  assert.equal(again.ran, false);
  assert.deepEqual(calls, []);
  assert.equal(logs.length, 1);
});

test("CI does not call IndexNow even when a marker is on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "indexnow-"));
  try {
    const next = join(dir, ".next");
    mkdirSync(next);
    writeFileSync(join(next, "indexnow-deploy.json"), `${JSON.stringify({
      sha: "abc123",
      urls: ["https://p5homeco.com/contact"],
      retired: [],
      submittedSha: null,
    })}\n`);
    let called = false;
    await scheduleIndexNowPostDeploy({
      port: 9,
      env: { CI: "true", P5_INDEXNOW_POST_DEPLOY: "1" },
      root: dir,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    assert.equal(called, false);
    const saved = JSON.parse(readFileSync(join(next, "indexnow-deploy.json"), "utf8"));
    assert.equal(saved.submittedSha, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the marker lists live sitemap URLs and leaves QuickBooks disconnect out", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const urls = loadIndexableUrls(repo) as string[];
  assert.ok(urls.includes("https://p5homeco.com"));
  assert.equal(urls.some((url) => url.includes("quickbooks-disconnect")), false);
});
