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
  // Owner, 1 November: "Request a quote" lands directly on the form. On /quote
  // the page heading and the form come first; no hero, photo, eyebrow or
  // paragraph sits in front of them, and the explanation follows the form.
  assert.equal(quote.includes('className="quote-hero"'), false);
  const mainStart = quote.indexOf('<main className="quote-main">');
  const quoteRequestStart = quote.indexOf('className="quote-request quote-request-first"');
  const formAt = quote.indexOf("<ShortRequestForm");
  const asideAt = quote.indexOf('className="quote-request-aside"');
  assert.ok(mainStart > -1 && quoteRequestStart > mainStart && formAt > quoteRequestStart && asideAt > formAt);
  const beforeForm = quote.slice(mainStart, formAt);
  assert.doesNotMatch(beforeForm, /<img|<p\b|<ul\b|quote-eyebrow|quote-lead/);
  assert.match(beforeForm, /<h1>A specialist team for your home project<\/h1>/);
  assert.match(quote.slice(formAt), /id="request-form"/);
  for (const later of ['className="quote-proof"', 'className="quote-photos"', 'className="quote-steps"', 'className="quote-faq"']) {
    assert.ok(quote.indexOf(later) > asideAt, `${later} follows the form`);
  }
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
  // One short screen: name, phone, then what they need, in that order.
  const nameAt = form.indexOf('name="name"');
  const phoneAt = form.indexOf('name="phone"');
  const noteAt = form.indexOf('name="note"');
  assert.ok(nameAt > -1 && phoneAt > nameAt && noteAt > phoneAt);
  assert.match(form, /What do you need\?/);
  const css = readFileSync("app/globals.css", "utf8");
  // The hero is sized against the small viewport (family-chrome.css), never 100vh under the header.
  assert.match(readFileSync("styles/family-chrome.css", "utf8"), /--fam-hero-available: calc\(100svh - var\(--header-height\)/);
  assert.match(css, /--color-primary:\s*var\(--bronze\)/);
  assert.match(home, /CompanyFinder/);
  // One action in the hero: the primary, with no phone link, microcopy or extra button.
  assert.equal((hero.match(/primary=\{/g) || []).length, 1);
  assert.doesNotMatch(hero, /\blink=|microcopy=|tel:|<button/);
  assert.match(hero, /Request a quote/);
  assert.doesNotMatch(form, /quote-wizard|data-wizard-step|pushState/);
  assert.match(form, /data-suppress-mobile-bar=""/);
  // Call, text, or have us call you, on the form itself.
  // Family segmented control under the heading: two native toggle buttons.
  const modes = form.slice(form.indexOf('className="quote-form-modes"'), form.indexOf('className="quote-form-field"'));
  assert.match(modes, /aria-pressed=\{!callback\}[\s\S]*Send a request[\s\S]*aria-pressed=\{callback\}[\s\S]*Have us call you/);
  assert.equal((modes.match(/type="button"/g) ?? []).length, 2);
  assert.ok(form.indexOf("{done") < form.indexOf('className="quote-form-modes"') && form.indexOf('className="quote-form-modes"') < form.indexOf('name="name"'));
  // Call full width with the phone icon, then text and chat, all tracked as before.
  assert.match(form, /<TrackedPhoneLink className="quote-form-talk-button quote-form-talk-call" location="quote_form">\s*<PhoneIcon/);
  assert.match(form, /href=\{PUBLIC_PHONE_SMS\}\s*onClick=\{\(\) => track\("text_click", \{ location: "quote_form" \}\)\}/);
  assert.match(form, /<OpenChatButton className="quote-form-talk-button" location="quote_form">/);
  assert.ok(form.indexOf("{talk}") < form.indexOf('type="submit"'), "Call and text sit above the button");
  assert.match(form, /Send my request/);
  assert.match(form, /trackAcceptedInquiry\(\)/);
  assert.match(form, /captureAttribution\(\)/);
});

test("the short form requires name, phone and a note; email and photos stay optional", () => {
  // Owner, 1 November: the easiest form there is. The lead pipeline reaches
  // people by phone (validateInboundLead needs an email or a phone), so email
  // is required only when the visitor picks "Email me". The callback shape is
  // covered by tests/short-request-shape.test.ts against the server checker.
  for (const field of ["name", "phone", "note"]) {
    assert.match(form, new RegExp(`name="${field}"[^>]*required|required[^>]*name="${field}"`, "s"));
  }
  assert.match(form, /name="email"[\s\S]*?required=\{draft\.reach === "email"\}/);
  assert.match(form, /type="tel"\s+inputMode="tel"\s+autoComplete="tel"/);
  assert.match(form, /autoComplete="name"/);
  assert.match(form, /autoComplete="email"/);
  assert.match(form, /Add photos <span className="quote-form-optional">\(optional\)<\/span>/);
  assert.match(form, /type="file"/);
  assert.doesNotMatch(form, /type="file"[^>]*required/);
  assert.match(form, /name="contact_preference"/);
  assert.match(form, /Add more detail \(optional\)/);
  assert.match(form, /short-request-trap/);
  const route = readFileSync("app/api/leads/short-request/route.ts", "utf8");
  assert.match(route, /readShortRequest\(/);
  const checker = readFileSync("app/lib/leads/shortRequest.ts", "utf8");
  assert.match(checker, /Enter an email address/);
  assert.match(checker, /Add a short note about the project/);
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
    readFileSync("app/lib/leads/shortRequest.ts", "utf8"),
    readFileSync("components/SiteChat.module.css", "utf8"),
  ].join("\n");
  assert.equal(fresh.includes("\u2014"), false);
  assert.equal(fresh.includes("\u2013"), false);
  assert.match(sessions, /PARTIAL_COMPLETION_EMAILS_ENABLED = false/);
});
