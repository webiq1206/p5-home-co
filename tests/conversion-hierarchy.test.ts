import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const home = readFileSync("app/HomePageClient.tsx", "utf8");
const chrome = readFileSync("components/SiteChrome.tsx", "utf8");
const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
const chat = readFileSync("components/SiteChat.tsx", "utf8");
const form = readFileSync("components/ShortRequestForm.tsx", "utf8");
const bar = readFileSync("components/LandingContactBar.tsx", "utf8");
const mobile = readFileSync("components/MobileActionBar.tsx", "utf8");
const sessions = readFileSync("app/lib/leads/estimatorSessions.ts", "utf8");

test("hub pages keep call and chat, with one short request below the hero", () => {
  const heroStart = home.indexOf('<section className="hero"');
  const heroEnd = home.indexOf("</section>", heroStart);
  const hero = home.slice(heroStart, heroEnd);
  assert.match(hero, /className="hero-image"/);
  assert.match(hero, /id="hero-heading"/);
  assert.doesNotMatch(hero, /ShortRequestForm/);
  assert.equal(home.match(/<ShortRequestForm/g)?.length, 1);
  assert.match(home, /<ShortRequestForm id="request-form"/);
  assert.ok(home.indexOf('<ShortRequestForm id="request-form"') > heroEnd);
  assert.match(chrome, /className="header-chat"/);
  assert.match(chrome, /<OpenChatButton/);
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
  assert.match(mobile, /href="\/quote"/);
  assert.match(mobile, /openSiteChat/);
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.hero \{[^}]*height: 100svh/);
  assert.doesNotMatch(css, /\.hero \{ height: auto; min-height: 0/);
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
