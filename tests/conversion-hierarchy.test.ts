import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const home = readFileSync("app/HomePageClient.tsx", "utf8");
const chrome = readFileSync("components/SiteChrome.tsx", "utf8");
const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
const chat = readFileSync("components/SiteChat.tsx", "utf8");
const form = readFileSync("components/ShortRequestForm.tsx", "utf8");
const tile = readFileSync("components/AttachmentTile.tsx", "utf8");
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
  const chatConfig = brand.match(/chat:\s*\{([^}]+)\}/)?.[1];
  assert.ok(chatConfig, 'The brand config supplies chat capability and policy');
  assert.match(chatConfig, /enabled:\s*true/);
  assert.match(chatConfig, /label:\s*'Chat'/);
  assert.match(chatConfig, /openEvent:\s*'p5:chat-open'/);
  assert.match(chatConfig, /hiddenOn:\s*\['\/admin\*', '\/portal\*'\]/);
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
  // Form v2 (owner, 1 November; clarity standard, 11 November): Step 1 shows
  // only what we need to call back: the easy, interesting question, then name
  // and phone. Everything optional sits in one closed dropdown after them, and
  // the attachment tile lives on Step 2 only, inside its own closed dropdown.
  const noteAt = form.indexOf('name="note"');
  const nameAt = form.indexOf('name="name"');
  const phoneAt = form.indexOf('name="phone"');
  const optionsAt = form.indexOf('data-testid="quote-options"');
  const emailAt = form.indexOf('name="email"');
  const reachAt = form.indexOf('name="contact_preference"');
  const submitAt = form.indexOf('type="submit"');
  assert.ok(noteAt > -1 && nameAt > noteAt && phoneAt > nameAt && optionsAt > phoneAt);
  assert.ok(emailAt > optionsAt && reachAt > emailAt && submitAt > reachAt, "Email and reach sit inside the Step 1 dropdown");
  const options = form.slice(form.lastIndexOf("<details", optionsAt), form.indexOf("</details>", optionsAt));
  assert.match(options, /open=\{optionsOpen\}/);
  assert.match(form, /const \[optionsOpen, setOptionsOpen\] = useState\(false\)/);
  assert.match(options, /Add an email or choose how we reach you <span className="quote-form-optional">\(optional\)<\/span>/);
  assert.match(options, /name="email"[\s\S]*name="contact_preference"/);
  // A restored draft with an email or a non-default reach opens it; so does an email error.
  assert.match(form, /if \(restored\.email\.trim\(\) \|\| restored\.reach !== DEFAULT_REACH\) setOptionsOpen\(true\)/);
  assert.match(form, /if \(field === "email" && !optionsOpen\) \{[\s\S]*?setOptionsOpen\(true\);\s*window\.requestAnimationFrame\(focus\)/);
  // No attachment tile and no file field on Step 1.
  assert.equal((form.match(/<AttachmentTile/g) ?? []).length, 1);
  assert.doesNotMatch(form, /<AttachmentTile name="files"|files_expected/);
  const stepTwoAt = form.indexOf('data-testid="quote-details-disclosure"');
  assert.ok(stepTwoAt > -1 && form.indexOf("<AttachmentTile") > stepTwoAt && form.indexOf("<AttachmentTile") < form.indexOf("</details>", stepTwoAt));
  // The steps line names both steps above the fields and flips to "Request sent".
  assert.match(form, /\{sent \? "Request sent" : "Your request"\}/);
  assert.match(form, /Photos and details \(optional\)/);
  assert.ok(form.indexOf("<QuoteSteps sent={Boolean(done)} />") < form.indexOf('className="quote-form-done"'));
  assert.match(form, /What can we help with\?/);
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
  // Under the heading: two native toggle buttons, styled as quiet underline
  // tabs so the active one cannot be mistaken for the send button.
  const modesAt = form.indexOf('className="quote-form-modes"');
  const modes = form.slice(modesAt, form.indexOf('className="quote-form-field"', modesAt));
  assert.match(modes, /aria-pressed=\{!callback\}[\s\S]*Send a request[\s\S]*aria-pressed=\{callback\}[\s\S]*Have us call you/);
  assert.equal((modes.match(/type="button"/g) ?? []).length, 2);
  assert.ok(form.indexOf("{done") < modesAt && modesAt < form.indexOf('name="note"'));
  const modeRule = css.slice(css.indexOf('.quote-form-mode[aria-pressed="true"]'), css.indexOf("}", css.indexOf('.quote-form-mode[aria-pressed="true"]')));
  assert.match(modeRule, /border-bottom-color: var\(--charcoal\)/);
  assert.doesNotMatch(modeRule, /background/, "The active tab is not filled like the send button");
  // Call, text and chat: one quiet line of links under the one send button, all tracked as before.
  assert.match(form, /<TrackedPhoneLink className="quote-form-talk-link" location="quote_form">\s*Call \{PUBLIC_PHONE_DISPLAY\}/);
  assert.match(form, /href=\{PUBLIC_PHONE_SMS\}\s*onClick=\{\(\) => track\("text_click", \{ location: "quote_form" \}\)\}/);
  assert.match(form, /<OpenChatButton className="quote-form-talk-link" location="quote_form">/);
  assert.doesNotMatch(form, /quote-form-talk-button/);
  assert.ok(form.indexOf("{talk}") > form.indexOf('type="submit"'), "Call, text and chat sit under the send button");
  assert.equal((form.match(/type="submit"/g) ?? []).length, 1);
  assert.match(form, /That is all we need\. You can add photos or plans after you send\./);
  assert.match(form, /We call you back during business hours\./);
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
  // One attachment tile, the family pattern, instead of the raw file control.
  assert.match(tile, /label = "Add photos, plans or files"/);
  assert.match(tile, /\{label\} <span className="quote-form-optional">\(optional\)<\/span>/);
  assert.match(tile, /Photos, PDFs or drawings\. Up to 10 files, 20 MB each\./);
  assert.match(tile, /type="file"\s+multiple\s+accept=\{ATTACHMENT_ACCEPT\}/);
  assert.match(tile, /ATTACHMENT_ACCEPT = "image\/\*,application\/pdf,\.heic,\.heif"/);
  assert.doesNotMatch(tile, /required/);
  assert.match(form, /name="contact_preference"/);
  // Project type, address, timing and files are Step 2 on the success screen:
  // one closed dropdown under a plain "nothing else is needed", with no Skip
  // button (leaving it closed is skipping).
  assert.match(form, /You are all set\. Nothing else is needed\./);
  const stepTwo = form.slice(form.indexOf('data-testid="quote-details-disclosure"'));
  assert.match(form, /<details className="quote-form-disclosure" data-testid="quote-details-disclosure">/);
  assert.match(stepTwo, /Add photos, plans or project details <span className="quote-form-optional">\(optional\)<\/span>/);
  for (const field of ["details_project", "details_address", "details_timing", "details_email"]) {
    assert.ok(stepTwo.indexOf(`name="${field}"`) > -1 && stepTwo.indexOf(`name="${field}"`) < stepTwo.indexOf("</details>"), `${field} sits inside the Step 2 dropdown`);
  }
  assert.match(stepTwo, /Each one helps us give you a closer quote on the first call\./);
  assert.match(stepTwo, /Save details/);
  assert.doesNotMatch(form, /Help us prepare|>\s*Skip\s*<|"skipped"/);
  assert.ok(form.indexOf("You are all set. Nothing else is needed.") < form.indexOf('data-testid="quote-details-disclosure"'));
  assert.match(form, /track\("lead_details_added"/);
  assert.equal((form.match(/trackAcceptedInquiry\(\)/g) ?? []).length, 1);
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
    tile,
    readFileSync("app/api/leads/short-request/details/route.ts", "utf8"),
    readFileSync("app/api/leads/short-request/files/route.ts", "utf8"),
    readFileSync("app/lib/leads/intakeContract.ts", "utf8"),
    readFileSync("docs/lead-intake-contract.md", "utf8"),
  ].join("\n");
  assert.equal(fresh.includes("\u2014"), false);
  assert.equal(fresh.includes("\u2013"), false);
  assert.match(sessions, /PARTIAL_COMPLETION_EMAILS_ENABLED = false/);
});
