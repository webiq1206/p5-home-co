import test from 'node:test';
import assert from 'node:assert/strict';
import {groundSourceResponsibilities} from '../lib/p5/sourceResponsibilities.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const source='Owner-selected decorative fixtures; recessed, utility and standard exterior fixtures are carried separately. Appliance allowances are product-only and exclude shipping, sales/use tax, delivery, installation and hookups. Anticipated ancillary costs are carried separately within Division .';
const extraction:ScopeExtraction={summary:'New house',sourceText:source,facts:[
 {field:'installation',value:'Standard installation and waterproofing for engineered wood and tile. Owner responsible for appliance and decorative lighting installation.',confidence:1,source:'scope.pdf',evidence:'Flooring installation included. Appliance allowances are product-only.',basis:'stated'},
 {field:'ownerSupplied',value:'Decorative lighting and all appliances are product-only allowances.',confidence:1,source:'scope.pdf',evidence:source,basis:'stated'},
 {field:'exclusions',value:'Land and financing are excluded.',confidence:1,source:'scope.pdf',evidence:'Land and financing excluded.',basis:'stated'},
],conflicts:[],reviewNotes:[],missingInformation:[],instructions:{...emptyInstructions(),responsibilities:['Owner provides final selections for decorative lighting and appliances','Owner responsible for installation of appliances and decorative lighting'],exclusions:['Appliance, lighting, and some decorative hardware shipping/tax/install','Land and financing'],questions:[]}};
test('product allowance exclusions do not become owner installation or global project exclusions',()=>{
 const safe=groundSourceResponsibilities(extraction,source,'',{});
 assert.equal(safe.facts.find(f=>f.field==='installation')?.value,'Standard installation and waterproofing for engineered wood and tile.');
 assert.equal(safe.facts.some(f=>f.field==='ownerSupplied'),false);
 assert.deepEqual(safe.instructions?.responsibilities,['Owner provides final selections for decorative lighting and appliances']);
 assert.deepEqual(safe.instructions?.exclusions,['Land and financing']);
 assert.equal(safe.sourceText,source);
 assert.deepEqual(safe.instructions?.questions,['Who should install the appliances?','Who should install the decorative lighting?']);
 assert.deepEqual(instructionPrompts(safe,{})[0].values,['Include installation in this estimate','Owner handles installation']);
 assert.match(extraction.facts[0].value,/Owner responsible/);
});
test('explicit owner installation and supply remain authoritative',()=>{
 const supplied={...extraction,facts:[{...extraction.facts[1],value:'Appliances'}]};
 assert.equal(groundSourceResponsibilities(supplied,source,'I will supply all appliances.',{}).facts[0].field,'ownerSupplied');
 const safe=groundSourceResponsibilities(extraction,source,'Owner will install appliances and decorative lighting.',{ownerSupplied:'All appliances and decorative lighting'});
 assert.equal(safe.instructions?.questions.length,0);assert.ok(safe.facts.some(f=>f.field==='ownerSupplied'));
 assert.match(safe.facts[0].value,/Owner responsible/);
});
test('a confirmed installation answer stays resolved without a new PDF',()=>{
 const safe=groundSourceResponsibilities(extraction,undefined,'Owner handles installation',{});
 assert.equal(safe,extraction);
});
