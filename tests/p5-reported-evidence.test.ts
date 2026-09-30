import test from 'node:test';import assert from 'node:assert/strict';
import {restoreReportedEvidence} from '../lib/p5/reportedEvidence.ts';import {verifiedResearchUrl} from '../lib/p5/scopePricing.ts';
const url='https://supplier.example/screws';
const raw={rates:[{sources:[{url,excerpt:'GRK cabinet screws, 100-pack, $11.98 (12 cents per screw)',low:.12,high:.12}]}]};
test('a formatter paraphrase is replaced by the same URL exact evidence, retaining numeric validation inputs',()=>{
 const exact='GRK cabinet screws, 100-pack, $11.98';
 const report=`Supplier: ${url}\nEvidence: ${exact}`;
 const fixed=restoreReportedEvidence(raw,report,verifiedResearchUrl);
 assert.equal(fixed.rates[0].sources[0].excerpt,exact);assert.equal(fixed.rates[0].sources[0].low,.12);
 assert.notEqual(raw.rates[0].sources[0].excerpt,exact,'input remains unchanged');
});
test('evidence recovery cannot borrow another URL, another product, or an ambiguous observation',()=>{
 for(const report of [`Supplier: https://supplier.example/shims\nEvidence: GRK cabinet screws, 100-pack, $11.98`,`Supplier: ${url}\nEvidence: Pine wood shims, 100-pack, $11.98`,`Supplier: ${url}\nEvidence: GRK cabinet screws, 100-pack, $11.98\nEvidence: GRK cabinet screws, 100-pack, $12.99`])assert.deepEqual(restoreReportedEvidence(raw,report,verifiedResearchUrl),raw);
});
