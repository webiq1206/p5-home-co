import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/legal/privacy/page.tsx", "utf8");
const section = page.slice(page.indexOf("<h2>5. Cookies and analytics</h2>"), page.indexOf("<h2>6. How long we keep it</h2>")).replace(/\s+/g, " ");

test("the privacy page discloses Google Analytics 4 and Google Ads conversion tracking", () => {
  assert.match(section, /Google Analytics 4/);
  assert.match(section, /Google Ads conversion/);
  assert.match(section, /conversion event when a quote inquiry is accepted/);
  assert.match(section, /separate conversion event when a project estimate is finished/);
  assert.match(section, /do not include your name, email, phone number, or project details/);
  assert.match(section, /The public website uses analytics and marketing cookies/);
  assert.match(page, /Last updated 17 October 2026/);
});
