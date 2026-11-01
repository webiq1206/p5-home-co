import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const home = readFileSync("app/HomePageClient.tsx", "utf8");
const chrome = readFileSync("components/SiteChrome.tsx", "utf8");
const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
const chat = readFileSync("components/SiteChat.tsx", "utf8");
const form = readFileSync("components/ShortRequestForm.tsx", "utf8");
const bar = readFileSync("components/LandingContactBar.tsx", "utf8");
// The header, menu and bottom bar are the shared family chrome; P5's choices live in lib/familyBrand.ts.
const mobile = readFileSync("components/family/MobileActionBar.tsx", "utf8");
const brand = readFileSync("lib/familyBrand.ts", "utf8");
const sessions = readFileSync("app/lib/leads/estimatorSessions.ts", "utf8");

test("hub pages keep call and chat, with one request entry below the hero", () => {
  // The homepage hero is the family HeroPhoto: photograph, H1, one support line, one action.
  const heroStart = home.indexOf("<HeroPhoto");
  const heroEnd = home.indexOf("/>", heroStart);
  const hero = home.slice(heroStart, heroEnd);
  assert.ok(heroStart > -1);
  assert.match(hero, /image=\{\{ \.\.\.HERO_IMAGE/);
  assert.match(hero, /title=/);
  assert.doesNotMatch(hero, /ShortRequestForm/);
  // Phase 3 plan (owner approved 31 October): credibility before the ask. The
  // homepage carries a short "Start your request" entry that keeps the
  // #request-form anchor and links to /quote, where the one working wizard lives.
  assert.equal(home.match(/<ShortRequestForm/g), null);
  const entry = home.indexOf('id="request-form"');
  assert.ok(entry > heroEnd);
  const entryEnd = home.indexOf("</section>", entry);
  assert.match(home.slice(entry, entryEnd), /href="\/quote"/);
  assert.match(home.slice(entry, entryEnd), /Start your request/);
  for (const before of ['className="stat-row"', 'className="trust-strip"', "<CompanyFinder", 'id="companies"', 'id="adu"']) {
    const at = home.indexOf(before);
    assert.ok(at > heroEnd && at < entry, `${before} sits between the hero and the request entry`);
  }
  // Chat stays in the header and the menu: the family header's compact actions and the menu tiles.
  assert.match(chrome, /<SiteHeader \/>/);
  assert.match(brand, /phoneActions: \['call', 'chat', 'text'\]/);
  assert.match(brand, /chat: \{ enabled: true, label: 'Chat', openEvent: 'p5:chat-open' \}/);
  assert.match(chat, /addEventListener\("p5:chat-open"/);
  assert.match(home, /SiteChrome/);
  const quoteHeroStart = quote.indexOf('className="quote-hero"');
  const quoteRequestStart = quote.indexOf('className="quote-request"');
  assert.ok(quoteHeroStart > -1 && quoteRequestStart > quoteHeroStart);
  assert.doesNotMatch(quote.slice(quoteHeroStart, quoteRequestStart), /ShortRequestForm/);
  assert.equal(quote.match(/<ShortRequestForm/g)?.length, 1);
  assert.match(quote, /<h1>A specialist team for your home project<\/h1>/);
  assert.doesNotMatch(quote, /P5Estimator/);
  assert.match(bar, /PUBLIC_PHONE_TEL/);
  assert.match(bar, /PUBLIC_PHONE_SMS/);
  assert.match(bar, /<OpenChatButton/);
  // The bottom bar: Call plus the one primary, "Request a quote" to /quote, never chat.
  assert.match(brand, /cta: \{ label: 'Request a quote', href: '\/quote' \}/);
  assert.match(mobile, /href=\{brand\.cta\.href\}/);
  assert.doesNotMatch(mobile, /openSiteChat|chat/i);
  assert.match(form, /state\.step === "email"/);
  assert.match(form, /state\.step === "phone"/);
  assert.match(form, /state\.step === "note"/);
  assert.match(form, /Your name/);
  const css = readFileSync("app/globals.css", "utf8");
  // The hero is sized against the small viewport (family-chrome.css), never 100vh under the header.
  assert.match(readFileSync("styles/family-chrome.css", "utf8"), /--fam-hero-available: calc\(100svh - var\(--header-height\)/);
  assert.match(css, /--color-primary:\s*var\(--bronze\)/);
  assert.match(home, /CompanyFinder/);
  // One action in the hero: the primary, with no phone link, microcopy or extra button.
  assert.equal((hero.match(/primary=\{/g) || []).length, 1);
  assert.doesNotMatch(hero, /\blink=|microcopy=|tel:|<button/);
  assert.match(hero, /Request a quote/);
  assert.match(form, /quote-wizard/);
  assert.match(form, /choice-card/);
});

test("the short form requires name, phone, email, and a project note, and files stay optional", () => {
  for (const field of ["name", "phone", "email", "note"]) {
    assert.match(form, new RegExp(`name="${field}"[^>]*required|required[^>]*name="${field}"`));
  }
  assert.match(form, /name="email"/);
  assert.match(form, /Project note/);
  assert.match(form, /type="file"/);
  assert.match(form, /Optional/);
  assert.doesNotMatch(form, /type="file"[^>]*required/);
  const route = readFileSync("app/api/leads/short-request/route.ts", "utf8");
  assert.match(route, /Enter an email address/);
  assert.match(route, /Add a short note about the project/);
  assert.doesNotMatch(chat, /type="file"/);
  assert.match(chat, /visualViewport/);
  assert.doesNotMatch(chat, /continueAssistantProject/);
  assert.match(chat, /Request a quote/);
  assert.doesNotMatch(readFileSync("components/P5Estimator.tsx", "utf8"), /short-request/);
});

test("new lead copy has no em or en dashes, and partial emails stay off", () => {
  const fresh = [
    form,
    chat,
    readFileSync("app/api/leads/short-request/route.ts", "utf8"),
    readFileSync("components/SiteChat.module.css", "utf8"),
  ].join("\n");
  assert.equal(fresh.includes("\u2014"), false);
  assert.equal(fresh.includes("\u2013"), false);
  assert.match(sessions, /PARTIAL_COMPLETION_EMAILS_ENABLED = false/);
});
