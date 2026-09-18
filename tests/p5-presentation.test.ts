import test from 'node:test';
import assert from 'node:assert/strict';
import {summarySections,estimateSections,SECTION_TITLES} from '../lib/p5/presentation.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
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
