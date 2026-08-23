import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isPrivatePath } from "../app/lib/privacy.ts";
import robots from "../app/robots.ts";
import sitemap from "../app/sitemap.ts";

// ---------------------------------------------------------------------------
// Which paths count as private.
// ---------------------------------------------------------------------------

test("every private area is recognised, including pages that do not exist yet", () => {
  // The point of prefix matching: a page added tomorrow is covered without
  // anybody remembering to cover it.
  for (const path of [
    "/admin",
    "/admin/",
    "/admin/finance",
    "/admin/finance/data-quality",
    "/admin/kb",
    "/admin/kb/some-article-written-next-year",
    "/portal",
    "/portal/client",
    "/portal/vendor",
    "/api",
    "/api/qbo/webhook",
  ]) {
    assert.equal(isPrivatePath(path), true, `${path} must be treated as private`);
  }
});

test("the public site is not accidentally caught", () => {
  // Over-blocking would quietly deindex the marketing site, which is the
  // failure nobody notices until traffic is gone.
  for (const path of [
    "/",
    "/legal/terms",
    "/legal/privacy",
    "/legal/quickbooks-disconnect",
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    assert.equal(isPrivatePath(path), false, `${path} must stay indexable`);
  }
});

test("a public path that merely starts with the same letters is not private", () => {
  // "/administration-services" is a plausible marketing page, and a naive
  // startsWith check would deindex it.
  assert.equal(isPrivatePath("/administration-services"), false);
  assert.equal(isPrivatePath("/portalside-remodels"), false);
  assert.equal(isPrivatePath("/apis-we-love"), false);
});

// ---------------------------------------------------------------------------
// robots.txt and the sitemap must agree with the middleware.
// ---------------------------------------------------------------------------

test("robots.txt disallows every private area", () => {
  const rules = robots().rules;
  const ruleList = Array.isArray(rules) ? rules : [rules];
  assert.ok(ruleList.length > 0);

  for (const rule of ruleList) {
    const disallow = Array.isArray(rule.disallow)
      ? rule.disallow
      : rule.disallow
        ? [rule.disallow]
        : [];
    // Every agent, named AI crawlers included - not just the wildcard rule.
    for (const prefix of ["/admin", "/portal", "/api"]) {
      assert.ok(
        disallow.some((d) => d.startsWith(prefix)),
        `${rule.userAgent}: nothing disallows ${prefix}`,
      );
    }
  }
});

test("the sitemap advertises only public pages", () => {
  // A private URL in the sitemap is an active invitation to index it, which
  // outweighs any noindex signal it might also be carrying.
  for (const entry of sitemap()) {
    const path = new URL(entry.url).pathname;
    assert.equal(isPrivatePath(path), false, `${entry.url} is private and must not be listed`);
  }
});

// ---------------------------------------------------------------------------
// Every admin area keeps its own server-side gate. The noindex tag hides a
// page from search; only the gate stops a person reading it.
// ---------------------------------------------------------------------------

function layoutsUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...layoutsUnder(full));
    else if (entry === "layout.tsx") found.push(full);
  }
  return found;
}

test("the admin root layout marks everything beneath it noindex", () => {
  const source = readFileSync(join("app", "admin", "layout.tsx"), "utf8");
  assert.match(source, /robots:\s*\{[^}]*index:\s*false/);
});

test("the portal root layout marks everything beneath it noindex", () => {
  const source = readFileSync(join("app", "portal", "layout.tsx"), "utf8");
  assert.match(source, /robots:\s*\{[^}]*index:\s*false/);
});

test("every section under /admin gates on a signed-in user", () => {
  // Checked at the LAYOUT level on purpose: individual pages inherit the gate,
  // so requiring it per page would be noise. But a section whose layout omits
  // it exposes every page inside that section at once.
  const sections = readdirSync(join("app", "admin"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // login is the one page that must be reachable signed out.
    .filter((name) => name !== "login");

  for (const section of sections) {
    const layouts = layoutsUnder(join("app", "admin", section));
    if (layouts.length === 0) continue; // inherits the parent section's gate
    const gated = layouts.some((path) => {
      const source = readFileSync(path, "utf8");
      return source.includes("getSessionUser") && source.includes("redirect");
    });
    assert.ok(gated, `app/admin/${section} has a layout but no server-side auth gate`);
  }
});
