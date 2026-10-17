import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { googleAdsCallClickLabel, googleAdsTextClickLabel } from '../app/site.ts';
import { googleTagBootstrap } from '../lib/analyticsBootstrap.ts';

const options = { hostname: 'example.com', measurementId: 'G-EXAMPLE', adsId: 'AW-EXAMPLE', phoneConversionLabel: 'PHONE', phoneNumber: '(208) 477-1169' };
function browser(hostname: string, webdriver = false, disabled = false) {
  const nodes: Record<string, unknown>[] = [];
  const storage = new Map(disabled ? [['p5_analytics_disabled', '1']] : []);
  const window = { location: { hostname, pathname: '/quote' }, dataLayer: [['event', 'queued_before_load']] };
  const context = vm.createContext({ window, navigator: { webdriver }, sessionStorage: {
    getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value),
  }, document: { getElementById: (id: string) => nodes.find(n => n.id === id), createElement: () => ({}), head: { appendChild: (n: Record<string, unknown>) => nodes.push(n) } } });
  return { nodes, window, context, storage };
}

test('real apex and www visitors load one tag and preserve conversion configuration', () => {
  for (const host of ['example.com', 'www.example.com']) {
    const b = browser(host);
    vm.runInContext(googleTagBootstrap(options), b.context);
    vm.runInContext(googleTagBootstrap(options), b.context);
    assert.equal(b.nodes.length, 1);
    assert.equal(b.nodes[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-EXAMPLE');
    const queued = b.window.dataLayer.map(args => Array.from(args));
    assert.equal(queued[0][1], 'queued_before_load');
    assert.deepEqual(queued.filter(args => args[0] === 'config').map(args => args[1]), ['G-EXAMPLE', 'AW-EXAMPLE', 'AW-EXAMPLE/PHONE']);
    assert.equal(b.storage.get('p5_entry_path'), '/quote');
  }
});

test('production builds on local, preview, unrelated and deceptive hosts send nothing', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', 'preview.replit.app', 'other.com', 'example.com.attacker.com']) {
    const b = browser(host);
    vm.runInContext(googleTagBootstrap(options), b.context);
    assert.equal(b.nodes.length, 0, host);
    assert.equal(b.window.dataLayer.length, 1, host);
  }
});

test('automated browsers and explicit QA sessions send nothing even on the live hostname', () => {
  for (const b of [browser('example.com', true), browser('example.com', false, true)]) {
    vm.runInContext(googleTagBootstrap(options), b.context);
    assert.equal(b.nodes.length, 0);
    assert.equal(b.window.dataLayer.length, 1);
  }
});

test('unavailable session storage does not break real visitor analytics', () => {
  const b = browser('example.com');
  vm.runInContext("sessionStorage.getItem = function () { throw new Error('unavailable'); }", b.context);
  vm.runInContext(googleTagBootstrap(options), b.context);
  assert.equal(b.nodes.length, 1);
});


test('the private saved-estimate QA path never touches analytics or session storage', () => {
  for (const path of ['/estimate/qa-saved', '/estimate/qa-saved/child']) {
    const b = browser('example.com');b.window.location.pathname=path;
    vm.runInContext("sessionStorage.getItem = sessionStorage.setItem = function () { throw new Error('storage must not be accessed'); }", b.context);
    vm.runInContext(googleTagBootstrap(options), b.context);
    assert.equal(b.nodes.length,0);assert.equal(b.window.dataLayer.length,1);
  }
  const normal=browser('example.com');normal.window.location.pathname='/estimate';
  vm.runInContext(googleTagBootstrap(options),normal.context);assert.equal(normal.nodes.length,1);
});


test('campaign attribution uses the same tag bootstrap with one business phone', () => {
  const b = browser('example.com');
  (b.context as Record<string, unknown>).URLSearchParams = URLSearchParams;
  (b.context as Record<string, unknown>).URL = URL;
  vm.runInContext("window.location.pathname='/services'; window.location.search='?gclid=click123&utm_source=google&utm_medium=cpc&email=ignore%40example.com'", b.context);
  vm.runInContext(googleTagBootstrap(options), b.context);
  const first = JSON.parse(b.storage.get('p5_attribution_first_v1') ?? '{}');
  const initialLatest = JSON.parse(b.storage.get('p5_attribution_latest_v1') ?? '{}');
  assert.equal(first.gclid, 'click123');
  assert.equal(initialLatest.landing_page, '/services');
  assert.equal(first.email, undefined);
  assert.equal(first.phone, undefined);
  // A subsequent on-site navigation must not clear attribution to direct.
  b.nodes.length = 0;
  vm.runInContext("window.location.pathname='/quote'; window.location.search=''", b.context);
  vm.runInContext(googleTagBootstrap(options), b.context);
  assert.equal(JSON.parse(b.storage.get('p5_attribution_first_v1') ?? '{}').gclid, 'click123');
  assert.equal(JSON.parse(b.storage.get('p5_attribution_latest_v1') ?? '{}').gclid, 'click123');
  b.nodes.length = 0;
  vm.runInContext("window.location.search='?utm_source=newsletter&utm_medium=email'; window.location.pathname='/contact'", b.context);
  vm.runInContext(googleTagBootstrap(options), b.context);
  assert.equal(JSON.parse(b.storage.get('p5_attribution_first_v1') ?? '{}').gclid, 'click123');
  const latest = JSON.parse(b.storage.get('p5_attribution_latest_v1') ?? '{}');
  assert.equal(latest.utm_source, 'newsletter');
  assert.equal(latest.gclid, undefined);
});

const clickOptions = { ...options, callClickLabel: googleAdsCallClickLabel, textClickLabel: googleAdsTextClickLabel };

function clickBrowser(hostname: string, webdriver = false, disabled = false) {
  const b = browser(hostname, webdriver, disabled);
  const listeners: Array<[string, (event: { target: unknown }) => void]> = [];
  (b.context as { document: { addEventListener: (type: string, fn: (event: { target: unknown }) => void) => void } }).document.addEventListener = (type, fn) => {
    listeners.push([type, fn]);
  };
  return { ...b, listeners };
}

function click(listener: (event: { target: unknown }) => void, href: string, nested = false) {
  const anchor = { getAttribute: (name: string) => (name === 'href' ? href : null), parentNode: null };
  listener({ target: nested ? { parentNode: anchor } : anchor });
}

function conversions(dataLayer: unknown[][]) {
  return dataLayer
    .map((args) => Array.from(args as ArrayLike<unknown>))
    .filter((args) => args[0] === 'event' && args[1] === 'conversion');
}

test('a tel or sms click fires one matching conversion and a second bind does not double it', () => {
  const b = clickBrowser('example.com');
  const source = googleTagBootstrap(clickOptions);
  vm.runInContext(source, b.context);
  vm.runInContext(source, b.context);
  assert.equal(b.listeners.length, 1);
  b.nodes.length = 0;
  vm.runInContext(source, b.context);
  assert.equal(b.listeners.length, 1);
  click(b.listeners[0][1], 'tel:+12084771169', true);
  click(b.listeners[0][1], 'sms:+12084771169?body=Hello');
  click(b.listeners[0][1], 'tel:+12084771169');
  click(b.listeners[0][1], 'mailto:hello@p5homeco.com');
  const fired = conversions(b.window.dataLayer);
  assert.deepEqual(fired.map((args) => String((args[2] as { send_to: string }).send_to)), [
    `AW-EXAMPLE/${googleAdsCallClickLabel}`,
    `AW-EXAMPLE/${googleAdsTextClickLabel}`,
    `AW-EXAMPLE/${googleAdsCallClickLabel}`,
  ]);
  assert.equal(b.window.dataLayer.some((args) => Array.from(args as ArrayLike<unknown>)[1] === 'phone_click'), false);
});

test('call and text conversions set no user_data and send no personal data', () => {
  const tapOnly = {
    hostname: 'example.com',
    measurementId: 'G-EXAMPLE',
    adsId: 'AW-EXAMPLE',
    callClickLabel: googleAdsCallClickLabel,
    textClickLabel: googleAdsTextClickLabel,
  };
  const b = clickBrowser('example.com');
  const source = googleTagBootstrap(tapOnly);
  assert.equal(source.includes('user_data'), false);
  vm.runInContext(source, b.context);
  click(b.listeners[0][1], 'tel:+12084771169');
  click(b.listeners[0][1], 'sms:+12084771169?body=Please%20call%20Nick');
  const queued = b.window.dataLayer.map((args) => Array.from(args as ArrayLike<unknown>));
  assert.equal(queued.some((args) => args[0] === 'set' && args[1] === 'user_data'), false);
  const fired = conversions(b.window.dataLayer);
  assert.equal(fired.length, 2);
  for (const args of fired) {
    const payload = args[2] as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload), ['send_to']);
    const serialized = JSON.stringify(payload);
    assert.equal(/user_data|email|phone|name|address|postal|12084771169|Nick/i.test(serialized), false);
  }
});

test('call and text clicks send nothing when analytics is off', () => {
  const cases = [
    clickBrowser('localhost'),
    clickBrowser('example.com', true),
    clickBrowser('example.com', false, true),
  ];
  const saved = clickBrowser('example.com');
  saved.window.location.pathname = '/estimate/qa-saved';
  cases.push(saved);
  for (const b of cases) {
    vm.runInContext(googleTagBootstrap(clickOptions), b.context);
    assert.equal(b.listeners.length, 0);
    assert.equal(conversions(b.window.dataLayer).length, 0);
  }
});

test('staff phone links do not count as ad clicks', () => {
  const b = clickBrowser('example.com');
  vm.runInContext(googleTagBootstrap(clickOptions), b.context);
  b.window.location.pathname = '/admin/lead/1';
  click(b.listeners[0][1], 'sms:2085550100');
  assert.equal(conversions(b.window.dataLayer).length, 0);
});

const SHARE_SENTENCE = "We do not sell personal information. We share limited information with Google to measure our ads, as described in section 5.";
const GOOGLE_TOOLS_SENTENCE = "We use Google Analytics to understand how visitors use this site and Google Ads to measure which of our ads lead to quote requests, calls and texts. These tools set cookies and receive information about your visit, including your IP address, which Google processes under its own privacy policy (https://policies.google.com/privacy).";
const TAP_DISCLOSURE = "When you tap Call or Text on our site, Google Ads is told that the tap happened, on which page, and the ad click identifier Google's tag saved if you arrived from one of our ads, so we can count calls and texts that come from our ads. The tap itself doesn't send Google your name, your own phone number or what you say or write.";
const CALL_AND_TEXT_DISCLOSURE = "On some of our Call and Text links, Google Analytics also records which link you used, such as the one in the header or footer.";
const STALE_TAP_SENTENCE = "When you tap Call or Text on our site, Google Ads is told that the tap happened and on which page, so we can count calls and texts that come from our ads. We don't send Google your name, phone number or the content of your call or message.";
const FORWARDING_DISCLOSURE = "If your call goes through a Google forwarding number, Google connects the call and can see the calling number and call length, but not what's said.";
const ATTRIBUTION_DISCLOSURE = "If you arrive from one of our ads or a link with campaign tags, our site saves the ad click identifier from that link (such as gclid, gbraid or wbraid) and the campaign tags in your browser for the rest of that visit. If you then send an inquiry, we keep them with your inquiry in our customer records so we can tell which ad or campaign led to it.";

function privacySource(): string {
  return readFileSync(new URL('../app/legal/privacy/page.tsx', import.meta.url), 'utf8');
}

function privacyText(): string {
  return privacySource().replace(/&apos;/g, "'").replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

/** True when app/ or components/ actually configure Google call forwarding. */
function tagSetupEnablesCallForwarding(): boolean {
  const root = new URL('..', import.meta.url);
  for (const name of ['app', 'components']) {
    for (const file of sourceFiles(new URL(`${name}/`, root).pathname)) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('phone_conversion_number')) return true;
      if (/googleTagBootstrap\s*\([\s\S]*?phoneConversionLabel/.test(source)) return true;
    }
  }
  return false;
}

test('approved privacy sentences name the Google share, the tools, and the tap', () => {
  const privacy = privacyText();
  const share = privacy.indexOf(SHARE_SENTENCE);
  const tools = privacy.indexOf(GOOGLE_TOOLS_SENTENCE);
  const tap = privacy.indexOf(TAP_DISCLOSURE);
  const links = privacy.indexOf(CALL_AND_TEXT_DISCLOSURE);
  assert.ok(share >= 0, 'section 4 share sentence');
  assert.ok(tools > share, 'Google tools paragraph comes after the share sentence');
  assert.ok(tap > tools, 'tap sentence comes after the Google tools paragraph');
  assert.ok(links > tap, 'call and text link sentence comes after the tap sentence');
  const forwarding = privacy.indexOf(FORWARDING_DISCLOSURE);
  assert.ok(forwarding > links, 'forwarding sentence comes right after the call and text link sentence');
  assert.equal(privacy.slice(links + CALL_AND_TEXT_DISCLOSURE.length, forwarding).trim(), '');
  const attribution = privacy.indexOf(ATTRIBUTION_DISCLOSURE);
  assert.ok(attribution > forwarding, 'campaign attribution sentence comes after the Google forwarding sentence');
  assert.equal(privacy.includes('dclid'), false);
  assert.equal(privacy.includes('90 days'), false);
  assert.equal(privacy.includes(STALE_TAP_SENTENCE), false);
  assert.match(privacySource(), /href="https:\/\/policies\.google\.com\/privacy"/);
  assert.equal(privacy.includes('we do not share it for advertising'), false);
});

test('the call-forwarding label and the forwarding disclosure stay paired', () => {
  assert.equal(tagSetupEnablesCallForwarding(), true);
  assert.equal(privacyText().includes(FORWARDING_DISCLOSURE), true);
});

test('the forwarding-number snippet is installed behind the analytics gates', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../lib/analyticsBootstrap.ts', import.meta.url), 'utf8');
  assert.match(layout, /phoneConversionLabel:\s*googleAdsPhoneConversionLabel/);
  assert.match(layout, /phoneNumber:\s*"\(208\) 477-1169"/);
  assert.match(layout, /callClickLabel: googleAdsCallClickLabel/);
  assert.match(layout, /textClickLabel: googleAdsTextClickLabel/);
  const gate = bootstrap.indexOf("p5_analytics_disabled");
  const snippet = bootstrap.indexOf("phone_conversion_number");
  assert.ok(gate >= 0 && snippet > gate, 'phone_conversion_number stays after the analytics gates');
  const site = readFileSync(new URL('../app/site.ts', import.meta.url), 'utf8');
  assert.match(site, /YHR0CIaPz_ccEKzf-q9E/);
  assert.match(site, new RegExp(googleAdsCallClickLabel));
  assert.match(site, new RegExp(googleAdsTextClickLabel));
});
