import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEstimateDocument,issueRecord,allocate,estimateReference,confirmStep,ESTIMATE_TEMPLATE_VERSION,type EstimateBrand} from '../lib/p5/estimateDocument.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {customerPdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

// The owner's approved preliminary online estimate (2026-09-21): one document model for the PDF,
// the email and the result screen, branded by the site that received the submission.
const site=ESTIMATOR_BRAND as unknown as EstimateBrand;
const brand=(id:string):EstimateBrand=>({...site,id,name:id==='p5'?'P5 Home Co':`Boise ${id} Co`});
const ID='0f1e2d3c-4b5a-4000-8000-00000000abcd';
const contact={name:'[QA] Test Customer',email:'qa@example.invalid',phone:'(208) 555-0100'};
const line=(id:string,category:string,description:string,quantity:number,unit:string,low:number,high:number,extra={})=>({id,category,description,quantity,unit,low,high,...extra});
const re10={range:{low:29266,high:29266},categoryRanges:[{category:'Roofing',low:6100,high:6900},{category:'Plumbing',low:3900,high:4400},{category:'Crawl space',low:7100,high:8000}],
 lineItems:[line('1','Roofing','Replace damaged shingles (RE-10 item 1)',4,'SQ',6100,6900),line('2','Plumbing','Repair supply line (item 2)',1,'EA',3900,4400),line('3','Crawl space','Install vapor barrier (item 3)',1400,'SF',7100,8000)],
 exclusions:['Mold remediation (not included in this price; we will quote it after a site visit)','Appliance repair'],assumptions:['To confirm: Mold remediation is listed but not priced in this estimate; it needs a site visit before we can put a number on it.','Roof decking is sound.'],verificationItems:['Confirm crawl space access.']};
const scope=(service:string,extra:Record<string,unknown>={},text='Replace the damaged shingles and fix the supply line.')=>({text,answers:{service,location:'Boise, ID 83714',...extra},uploads:[{name:'RE-10 notice.pdf'}],uncertainFields:[] as string[]});

test('the site that received the submission is the brand; a record stamped for another brand is refused',()=>{
 const issue=issueRecord({brandId:'handyman',id:ID,revision:2,now:new Date('2026-09-21T18:00:00Z'),contact,scope:scope('re10')});
 assert.equal(buildEstimateDocument({id:ID,result:{...re10,issue},brand:brand('handyman')}).brand.id,'handyman');
 assert.throws(()=>buildEstimateDocument({id:ID,result:{...re10,issue},brand:brand('remodeling')}),/estimate-brand-mismatch/);
});
test('a single price reconciles exactly: category amounts add up to the total the engine priced',()=>{
 for(const [total,weights] of [[29266,[6500,4150,7550]],[1450,[1050,450]],[100,[1,1,1]],[7,[0,0]]] as [number,number[]][])
  assert.equal(allocate(total,weights).reduce((t,v)=>t+v,0),total);
 const doc=buildEstimateDocument({id:ID,result:re10,brand:brand('handyman'),issue:{service:'re10'}});
 assert.equal(doc.priceKind,'single');assert.equal(doc.total?.amount,'$29,266');
 assert.equal(doc.categories.reduce((t,c)=>t+c.low,0),29266);
});
test('a range keeps its own basis and says how categories relate to it, never inventing a total',()=>{
 const doc=buildEstimateDocument({id:ID,result:{...re10,range:{low:30000,high:34000}},brand:brand('remodeling'),issue:{service:'kitchen'}});
 assert.equal(doc.total?.amount,'$30,000 to $34,000');assert.equal(doc.subtotal,null);
 assert.ok(doc.totalNotes.some(n=>/parts of the overall range, not additional charges/.test(n)));
 assert.equal(buildEstimateDocument({id:ID,result:{...re10,range:null},brand:brand('remodeling'),issue:{service:'kitchen'}}).total,null);
});
test('requested work that is not priced yet is never an exclusion; the estimate says it is partial',()=>{
 const doc=buildEstimateDocument({id:ID,result:re10,brand:brand('handyman'),issue:{service:'re10'}});
 assert.equal(doc.status,'partial');assert.match(doc.partialNote,/one requested item is not priced yet/);
 assert.deepEqual(doc.exclusions,['Appliance repair']);
 const confirm=doc.assumptionRows.find(([k])=>k==='To confirm')![1];
 assert.ok(confirm.some(v=>/^Mold remediation: not priced yet/.test(v)));
 assert.equal(confirm.filter(v=>/Mold/.test(v)).length,1,'the unpriced item is listed once');
 assert.ok(!doc.assumptionRows.find(([k])=>k==='Assumptions')![1].some(v=>/Mold/.test(v)));
});
test('an empty exclusion list is stated plainly, never printed as "None"',()=>{
 const doc=buildEstimateDocument({id:ID,result:{...re10,exclusions:[]},brand:brand('handyman'),issue:{service:'handyman'}});
 assert.equal(doc.exclusions.length,0);assert.match(doc.exclusionsNote,/No specific exclusions were identified/);
});
test('finish basis is reported truthfully: selected, from documents, or an assumption to confirm',()=>{
 const base={brandId:'remodeling',id:ID,revision:1,now:new Date('2026-09-21T18:00:00Z'),contact};
 assert.equal(issueRecord({...base,scope:scope('kitchen',{finish:'high-end'})}).finishBasis,'selected');
 assert.equal(issueRecord({...base,scope:{...scope('kitchen',{finish:'high-end'}),uncertainFields:['finish']}}).finishBasis,'assumed');
 assert.equal(issueRecord({...base,scope:{...scope('kitchen',{finish:'luxury'}),uploads:[{name:'selections.pdf'}],extraction:{facts:[{field:'finish',value:'luxury',source:'selections.pdf',basis:'stated'}]}}}).finishBasis,'document');
 assert.equal(issueRecord({...base,scope:scope('kitchen')}).finishBasis,'assumed');
 assert.equal(issueRecord({...base,scope:scope('re10')}).finishBasis,'not-applicable');
 // The builder-grade tier is never called a "refresh" on a new home.
 const doc=buildEstimateDocument({id:ID,result:re10,brand:brand('construction'),issue:{service:'new-construction',finish:'refresh',finishBasis:'selected'}});
 assert.equal(doc.finish.name,'Builder grade');assert.match(doc.finish.basis,/selected by you/);
 const repair=buildEstimateDocument({id:ID,result:re10,brand:brand('handyman'),issue:{service:'re10'}});
 assert.equal(repair.finish.heading,'Finish / repair standard');assert.match(repair.finish.detail,/exact match to existing finishes is not guaranteed/);
});
test('service decides the title and the second next step; RE-10 is a service, never a brand',()=>{
 assert.equal(buildEstimateDocument({id:ID,result:re10,brand:brand('handyman'),issue:{service:'re10'}}).title,'RE-10 repair estimate');
 assert.equal(buildEstimateDocument({id:ID,result:re10,brand:brand('remodeling'),issue:{service:'cabinet-product'}}).title,'Cabinet estimate');
 assert.match(confirmStep('cabinet-install'),/layouts, dimensions, materials, hardware and installation scope/);
 assert.match(confirmStep('re10'),/contract deadline/);assert.match(confirmStep('new-construction'),/plans, site conditions/);
});
test('the P5 endorsement appears on every brand but P5 itself',()=>{
 assert.equal(buildEstimateDocument({id:ID,result:re10,brand:brand('p5'),issue:{service:'handyman'}}).brand.endorsed,false);
 for(const id of ['remodeling','construction','handyman','cabinet'])assert.equal(buildEstimateDocument({id:ID,result:re10,brand:brand(id),issue:{service:'handyman'}}).brand.endorsed,true);
});
test('a request to us is not a project name; the service and address name it instead',()=>{
 const base={brandId:'handyman',id:ID,revision:1,now:new Date('2026-09-21T18:00:00Z'),contact};
 assert.equal(issueRecord({...base,scope:scope('re10',{address:'5487 N Example Ave'},'Please price the repair items on this RE-10 inspection notice.')}).projectName,'RE-10 repairs at 5487 N Example Ave');
 assert.equal(issueRecord({...base,scope:scope('handyman',{},'Replace two interior doors.')}).projectName,'Replace two interior doors');
 assert.equal(issueRecord({...base,scope:scope('cabinet-product',{},'Supply and install new shaker kitchen cabinets: 18 linear feet of base cabinets and 14 linear feet of upper cabinets, painted maple.')}).projectName,'Supply and install new shaker kitchen cabinets');
 assert.equal(estimateReference(ID),'P5-0F1E2D3C');assert.equal(issueRecord({...base,scope:scope('re10')}).templateVersion,ESTIMATE_TEMPLATE_VERSION);
});
test('PDF and email render the same saved revision, keep its date on every re-render, and ask for nothing',async()=>{
 const issue=issueRecord({brandId:site.id,id:ID,revision:4,now:new Date('2026-09-21T18:00:00Z'),contact,scope:scope('re10')});
 const saved={...re10,issue};
 const first=(await pdfTextLayers(await customerPdf(ID,saved))).join('\n');
 const again=(await pdfTextLayers(await customerPdf(ID,saved,'2027-01-01T00:00:00Z'))).join('\n');
 assert.equal(first,again,'a resend or re-download is the same document');
 const mail=estimateEmail(ID,{customer:saved,contact},false);
 for(const output of [first,mail.text,mail.html]){
  assert.match(output,/P5-0F1E2D3C/);assert.match(output,/September 21, 2026/);assert.match(output,/\$29,266/);
  assert.match(output,/Preliminary estimate, not a contract\./);assert.match(output,/Request a project review/);
  assert.doesNotMatch(output,/\b(?:sign here|signature line|initials|deposit|approve and pay|accept this (?:estimate|proposal))\b/i);
  assert.doesNotMatch(output,/direct cost|overhead|profit|contingency/i);
 }
 // "margin" is checked on the text layers only; the HTML carries CSS margins.
 for(const output of [first,mail.text])assert.doesNotMatch(output,/margin/i);
 if(site.id!=='p5')for(const output of [first,mail.text])assert.match(output,/A P5 Home Co\. brand/);
 assert.match(mail.html,/mailto:[^"]+\?subject=Project%20review%20request%20-%20estimate%20P5-0F1E2D3C/);
});
test('customer text cannot inject markup into the email',()=>{
 const issue=issueRecord({brandId:site.id,id:ID,revision:1,now:new Date('2026-09-21T18:00:00Z'),contact:{...contact,name:'<img src=x onerror=alert(1)>'},scope:scope('handyman',{},'<script>alert(1)</script> fix the door.')});
 const mail=estimateEmail(ID,{customer:{...re10,issue}},false);
 assert.doesNotMatch(mail.html,/<script>|<img src=x/);
});
test('a task and the priced line that repeats it read once, with the item and quantity kept',()=>{
 const task='Exterior/roof: Furnish and replace rubber boots at all plumbing roof vents';
 const doc=buildEstimateDocument({id:ID,brand:brand('handyman'),issue:{service:'re10'},result:{range:{low:500,high:500},categoryRanges:[{category:'Roofing',low:500,high:500}],
  scopeTasks:[{description:task,category:'Roofing'}],
  lineItems:[line('b','Roofing',`${task}: Plumbing vent pipe boot.`,3,'EA',288,288,{pricingStatus:'estimated-allowance'}),line('c','Roofing',`${task}: Roofer labor.`,2,'hour',212,212)]}});
 const c=doc.categories[0];
 assert.deepEqual(c.work,[`${task} (Roofer labor, 2 hour)`]);
 // Structured for separated rendering: one item per task, its priced lines under it.
 assert.deepEqual(c.items,[{task,where:'',details:[{text:'Roofer labor',qty:'2 hour'}],added:false}]);
 assert.match(c.allowances[0],/^Plumbing vent pipe boot\., 3 EA \(included in this category amount\)/);
});
test('a location prefix is shown as a tag, and the task still reads once (owner report 2026-09-22)',()=>{
 const task='Tighten the guest toilet and verify stability';
 const doc=buildEstimateDocument({id:ID,brand:brand('handyman'),issue:{service:'re10'},result:{range:{low:660,high:660},categoryRanges:[{category:'Plumbing',low:660,high:660}],
  scopeTasks:[{description:task,category:'Plumbing'}],
  lineItems:[line('t','Plumbing',`Residence / Floor Main level / ${task}: Toilet reset / tighten (labor)`,1,'EA',660,660)]}});
 assert.deepEqual(doc.categories[0].items,[{task,where:'Main level',details:[{text:'Toilet reset / tighten',qty:''}],added:false}]);
 assert.equal(doc.categories[0].work.length,1,'the task is listed once, not again with its location');
});
test('work the contractor does is never listed as supplied by the owner (owner report 2026-09-22)',()=>{
 const doc=buildEstimateDocument({id:ID,brand:brand('cabinet'),issue:{service:'cabinet-install'},result:{...re10,instructions:{responsibilities:['Contractor supplies and installs all specified kitchen cabinets and hardware','Provide and install all listed materials and items','Owner supplies the appliances']}}});
 assert.ok(!doc.exclusions.some(e=>/Contractor supplies|Provide and install all listed/.test(e)));
 assert.ok(doc.exclusions.includes('By others or supplied by the owner: Owner supplies the appliances'));
});
