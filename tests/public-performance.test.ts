import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("HubSpot tracking still loads on the public site, after the page load event", () => {
  const source = readFileSync("app/HubSpotScript.tsx", "utf8");
  assert.match(source, /js-na2\.hs-scripts\.com\/\$\{hubspotPortalId\}\.js/);
  assert.match(source, /strategy="lazyOnload"/);
  assert.match(source, /isPrivatePath\(pathname\)/);
  assert.doesNotMatch(source, /strategy="afterInteractive"/);
});

test("the homepage hero is in the server HTML without an entrance fade", () => {
  const page = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(page, /<img className="hero-image"/);
  assert.match(page, /<h1 id="hero-heading">/);
  assert.match(page, /100\+ projects/);
  const css = readFileSync("app/globals.css", "utf8");
  const heroImage = css.match(/\.hero-image \{[^}]+\}/)?.[0] || "";
  const heroCopy = css.match(/\.hero-copy \{[^}]+\}/)?.[0] || "";
  assert.equal(heroImage.includes("animation"), false);
  assert.equal(heroImage.includes("opacity"), false);
  assert.equal(heroCopy.includes("animation"), false);
  assert.equal(heroCopy.includes("opacity"), false);
  assert.equal(css.includes("heroReveal"), false);
});
