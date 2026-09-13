import test from "node:test";
import assert from "node:assert/strict";
import {validateAnswer,validateExtraction,combineScopeExtractions,protectPricingFacts} from "../lib/p5/scope.ts";
import {reconcileScope} from "../lib/p5/adaptive.ts";
test("malformed numeric extraction cannot become a zero or a clarification option",()=>{
 for(const value of [",","1,,000","0x50","Infinity","80 feet"]){assert.ok(validateAnswer("sqft",value));}
 const fact=(value:string)=>({field:"sqft",value,confidence:.98,source:"scope.pdf",evidence:"Room area 80 square feet",basis:"stated"});
 const result=validateExtraction({summary:"Test scope",facts:[fact(","),fact("80.0")],conflicts:[],missingInformation:[],reviewNotes:[]});
 assert.equal(result.facts.length,1);assert.equal(result.facts[0].value,"80");
 assert.equal(result.conflicts.length,0);
 const other=validateExtraction({summary:"Same scope image",facts:[fact("80")],conflicts:[],missingInformation:[],reviewNotes:[]});
 assert.equal(combineScopeExtractions([result,other]).conflicts.length,0);
});

test("cabinet measurements keep assembly identity and do not turn undocumented tall length into zero",()=>{
 const result=validateExtraction({
  summary:"Cabinet scope",
  facts:[
   {field:"cabinetBaseLf",value:"13.3",confidence:.99,source:"scope.pdf",evidence:"13.3 LF bench top",basis:"stated"},
   {field:"cabinetTallLf",value:"0",confidence:.99,source:"scope.pdf",evidence:"Tall cabinet length not documented",basis:"stated"},
  ],
  conflicts:[],missingInformation:[],reviewNotes:[],
 });
 assert.equal(result.facts.some(f=>f.field==="cabinetBaseLf"),false);
 assert.equal(result.facts.some(f=>f.field==="cabinetTallLf"),false);
 assert.equal(result.missingInformation.length,2);
 const absent=validateExtraction({
  summary:"No tall units",
  facts:[{field:"cabinetTallLf",value:"0",confidence:.99,source:"scope.pdf",evidence:"No tall cabinets are shown",basis:"stated"}],
  conflicts:[],missingInformation:[],reviewNotes:[],
 });
 assert.equal(protectPricingFacts(absent).facts[0]?.value,"0");
});

test("retained clarification metadata survives extraction validation and page combination",()=>{
 const metadata={version:"p5-retained-clarification-v1",clarifications:[]} as any;
 const input={summary:"Selected cabinet finish",facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarificationProvenance:metadata,sourceHistory:metadata};
 const validated=validateExtraction(input);
 assert.deepEqual(validated.clarificationProvenance,metadata);
 assert.deepEqual(validated.sourceHistory,metadata);
 const combined=combineScopeExtractions([validated]);
 assert.deepEqual(combined.clarificationProvenance,metadata);
 assert.deepEqual(combined.sourceHistory,metadata);
});

const laborFact=(value:string,evidence:string,source='driveway.pdf')=>({
 field:'laborHours' as const,value,confidence:1,source,evidence,basis:'stated' as const,
});
const emptyExtraction=(facts:any[],summary='Driveway labor scope')=>({summary,facts,conflicts:[],missingInformation:[],reviewNotes:[]});

test("validated, combined and saved labor facts aggregate explicit additive components",()=>{
 const excavation=laborFact('16','Driveway excavation labor: 16 labor hours','driveway-p1');
 const concrete=laborFact('24','Driveway concrete labor: 24 labor hours','driveway-p2');
 const validated=validateExtraction(emptyExtraction([excavation,concrete]));
 assert.deepEqual(validated.facts.filter(f=>f.field==='laborHours').map(f=>f.value),['40']);
 assert.equal(validated.conflicts.some(conflict=>conflict.field==='laborHours'),false);
 assert.equal((validated.sourceHistory as any)?.laborFacts.length,2);
 assert.equal(reconcileScope({},validated).answers.laborHours,'40');

 const persisted=validateExtraction(JSON.parse(JSON.stringify(validated)));
 assert.deepEqual(persisted.facts.filter(f=>f.field==='laborHours').map(f=>f.value),['40']);
 assert.equal((persisted.sourceHistory as any)?.laborFacts.length,2);
 assert.equal(reconcileScope({},persisted).answers.laborHours,'40');

 const combined=combineScopeExtractions([
   validateExtraction(emptyExtraction([excavation])),
   validateExtraction(emptyExtraction([concrete])),
 ]);
 assert.deepEqual(combined.facts.filter(f=>f.field==='laborHours').map(f=>f.value),['40']);
 assert.equal(combined.conflicts.some(conflict=>conflict.field==='laborHours'),false);
 assert.equal(reconcileScope({},combined).answers.laborHours,'40');
});

test("labor aggregation checks same-work conflicts, deduplicates repeated summaries and uses cited takeoffs",()=>{
 const sameWork=validateExtraction(emptyExtraction([
   laborFact('16','Driveway labor: 16 labor hours'),
   laborFact('24','Driveway labor: 24 labor hours'),
 ]));
 assert.equal(sameWork.conflicts.filter(conflict=>conflict.field==='laborHours').length,1);
 assert.equal(reconcileScope({},sameWork).answers.laborHours,undefined);

 const repeatedSummary=validateExtraction(emptyExtraction([
   laborFact('40','Total labor hours: 40 hours','summary-page-1'),
   laborFact('40','Total labor hours: 40 hours','summary-page-2'),
 ],'Repeated summary'));
 assert.deepEqual(repeatedSummary.facts.filter(f=>f.field==='laborHours').map(f=>f.value),['40']);
 assert.equal(repeatedSummary.conflicts.some(conflict=>conflict.field==='laborHours'),false);
 assert.equal(reconcileScope({},repeatedSummary).answers.laborHours,'40');

 const source='supported-driveway.pdf';
 const withTakeoffs=validateExtraction({
   ...emptyExtraction([laborFact('16','16 labor hours',source),laborFact('24','24 labor hours',source)]),
   takeoffs:[
    {id:'excavation-labor',description:'Driveway excavation',building:'Main',floor:'1',component:'excavation',quantity:16,unit:'HR',basis:'stated',evidence:'16 labor hours',sources:[{source,page:1,sheet:'',revision:''}],supersedes:[],issues:[]},
    {id:'concrete-labor',description:'Driveway concrete',building:'Main',floor:'1',component:'concrete',quantity:24,unit:'HR',basis:'stated',evidence:'24 labor hours',sources:[{source,page:2,sheet:'',revision:''}],supersedes:[],issues:[]},
   ],
 });
 assert.deepEqual(withTakeoffs.facts.filter(f=>f.field==='laborHours').map(f=>f.value),['40']);
 assert.equal(withTakeoffs.conflicts.some(conflict=>conflict.field==='laborHours'),false);
});

test("partial or ambiguous labor never becomes a complete total",()=>{
 const partial=validateExtraction(emptyExtraction([
   laborFact('40','Total labor hours: 40 hours; concrete labor quantity remains unknown.'),
   laborFact('16','Driveway excavation labor: 16 labor hours'),
 ]));
 assert.ok(partial.missingInformation.some(note=>/component remains unknown|partial/i.test(note)));
 assert.equal(reconcileScope({},partial).answers.laborHours,undefined);

 const subtotal=validateExtraction(emptyExtraction([
   laborFact('40','Subtotal labor hours: 40 hours.'),
   laborFact('16','Driveway excavation labor: 16 labor hours'),
   laborFact('24','Driveway concrete labor: 24 labor hours'),
 ]));
 assert.ok(subtotal.missingInformation.some(note=>/component remains unknown|partial/i.test(note)));
 assert.equal(reconcileScope({},subtotal).answers.laborHours,undefined);

 const ambiguous=validateExtraction(emptyExtraction([
   laborFact('16','Driveway scope labor hours: 16 hours'),
   laborFact('24','Driveway scope labor hours: 24 hours'),
 ]));
 assert.equal(ambiguous.conflicts.some(conflict=>conflict.field==='laborHours'),true);
 assert.equal(reconcileScope({},ambiguous).answers.laborHours,undefined);
});

test('blank optional facts remain unknown while stated quantities survive',()=>{
 const result=validateExtraction({summary:'600 square foot addition',facts:[
  {field:'sqft',value:'600',confidence:1,source:'typed scope',evidence:'600 square foot addition',basis:'stated'},
  {field:'countertopSqft',value:'',confidence:1,source:'typed scope',evidence:'',basis:'inferred'},
  {field:'cabinetTallLf',value:null,confidence:1,source:'typed scope',evidence:'',basis:'inferred'},
 ],conflicts:[],missingInformation:[],reviewNotes:[]});
 assert.deepEqual(result.facts.map(f=>[f.field,f.value]),[['sqft','600']]);
 assert.equal(result.missingInformation.length,2);
});

test('numeric JSON transport preserves explicit values and evidence without inventing quantities',()=>{
 const result=validateExtraction({summary:'Eight hours of installation',facts:[
  {field:'laborHours',value:8,confidence:1,source:'typed scope',evidence:'Eight hours of installation',basis:'stated'},
 ],conflicts:[],missingInformation:[],reviewNotes:[]});
 assert.equal(result.facts[0].value,'8');assert.equal(result.facts[0].evidence,'Eight hours of installation');
});
