import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEstimateDocument,type EstimateBrand} from '../lib/p5/estimateDocument.ts';
import {estimateSections} from '../lib/p5/presentation.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {customerPdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';

test('UI, document, and rendered PDF distinguish cost basis from scope source and preserve real review notes',async()=>{
 const result={range:{low:450,high:555},summary:'Replace three owner-supplied levers.',lineItems:[{id:'labor',category:'Windows & Doors',description:'Hardware installation labor',quantity:3,unit:'EA',low:332,high:409,pricingStatus:'owner-planning-rate'}],
  verificationItems:['Confirm concealed damage before a firm proposal.','Earlier scope and pricing assumptions remain pending review before a firm proposal.'],
  issue:{projectName:`SYNTHETIC QA ${String.fromCharCode(0x2014)} DO NOT CONTACT`,service:'handyman',sources:['scope.pdf']}};
 const ui=estimateSections(result).find(section=>section.title==='Pricing basis')!.text;
 const doc=buildEstimateDocument({id:'00000000-0000-4000-8000-000000000014',result,brand:ESTIMATOR_BRAND as unknown as EstimateBrand});
 assert.deepEqual(doc.assumptionRows.find(([key])=>key==='Pricing basis')?.[1],[ui]);
 assert.match(doc.assumptionRows.find(([key])=>key==='Scope source')![1][0],/Your online submission.*scope.pdf/);
 assert.ok(doc.assumptionRows.find(([key])=>key==='To confirm')![1].includes(result.verificationItems[0]));
 assert.ok(doc.assumptionRows.find(([key])=>key==='To confirm')![1].includes(result.verificationItems[1]));
 const pdf=await customerPdf('00000000-0000-4000-8000-000000000014',result,'2026-10-02T18:00:00Z');
 const pages=await pdfTextLayers(pdf);
 assert.match(JSON.stringify(pages),/Owner planning rates provide the foundation/);
 assert.match(JSON.stringify(pages),/Scope source/);
});
