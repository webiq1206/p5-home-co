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

test("HubSpot waits for the first interaction, or at least 5 seconds after load", () => {
  const source = readFileSync("app/HubSpotScript.tsx", "utf8");
  for (const name of ["pointerdown", "keydown", "scroll", "touchstart"]) {
    assert.match(source, new RegExp(`"${name}"`));
  }
  const fallback = Number(source.match(/IDLE_FALLBACK_MS = (\d+)/)?.[1]);
  assert.ok(fallback >= 5000, `fallback is ${fallback} ms`);
  assert.match(source, /if \(!isPublic \|\| !interacted\) return null;/);
});

test("the homepage hero is in the server HTML without an entrance fade", () => {
  const page = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.match(page, /className="hero-image"/);
  assert.match(page, /id="hero-heading"/);
  assert.match(page, /hero-panel/);
  assert.doesNotMatch(page, /hero-shade/);
  const css = readFileSync("app/globals.css", "utf8");
  const heroImage = css.match(/\.hero-image \{[^}]+\}/)?.[0] || "";
  const heroCopy = css.match(/\.hero-copy \{[^}]+\}/)?.[0] || "";
  assert.equal(heroImage.includes("animation"), false);
  assert.equal(heroImage.includes("opacity"), false);
  assert.equal(heroCopy.includes("animation"), false);
  assert.equal(heroCopy.includes("opacity"), false);
  assert.equal(css.includes("heroReveal"), false);
  assert.equal(css.includes("hero-shade"), false);
  assert.match(css, /--color-primary/);
  assert.match(css, /--section-y/);
});
