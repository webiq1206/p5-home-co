import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
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
