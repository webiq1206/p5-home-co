import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the forwarding-number snippet is not installed on the page', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../lib/analyticsBootstrap.ts', import.meta.url), 'utf8');
  assert.equal(layout.includes('phoneConversionLabel'), false);
  assert.equal(layout.includes('phone_conversion_number'), false);
  assert.match(layout, /callClickLabel: googleAdsCallClickLabel/);
  assert.match(layout, /textClickLabel: googleAdsTextClickLabel/);
  assert.match(bootstrap, /phone_conversion_number/);
  const site = readFileSync(new URL('../app/site.ts', import.meta.url), 'utf8');
  assert.match(site, new RegExp(googleAdsCallClickLabel));
  assert.match(site, new RegExp(googleAdsTextClickLabel));
});
