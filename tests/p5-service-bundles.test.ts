import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {priceCompleteScope} from '../lib/p5/scopePricing.ts';
import {supportedServiceBundle} from '../lib/p5/serviceBundles.ts';
import {customerPdf} from '../lib/p5/pdf.ts';

const fixture=(name:string)=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const rows=fixture('p5-main12-saved-failure.json').find((row:any)=>row.source==='work').evidence;
const saved=rows.find((row:any)=>row.payload.input?.kind==='pricing').payload.input;
const configuration=saved.configuration;
const now=new Date('2026-10-02T16:00:00Z');
const failedProvider=async()=>{throw new Error('Provider unavailable: a certified bundle must not call it');};

for(const [version,file] of [['.8','p5-same-door-hardware.json'],['.9','p5-retained-audit-copy.json'],['.10','p5-final-minor-work-copy.json'],['.11','p5-main11-saved-failure.json'],['.12','p5-main12-saved-failure.json']])test('complete pipeline releases exact saved '+version+' scope without pricing-provider or research calls',async(t)=>{
 t.mock.method(globalThis,'fetch',failedProvider);
 const f=fixture(file),scope=version==='.12'?saved.draft.reviewed:f.scope||f.internal_estimate.scope;
 const before=JSON.stringify(scope);
 // Earlier render fixtures omitted the planning catalog; all five scopes are
 // evaluated against the same immutable, approved .12 configuration.
 const out=await priceCompleteScope(scope,configuration,failedProvider,now);
 const internal=out.internal as any;
 assert.equal(internal.scopePricing.version,'supported-service-bundle-v1');
 assert.equal(internal.directCost,285);assert.equal(internal.lines.length,2);
 assert.equal(internal.lines.filter((line:any)=>line.category==='field-labor').length,1);
 assert.equal(internal.lines.find((line:any)=>line.id==='bundle-labor').quantity,3);
 assert.equal(internal.lines.find((line:any)=>line.id==='minor-work-allowance').unitCost,75);
 assert.ok(out.customer.range);assert.equal(internal.contingency,28.5);assert.equal(internal.contingencyRate,.1);
 assert.ok(internal.targetOperatingProfit>=.12);assert.ok(internal.divisor>0);assert.ok(internal.contractPrice>internal.riskAdjustedDirectCost);
 assert.equal(JSON.stringify(scope),before);
 assert.doesNotMatch(JSON.stringify(out.customer),/PB-02-41-29|no supported price|research exhausted|Earlier scope and pricing assumptions/);
 const again=await priceCompleteScope(scope,configuration,failedProvider,now);
 assert.deepEqual(again.customer,out.customer,'retry returns the same result without buying another provider call');
});

function scopeFor(item:string,count=3){
 const scope=structuredClone(saved.draft.reviewed);
 scope.text=`Install ${count} owner-supplied compatible ${item} with existing predrilled holes. Contractor supplies normal installation consumables. Easy ground-floor access and standard scheduling.`;
 scope.answers={service:'handyman',location:'Boise, Idaho 83702',fixtureCount:String(count),ownerSupplied:`${count} owner-supplied compatible ${item}`};
 scope.extraction={...scope.extraction,sourceText:scope.text,summary:scope.text,facts:[],reviewNotes:[],instructions:{...scope.extraction.instructions,inclusions:[`Install ${count} owner-supplied compatible ${item}`,'Contractor supplies normal installation consumables'],exclusions:[],responsibilities:[`Owner supplies ${item}`]}};
 return scope;
}
for(const [item,count,cost] of [['passage door levers',1,145],['passage door knobs',6,495],['cabinet pulls',10,155],['cabinet knobs',12,171],['towel bars',2,165],['towel rings',3,210],['toilet paper holders',2,165],['robe hooks',4,255]] as const)test('supported bundle: '+count+' '+item,async()=>{
 const out=await priceCompleteScope(scopeFor(item,count),configuration,failedProvider,now);
 assert.ok(out.customer.range);assert.equal((out.internal as any).directCost,cost);
 assert.equal((out.internal as any).lines.filter((line:any)=>line.id==='minor-work-allowance').length,1);
 assert.equal((out.internal as any).lines.some((line:any)=>line.category==='materials'),false,'owner products are not purchased again');
});

test('one explicit total across rooms stays one supported quantity',async()=>{
 const scope=scopeFor('passage door levers');
 scope.text+=' All three levers are in bedroom and hallway rooms.';
 scope.extraction.sourceText=scope.text;
 const out=await priceCompleteScope(scope,configuration,failedProvider,now);
 assert.equal((out.internal as any).directCost,285);
});

for(const [name,mutate] of [
 ['extra hinges',(s:any)=>{s.text+=' Also install three new hinges.';}],
 ['other primary material',(s:any)=>{s.text+=' Install a new door.';}],
 ['structural repair',(s:any)=>{s.text+=' Repair structural damage.';}],
 ['hazard',(s:any)=>{s.text+=' Remove hazardous lead paint.';}],
 ['inert-prefix injection',(s:any)=>{s.text+=' Easy ground-floor access and install a sink.';}],
 ['contractor primary products',(s:any)=>{s.text+=' Contractor supplies three passage door levers.';}],
 ['different source text',(s:any)=>{s.extraction.sourceText+=' Install additional hinges.';}],
 ['missing quantity',(s:any)=>{s.text=s.text.replace(/3/g,'');s.answers.fixtureCount='';s.answers.ownerSupplied='Owner-supplied compatible passage door levers';s.extraction.instructions.inclusions=['Install owner-supplied passage door levers'];}],
 ['zero quantity',(s:any)=>{s.answers.fixtureCount='0';}],
 ['conflicting quantity',(s:any)=>{s.answers.fixtureCount='4';}],
 ['different door count',(s:any)=>{s.text+=' Install on six doors.';}],
 ['independent room counts',(s:any)=>{s.text='Install two owner-supplied compatible passage door levers in bedroom and install two passage door levers in hallway. Contractor supplies normal installation consumables.';s.answers.fixtureCount='2';s.answers.ownerSupplied='Owner supplies two compatible passage door levers';}],
 ['independent sentences',(s:any)=>{s.text='Install two owner-supplied compatible passage door levers in bedroom. Install two passage door levers in hallway. Contractor supplies normal installation consumables.';}],
 ['large scope',(s:any)=>{s.answers.fixtureCount='100';}],
 ['unknown essential condition',(s:any)=>{s.extraction.missingInformation=['Door count'];}],
 ['conflicting extraction',(s:any)=>{s.extraction.conflicts=['Conflicting fixture counts'];}],
 ['uploads',(s:any)=>{s.uploads=[{id:'fixture-document',name:'extra-work.pdf'}];}],
 ['incomplete upload coverage',(s:any)=>{s.extraction.documentCoverage.complete=false;}],
 ['separate buildings',(s:any)=>{s.extraction.instructions.separateBuildings=true;}],
 ['materials-only',(s:any)=>{s.extraction.instructions.materialsOnly=true;}],
 ['labor-only restriction',(s:any)=>{s.extraction.instructions.laborOnly=true;}],
 ['excluded priced work',(s:any)=>{s.answers.exclusions='Door levers';}],
 ['excluded consumables',(s:any)=>{s.answers.exclusions='Installation consumables';}],
 ['new-build',(s:any)=>{s.answers.service='new-construction';}],
 ['remodel',(s:any)=>{s.answers.service='remodel';}],
 ['cabinet project',(s:any)=>{s.answers.service='cabinets';s.answers.fixtureCount='0';}],
 ['flooring',(s:any)=>{s.text='Install 400 SF of flooring';}],
] as const)test('bundle does not certify '+name,()=>{
 const scope=scopeFor('passage door levers');mutate(scope);
 if(name!=='different source text')scope.extraction.sourceText=scope.text;
 assert.equal(supportedServiceBundle(scope,configuration,now),null);
});

test('expired rates cannot become a new approved bundle',()=>{
 assert.equal(supportedServiceBundle(scopeFor('passage door levers'),configuration,new Date('2028-01-01')),null);
});

test('saved bundle result survives JSON storage and renders a real customer PDF',async()=>{
 const out=await priceCompleteScope(saved.draft.reviewed,configuration,failedProvider,now);
 const stored=JSON.parse(JSON.stringify(out.customer));
 const pdf=await customerPdf('synthetic-bundle-offline-only',stored,now.toISOString());
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);
 assert.deepEqual(stored.range,out.customer.range);
});
