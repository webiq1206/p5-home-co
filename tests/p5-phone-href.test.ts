import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {phoneHref} from '../lib/p5/phoneHref.ts';
import {buildEstimateDocument, type EstimateBrand} from '../lib/p5/estimateDocument.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

const DIAL = /^(?:tel|sms):\+1\d{10}$/;

function assertDialLinks(label: string, rendered: string) {
  const links = [...rendered.matchAll(/(?:tel|sms):[^\s"'<>]*/g)].map((match) => match[0]);
  assert.ok(links.length > 0, `${label} rendered no tel: or sms: link`);
  for (const href of links) assert.match(href, DIAL, `${label} rendered ${href}`);
}

test('phone links use +1 for 10 digits, + for 11 digits starting with 1, and + for a plus with 8 to 15 digits', () => {
  for (const value of ['(208) 477-1169', '208-477-1169', '2084771169']) {
    assert.equal(phoneHref(value), 'tel:+12084771169');
    assert.equal(phoneHref(value, 'sms'), 'sms:+12084771169');
  }
  assert.equal(phoneHref('1 (208) 477-1169'), 'tel:+12084771169');
  assert.equal(phoneHref('+442079460958'), 'tel:+442079460958');
  for (const value of ['x12', '555-0100', '5550100', 'call me', '011', '0112084771169', '2084771169 2085550100', '']) {
    assert.equal(phoneHref(value), '', value);
    assert.equal(phoneHref(value, 'sms'), '', value);
  }
});

test('rendered estimator phone links include + and keep the visible number', () => {
  const brand = ESTIMATOR_BRAND as unknown as EstimateBrand;
  const doc = buildEstimateDocument({
    id: '0f1e2d3c-4b5a-4000-8000-00000000abcd',
    result: {summary: 'Paint the hall.', range: null, lineItems: []},
    brand,
    issue: {brandId: ESTIMATOR_BRAND.id, service: 'handyman', reference: 'P5-PHONE', revision: 1, issuedAt: '2026-10-17T00:00:00.000Z', contact: {name: 'A', email: 'a@example.invalid', phone: '(208) 555-0100'}},
  });
  assert.equal(doc.review.label, 'Request a project review');
  assert.equal(doc.review.phone, ESTIMATOR_BRAND.phone);
  assert.equal(doc.review.tel, 'tel:+12084771169');
  assertDialLinks('estimate document', JSON.stringify(doc.review));

  const record = {customer: {summary: 'Paint the hall.', range: {low: 100, high: 200}, lineItems: [], issue: {brandId: ESTIMATOR_BRAND.id, service: 'handyman', contact: {name: 'A', email: 'a@example.invalid', phone: '(208) 555-0100'}}}, contact: {name: 'A', email: 'a@example.invalid', phone: '(208) 555-0100'}};
  const customer = estimateEmail('phone-href', record, false);
  const admin = estimateEmail('phone-href', {...record, internal: {directCost: 1}}, true);
  assert.match(customer.html, />\(208\) 477-1169</);
  assert.match(admin.html, />\(208\) 555-0100</);
  assert.doesNotMatch(customer.text, /tel:|sms:/);
  assertDialLinks('customer estimate email', customer.html);
  assertDialLinks('internal estimate email', admin.html);

  for (const file of ['components/P5Estimator.tsx', 'components/P5ReviewRequest.tsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /href=\{phoneHref\(brand\.phone\)\}/);
    assert.equal(source.includes('tel:'), false, file);
    assert.equal(source.includes('sms:'), false, file);
    assert.match(source, /Call \{brand\.phone\}/);
  }
  assert.equal(phoneHref(ESTIMATOR_BRAND.phone), 'tel:+12084771169');
  assert.equal(phoneHref(ESTIMATOR_BRAND.phone, 'sms'), 'sms:+12084771169');
});
