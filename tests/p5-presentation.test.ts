import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {summarySections,estimateSections,customerPresentation,publicPricingText,SECTION_TITLES} from '../lib/p5/presentation.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {administrativePdf,customerPdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {suggestedTrade} from '../lib/p5/trades.ts';
const result={summary:'Project type: new-construction\nProject area in square feet: 4500\nPlumbing work: Supply fixtures. Install connections.\nExcluded work: Land and financing.',includedCategories:['Plumbing'],range:{low:100,high:200},lineItems:[{id:'p',category:'Plumbing',description:'Fixture installation',quantity:2,unit:'EA',low:100,high:200,unitLow:50,unitHigh:100}],categoryRanges:[{category:'Plumbing',low:100,high:200}],assumptions:[],exclusions:['Land'],allowances:[],factors:[],message:'Review your estimate.',nextStep:'Consultation',disclaimer:'Preliminary only.'};
test('Customer outputs combine repeated exclusions and retain every distinct condition',()=>{
 const r={...result,summary:'Excluded work: Plumbing excluded.',instructions:{inclusions:['Install trim.'],exclusions:['Plumbing excluded.','Electrical excluded.']},exclusions:['Plumbing excluded','Electrical excluded.','Permits excluded.'],verificationItems:['Confirm door size.'],assumptions:['Confirm door size.','Confirm hardware responsibility.']};
 const sections=estimateSections(r),excluded=sections.filter(s=>s.kind==='excluded');
 assert.equal(excluded.length,1);assert.deepEqual(excluded[0].bullets,['Plumbing excluded.','Electrical excluded.','Permits excluded.']);
 const assumptions=sections.filter(s=>s.kind==='assumption').flatMap(s=>s.bullets||[]);
 assert.equal(assumptions.filter(s=>s==='Confirm door size.').length,1);assert.ok(assumptions.includes('Confirm hardware responsibility.'));
 assert.ok(sections.some(s=>s.kind==='included'&&s.bullets?.includes('Install trim.')));
 const mail=estimateEmail('synthetic',{customer:r,contact:{name:'QA'}},false);
 assert.equal(mail.text.split('Plumbing excluded.').length-1,1);
});
test('Legacy summaries retain values, use readable quantities and group scope without inventing prices',()=>{
 const sections=summarySections(result.summary);
 assert.deepEqual(sections[0].rows,[['Project type','New construction'],['Project area in square feet','4,500']]);
 const breakdown=estimateSections(result).find(s=>s.title==='Plumbing'&&s.text);
 assert.equal(breakdown?.rows?.length,2);assert.ok(breakdown?.rows?.[1][1].includes('$100 to $200 total'));
 assert.ok(JSON.stringify(sections).includes('Land and financing.'));
});
test('Formatted customer emails escape scope HTML and never include internal finance',()=>{
 const record={customer:{...result,summary:result.summary+'\n<script>alert(1)</script>'},internal:{directCost:98765,operatingProfit:12345},contact:{name:'Test'}};
 const customer=estimateEmail('test',record,false),admin=estimateEmail('test',record,true);
 assert.ok(customer.html.includes('<h2'));assert.ok(customer.html.includes('&lt;script&gt;'));
 assert.ok(!customer.html.includes('<script>'));assert.ok(!customer.html.includes('98,765'));
 assert.ok(admin.html.includes('98,765'));assert.ok(customer.text.includes('Plumbing'));assert.ok(customer.text.includes('NOT INCLUDED'));
 // Excluded work is its own labeled section in both formats, never under an included heading.
 assert.ok(customer.html.includes('Not included'));assert.ok(customer.html.indexOf('Land and financing.')>customer.html.indexOf('Not included'));
});
test('Specialty cabinet products and paint-grade trim retain the correct trade',()=>{
 assert.equal(suggestedTrade('Wood cabinet pullout product with door-mount hardware'),'Cabinets');
 assert.equal(suggestedTrade('Install paint-grade base moulding and baseboard trim'),'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Paint the cabinets'),'Painting');
 assert.equal(suggestedTrade('Standard paint-grade solid wood crown moulding, material supply only (no installation labor, no painting/finishing, no cabinet casework), for kitchen cabinet trim use'),'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Paint the crown moulding'),'Painting');
 assert.equal(suggestedTrade('Install crown moulding without painting'),'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Replace heating ductwork'),'Heating & Cooling');
 assert.equal(suggestedTrade('Supply an exterior entry door'),'Windows & Doors');
});

test("Partial saved instruction records remain readable without losing supplied exclusions",()=>{
 const sections=estimateSections({summary:"",instructions:{exclusions:["Appliances"],inclusions:["Cabinets"]}});
 const excluded=sections.find(section=>section.kind==='excluded');
 assert.ok(excluded?.bullets?.includes("Appliances"));
 // Inclusions and exclusions never share a section.
 const included=sections.find(section=>section.kind==='included');
 assert.ok(included?.bullets?.includes("Cabinets"));assert.ok(!included?.bullets?.includes("Appliances"));
});

test('Placeholder building and floor labels neither create a per-building table nor prefix rows',()=>{
 const line=(id:string,building:string,floor?:string,extra:any={})=>({id,category:'Drywall',description:'Ceiling patch '+id,quantity:1,unit:'EA',low:50,high:100,unitLow:50,unitHigh:100,building,floor,...extra});
 const base={summary:'',includedCategories:['Drywall'],range:{low:100,high:200},scopeTasks:[],assumptions:[],exclusions:[],allowances:[],factors:[],categoryRanges:[{category:'Drywall',low:100,high:200}]};
 const single=estimateSections({...base,lineItems:[line('a','Main residence'),line('b','Unspecified building','Unspecified floor',{pricingStatus:'estimated-allowance',verification:'Regional planning average.'})]});
 assert.ok(!single.some(s=>s.title===SECTION_TITLES.buildingPrices),'one real building: no per-building table');
 const allowanceRows=single.find(s=>s.title===SECTION_TITLES.allowances)?.rows||[];
 assert.ok(allowanceRows.length&&allowanceRows.every(r=>!/unspecified/i.test(r[0])),'placeholder labels are not shown on rows');
 const two=estimateSections({...base,lineItems:[line('a','Main'),line('b','ADU')]});
 assert.ok(two.some(s=>s.title===SECTION_TITLES.buildingPrices),'two named buildings keep their totals');
});

// The saved live result is local verification evidence (p5-verification/ is
// gitignored). Where it is absent the same boundary is held by the synthetic
// historical result in p5-customer-privacy.test.ts.
const SAVED_RESULT='p5-verification/pricing-qualification/0c45743d4aa180074804ccb2d6d07d178df6353c719c185813102f0b80a9d0f7/1789830300212-0b0c5b15-ed5c-41c2-8718-a253c7d0f0b8/live-pricing-mapping-report.json';
test('saved pricing result keeps public scope and selling prices while customer page, email and PDF hide private costs',{skip:!existsSync(SAVED_RESULT)&&'saved live result is not present in this checkout'},async()=>{
 const path='p5-verification/pricing-qualification/0c45743d4aa180074804ccb2d6d07d178df6353c719c185813102f0b80a9d0f7/1789830300212-0b0c5b15-ed5c-41c2-8718-a253c7d0f0b8/live-pricing-mapping-report.json';
 const saved=JSON.parse(await readFile(path,'utf8')).result;
 const projected=customerPresentation(saved.customer);
 const rendered=JSON.stringify(estimateSections(saved.customer));
 const mail=estimateEmail('saved-result',{customer:saved.customer,internal:saved.internal,contact:{name:'Saved Result'}},false);
 const customerPdfText=(await pdfTextLayers(await customerPdf('saved-result',saved.customer))).join('\n');
 const publicOutputs=[JSON.stringify(projected),rendered,mail.html,mail.text,customerPdfText];
 for(const output of publicOutputs){
  assert.doesNotMatch(output,/\$2\.00|200\.00 direct cost|approved direct labor rate|owner-average cost|owner-approved estimating schedule|operating profit|overhead recovery|pricing divisor/i);
  assert.match(output,/100 (?:linear feet|LF)/i);
  assert.match(output,/owner supplies all materials/i);
 }
 assert.match(rendered,/plumbing, electrical, and second-floor work/i);
 assert.match(rendered,/preliminary estimating basis/i);
 assert.match(rendered,/source date is not stated/i);
 assert.match(mail.text,/\$335 to \$435/);
 assert.match(customerPdfText,/\$335 to \$435/);
 for(const key of ['directCost','lines','allocationDollars','targetOperatingProfit','costBookSnapshot','scopePricing'])assert.equal(key in projected,false);

 // The same saved record remains complete in the explicitly administrative
 // artifact; the repair is a customer boundary, not destructive persistence.
 const adminText=(await pdfTextLayers(await administrativePdf('saved-result',saved.internal))).join('\n');
 assert.match(adminText,/Direct project cost: \$200\.00/);
 assert.match(adminText,/\$2\.00 = \$200\.00/);
 assert.match(adminText,/owner-average cost/i);
});

test('ordinary overhead-door scope and every priced line survive page, email, and PDF presentation',async()=>{
 const garage={
  summary:'Repair the overhead garage door and its opener.',
  includedCategories:['Garage Doors'],
  range:{low:1500,high:1800},
  categoryRanges:[{category:'Garage Doors',low:1500,high:1800}],
  lineItems:[
   {id:'door',category:'Garage Doors',description:'Repair overhead garage door',quantity:1,unit:'EA',low:1200,high:1400,unitLow:1200,unitHigh:1400},
   {id:'opener',category:'Garage Doors',description:'Repair garage door opener',quantity:1,unit:'EA',low:300,high:400,unitLow:300,unitHigh:400},
  ],
  assumptions:[],exclusions:[],allowances:[],factors:[],message:'Review your estimate.',nextStep:'Consultation',disclaimer:'Preliminary only.',
 };
 assert.equal(publicPricingText('Repair the overhead garage door and its opener.'),'Repair the overhead garage door and its opener.');
 assert.equal(publicPricingText('Repair overhead wiring and follow the architect markup. Maintain a 1/8-inch margin around the door.'),'Repair overhead wiring and follow the architect markup. Maintain a 1/8-inch margin around the door.');
 const page=JSON.stringify(estimateSections(garage));
 const mail=estimateEmail('garage-regression',{customer:garage,contact:{name:'Garage Customer'}},false);
 const pdf=(await pdfTextLayers(await customerPdf('garage-regression',garage))).join('\n');
 for(const output of [page,mail.html,mail.text,pdf]){
  assert.match(output,/Repair the overhead garage door and its opener\./);
  assert.match(output,/Repair overhead garage door/);
  assert.match(output,/\$1,200 to \$1,400 total/);
 }
});

test('a fully private description is replaced safely without dropping its priced quantity or selling total',async()=>{
 const privateDescription={
  summary:'Garage improvements.',
  includedCategories:['Garage Doors'],
  range:{low:335,high:435},
  categoryRanges:[{category:'Garage Doors',low:335,high:435}],
  lineItems:[{id:'private-description',category:'Garage Doors',description:'Approved direct labor rate of $2.00/LF ($200.00 direct cost).',quantity:100,unit:'LF',low:335,high:435,unitLow:3.35,unitHigh:4.35}],
  assumptions:[],exclusions:[],allowances:[],factors:[],message:'Review your estimate.',nextStep:'Consultation',disclaimer:'Preliminary only.',
 };
 const projected=customerPresentation(privateDescription);
 assert.equal(projected.lineItems.length,1);
 assert.equal(projected.lineItems[0].description,'Priced scope item - Garage Doors');
 const page=JSON.stringify(estimateSections(privateDescription));
 const mail=estimateEmail('private-description',{customer:privateDescription,contact:{name:'Garage Customer'}},false);
 const pdf=(await pdfTextLayers(await customerPdf('private-description',privateDescription))).join('\n');
 for(const output of [page,mail.html,mail.text,pdf]){
  assert.match(output,/Priced scope item - Garage Doors/);
  assert.match(output,/100 LF/);
  assert.match(output,/\$335 to \$435 total/);
  assert.doesNotMatch(output,/\$2\.00|200\.00 direct cost|direct labor rate/i);
 }
});

test('public pricing repair removes adversarial finance clauses without losing mixed public facts',()=>{
 const mixed=[
  'Install 100 LF in 4 hours at the direct labor rate of $2.00/LF ($200.00 direct cost), excluding all second-floor work.',
  'The catalog unit-cost is $9.25; the source date is not stated.',
  'Pricing carries 20% profit and 20% overhead allocation, but the customer selling total is $500.',
  'The risk-adjusted cost is divided by 0.60 for a 40% margin. Customer price is $600.',
  'Fixture allowance includes $1,200 for 8 fixtures, delivery, and installation by October 15.',
  'Owner supplies materials; plumbing and electrical are excluded.',
 ].join('\n');
 const repaired=publicPricingText(mixed);
 assert.doesNotMatch(repaired,/\$2\.00|\$200\.00|\$9\.25|profit|margin|overhead|allocation|risk-adjusted|divided by|0\.60/i);
 assert.match(repaired,/100 LF in 4 hours/);
 assert.match(repaired,/excluding all second-floor work/);
 assert.match(repaired,/source date is not stated/);
 assert.match(repaired,/customer selling total is \$500/);
 assert.match(repaired,/Customer price is \$600/);
 assert.match(repaired,/allowance includes \$1,200 for 8 fixtures/);
 assert.match(repaired,/delivery, and installation by October 15/);
 assert.match(repaired,/Owner supplies materials/);
 assert.match(repaired,/plumbing and electrical are excluded/);
});

test('financial context identifies overhead, margin, allocation, and markup without treating the words themselves as private',()=>{
 const financial=[
  'Overhead: $72.',
  'Overhead is 20%.',
  '$72 overhead.',
  '20% for overhead.',
  'Margin of 40%.',
  'Allocation is 12%.',
  'Markup: $90.',
 ].join('\n');
 assert.equal(publicPricingText(financial),'');
 const ordinary=[
  'Repair the overhead garage door and its opener.',
  'Repair overhead wiring.',
  'Maintain a 1/8-inch margin around the door.',
  'Follow the architect markup.',
  'Confirm the room allocation with the architect.',
 ].join('\n');
 assert.equal(publicPricingText(ordinary),ordinary);
});
test('One house described four ways is not four buildings',()=>{
 const line=(id:string,building:string)=>({id,category:'Electrical',description:'Repair '+id,quantity:1,unit:'EA',low:50,high:100,unitLow:50,unitHigh:100,building});
 const sections=estimateSections({summary:'',includedCategories:['Electrical'],range:{low:200,high:400},scopeTasks:[],assumptions:[],exclusions:[],allowances:[],factors:[],categoryRanges:[{category:'Electrical',low:200,high:400}],lineItems:[line('a','5487 N Marcliffe Ave'),line('b','Residence'),line('c','Single-family residence'),line('d','Residence site')]} as never);
 assert.ok(!sections.some(s=>s.title===SECTION_TITLES.buildingPrices));
 assert.ok(!JSON.stringify(sections).includes('Single-family residence /'));
});
