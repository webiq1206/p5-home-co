import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(new URL("../app/legal/privacy/page.tsx", import.meta.url), "utf8");
const visible = source.replace(/<[^>]+>/g, "").replace(/\{`|`\}/g, "").replace(/\s+/g, " ");

const disclosure = "Cookies, analytics and advertising. We use Google Analytics 4 (GA4) to understand how visitors use this site, such as pages viewed, referring site, approximate location, browser and device type. We use Google Ads conversion tracking to measure which of our ads lead to calls, form submissions and completed estimates, and Google may use cookies to show our ads to people who have visited this site (remarketing). These tools set cookies and receive information about your visit, including your IP address, which Google processes under its own privacy policy (https://policies.google.com/privacy). We do not currently send your name, email, phone number, address or project description to Google; Google Analytics receives only the type of project you choose (for example, an addition or an ADU) when you use the estimator or send an inquiry. You can opt out of personalized Google ads at https://adssettings.google.com, use the Google Analytics opt-out add-on at https://tools.google.com/dlpage/gaoptout, or block or delete cookies in your browser; the site will still work.";

test("privacy section 5 opens with the cookies, analytics and advertising disclosure", () => {
  assert.match(visible, /5\. Cookies and analytics/);
  assert.equal(visible.includes(disclosure), true);
  assert.equal(visible.includes("The public website uses analytics and marketing cookies"), false);
  assert.equal(visible.includes("We also use the Meta Pixel"), false);
});

test("privacy section 5 keeps the existing cookie sentences after the new disclosure", () => {
  const section = visible.slice(visible.indexOf("5. Cookies and analytics"), visible.indexOf("6. How long we keep it"));
  assert.equal(section.includes("You can block or delete cookies in your browser settings; the site will still work."), true);
  assert.equal(section.includes("The portals use a strictly necessary cookie to keep you signed in, which cannot be turned off without ending your session."), true);
  assert.equal(section.indexOf(disclosure) < section.indexOf("You can block or delete cookies in your browser settings"), true);
});

test("the privacy page date shows this wording change", () => {
  assert.match(source, /Last updated 17 October 2026/);
  assert.equal(source.includes("Last updated 23 August 2026"), false);
});

test("section 5 names neither Microsoft Clarity nor Meta", () => {
  const section = visible.slice(visible.indexOf("5. Cookies and analytics"), visible.indexOf("6. How long we keep it"));
  for (const sentence of [
    "Microsoft Clarity",
    "We also use the Meta Pixel",
    "Meta's pixel",
    "https://www.facebook.com/privacy/policy",
  ]) {
    assert.equal(section.includes(sentence), false, sentence);
  }
});

test("the public site does not load Clarity or a Meta pixel", () => {
  const root = new URL("..", import.meta.url);
  const hits: string[] = [];
  const skip = new Set(["node_modules", ".next"]);
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        visit(path);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs|jsx|html)$/.test(name)) continue;
      const text = readFileSync(path, "utf8");
      if (/clarity\.ms|js\.clarity\.ms|fbevents|connect\.facebook|facebook\.net|fbq\s*\(/.test(text)) hits.push(path);
    }
  };
  for (const dir of ["app", "components", "lib", "public"]) visit(new URL(dir, root).pathname);
  assert.deepEqual(hits, []);
});
