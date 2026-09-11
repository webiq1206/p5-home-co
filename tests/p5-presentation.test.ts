import test from 'node:test';
import assert from 'node:assert/strict';
import {summarySections,estimateSections} from '../lib/p5/presentation.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
const result={summary:'Project type: new-construction\nProject area in square feet: 4500\nPlumbing work: Supply fixtures. Install connections.\nExcluded work: Land and financing.',includedCategories:['Plumbing'],range:{low:100,high:200},lineItems:[{id:'p',category:'Plumbing',description:'Fixture installation',quantity:2,unit:'EA',low:100,high:200,unitLow:50,unitHigh:100}],categoryRanges:[{category:'Plumbing',low:100,high:200}],assumptions:[],exclusions:['Land'],allowances:[],factors:[],message:'Review your estimate.',nextStep:'Consultation',disclaimer:'Preliminary only.'};
test('Legacy summaries retain values, use readable quantities and group scope without inventing prices',()=>{
 const sections=summarySections(result.summary);
 assert.deepEqual(sections[0].rows,[['Project type','New construction'],['Project area in square feet','4,500']]);
 const breakdown=estimateSections(result).find(s=>s.title==='Plumbing'&&s.text);
 assert.equal(breakdown?.rows?.length,1);assert.ok(breakdown?.rows?.[0][1].includes('$100 to $200 total'));
 assert.ok(JSON.stringify(sections).includes('Land and financing.'));
});
test('Formatted customer emails escape scope HTML and never include internal finance',()=>{
 const record={customer:{...result,summary:result.summary+'\n<script>alert(1)</script>'},internal:{directCost:98765,operatingProfit:12345},contact:{name:'Test'}};
 const customer=estimateEmail('test',record,false),admin=estimateEmail('test',record,true);
 assert.ok(customer.html.includes('<h2'));assert.ok(customer.html.includes('&lt;script&gt;'));
 assert.ok(!customer.html.includes('<script>'));assert.ok(!customer.html.includes('98,765'));
 assert.ok(admin.html.includes('98,765'));assert.ok(customer.text.includes('PLUMBING'));
});
