import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.P5_TEST_BASE_URL || 'http://127.0.0.1:5000';
const exe = execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim();
const result = { externalServices: 'mocked', cases: [], screenshots: [] };
const estimate = {
  status: 'preliminary', range: { low: 1000, high: 1800 },
  summary: 'Synthetic planning range.', nextStep: 'Schedule a scope review.',
  disclaimer: 'This is not a bid, quote, offer or guaranteed price.',
  lineItems: [], categoryRanges: [], includedCategories: [], allowances: [],
  assumptions: [], exclusions: [], factors: []
};
const fullAnswers = {
  service: 'bathroom', taskList: 'Complete the specified work. Repair three interior doors.',
  sqft: '80', materials: 'Porcelain tile', demolition: 'Remove old finishes'
};
async function mock(context) {
  const state = { draft: null, submissions: 0 };
  await context.route('**/api/estimator-session', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await context.route('**/api/p5-estimator/**', async r => {
    const u = new URL(r.request().url()), endpoint = u.pathname.split('/').at(-1);
    const send = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (endpoint === 'draft') {
      if (r.request().method() === 'GET') return send({ draft: state.draft });
      const input = r.request().postDataJSON();
      if (state.draft?.status === 'submitted') return send({ error: 'Already submitted' }, 409);
       state.draft = { ...(state.draft || {}), ...input, revision: (state.draft?.revision || 0) + 1,
        status: 'draft', answers: { ...fullAnswers, ...(state.draft?.answers || {}), ...(input.answers || {}) },
        response: input.response || state.draft?.response || { text: 'Synthetic remodel scope' },
        wizard: input.wizard || state.draft?.wizard || {}, uploads: input.uploads || state.draft?.uploads || [],
        extraction: state.draft?.extraction || { summary: 'Synthetic project', facts: [] } };
      return send({ draft: state.draft, conflicts: [], pricedFields: [], questions: [] });
    }
    if (endpoint === 'scope') {
      state.draft = { ...(state.draft || {}), revision: (state.draft?.revision || 0) + 1,
        answers: { ...fullAnswers, ...(state.draft?.answers || {}) },
        uploads: [{ id: 'synthetic-upload', name: 'scope.txt', size: 30, type: 'text/plain', sha256: 'synthetic', status: 'stored' }],
        extraction: { summary: 'Synthetic project', facts: Object.entries(fullAnswers).map(([field, value]) => ({ field, value, confidence: .98, source: 'scope.txt', evidence: value })), conflicts: [], missingInformation: [], reviewNotes: [], clarifications: [] } };
      return send({ draft: state.draft, analysis: { extraction: state.draft.extraction }, conflicts: [], pricedFields: [], warning: '' });
    }
    if (endpoint === 'price') return send({ ...estimate, status: 'ready' });
    if (endpoint === 'submit') {
      if (state.draft?.status === 'submitted') return send({ accepted: false, duplicate: true, estimate, delivery: [] });
      state.submissions++; state.draft = { ...state.draft, status: 'submitted' };
      return send({ accepted: true, duplicate: false, estimate, delivery: [{ channel: 'customer', status: 'retry' }, { channel: 'admin', status: 'sent' }, { channel: 'crm', status: 'needs-review' }] });
    }
    return send({});
  });
  return state;
}
async function shot(page, name) {
  await mkdir('p5-verification/mobile-acceptance', { recursive: true });
  const path = `p5-verification/mobile-acceptance/${name}.png`;
  await page.screenshot({ path, fullPage: true }); result.screenshots.push(path);
}
async function run(width, height) {
  const browser = await chromium.launch({ executablePath: exe });
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true });
  const state = await mock(context), page = await context.newPage(), est = page.locator('[data-p5-estimator]').first();
  page.setDefaultTimeout(7000);
  try {
    await page.goto(`${base}/estimate`, { waitUntil: 'domcontentloaded' });
    await est.getByLabel('Tell us about your project', { exact: true }).waitFor();
    const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, nav: [...document.querySelectorAll('nav')].some(n => { const a=n.getBoundingClientRect(), e=document.querySelector('[data-p5-estimator]')?.getBoundingClientRect(); return e && a.bottom > e.top && a.top < e.bottom; }) }));
    assert.equal(metrics.overflow, false, 'no horizontal overflow');
    await est.getByLabel('Tell us about your project', { exact: true }).fill('Synthetic remodel scope ');
    await est.getByRole('button', { name: /Continue/ }).click();
    if (await est.getByText('Bathroom remodel', { exact: true }).count()) {
      await est.getByText('Bathroom remodel', { exact: true }).click();
      await est.getByRole('button', { name: /^Continue/ }).click();
    }
    await est.getByText(/scope|review|upload/i).first().waitFor();
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    await est.getByRole('button', { name: 'Get my estimate', exact: true }).waitFor();
    assert.equal(await est.getByRole('button', { name: 'Get my estimate', exact: true }).count(), 1, 'single Get my estimate action');
     const action=est.getByRole('button',{name:'Get my estimate',exact:true});
     await action.click();
     assert.equal(state.submissions,0,'confirmation cannot be bypassed');
     await est.getByRole('checkbox').check();
     await action.click();
     assert.equal(state.submissions,0,'contact cannot be bypassed');
     await est.getByLabel('Your name',{exact:true}).fill('Synthetic Acceptance');
     assert.equal(await est.locator('[data-p5-sticky-submit]').evaluate(el=>getComputedStyle(el).position),'static','editable focus returns action inline');
     await est.getByLabel('Email',{exact:true}).fill('acceptance@example.com');
     await est.getByRole('button',{name:'Back to my project',exact:true}).click();
     await est.getByLabel('Tell us about your project',{exact:true}).waitFor();
     const oldId=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id);
     page.on('dialog',dialog=>dialog.accept());
     await est.getByRole('button',{name:'Replace this project',exact:true}).click();
     await page.waitForFunction(old=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id!==old,oldId);
     const clean=await page.evaluate(()=>{const d=JSON.parse(localStorage.getItem('p5-project-draft-v2'));return {answers:d.answers,uploads:d.uploads,text:d.text};});
     assert.deepEqual(clean,{answers:{},uploads:[],text:''},'replacement is isolated from prior source');
     await est.getByText(/Saved project recovery \(/).click();
     await est.getByRole('button',{name:/^Restore Synthetic remodel scope/}).first().click();
     await page.waitForFunction(old=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id===old,oldId);
     assert.equal(await est.locator('input[type=file]').count(),1);
     assert.equal(await est.getByLabel('Tell us about your project',{exact:true}).count(),1);
     await est.getByRole('button',{name:'Continue',exact:true}).click();
     await est.getByLabel('Your name',{exact:true}).fill('Synthetic Acceptance');
     await est.getByLabel('Email',{exact:true}).fill('acceptance@example.com');
     await est.getByRole('checkbox').check();
     await page.waitForTimeout(200);
     await est.getByRole('checkbox').scrollIntoViewIfNeeded();
     const rect=await action.boundingBox();
     assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=height,'action remains inside mobile viewport');
     await est.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
     for(let attempt=0;attempt<50&&state.submissions===0;attempt++)await page.waitForTimeout(100);
     await page.waitForTimeout(300);
     assert.equal(state.submissions,1,'rapid submission is idempotent');
    await shot(page, `${width}-long-review`);
    result.cases.push({ width, passed: true, state });
  } catch (e) {
    console.error(width,String(e));
    result.cases.push({ width, passed: false, error: String(e) }); await shot(page, `${width}-failure`).catch(() => {});
  } finally { await context.close(); await browser.close(); }
}
await run(390, 844);
await run(375, 844);
await writeFile('p5-verification/mobile-acceptance-report.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.cases.some(x => !x.passed)) process.exitCode = 1;