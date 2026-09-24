import test from 'node:test';
import assert from 'node:assert/strict';
import {customerText,projectCustomerEstimate,customerPresentation,publicPricingText,customerSafeValue} from '../lib/p5/customerProjection.ts';
import {customerSafeText as safetyText,customerSafeValue as safetyValue} from '../lib/p5/customerSafety.ts';
import {estimateSections,categoryBreakdown,customerEstimateSections,customerSafeText} from '../lib/p5/presentation.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {customerPdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';

// One customer boundary serves every brand. These cases were found separately
// on the Construction, Handyman and Cabinet sites; all of them are held here.
// No provider, storage or customer delivery is used, and no saved evidence is rewritten.
const oldResult={
 status:'planning-range',range:{low:350,high:450},summary:'Install 100 LF of trim.',
 includedCategories:['Carpentry'],categoryRanges:[{category:'Carpentry',low:350,high:450}],
 lineItems:[{id:'trim',category:'Carpentry',description:'Trim installation',quantity:100,unit:'LF',low:350,high:450,unitLow:3.5,unitHigh:4.5,unitCost:2,evidence:{reference:'private catalog'},rateSources:['private source'],pricingStatus:'estimated-allowance'}],
 allowances:[],assumptions:['100 LF of trim at $2.00/LF ($200.00 direct cost). Preliminary allowance, not a supplier quote. Confirm local pricing and selections.'],
 exclusions:['Painting excluded.'],factors:[],nextStep:'Confirm scope.',message:'Planning estimate.',disclaimer:'Not a bid.',
 internal:{directCost:200,margin:.2},costBookSnapshot:{private:true},
 verificationItems:['Regional planning average, not verified local pricing: $2.00/LF. Confirm quantities.'],
};
test('every entry point is the same single projection',()=>{
 const sample='100 LF of trim at $2.00/LF ($200.00 direct cost). Confirm selections.';
 for(const redact of [customerText,customerSafeText,safetyText,publicPricingText])assert.equal(redact(sample),'100 LF of trim. Confirm selections.');
 assert.deepEqual(projectCustomerEstimate(oldResult),customerPresentation(oldResult));
 assert.deepEqual(safetyValue({a:[sample,'Overhead is 20%.']}),{a:['100 LF of trim. Confirm selections.']});
 assert.deepEqual(customerSafeValue({n:3,ok:true,none:null}),{n:3,ok:true,none:null});
});
test('prose redacts rate and margin variants, not scope quantities or nonfinancial percentages',()=>{
 const safe='Allow 10% waste; roof pitch 25%; install 100 LF and 2 per room. Final selection to be confirmed.';
 assert.equal(customerText(safe),safe);
 for(const privateText of ['2.00/LF','2.00 USD/each','USD 2.00/each','margin 20%','20% margin','overhead: 20%','profit at 25%','contingency rate 12%','cost basis 4.10','$2.00 - $3.00 / LF','$4 per hour']){
  const output=customerText(privateText);
  assert.doesNotMatch(output,/\d/,privateText);
 }
});
test('spelled-out bare unit rates and extended cost arithmetic stay private',()=>{
 for(const rate of ['1.25 per linear foot','3.00 per square foot','5 per gallon','2.00 per pound','2 per LF','3/EA','4 per cubic yard','6 per lineal foot']){
  assert.equal(customerText(rate),'',rate);
 }
 const arithmetic='Trim: 100 LF x 2 =200. Allow 10% waste; confirm local pricing.';
 assert.equal(customerText(arithmetic),'Trim: 100 LF. Allow 10% waste; confirm local pricing.');
 assert.equal(customerText('100 LF × 2.00 = 200.00'),'100 LF');
 for(const scope of ['5 nails per linear foot','2 gallons per room','100 LF of trim','2 per room','3 per wall','10 x 12 feet','2 x 4 studs','5 gallons cover 400 square feet','Roof pitch 25%; allow 10% waste.','Install 3/4 inch plywood.','Use 1/2 HR rated assemblies.']){
  assert.equal(customerText(scope),scope);
 }
 const projected=projectCustomerEstimate({...oldResult,assumptions:[arithmetic,'Allowance: 5 per gallon; not a supplier quote.']});
 assert.equal(projected.lineItems[0].quantity,100);
 assert.equal(projected.lineItems[0].unitLow,3.5);
 assert.deepEqual(projected.range,oldResult.range);
 assert.doesNotMatch(JSON.stringify(projected.assumptions),/x 2|=200|5 per gallon/);
 assert.match(projected.assumptions.join(' '),/not a supplier quote/);
});
test('generated evidence ranges and verbose financial ratios hide every cost bound',()=>{
 const evidence='Regional planning average: 20 to 30 USD/SF. Allow 10% waste; not verified local pricing.';
 assert.equal(customerText(evidence),'Budget allowance. Allow 10% waste; final selection to be confirmed.');
 assert.equal(customerText('2.50 to 3.75 USD/LF; confirm quantities.'),'confirm quantities.');
 assert.equal(customerText('operating profit target is 20%; overhead allocation of 0.2; allow 10% waste.'),'allow 10% waste.');
});
test('customer selling totals and allowance amounts in prose are not cost figures',()=>{
 for(const text of ['The customer selling total is $500.','Fixture allowance includes $1,200 for 8 fixtures, delivery, and installation by October 15.','Tile allowance of $4,500 is included.'])assert.equal(customerText(text),text);
});
test('live consumable cost notes hide direct-material amounts and their later bounds',async()=>{
 const note='The consumables are covered by planning-1 as a $30 direct-material work-package allowance, with a disclosed $20–$40 range, for the stated 100 LF. This is not a supplier quote; verify local pricing before a firm proposal.';
 const result={...oldResult,verificationItems:[note]};
 const projected=projectCustomerEstimate(result);
 const email=estimateEmail('offline-consumables',{customer:result,internal:{}},false);
 const pdf=(await pdfTextLayers(await customerPdf('offline-consumables',result))).join(' ');
 for(const output of [customerText(note),JSON.stringify(projected.verificationItems),email.text,email.html,pdf]){
  assert.doesNotMatch(output,/\$20|\$30|\$40|direct-material/);
  assert.match(output,/100 LF/);assert.match(output,/not a supplier quote/);
 }
 assert.deepEqual(projected.range,result.range,'customer selling totals remain unchanged');
});
test('ordinary overhead, margin and markup wording survives while financial overhead does not',()=>{
 for(const text of ['Install overhead cabinets above the workbench.','Replace overhead lighting in the pantry.','Repair the overhead garage door and its opener.','Replace overhead doors at both bays.','Follow the architect markup.','Maintain a 1/8-inch margin around the door.'])assert.equal(customerSafeText(text),text);
 for(const text of ['Overhead recovery: $400.','Overhead is 20%.','Add $400 for overhead.','Overhead costs are $900.'])assert.equal(customerSafeText(text),'');
 assert.equal(customerSafeText('Preliminary allowance: $2.00/LF ($200.00 direct cost). Confirm selections.'),'Preliminary allowance. Confirm selections.');
 assert.equal(customerSafeText('Projected gross profit is $5,000. Confirm final selections.'),'Confirm final selections.');
 assert.equal(customerSafeText('Overhead recovery: $800. Scope remains preliminary.'),'Scope remains preliminary.');
});
test('historical projection hides costs without changing selling arithmetic, scope or original evidence',()=>{
 const before=JSON.stringify(oldResult);
 const result=projectCustomerEstimate(oldResult);
 const text=JSON.stringify(result);
 assert.doesNotMatch(text,/\$2\.00|\$200\.00|unitCost|private catalog|rateSources|directCost|costBookSnapshot/);
 assert.deepEqual(result.range,oldResult.range);
 assert.equal(result.lineItems[0].quantity,100);
 assert.equal(result.lineItems[0].unitLow,3.5);
 assert.match(text,/Preliminary allowance, not a supplier quote/);
 assert.match(text,/final selection to be confirmed/i);
 assert.match(text,/Painting excluded/);
 assert.equal(JSON.stringify(oldResult),before);
 assert.deepEqual(projectCustomerEstimate(result),result);
});
test('scope tasks keep their public identity, location and quantity and nothing else',()=>{
 const projected=customerPresentation({scopeTasks:[{id:'t1',description:'Install trim at $2.00/LF ($200.00 direct cost)',category:'Carpentry',building:'Shop',floor:'2',quantity:100,unit:'LF',quantityRange:{low:90,high:110},status:'priced',codes:['03-19-04-L'],unitCost:2}]});
 assert.deepEqual(projected.scopeTasks,[{id:'t1',description:'Install trim',category:'Carpentry',building:'Shop',floor:'2',quantity:100,unit:'LF',quantityRange:{low:90,high:110},status:'priced'}]);
});
test('saved-result customer sections, page breakdown and email reapply the boundary',()=>{
 const sections=JSON.stringify(estimateSections(oldResult));
 assert.doesNotMatch(sections,/\$2\.00|\$200\.00/);
 assert.match(sections,/Confirm local pricing/);
 assert.deepEqual(customerEstimateSections(oldResult),estimateSections(oldResult));
 assert.equal(categoryBreakdown(oldResult,true,false)[0].items[0].unitLow,3.5);
 const email=estimateEmail('offline-test',{customer:oldResult,internal:{directCost:200}},false);
 assert.doesNotMatch(email.html+email.text,/\$2\.00|\$200\.00|private catalog/);
 assert.match(email.text,/100 LF/);
 assert.match(email.text,/\$350/);
 const admin=estimateEmail('offline-test',{customer:oldResult,internal:{directCost:200}},true);
 assert.match(admin.text,/Direct project cost: \$200/);
});
test('private text in the message, next step and disclaimer never reaches the customer email or PDF',async()=>{
 const leaking={...oldResult,message:'Planning estimate. Direct cost is $200.00.',nextStep:'Confirm scope. Margin of 40%.',disclaimer:'Not a bid. Overhead allocation is 12%.'};
 const email=estimateEmail('offline-test',{customer:leaking,internal:{directCost:200}},false);
 const pdf=(await pdfTextLayers(await customerPdf('offline-privacy',leaking))).join(' ');
 for(const output of [email.html,email.text,pdf]){
  assert.doesNotMatch(output,/\$200\.00|40%|12%|Direct cost|Overhead allocation/i);
  // The free-text message and disclaimer are replaced by the approved notice on the customer estimate.
  assert.match(output,/Preliminary estimate, not a contract\./);
 }
});
test('unit rates can be withheld from the customer copy while the administrative breakdown retains them',async()=>{
 const leaked='$2.00/LF ($200.00 direct cost)';
 const r={...oldResult,lineItems:[{...oldResult.lineItems[0],description:'20 LF cabinet run',quantity:20,unit:'LF',low:100,high:200,unitLow:10,unitHigh:15,rateLocation:leaked,rateDate:'2026-09-19',verification:`${leaked}; confirm selections before a firm proposal.`}]};
 const hidden=customerPresentation(r,{hideUnitRates:true});
 for(const key of ['unitLow','unitHigh','rateLocation','rateDate'])assert.equal(key in hidden.lineItems[0],false,key);
 assert.equal(hidden.lineItems[0].verification,'confirm selections before a firm proposal.');
 const sections=JSON.stringify(estimateSections(r,true));
 assert.match(sections,/\$100 to \$200/);
 assert.match(sections,/20 LF/);
 assert.doesNotMatch(sections,/direct cost|unit cost|markup|profit|\$2\.00\/LF|\$10\.00|\$15\.00|cost location/i);
 assert.equal(categoryBreakdown(r,true,true)[0].items[0].unitHigh,undefined);
 assert.equal(categoryBreakdown(r,false)[0].items[0].unitHigh,15);
 // Brands that show unit rates still show the selling unit range, never the cost rate.
 const shown=JSON.stringify(estimateSections(r,false));
 assert.match(shown,/\$10\.00 to \$15\.00 \/ LF/);
 assert.doesNotMatch(shown,/\$2\.00\/LF|direct cost/i);
});
test('historical customer PDF hides prose rates while keeping selling totals and caveats',async()=>{
 const text=(await pdfTextLayers(await customerPdf('offline-privacy',oldResult))).join(' ');
 assert.doesNotMatch(text,/\$2\.00|\$200\.00|private catalog/);
 assert.match(text,/\$350/);
 assert.match(text,/100 LF/);
 assert.match(text,/not a supplier quote/);
});
test('owner price-book provenance notes never reach customer copy (live RE-10, 2026-09-21)',()=>{
 // 165 book lines carry "Third-party market rate (cost to you if subcontracted)" and 28 carry
 // "parts / materials extra"; both reached a live result screen inside line descriptions.
 assert.equal(publicPricingText('Exterior/roof: Clean buildup at the flashing.: Roofer. Third-party market rate (cost to you if subcontracted)'),'Exterior/roof: Clean buildup at the flashing.: Roofer.');
 assert.equal(publicPricingText('Service call. Third-party market rate; parts / materials extra'),'Service call.');
 assert.equal(publicPricingText('Install vapor barrier in crawl space.'),'Install vapor barrier in crawl space.');
});
