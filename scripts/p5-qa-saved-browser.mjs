import {chromium, webkit, expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
import ts from 'typescript';

// The isolated component mode exercises development StrictMode. The full-page
// mode loads the actual local production route with a synthetic in-memory admin
// session. Both use invented saved data and block unapproved browser requests;
// server revision fencing has separate isolated database tests.
const realPage = process.env.P5_QA_REAL_PAGE === '1';
const origin = realPage ? 'http://127.0.0.1:5001' : 'http://qa-saved-fixture.test';
const fixtureCookie = realPage ? {name: 'p5_session', value: 'p5-qa-saved-layout-synthetic-session'} : {name: 'qa_fixture_session', value: 'synthetic-only'};
const api = '/api/admin/p5-estimators/qa-saved-estimate';
const revision = 6;
const endpoint = `${api}?case=case-1&revision=${revision}`;
const output = 'p5-verification';
const engine = process.env.P5_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine), 'Use Chromium or WebKit.');

const entry = `
  import {StrictMode, useEffect} from 'react';
  import {createRoot} from 'react-dom/client';
  import Saved from './components/P5QaSavedEstimate';
  function Probe() {
    useEffect(() => {
      window.__qaStrict.mounts += 1;
      return () => { window.__qaStrict.cleanups += 1; };
    }, []);
    return <Saved revision={${revision}}/>;
  }
  createRoot(document.getElementById('root')).render(<StrictMode><Probe/></StrictMode>);
`;
const built = await build({
  stdin: {contents: entry, loader: 'tsx', resolveDir: process.cwd()},
  bundle: true, write: false, metafile: true, outfile: 'saved-fixture.js',
  format: 'iife', platform: 'browser', jsx: 'automatic',
  // Development mode is intentional: production React does not replay effects.
  define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
});
const code = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = built.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
// Ignore strings/comments such as esbuild's <define:process.env> label, but
// reject a real unresolved Node environment read before launching the browser.
let nodeEnvironmentReads = 0;
const browserSyntax = ts.createSourceFile('saved-fixture.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function inspectBrowserSyntax(node) {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process' && node.name.text === 'env') nodeEnvironmentReads += 1;
  ts.forEachChild(node, inspectBrowserSyntax);
}
inspectBrowserSyntax(browserSyntax);
assert.equal(nodeEnvironmentReads, 0, 'The standalone browser fixture must not depend on Node process.env.');
const inputs = Object.keys(built.metafile.inputs).map(path => path.replaceAll('\\', '/'));
assert.ok(inputs.includes('components/P5QaSavedEstimate.tsx'));
assert.ok(inputs.includes('components/P5Estimator.tsx'));
const forbiddenInput = /(?:^|\/)(?:pg|postgres|server-only)(?:\/|$)|(?:^|\/)lib\/(?:db(?:\.|\/)|providers?\/)|(?:^|\/)lib\/p5\/(?:qa(?!SavedEstimateView)|provider|projectMap)|(?:^|\/)app\/api\//i;
assert.deepEqual(inputs.filter(path => forbiddenInput.test(path)), [], 'No server QA, provider, project map or database implementation may enter the browser bundle.');
assert.doesNotMatch(code, /p5ds_qa_|qa-paid-|p5-acceptance-20261004|pg_is_in_recovery|DATABASE_URL|QA_PROJECT_MAP|qaProjectMap|\b(?:SELECT\s+.+?\s+FROM\s+p5_|INSERT\s+INTO\s+p5_|UPDATE\s+p5_)/i);
await mkdir(output, {recursive: true});

// Build the document with the same pure presenter used by saved estimates.
// This fixture uses only invented identities and amounts and never loads a DB.
const presenter = await build({
  stdin: {contents: "export {buildEstimateDocument} from './lib/p5/estimateDocument.ts'; export {customerPresentation} from './lib/p5/customerProjection.ts';", resolveDir: process.cwd()},
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const {buildEstimateDocument, customerPresentation} = await import(`data:text/javascript;base64,${Buffer.from(presenter.outputFiles[0].text).toString('base64')}`);
const result = customerPresentation({
  status: 'preliminary', range: {low: 12345, high: 12345},
  categoryRanges: [{category: 'Other Project Work', low: 12345, high: 12345}],
  lineItems: [{id: 'synthetic-repair', category: 'Other Project Work', description: 'Repair three interior doors', quantity: 3, unit: 'EA', low: 12345, high: 12345, unitLow: 4115, unitHigh: 4115, pricingStatus: 'owner-planning-rate'}],
  scopeTasks: [{description: 'Repair three interior doors', category: 'Other Project Work'}],
  summary: 'Synthetic saved Case 1 browser fixture.', includedCategories: ['Other Project Work'],
  allowances: [], assumptions: ['Synthetic doors are standard interior slabs.'],
  exclusions: ['Painting is excluded.'], factors: [], nextStep: 'Review the saved synthetic scope.',
  message: 'Synthetic saved planning amount.', disclaimer: 'This is not a bid or contract.',
});
const id = 'a1b2c3d4-1111-4111-8111-111111111111';
const document = buildEstimateDocument({
  id, result,
  brand: {id: 'synthetic', name: 'Synthetic QA Company', domain: 'example.invalid', email: 'qa@example.invalid', phone: '(202) 555-0100', accent: '#123456', ink: '#123456', logo: '', consultationPath: '/synthetic-review'},
  issue: {brandId: 'synthetic', reference: 'P5-A1B2C3D4', revision, issuedAt: '2026-10-06T12:00:00Z', service: 'handyman', projectName: 'Synthetic saved Case 1', contact: {name: 'Synthetic QA', email: 'qa@example.invalid', phone: '(202) 555-0100'}, location: 'Synthetic city', address: '', finish: '', finishBasis: 'not-applicable', timing: '', sources: []},
});
const fixture = {case: 'case-1', label: 'Case 1 · synthetic browser fixture', id, revision, result, document, delivery: [{channel: 'suppressed', status: 'suppressed'}]};
assert.equal(document.reference, 'P5-A1B2C3D4');
assert.equal(document.revision, revision);
assert.equal(document.total.amount, '$12,345');
const pdf = await PDFDocument.create();
pdf.addPage().drawText(`Synthetic saved QA: ${document.reference}; revision ${revision}; ${document.total.amount}`);
const pdfBytes = Buffer.from(await pdf.save());
const existingDraft = JSON.stringify({
  id: '99999999-9999-4999-8999-999999999999', key: 'a'.repeat(64), revision: 3,
  text: 'Existing synthetic local project must stay byte-for-byte unchanged.',
  answers: {service: 'handyman'}, extraction: null, step: 1, updatedAt: 123456789,
  contact: {name: 'Local fixture', email: 'local@example.invalid', phone: ''},
  uploads: [], wizard: {skipped: [], resolutions: {}}, dirty: true,
});
const storageSeed = [{name: 'p5-project-draft-v2', value: existingDraft}];
const fileBytes = [...Buffer.from('Existing synthetic file cache must remain unchanged.\n')];
const fileSeed = {
  id: '99999999-9999-4999-8999-999999999999:existing-synthetic-scope.txt',
  draftId: '99999999-9999-4999-8999-999999999999', name: 'existing-synthetic-scope.txt',
  type: 'text/plain', lastModified: 123456789, size: fileBytes.length, bytes: fileBytes,
};
const malicious = new URLSearchParams({
  estimate: 'untrusted-estimate-id', t: 'untrusted-signed-token',
  continue: 'untrusted-transfer-code', case: 'other-case', revision: '999',
});
if (realPage) { malicious.set('case', 'case-1'); malicious.set('revision', String(revision)); }
const pageUrl = `${origin}/estimate/qa-saved?${malicious}`;
await writeFile(`${output}/qa-saved-bundle-results.json`, JSON.stringify({
  passed: true, reactMode: 'development', strictMode: true,
  components: ['P5QaSavedEstimate', 'P5Estimator'], serverInputs: [],
  syntheticFixture: {case: fixture.case, revision, reference: document.reference, total: document.total.amount},
  browserExecuted: false,
}, null, 2));
if (process.env.P5_QA_BUNDLE_ONLY === '1') {
  console.log('PASS: saved QA adapter and actual estimator bundle in development StrictMode without server QA identities, SQL, project maps or provider code. Pure synthetic document and PDF fixtures verified. Browser execution skipped.');
  process.exit(0);
}

function installTraps() {
  const counts = {localStorage: 0, sessionStorage: 0, indexedDB: 0, crypto: 0, sendBeacon: 0, analytics: 0, publicApi: 0};
  const calls = [];
  const fetches = [];
  const hit = (kind, detail) => { counts[kind] += 1; calls.push({kind, detail: String(detail)}); };
  const nativeStorage = {localStorage: window.localStorage, sessionStorage: window.sessionStorage};
  const storageMethods = Object.fromEntries(['getItem', 'setItem', 'removeItem', 'clear', 'key'].map(name => [name, Storage.prototype[name]]));
  const storageLength = Object.getOwnPropertyDescriptor(Storage.prototype, 'length').get;
  const storageKind = target => target === nativeStorage.localStorage ? 'localStorage' : 'sessionStorage';
  for (const [kind, target] of Object.entries(nativeStorage)) {
    Object.defineProperty(window, kind, {configurable: true, get() { hit(kind, 'window getter'); return target; }});
  }
  for (const [name, method] of Object.entries(storageMethods)) {
    Object.defineProperty(Storage.prototype, name, {configurable: true, value: function (...args) {
      hit(storageKind(this), name); return Reflect.apply(method, this, args);
    }});
  }
  Object.defineProperty(Storage.prototype, 'length', {configurable: true, get() {
    hit(storageKind(this), 'length'); return Reflect.apply(storageLength, this, []);
  }});
  const indexed = window.indexedDB;
  const nativeIndexedOpen = indexed.open;
  Object.defineProperty(window, 'indexedDB', {configurable: true, get() { hit('indexedDB', 'window getter'); return indexed; }});
  for (const name of ['open', 'deleteDatabase', 'databases', 'cmp']) {
    if (typeof indexed[name] !== 'function') continue;
    Object.defineProperty(indexed, name, {configurable: true, value() { hit('indexedDB', name); throw new Error('The saved QA view must not access IndexedDB.'); }});
  }
  for (const name of ['getRandomValues', 'randomUUID']) {
    const method = window.crypto[name];
    if (typeof method !== 'function') continue;
    Object.defineProperty(window.crypto, name, {configurable: true, value(...args) { hit('crypto', name); return Reflect.apply(method, window.crypto, args); }});
  }
  if (window.crypto.subtle) for (const name of ['generateKey', 'deriveKey', 'importKey', 'unwrapKey']) {
    Object.defineProperty(window.crypto.subtle, name, {configurable: true, value() { hit('crypto', name); return Promise.reject(new Error('No key creation in saved QA.')); }});
  }
  Object.defineProperty(navigator, 'sendBeacon', {configurable: true, value(url) { hit('sendBeacon', url); return false; }});
  for (const name of ['gtag', 'ga', 'fbq', 'clarity', 'mixpanel', 'posthog', 'analytics']) {
    const trap = new Proxy(function () { hit('analytics', name); }, {get(_target, key) { return () => hit('analytics', `${name}.${String(key)}`); }});
    Object.defineProperty(window, name, {configurable: true, writable: true, value: trap});
  }
  for (const name of ['dataLayer', '_hsq']) {
    const queue = [];
    queue.push = (...args) => { hit('analytics', `${name}.push`); return Array.prototype.push.apply(queue, args); };
    Object.defineProperty(window, name, {configurable: true, writable: true, value: queue});
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const headers = Object.fromEntries(new Headers(init.headers || (input instanceof Request ? input.headers : undefined)));
    fetches.push({url: url.href, method: init.method || 'GET', credentials: init.credentials, cache: init.cache, redirect: init.redirect, headers});
    if (url.pathname.startsWith('/api/p5-estimator')) hit('publicApi', url.pathname);
    return nativeFetch(input, init);
  };
  window.__qaStrict = {mounts: 0, cleanups: 0};
  const readStorage = target => Array.from({length: Reflect.apply(storageLength, target, [])}, (_, index) => {
    const name = Reflect.apply(storageMethods.key, target, [index]);
    return {name, value: Reflect.apply(storageMethods.getItem, target, [name])};
  }).sort((a, b) => a.name.localeCompare(b.name));
  // Test-only inspection uses native handles captured before traps; the app has
  // no such handles. Seed creation and inspection are excluded from app counts.
  const readFiles = () => new Promise((resolve, reject) => {
    const request = Reflect.apply(nativeIndexedOpen, indexed, ['p5-project-files-v1', 1]);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Existing file cache disappeared.')); };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction('files', 'readonly');
        const all = transaction.objectStore('files').getAll();
        let rows;
        all.onsuccess = () => { rows = all.result.map(row => ({...row, bytes: Array.from(new Uint8Array(row.bytes))})); };
        transaction.oncomplete = () => { db.close(); resolve(rows); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
        transaction.onabort = () => { db.close(); reject(transaction.error || new Error('File cache inspection aborted.')); };
      } catch (error) { db.close(); reject(error); }
    };
  });
  window.__qaSnapshot = async () => {
    const files = await readFiles();
    return {
      counts: {...counts}, calls: [...calls], fetches: [...fetches], strictMode: {...window.__qaStrict},
      local: readStorage(nativeStorage.localStorage), session: readStorage(nativeStorage.sessionStorage), files,
    };
  };
}

const browser = await (engine === 'webkit' ? webkit : chromium).launch();
const results = [];
try {
  if (realPage) {
    const loggedOut = await browser.newContext({serviceWorkers: 'block'});
    try {
      await loggedOut.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin || request.method() !== 'GET' || url.pathname.startsWith('/api/')) return route.abort('blockedbyclient');
        return route.continue();
      });
      const page = await loggedOut.newPage();
      await page.goto(pageUrl);
      await expect(page.getByText('Administrator sign-in is required.', {exact: true})).toBeVisible();
      await expect(page.getByRole('region', {name: 'Project estimator', exact: true})).toHaveCount(0);
    } finally { await loggedOut.close(); }
  }
  for (const width of (realPage ? [320, 390, 1904] : [320, 390, 1440])) {
    const context = await browser.newContext({
      viewport: {width, height: width === 1904 ? 867 : 900}, acceptDownloads: true, serviceWorkers: 'block',
      storageState: {cookies: [], origins: [{origin, localStorage: storageSeed}]},
    });
    await context.addCookies([{...fixtureCookie, url: origin, httpOnly: true, sameSite: 'Lax'}]);
    async function fixtureSession() {
      const cookies = await context.cookies(origin);
      assert.deepEqual(cookies.map(({name, value, httpOnly, sameSite}) => ({name, value, httpOnly, sameSite})), [
        {...fixtureCookie, httpOnly: true, sameSite: 'Lax'},
      ], 'The existing synthetic browser session must remain intact.');
    }
    await fixtureSession();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.clock.install({time: new Date('2026-10-06T12:00:00Z')});
    const requests = [], violations = [], errors = [], checkpoints = [], stages = [];
    let readMode = 'ok', pdfMode = 'ok';
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      try {
        assert.equal(url.origin, origin, 'External requests are forbidden.');
        if (request.isNavigationRequest() && url.pathname === '/fixture-setup') {
          assert.equal(request.method(), 'GET');
          return await route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Synthetic storage setup</title>'});
        }
        if (request.isNavigationRequest() && url.pathname === '/estimate/qa-saved') {
          assert.equal(request.method(), 'GET');
          if (realPage) return await route.continue();
          return await route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial}*{box-sizing:border-box;min-width:0}button,select{max-width:100%}</style><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
        }
        if (realPage && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/'))) {
          assert.equal(request.method(), 'GET');
          return await route.continue();
        }
        if (url.pathname === '/fixture.js') return await route.fulfill({contentType: 'application/javascript', body: code});
        if (url.pathname === '/fixture.css') return await route.fulfill({contentType: 'text/css', body: css});
        if (url.pathname === '/favicon.ico') return await route.fulfill({status: 204, body: ''});
        assert.equal(url.pathname, api, 'Only the authenticated saved QA endpoint may be requested.');
        const isPdf = url.searchParams.get('pdf') === '1';
        assert.equal(url.pathname + url.search, endpoint + (isPdf ? '&pdf=1' : ''), 'Case and revision must be fixed, independent of hostile page parameters.');
        assert.equal(request.method(), 'GET');
        const headers = await request.allHeaders();
        assert.equal(headers['x-p5-draft-key'], undefined);
        assert.equal(headers['x-p5-draft-id'], undefined);
        // Routing runs before WebKit attaches network-stack headers. The mock
        // never sends a wire request: verify the existing browser cookie jar
        // and the adapter's same-origin credentials at every checkpoint below.
        // https://playwright.dev/docs/next/network#headers-owned-by-the-network-stack
        await fixtureSession();
        if (headers.cookie !== undefined) assert.ok(headers.cookie.split(';').some(pair => pair.trim() === `${fixtureCookie.name}=${fixtureCookie.value}`));
        assert.equal(request.postData(), null);
        requests.push({method: request.method(), url: url.pathname + url.search, mode: isPdf ? pdfMode : readMode});
        if (isPdf) {
          if (pdfMode === 'error') return await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic PDF temporarily unavailable.'})});
          if (pdfMode === 'invalid') return await route.fulfill({contentType: 'text/html', body: '<p>Synthetic non-PDF response</p>'});
          return await route.fulfill({contentType: 'application/pdf', body: pdfBytes});
        }
        if (readMode === 'stale') return await route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic saved revision changed. Read the approved revision again.'})});
        if (readMode === 'error') return await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic saved estimate temporarily unavailable.'})});
        return await route.fulfill({contentType: 'application/json', body: JSON.stringify(readMode === 'mismatch' ? {...fixture, revision: revision + 1} : fixture)});
      } catch (error) {
        violations.push(String(error));
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    const est = page.getByRole('region', {name: 'Project estimator', exact: true});
    const pdfCard = est.locator('details[aria-label="Estimate PDF attachment"]');
    const downloadButton = est.getByRole('button', {name: 'Download estimate PDF', exact: true});
    async function bannerLayout() {
      if (!await est.count()) return null;
      const geometry = await est.evaluate(root => {
        const note = root.querySelector('[role="note"]');
        const nav = root.querySelector('nav[aria-label="Estimator navigation"]');
        const thread = root.querySelector('[data-p5-thread]');
        const box = element => {
          const {top, bottom, left, right, width, height} = element.getBoundingClientRect();
          return {top, bottom, left, right, width, height};
        };
        const n = box(note);
        const points = [[n.left + n.width / 2, n.top + n.height / 2], [n.left + 4, n.top + 4], [n.right - 4, n.bottom - 4]];
        return {note: n, nav: box(nav), thread: box(thread), viewport: {width: innerWidth, height: innerHeight},
          unobscured: points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit === note || note.contains(hit); })};
      });
      assert.ok(geometry.note.top >= geometry.nav.bottom - 1, 'Synthetic QA notice must be below the estimator navigation.');
      assert.ok(geometry.thread.top >= geometry.note.bottom - 1, 'Results must scroll below the complete QA notice.');
      assert.ok(geometry.note.top >= 0 && geometry.note.bottom <= geometry.viewport.height && geometry.note.left >= 0 && geometry.note.right <= geometry.viewport.width, 'The entire QA notice must remain inside the viewport.');
      assert.ok(geometry.unobscured, 'The synthetic/read-only notice must not be covered by navigation or other content.');
      return geometry;
    }
    async function checkpoint(stage, requireStrict = true) {
      // Trigger the actual lifecycle listeners that would flush progress/beacons.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
        const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
        Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
        if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
        else delete document.visibilityState;
      });
      await page.clock.fastForward(65000);
      await fixtureSession();
      const geometry = await bannerLayout();
      const snapshot = await page.evaluate(() => window.__qaSnapshot());
      checkpoints.push({stage, geometry, ...snapshot});
      assert.deepEqual(snapshot.counts, {localStorage: 0, sessionStorage: 0, indexedDB: 0, crypto: 0, sendBeacon: 0, analytics: 0, publicApi: 0}, `${stage}: forbidden browser side effect`);
      assert.deepEqual(snapshot.local, storageSeed, `${stage}: the existing local draft changed`);
      assert.deepEqual(snapshot.session, [], `${stage}: session storage changed`);
      assert.deepEqual(snapshot.files, [fileSeed], `${stage}: the existing IndexedDB file cache changed`);
      if (requireStrict && !realPage) {
        assert.ok(snapshot.strictMode.mounts >= 2, 'React development StrictMode must replay the mount effect.');
        assert.ok(snapshot.strictMode.cleanups >= 1, 'StrictMode cleanup must run.');
      }
      for (const request of snapshot.fetches) {
        assert.ok([origin + endpoint, origin + endpoint + '&pdf=1'].includes(request.url));
        assert.equal(request.method, 'GET');
        assert.equal(request.credentials, 'same-origin');
        assert.equal(request.cache, 'no-store');
        assert.equal(request.redirect, 'error');
        assert.equal(request.headers['x-p5-draft-key'], undefined);
        assert.equal(request.headers['x-p5-draft-id'], undefined);
      }
      assert.deepEqual(violations, [], `${stage}: unexpected network`);
      assert.deepEqual(errors, [], `${stage}: browser errors`);
      stages.push(stage);
    }
    async function savedIsExact() {
      await expect(est).toHaveAttribute('data-qa-saved-preview', 'true');
      await expect(est).toHaveAttribute('data-step', '3');
      await expect(est.getByRole('note')).toHaveText(`Synthetic QA · ${fixture.label} · revision ${revision}. Read-only saved result and PDF.`);
      await expect(est.getByRole('heading', {name: document.title, exact: true})).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(est.getByRole('heading', {name: document.total.amount, exact: true})).toBeVisible();
      await expect(est.getByText(`Estimate ${document.reference} | Prepared ${document.issuedLabel}`, {exact: true})).toBeVisible();
      await expect(est.getByText('This test estimate is saved. Automatic notifications were not sent.', {exact: true})).toBeVisible();
      const receipt = est.getByRole('list', {name: 'Delivery status', exact: true});
      await expect(receipt.locator('li[data-state="suppressed"]')).toHaveCount(2);
      await expect(receipt.getByText('Not sent (test estimate)', {exact: true})).toHaveCount(2);
      assert.doesNotMatch(await est.innerText(), /\bSending\b|We are sending|Your estimate was sent/i);
      await expect(est.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
      await expect(est.locator('a[href^="mailto:"],a[href^="tel:"],a[href="#p5-project-review"]')).toHaveCount(0);
      await expect(est.getByRole('button', {name: /new project|update my estimate|get my estimate|send answer|attach|contact|review|consultation|continue|previous step/i})).toHaveCount(0);
      for (const href of await est.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))) {
        assert.ok(['/', '/admin/p5-estimators/qa-recovery?case=case-1'].includes(href), `Unexpected actionable link ${href}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Saved QA page overflows the viewport.');
      assert.equal(page.url(), pageUrl, 'Saved preview must not claim or remove customer continuation tokens.');
      const categoryHeading = est.locator('summary').filter({hasText: 'Other Project Work'}).locator('span').first();
      const heading = await categoryHeading.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        return {width: bounds.width, lines: Array.from(range.getClientRects()).map(rect => ({top: rect.top, width: rect.width}))};
      });
      assert.ok(heading.width >= 120, 'The category heading needs readable width beside status and price.');
      assert.ok(new Set(heading.lines.map(line => Math.round(line.top))).size <= 2, 'Other Project Work must not be squeezed into fragmented lines.');
    }
    async function downloadPdf() {
      if (!await pdfCard.evaluate(node => node.open)) await pdfCard.locator('summary').click();
      const before = requests.filter(request => request.url.endsWith('&pdf=1')).length;
      const [download] = await Promise.all([page.waitForEvent('download'), downloadButton.click()]);
      assert.equal(await download.failure(), null);
      const path = await download.path();
      assert.ok(path);
      assert.deepEqual(await readFile(path), pdfBytes, 'Downloaded bytes must be the fixed saved PDF.');
      await expect(pdfCard.locator('summary')).toContainText('Downloaded');
      assert.equal(requests.filter(request => request.url.endsWith('&pdf=1')).length, before + 1);
    }
    async function readAgain() {
      await page.getByRole('button', {name: 'Read saved estimate again', exact: true}).click();
      await savedIsExact();
    }
    try {
      // Bootstrap the user's hypothetical existing file cache before application
      // code or instrumentation runs. Every later app access is counted.
      await page.goto(`${origin}/fixture-setup`);
      await page.evaluate(seed => new Promise((resolve, reject) => {
        const request = indexedDB.open('p5-project-files-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files', {keyPath: 'id'});
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('files', 'readwrite');
          transaction.objectStore('files').put({...seed, bytes: new Uint8Array(seed.bytes).buffer});
          transaction.oncomplete = () => { db.close(); resolve(); };
          transaction.onerror = () => { db.close(); reject(transaction.error); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
        };
      }), fileSeed);
      await context.addInitScript(installTraps);
      await page.goto(pageUrl);
      await savedIsExact();
      await checkpoint(realPage ? 'production page initial saved restoration' : 'strict-mode initial saved restoration');
      await page.screenshot({path: `${output}/${engine}-${width}-qa-saved${realPage ? '-page' : ''}-initial.png`, fullPage: true});
      const beforeScroll = await bannerLayout();
      await est.locator('[data-p5-thread]').evaluate(thread => { thread.scrollTop = thread.scrollHeight; });
      await checkpoint('QA notice remains visible while results scroll');
      const afterScroll = await bannerLayout();
      assert.ok(Math.abs(beforeScroll.note.top - afterScroll.note.top) < 1, 'The QA notice must not scroll with result content.');
      const accordions = est.locator('details');
      assert.ok(await accordions.count() >= 3, 'Exercise real estimate detail accordions.');
      for (let index = 0; index < await accordions.count(); index += 1) {
        const details = accordions.nth(index), summary = details.locator(':scope > summary');
        const wasOpen = await details.evaluate(node => node.open);
        await summary.click();
        await expect(details).toHaveJSProperty('open', !wasOpen);
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(details).toHaveJSProperty('open', wasOpen);
      }
      await checkpoint('accordion pointer and keyboard interactions');
      await est.evaluate(root => {
        const form = root.querySelector('form');
        form.requestSubmit();
        const submit = new Event('submit', {bubbles: true, cancelable: true});
        form.dispatchEvent(submit);
        if (!submit.defaultPrevented) throw new Error('Read-only form submission must be prevented.');
        const data = new DataTransfer();
        data.items.add(new File(['synthetic upload'], 'must-not-upload.txt', {type: 'text/plain'}));
        data.setData('text/plain', 'Must not revise the saved synthetic case.');
        for (const target of [root, form, root.querySelector('[data-p5-thread]')]) {
          for (const type of ['dragover', 'drop', 'paste']) {
            const event = new Event(type, {bubbles: true, cancelable: true});
            Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', {value: data});
            target.dispatchEvent(event);
            if (type === 'drop' && !event.defaultPrevented) throw new Error('Read-only drops must be prevented.');
          }
        }
      });
      await savedIsExact();
      await checkpoint('programmatic submit drop and paste stay inert');
      await downloadPdf();
      await downloadPdf();
      await checkpoint('repeated authenticated saved PDF downloads');
      pdfMode = 'error';
      await downloadButton.click();
      await expect(est.getByRole('alert')).toContainText('Synthetic PDF temporarily unavailable.');
      await expect(pdfCard.locator('summary')).toContainText('Retry');
      await checkpoint('PDF failure has no generation fallback');
      pdfMode = 'ok';
      await downloadPdf();
      await expect(est.getByRole('alert')).toHaveCount(0);
      pdfMode = 'invalid';
      await downloadButton.click();
      await expect(est.getByRole('alert')).toContainText('The saved PDF could not be verified.');
      await expect(pdfCard.locator('summary')).toContainText('Retry');
      pdfMode = 'ok';
      await downloadPdf();
      await checkpoint('PDF retry and invalid-content rejection');
      for (let restore = 0; restore < 2; restore += 1) {
        await est.getByRole('button', {name: 'Reload saved estimate', exact: true}).click();
        await savedIsExact();
        await expect(pdfCard.locator('summary')).toContainText('Available');
        await checkpoint(`explicit saved restoration ${restore + 1}`);
      }
      for (let reload = 0; reload < 2; reload += 1) {
        await page.reload();
        await savedIsExact();
        await checkpoint(`browser reload ${reload + 1}`);
      }
      for (const mode of ['stale', 'mismatch']) {
        readMode = mode;
        await est.getByRole('button', {name: 'Reload saved estimate', exact: true}).click();
        await expect(page.getByRole('main').getByRole('alert')).toContainText(mode === 'stale' ? 'Synthetic saved revision changed.' : 'identity could not be verified');
        await expect(est).toHaveCount(0);
        await expect(downloadButton).toHaveCount(0);
        const requestCount = requests.length;
        await checkpoint(`${mode} revision is rejected without polling`);
        assert.equal(requests.length, requestCount, 'Read failure cannot automatically retry.');
        readMode = 'ok';
        await readAgain();
        await checkpoint(`restore after ${mode} rejection`);
      }
      readMode = 'error';
      await page.reload();
      await expect(page.getByRole('main').getByRole('alert')).toContainText('Synthetic saved estimate temporarily unavailable.');
      await expect(est).toHaveCount(0);
      const requestCount = requests.length;
      await checkpoint('reload read error stays closed');
      assert.equal(requests.length, requestCount);
      readMode = 'ok';
      await readAgain();
      await savedIsExact();
      await downloadPdf();
      await checkpoint('final exact saved identity and unchanged local draft');
      await page.screenshot({path: `${output}/${engine}-${width}-qa-saved${realPage ? '-page' : ''}.png`, fullPage: true});
      results.push({engine, width, realPage, passed: true, strictMode: realPage ? 'compiled production page' : 'development effect replay verified', case: fixture.case, revision, reference: document.reference, total: document.total.amount, advancedMillisecondsPerCheckpoint: 65000, stages, requests, checkpoints});
    } catch (error) {
      const snapshot = await page.evaluate(() => window.__qaSnapshot?.()).catch(() => null);
      if (snapshot) checkpoints.push({stage: 'failure diagnostics', ...snapshot});
      results.push({engine, width, passed: false, error: String(error), stages, requests, checkpoints, violations, errors});
      await page.screenshot({path: `${output}/${engine}-${width}-qa-saved${realPage ? '-page' : ''}-failed.png`, fullPage: true}).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${output}/${engine}-qa-saved${realPage ? '-page' : ''}-results.json`, JSON.stringify({
  scope: realPage ? 'Actual local Next production route, shared layout and client. Isolated synthetic administrator/session SELECT only; saved JSON/PDF mocked. No live credentials, customer data, provider or production calls.' : 'Synthetic saved Case 1 component regression. All network intercepted. No live login, customer data, database, provider or production calls.',
  engine, realPage, results,
}, null, 2));
console.log(JSON.stringify(results.map(({engine, width, realPage, passed, error, stages, errors, violations}) => ({engine, width, realPage, passed, error, stages, errors, violations}))));
if (results.some(result => !result.passed)) process.exitCode = 1;
