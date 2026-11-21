/**
 * Post-deploy IndexNow for p5homeco.com.
 *
 * The published build command runs this file's prepare step after build:host
 * and writes .next/indexnow-deploy.json with the commit SHA and the public
 * URLs that commit changed. The deployment
 * run (P5_INDEXNOW_POST_DEPLOY=1, set only on the published start command)
 * reads that file after the new server is answering and POSTs the existing
 * /api/indexnow route once. A later cold start sees the same SHA and does not
 * submit again.
 *
 * GitHub Actions, pull-request builds and any process with CI set never write
 * the marker and never call IndexNow.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const INDEXNOW_MARKER = ".next/indexnow-deploy.json";

/** Files whose change rewrites the organization schema on every public page. */
const GLOBAL_SOURCES = new Set([
  "app/layout.tsx",
  "app/structuredData.ts",
  "app/publicIdentity.ts",
  "app/site.ts",
  "app/serviceArea.ts",
  "components/SiteChrome.tsx",
  "components/family/SiteFooter.tsx",
  "lib/familyBrand.ts",
]);

export function formatIndexNowLog(sha, submitted, status) {
  return `[IndexNow] sha=${sha} submitted=${submitted} status=${status}`;
}

/** True only for the published deployment start, never for CI or a PR build. */
export function shouldRunIndexNowPostDeploy(env) {
  if (env.CI === "true" || env.CI === "1" || env.CI === true) return false;
  if (env.GITHUB_ACTIONS === "true") return false;
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target") return false;
  if (env.VERCEL) return false;
  return env.P5_INDEXNOW_POST_DEPLOY === "1";
}

/** The build may record the marker. CI and PR builds must not. */
export function shouldPrepareIndexNowMarker(env) {
  if (env.CI === "true" || env.CI === "1" || env.CI === true) return false;
  if (env.GITHUB_ACTIONS === "true") return false;
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target") return false;
  if (env.VERCEL) return false;
  return true;
}

export function routeForPage(file) {
  if (file === "app/page.tsx") return "/";
  if (!file.startsWith("app/") || !file.endsWith("/page.tsx") || file.includes("[")) return null;
  return `/${file.slice("app/".length, -"/page.tsx".length)}`;
}

/**
 * Indexable URLs touched by this commit, plus both ends of any redirect.
 * A redirect source that is no longer indexable is returned in `retired`
 * so the existing API can report it as previously public.
 */
export function planChangedUrls(files, indexableUrls, redirects = []) {
  const byPath = new Map();
  for (const url of indexableUrls) {
    const path = new URL(url).pathname || "/";
    byPath.set(path === "" ? "/" : path, url);
  }
  const chosen = new Set();
  const add = (path) => {
    const url = byPath.get(path);
    if (url) chosen.add(url);
  };
  if (files.some((file) => GLOBAL_SOURCES.has(file))) {
    for (const url of indexableUrls) chosen.add(url);
  }
  for (const file of files) {
    const route = routeForPage(file);
    if (route) add(route);
  }
  const retired = [];
  for (const pair of redirects) {
    add(pair.to);
    if (!byPath.has(pair.from)) retired.push(pair.from);
    else add(pair.from);
    if (!byPath.has(pair.to)) retired.push(pair.to);
  }
  return { urls: [...chosen], retired };
}

export function changedFilesFromGit(cwd, exec = execFileSync) {
  const sha = exec("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  let out = "";
  try {
    out = exec("git", ["diff", "--name-only", "HEAD^", "HEAD"], { cwd, encoding: "utf8" });
  } catch {
    try {
      out = exec("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], { cwd, encoding: "utf8" });
    } catch {
      out = "";
    }
  }
  return { sha, files: String(out).split("\n").filter(Boolean) };
}

export function loadIndexableUrls(cwd, spawn = spawnSync) {
  const result = spawn(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    "import { getIndexableEntries } from './app/siteUrls.ts'; process.stdout.write(JSON.stringify(getIndexableEntries().map((entry) => entry.url)));",
  ], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Could not read indexable URLs.");
  return JSON.parse(result.stdout);
}

export function buildIndexNowMarker({ sha, files, indexableUrls, redirects = [] }) {
  const planned = planChangedUrls(files, indexableUrls, redirects);
  return { sha, urls: planned.urls, retired: planned.retired, submittedSha: null };
}

export function writeIndexNowDeployMarker({ cwd, env, exec = execFileSync, spawn = spawnSync, log = console.log } = {}) {
  if (!shouldPrepareIndexNowMarker(env)) return { wrote: false };
  const { sha, files } = changedFilesFromGit(cwd, exec);
  const indexableUrls = loadIndexableUrls(cwd, spawn);
  const marker = buildIndexNowMarker({ sha, files, indexableUrls });
  const path = join(cwd, INDEXNOW_MARKER);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker)}\n`);
  log(`[IndexNow] prepared sha=${sha} urls=${marker.urls.length}`);
  return { wrote: true, marker };
}

export async function runIndexNowPostDeploy({
  env,
  marker,
  fetchImpl,
  log = console.log,
  secret,
  endpoint,
}) {
  if (!shouldRunIndexNowPostDeploy(env)) return { ran: false };
  if (!marker?.sha || marker.submittedSha === marker.sha) return { ran: false, skipped: true };
  const urls = marker.urls ?? [];
  const retired = marker.retired ?? [];
  if (urls.length === 0 && retired.length === 0) {
    log(formatIndexNowLog(marker.sha, 0, 204));
    return { ran: true, submitted: 0, status: 204, markSubmitted: true };
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret || ""}`,
    },
    body: JSON.stringify({
      changes: [
        ...urls.map((url) => ({ url, changeToken: marker.sha })),
        ...retired.map((url) => ({ url, changeToken: marker.sha, action: "delete" })),
      ],
    }),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    log(formatIndexNowLog(marker.sha, 0, response.status));
    return { ran: true, submitted: 0, status: response.status, markSubmitted: false };
  }
  const submitted = Number(body.submitted || 0);
  if (submitted === 0) return { ran: true, submitted: 0, skipped: true, markSubmitted: true };
  log(formatIndexNowLog(marker.sha, submitted, body.indexNowStatus));
  return { ran: true, submitted, status: body.indexNowStatus, markSubmitted: true };
}

async function waitForServer(port, fetchImpl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/`, { method: "GET" });
      if (response) return true;
    } catch {
      // The process is up before Next is accepting connections.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function scheduleIndexNowPostDeploy({
  port,
  env = process.env,
  root = process.cwd(),
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (!shouldRunIndexNowPostDeploy(env)) return;
  const path = join(root, INDEXNOW_MARKER);
  let marker;
  try {
    marker = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
  if (!marker?.sha || marker.submittedSha === marker.sha) return;
  const ready = await waitForServer(port, fetchImpl);
  if (!ready) {
    log(formatIndexNowLog(marker.sha, 0, 503));
    return;
  }
  const result = await runIndexNowPostDeploy({
    env,
    marker,
    fetchImpl,
    log,
    secret: env.WATCHDOG_SECRET,
    endpoint: `http://127.0.0.1:${port}/api/indexnow`,
  });
  if (result.markSubmitted) {
    writeFileSync(path, `${JSON.stringify({ ...marker, submittedSha: marker.sha })}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "prepare") {
  // Deployment build only (.replit build). A marker problem is logged and does
  // not fail the build: the site still publishes, and the start step no-ops
  // when the marker is missing.
  try {
    writeIndexNowDeployMarker({ cwd: process.cwd(), env: process.env });
  } catch (error) {
    console.error("[IndexNow] marker not written", error instanceof Error ? error.message : error);
  }
}
