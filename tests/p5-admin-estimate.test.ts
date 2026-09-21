import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdminSummary,groupedChecks} from '../lib/p5/adminEstimate.ts';
import {issueRecord,type EstimateBrand} from '../lib/p5/estimateDocument.ts';
import {administrativePdf} from '../lib/p5/pdf.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

// The internal estimate record in the approved template (owner request, 2026-09-21): short, and
// complete where it matters (price build-up, cost by trade, every priced line, grouped checks).
const brand=ESTIMATOR_BRAND as unknown as EstimateBrand;
const ID='0f1e2d3c-4b5a-4000-8000-00000000abcd';
const contact={name:'[QA] Admin Check',email:'qa@example.invalid',phone:'(208) 555-0100'};
const scope={text:'Remodel the kitchen.',answers:{service:'kitchen',finish:'mid-range',location:'Boise, ID'},uploads:[],uncertainFields:[] as string[]};
const line=(n:number,trade:string,category:string,description:string,quantity:number,unitCost:number,reference:string)=>({id:`l${n}`,trade,category,description,quantity,unit:'EA',unitCost,cost:quantity*unitCost,evidence:{basis:'owner-estimating-schedule',reference}});
const lines=[line(1,'Cabinets','materials','Base cabinets',10,300,'Owner book; PB-12-02-02'),line(2,'Plumbing','subcontractors','Sink reconnect',1,850,'Owner book; PB-22-02-05'),line(3,'Electrical','subcontractors','GFCI receptacles',4,145,'Learned; PB-L-3fa91c02de')];
const warnings=[...lines.slice(1).map(l=>({code:'written-sub-quote-required',severity:'review',message:`${l.id}: obtain a current written subcontractor price before a firm proposal.`})),{code:'cost-evidence-missing',severity:'block',message:'l1: current cost evidence is required.'}];
const internal={service:'kitchen',lines,directCost:4430,contingencyRate:.1,contingency:443,riskAdjustedDirectCost:4873,allocationDollars:{overhead:1433},targetOperatingProfit:.12,operatingProfit:860,contractPrice:7166,publishable:false,warnings,financeSnapshot:{secret:'policy'},matrix:{method:'fixed'}};
const customer={range:{low:6800,high:7500},categoryRanges:[{category:'Cabinets',low:4000,high:4400}],lineItems:[],exclusions:['Appliances'],verificationItems:['Confirm door style.'],issue:issueRecord({brandId:brand.id,id:ID,revision:1,now:new Date('2026-09-21T18:00:00Z'),contact,scope})};

test('checks repeated line by line are grouped by kind with a count, blocking first',()=>{
 const checks=groupedChecks(warnings);
 assert.deepEqual(checks,['Blocking: current cost evidence is required.','Review (2 lines): obtain a current written subcontractor price before a firm proposal.']);
});
test('the summary carries the price build-up, cost by trade and every priced line with its source',()=>{
 const s=buildAdminSummary({id:ID,record:{...internal,customer,contact},brand});
 assert.deepEqual(s.build.map(([k])=>k),['Direct project cost','Contingency (10.0%)','Overhead recovery','Operating profit (12.0% target)','Overhead and profit share of price']);
 assert.equal(s.contractPrice,'$7,166');assert.equal(s.customerPrice,'$6,800 to $7,500');
 assert.deepEqual(s.trades.map(t=>t.trade),['Cabinets','Plumbing','Electrical']);
 assert.deepEqual(s.lines.map(l=>l.basis),['PB-12-02-02','PB-22-02-05','PB-L-3fa91c02de (learned)']);
 assert.match(s.status,/1 blocking check/);
});
test('the internal PDF and email are short, complete and marked confidential; the customer email stays clean',async()=>{
 const pdf=(await pdfTextLayers(await administrativePdf(ID,{...internal,customer,contact}))).join('\n');
 const mail=estimateEmail(ID,{internal,customer,contact},true);
 for(const output of [pdf,mail.text]){
  assert.match(output,/INTERNAL ESTIMATE RECORD/i);assert.match(output,/Contract price/);assert.match(output,/\$7,166/);
  assert.match(output,/Review \(2 lines\)/);assert.match(output,/P5-0F1E2D3C/);
  // The old record printed the whole calculation trace and policy snapshots; the new one does not.
  assert.doesNotMatch(output,/calculation trace|Financial policy snapshot|secret|Service margin policy/i);
 }
 assert.match(pdf,/Base cabinets/);assert.match(pdf,/PB-12-02-02/);
 assert.ok(mail.text.split('\n').length<60,'the internal email stays short');
 const customerMail=estimateEmail(ID,{internal,customer,contact},false);
 assert.doesNotMatch(customerMail.html+customerMail.text,/\$7,166|Contract price|Overhead recovery|PB-12/);
});
