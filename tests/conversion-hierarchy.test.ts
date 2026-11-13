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
  // Chat stays on every public P5 page. The one addition is the estimator embed, which the
  // brand sites frame: the P5 chat launcher does not belong inside another site's page.
  assert.match(chatConfig, /hiddenOn:\s*\['\/admin\*', '\/portal\*', '\/estimator\/embed\*'\]/);
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
  const css = readFileSync("app/globals.css", "utf8");
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
  // A quiet text toggle, not a box: a plus and one muted line, with the fields inline when open.
  assert.match(options, /className="quote-form-toggle"/);
  assert.match(options, /<summary>\s*<PlusIcon \/>\s*<span>Add address, email or contact preference \(optional\)<\/span>\s*<\/summary>/);
  const toggleRules = css.split("\n").filter((line) => /^\.quote-form-toggle\b/.test(line)).join("\n") + css.slice(css.indexOf(".quote-form-toggle > summary {"), css.indexOf("}", css.indexOf(".quote-form-toggle > summary {")));
  assert.doesNotMatch(toggleRules, /border|background|box-shadow/, "The toggle has no box");
  // The optional project address is the toggle's first field, above email: never required, never checked.
  assert.match(options, /<label htmlFor=\{ids\.projectAddress\}>Project address<\/label>\s*<input[^>]*name="address"\s+type="text"\s+autoComplete="street-address"\s+maxLength=\{300\}/);
  assert.match(options, /Leave blank if you do not have one yet\./);
  assert.match(options, /name="address"[\s\S]*name="email"[\s\S]*name="contact_preference"/);
  assert.doesNotMatch(options.slice(options.indexOf('name="address"'), options.indexOf('name="email"')), /required|aria-invalid/);
  assert.match(form, /body\.set\("email", draft\.email\.trim\(\)\);\s*body\.set\("address", draft\.address\.trim\(\)\);/);
  // The call-back side sends no address.
  assert.ok(form.indexOf('body.set("address"') > form.indexOf('body.set("request_type", "request")'));
  // A restored draft with an email or a non-default reach opens it; so does an email error.
  assert.match(form, /if \(restored\.address\.trim\(\) \|\| restored\.email\.trim\(\) \|\| restored\.reach !== DEFAULT_REACH\) setOptionsOpen\(true\)/);
  assert.match(form, /if \(field === "email" && !optionsOpen\) \{[\s\S]*?setOptionsOpen\(true\);\s*window\.requestAnimationFrame\(focus\)/);
  // No attachment tile and no file field on Step 1.
  assert.equal((form.match(/<AttachmentTile/g) ?? []).length, 1);
  assert.doesNotMatch(form, /<AttachmentTile name="files"|files_expected/);
  const stepTwoAt = form.indexOf('data-testid="quote-details-disclosure"');
  assert.ok(stepTwoAt > -1 && form.indexOf("<AttachmentTile") > stepTwoAt && form.indexOf("<AttachmentTile") < form.indexOf("</details>", stepTwoAt));
  // Clean layout (owner, 11 November): no step indicator, tabs, footnote or chevron box, in the form or its styles.
  assert.doesNotMatch(form, /QuoteSteps|quote-form-steps|quote-form-next|quote-form-disclosure|ChevronIcon|That is all we need/);
  assert.doesNotMatch(css, /quote-form-steps|quote-form-step-badge|quote-form-next|quote-form-disclosure|quote-form-chevron|quote-form-more|quote-form-talk-link/);
  assert.match(form, /What can we help with\?/);
  // Name and phone share one row from 640px up.
  const pairAt = form.indexOf('className="quote-form-pair"');
  assert.ok(pairAt > noteAt && pairAt < nameAt && phoneAt < optionsAt);
  assert.match(css, /@media \(min-width: 640px\) \{\s*\.quote-form-pair \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
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
  // One muted line under the one send button: "Prefer to talk? Call ... or have us call you."
  // The same two native toggle buttons as before, in one group; only the one for the other
  // mode shows, as a text link, and the active one stays in the DOM, pressed and visually hidden.
  const talkAt = form.indexOf("const talk = (");
  const talk = form.slice(talkAt, form.indexOf("</p>", talkAt));
  assert.match(talk, /Prefer to talk\?\{" "\}\s*<TrackedPhoneLink className="quote-form-line-link" location="quote_form">\s*Call \{PUBLIC_PHONE_DISPLAY\}/);
  assert.match(talk, /"Rather write it down\? "/);
  assert.match(talk, /className="quote-form-modes" role="group" aria-label="How would you like to start\?">\s*\{modeButton\("request", "Send a request"\)\}\s*\{modeButton\("callback", "Have us call you"\)\}/);
  assert.match(form, /className=\{active \? "quote-form-mode short-request-sr" : "quote-form-mode quote-form-line-link"\}\s*aria-pressed=\{active\}/);
  assert.equal((form.match(/aria-pressed=/g) ?? []).length, 1);
  // Text and chat left the form; the header and the bottom bar still carry them.
  assert.doesNotMatch(form, /OpenChatButton|quote-form-talk-button|quote-form-talk-link|SaveContactButton/);
  assert.doesNotMatch(talk, /PUBLIC_PHONE_SMS|sms:/);
  const submitTag = form.indexOf('type="submit"');
  assert.ok(form.indexOf("{talk}") > submitTag, "The call line sits under the send button");
  assert.equal((form.match(/type="submit"/g) ?? []).length, 1);
  // Then one small line, and nothing else before the status message.
  const afterSend = form.slice(form.indexOf("{talk}"), form.indexOf("{status && ("));
  assert.match(afterSend, /^\{talk\}\s*<p className="quote-form-line quote-form-legal">\s*No obligation\. <Link href="\/legal\/privacy">Privacy Policy<\/Link>\s*<\/p>\s*$/);
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
  // The toggle it sits behind already says "(optional)"; the tile does not repeat it.
  assert.match(tile, /<span className="attach-tile-label">\s*\{label\}\s*<\/span>/);
  assert.doesNotMatch(tile, /\(optional\)<|Optional\./);
  // Inside the form "(optional)" marks only the three toggle summaries and the visible "Best time to call".
  const marked = form.split("\n").filter((line) => /\(optional\)</.test(line)).map((line) => line.trim());
  assert.deepEqual(marked, [
    "<span id={ids.details}>Add photos, plans or details (optional)</span>",
    "<span>Answer two quick questions for us (optional)</span>",
    'Best time to call <span className="quote-form-optional">(optional)</span>',
    "<span>Add address, email or contact preference (optional)</span>",
  ]);
  assert.match(form, /<label htmlFor=\{ids\.email\}>\s*Email\s*<\/label>/);
  assert.match(form, /<label htmlFor=\{ids\.detailsEmail\}>\s*Email\s*<\/label>/);
  // The last link of each muted line keeps its full stop: both sit in one nowrap span.
  assert.match(form, /<span className="quote-form-nowrap">\s*<span className="quote-form-modes"[\s\S]*?<\/span>\s*\{callback \? null : "\."\}\s*<\/span>/);
  assert.match(form, /<span className="quote-form-nowrap">\s*<TrackedPhoneLink className="quote-form-line-link" location="form_thanks">[\s\S]*?<\/TrackedPhoneLink>\s*\.\s*<\/span>/);
  assert.match(readFileSync("app/globals.css", "utf8"), /\.quote-form-nowrap \{ white-space: nowrap; \}/);
  assert.match(tile, /Photos, PDFs or drawings\. Up to 10 files, 20 MB each\./);
  assert.match(tile, /type="file"\s+multiple\s+accept=\{ATTACHMENT_ACCEPT\}/);
  assert.match(tile, /ATTACHMENT_ACCEPT = "image\/\*,application\/pdf,\.heic,\.heif"/);
  assert.doesNotMatch(tile, /required/);
  assert.match(form, /name="contact_preference"/);
  // Project type, address, timing and files are Step 2 on the success screen:
  // one closed dropdown under a plain "nothing else is needed", with no Skip
  // button (leaving it closed is skipping).
  // One sentence about what happens next, ending "Nothing else is needed.".
  const allSetAt = form.indexOf('data-testid="quote-all-set"');
  const allSet = form.slice(allSetAt, form.indexOf("</p>", allSetAt));
  assert.match(allSet, /answers your questions and helps you work out the next step, which may be a time to visit\.`\}\{" "\}\s*Nothing else is needed\.\s*$/);
  const doneAt = form.indexOf('className="quote-form-done"');
  assert.equal(form.slice(doneAt, allSetAt).includes("<p"), true);
  assert.equal((form.slice(doneAt, allSetAt).match(/<p\b/g) ?? []).length, 1, "The sentence is the first thing on the sent screen");
  const stepTwo = form.slice(form.indexOf('data-testid="quote-details-disclosure"'));
  assert.match(form, /<details className="quote-form-toggle" data-testid="quote-details-disclosure">/);
  assert.match(stepTwo, /<summary>\s*<PlusIcon \/>\s*<span id=\{ids\.details\}>Add photos, plans or details \(optional\)<\/span>\s*<\/summary>/);
  // The feedback questions wait behind their own toggle and only after details are saved.
  assert.match(form, /\{showDetails && detailsState === "saved" \? \(\s*<details className="quote-form-toggle quote-form-feedback">/);
  // The sent screen ends with one muted call line.
  assert.match(form.slice(form.indexOf("<ThanksQuestions />")), /Prefer to talk\?\{" "\}\s*<span className="quote-form-nowrap">\s*<TrackedPhoneLink className="quote-form-line-link" location="form_thanks">/);
  // Step 2 never re-asks what Step 1 has: its address and email show only when Step 1 had none.
  assert.match(stepTwo, /\{!done\.hadAddress && \(\s*<div className="quote-form-field">\s*<label htmlFor=\{ids\.address\}>Address or ZIP code<\/label>/);
  assert.match(stepTwo, /\{!done\.hadEmail && \(/);
  assert.match(form, /hadAddress: !callback && Boolean\(draft\.address\.trim\(\)\)/);
  for (const field of ["details_project", "details_address", "details_timing", "details_email"]) {
    assert.ok(stepTwo.indexOf(`name="${field}"`) > -1 && stepTwo.indexOf(`name="${field}"`) < stepTwo.indexOf("</details>"), `${field} sits inside the Step 2 dropdown`);
  }
  assert.match(stepTwo, /Save details/);
  assert.doesNotMatch(form, /Help us prepare|>\s*Skip\s*<|"skipped"/);
  assert.ok(allSetAt < form.indexOf('data-testid="quote-details-disclosure"'));
  assert.doesNotMatch(form, /Save our contact|Have a question now|You get a written scope before any price/);
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
