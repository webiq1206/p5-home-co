import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {resolveInstructionAnswer} from '../lib/p5/clarificationAnswer.ts';
import {reconcileScope} from '../lib/p5/adaptive.ts';
import {validateExtraction,type ReviewedScope,type ScopeExtraction} from '../lib/p5/scope.ts';
import {priceCompleteScope,type PricingRequest} from '../lib/p5/scopePricing.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {DEFAULT_FINANCE} from '../lib/p5/pricing.ts';

const date='2026-09-11T00:00:00.000Z';
const now=new Date(date);
const question='Which bench top option should be included in the estimate?';
const answer='Option 2: matching painted MDF/wood bench top only. Exclude butcher block, laminate and quartz alternatives. Include the two cabinet units and 9 knobs/pulls. Assembly 2 hours + cabinet installation 8 hours + selected top fabrication/install 4 hours = 14 labor hours.';
const source='Option 1: butcher block (+5h); Option 2: matching painted MDF/wood (+4h); Option 3: laminate (+2h); Option 4: quartz (+5h). Assembly 2 hours + cabinet installation 8 hours.';

const page=(sourceName:string,pageNumber:number)=>({source:sourceName,page:pageNumber,sheet:'A1',revision:'1',status:'read' as const,notes:[]});
const pageSource=(sourceName:string,pageNumber:number)=>({source:sourceName,page:pageNumber,sheet:'A1',revision:'1'});

function cabinetExtractionInput(){
  return {
    summary:'Cabinet package',
    facts:[
      {
        field:'service',
        value:'cabinet-product',
        confidence:1,
        source:'cabinet.pdf',
        evidence:'The requested scope is a cabinet product package.',
        basis:'stated',
      },
      {
        field:'location',
        value:'Boise',
        confidence:1,
        source:'cabinet.pdf',
        evidence:'Project location: Boise.',
        basis:'stated',
      },
      {
        field:'taskList',
        value:'Two cabinet units and 9 knobs/pulls.',
        confidence:1,
        source:'cabinet.pdf',
        evidence:`Two cabinet units and 9 knobs/pulls. ${source}`,
        basis:'stated',
      },
    ],
    conflicts:[],
    reviewNotes:[],
    missingInformation:[],
    instructions:{...emptyInstructions(),questions:[question]},
    pages:[page('cabinet.pdf',2)],
    takeoffs:[
      ...[
        ['butcher block',5],
        ['matching painted MDF/wood',4],
        ['laminate',2],
        ['quartz',5],
      ].map(([description,quantity],index)=>({
        id:`top-${index}`,
        description:`${description} bench top`,
        building:'Main',
        floor:'1',
        component:'bench top option',
        quantity,
        unit:'HR',
        basis:'stated' as const,
        evidence:source,
        sources:[pageSource('cabinet.pdf',2)],
        supersedes:[],
        issues:[],
      })),
      {
        id:'cabinet-units',
        description:'Cabinet units',
        building:'Main',
        floor:'1',
        component:'cabinet',
        quantity:1,
        unit:'EA',
        basis:'stated' as const,
        evidence:'One cabinet unit on the schedule.',
        sources:[pageSource('cabinet.pdf',2)],
        supersedes:[],
        issues:[],
      },
      {
        id:'hardware',
        description:'Knobs/pulls',
        building:'Main',
        floor:'1',
        component:'hardware',
        quantity:5,
        unit:'EA',
        basis:'stated' as const,
        evidence:'Five knobs/pulls on the hardware schedule.',
        sources:[pageSource('cabinet.pdf',2)],
        supersedes:[],
        issues:[],
      },
    ],
  };
}

function cabinetExtraction():ScopeExtraction{
  return validateExtraction(cabinetExtractionInput());
}

function catalog():PlanningCatalog{
  const requiredCodes=[
    '03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L',
    '03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01',
    '03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR',
    'REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR',
  ];
  return {
    version:PLANNING_MODEL_VERSION,
    source:'Synthetic approved in-memory owner schedule; integration fixture only',
    authorizedBy:'Synthetic test owner',
    importedAt:date,
    rates:requiredCodes.map(code=>({
      code,
      description:code==='03-17-01-M'?'Cabinet units':code==='03-19-02-M'?'Knobs and pulls':code==='REF-GENERAL-HOUR'?'General labor hours':'Synthetic approved work',
      type:code.endsWith('-M')?'Material':'Labor' as 'Material'|'Labor',
      unit:code==='03-17-01-M'||code==='03-19-02-M'?'EA':code.includes('HOUR')?'HR':'LF',
      amount:100,
      source:'Synthetic approved in-memory owner schedule',
      basis:'owner-average-cost' as const,
    })),
  };
}

function providerReply(input:unknown){
  return {value:input,sourceUrls:[]};
}

test('retained four-option cabinet scope persists canonically through pricing',async()=>{
  const extraction=cabinetExtraction();
  const prompts=instructionPrompts(extraction,{});
  assert.equal(prompts.length,1);
  assert.equal(prompts[0].question,question);
  assert.deepEqual(prompts[0].values,[
    'Option 1: butcher block (+5h)',
    'Option 2: matching painted MDF/wood (+4h)',
    'Option 3: laminate (+2h)',
    'Option 4: quartz (+5h)',
  ]);

  let clarificationProviderCalls=0;
  const resolved=await resolveInstructionAnswer(
    extraction,
    {service:'cabinet-product',location:'Boise'},
    {id:prompts[0].id,answer},
    [],
    async()=>{clarificationProviderCalls++;throw new Error('retained choice must not call a provider');},
  );
  assert.equal(clarificationProviderCalls,0);
  assert.equal(resolved.answers.laborHours,'14');
  assert.match(resolved.answers.taskList||'',/2 cabinet units/);
  assert.match(resolved.answers.taskList||'',/9 knobs\/pulls/);
  assert.match(resolved.answers.materials||'',/matching painted MDF\/wood bench top/);
  assert.match(resolved.answers.exclusions||'',/butcher block/);
  assert.match(resolved.answers.exclusions||'',/laminate/);
  assert.match(resolved.answers.exclusions||'',/quartz/);
  assert.equal(resolved.extraction?.instructions?.questions.length,0);

  const resolvedFacts=Object.fromEntries((resolved.extraction?.facts||[]).map(fact=>[fact.field,fact.value]));
  assert.equal(resolvedFacts.laborHours,'14');
  assert.equal(resolvedFacts.materials,'matching painted MDF/wood bench top');
  assert.equal(resolvedFacts.cabinetConstruction,'2 cabinet units; 9 knobs/pulls; matching painted MDF/wood bench top');
  assert.match(resolvedFacts.taskList||'',/2 cabinet units/);
  assert.match(resolvedFacts.taskList||'',/9 knobs\/pulls/);
  assert.match(resolvedFacts.taskList||'',/14 labor hours/);
  assert.doesNotMatch(resolvedFacts.materials||'',/butcher|laminate|quartz/i);
  assert.deepEqual(resolved.extraction?.takeoffs?.map(item=>[item.id,item.quantity]),[
    ['top-1',4],['cabinet-units',2],['hardware',9],
    ['assembly-labor',2],['cabinet-installation-labor',8],
  ]);
  const resolvedHourLedger=(resolved.extraction?.takeoffs||[])
    .filter(item=>item.unit==='HR'&&item.quantity!==null)
    .reduce((total,item)=>total+(item.quantity||0),0);
  assert.equal(resolvedHourLedger,14);

  const sourceHistory=resolved.extraction?.sourceHistory;
  const provenance=resolved.extraction?.clarificationProvenance;
  assert.ok(sourceHistory);
  assert.deepEqual(sourceHistory,provenance);
  assert.equal(sourceHistory?.clarifications[0].question,question);
  assert.equal(sourceHistory?.clarifications[0].selected.option,2);
  assert.equal(sourceHistory?.clarifications[0].excluded.length,3);
  assert.equal(sourceHistory?.clarifications[0].source.takeoffs.length,6);

  // Persisted extraction records use the provider-compatible pages ledger when
  // revalidated; the saved documentCoverage is restored from those pages.
  const persisted=JSON.parse(JSON.stringify(resolved.extraction));
  const restored=validateExtraction({...persisted,pages:persisted.documentCoverage?.pages});
  assert.equal(Object.fromEntries(restored.facts.map(fact=>[fact.field,fact.value])).laborHours,'14');
  assert.equal(Object.fromEntries(restored.facts.map(fact=>[fact.field,fact.value])).materials,'matching painted MDF/wood bench top');
  assert.deepEqual(restored.takeoffs?.map(item=>[item.id,item.quantity]),[
    ['top-1',4],['cabinet-units',2],['hardware',9],
    ['assembly-labor',2],['cabinet-installation-labor',8],
  ]);
  const restoredHourLedger=(restored.takeoffs||[])
    .filter(item=>item.unit==='HR'&&item.quantity!==null)
    .reduce((total,item)=>total+(item.quantity||0),0);
  assert.equal(restoredHourLedger,14);
  assert.deepEqual(restored.sourceHistory,sourceHistory);
  assert.deepEqual(restored.clarificationProvenance,provenance);
  assert.equal(restored.documentCoverage?.expectedPages,1);
  assert.equal(restored.documentCoverage?.complete,true);

  const reconciliation=reconcileScope(resolved.answers,restored,{});
  assert.deepEqual(reconciliation.conflicts,[]);
  assert.equal(reconciliation.answers.laborHours,'14');
  assert.match(reconciliation.answers.materials||'',/matching painted MDF\/wood bench top/);

  const configuration=createPlanningConfiguration(catalog(),['cabinet-product']);
  const policyBefore=JSON.parse(JSON.stringify(configuration));
  const pricingPayloads:unknown[]=[];
  const stages:string[]=[];
  const request:PricingRequest=async(instructions,input,search)=>{
    assert.equal(search,false);
    const serialized=JSON.stringify(input);
    pricingPayloads.push(input);
    assert.doesNotMatch(serialized,/clarificationProvenance|sourceHistory/);
    const data=input as Record<string,any>;
    if(instructions.startsWith('Inventory ')){
      stages.push('inventory');
      return providerReply({
        tasks:[
          {
            id:'cabinet-units',
            description:'Selected matching painted MDF/wood bench top cabinet units',
            evidence:'Selected scope includes 2 cabinet units.',
          },
          {
            id:'cabinet-hardware',
            description:'Selected matching painted MDF/wood bench top knobs/pulls',
            evidence:'Selected scope includes 9 knobs/pulls (9 each).',
          },
          {
            id:'cabinet-labor',
            description:'Selected matching painted MDF/wood bench top fabrication and installation',
            evidence:'Selected scope total is 14 labor hours.',
          },
        ],
        issues:[],
        notes:[],
      });
    }
    if(instructions.startsWith('You are a construction estimator')){
      stages.push('mapping');
      assert.equal(data.taskBatch.length,3);
      return providerReply({
        tasks:data.taskBatch.map((task:any)=>({
          id:task.id,
          description:task.description,
          evidence:task.evidence,
          existingLineIds:[],
          additions:task.id.split(':').at(-1)==='cabinet-labor'
            ?[{code:'REF-GENERAL-HOUR',quantity:14,quantityEvidence:'14 labor hours total: assembly, cabinet installation and selected top fabrication/install.'}]
            :task.id.split(':').at(-1)==='cabinet-units'
              ?[{code:'03-17-01-M',quantity:2,quantityEvidence:'2 cabinet units included in the selected package.'}]
              :[{code:'03-19-02-M',quantity:9,quantityEvidence:'9 knobs/pulls included in the selected package.'}],
          researchDescription:'',
          issues:[],
        })),
        issues:[],
        notes:[],
        replacements:[],
        removeExclusions:[],
      });
    }
    assert.ok(instructions.startsWith('Independently audit'));
    stages.push('audit');
    if(data.tasks.length===0){
      assert.ok(data.original.section>1,'only a repeated-context section has no new tasks');
      return providerReply({coveredTaskIds:[],issues:[],notes:[],resolvedIssues:[]});
    }
    assert.deepEqual(data.tasks.map((task:any)=>task.id.split(':').at(-1)),['cabinet-units','cabinet-hardware','cabinet-labor']);
    return providerReply({coveredTaskIds:data.tasks.map((task:any)=>task.id),issues:[],notes:[],resolvedIssues:[]});
  };
  const scope:ReviewedScope={
    text:'Reviewed cabinet package',
    answers:resolved.answers,
    extraction:restored,
    uploads:[],
    reviewedAt:date,
    corrections:[],
  };
  const priced=await priceCompleteScope(scope,configuration,request,now);
  assert.deepEqual(stages,['inventory','mapping','audit']);
  assert.ok(priced.customer.range);
  assert.deepEqual(configuration,policyBefore,'pricing cannot mutate the approved in-memory policy');
  const internal=priced.internal as any;
  const lines=internal.lines as Array<{description:string;quantity:number;unit:string}>;
  const laborLines=lines.filter(line=>line.unit==='hour'&&/labor/i.test(line.description));
  assert.equal(laborLines.length,1);
  assert.equal(laborLines[0].quantity,14);
  assert.notEqual(laborLines[0].quantity,10);
  assert.ok(!lines.some(line=>/butcher|laminate|quartz/i.test(line.description)));
  assert.ok(!priced.customer.lineItems.some(line=>/butcher|laminate|quartz/i.test(line.description)));
  assert.equal(pricingPayloads.length,3);
  assert.ok(pricingPayloads.every(payload=>!JSON.stringify(payload).includes('p5-retained-clarification-v1')));
  assert.ok(pricingPayloads.every(payload=>!JSON.stringify(payload).includes(answer)),
    'inventory, mapping and audit must receive the canonical clarification, not the raw arithmetic reply');
  const chunked=await priceCompleteScope({...scope,text:scope.text+'\n'+'Context only; no added work.\n'.repeat(1700)},configuration,request,now);
  assert.ok(chunked.customer.range,`multi-part pricing must preserve the same selected scope: ${JSON.stringify(chunked.customer.verificationItems)}`);
  assert.equal((chunked.internal as any).lines.find((line:any)=>line.unit==='hour'&&/labor/i.test(line.description))?.quantity,14);
  assert.ok(pricingPayloads.length>6,'exercise multi-part inventory and mapping');
  assert.ok(pricingPayloads.every(payload=>!JSON.stringify(payload).includes(answer)),
    'chunk boundaries must not reintroduce the raw arithmetic reply');
  assert.deepEqual(configuration,policyBefore);
  const duplicateSummaryRequest:PricingRequest=async(...args)=>{
    const response=await request(...args);
    if(!args[0].startsWith('You are a construction estimator'))return response;
    const value=response.value as {tasks:any[]};
    return {...response,value:{...value,tasks:value.tasks.map(task=>task.id.split(':').at(-1)==='cabinet-labor'
      ?{...task,additions:[...task.additions,...task.additions]}:task)}};
  };
  const duplicateSummary=await priceCompleteScope(scope,configuration,duplicateSummaryRequest,now);
  assert.equal(duplicateSummary.customer.range,null,'a repeated labor summary must never be billed twice');
  assert.ok(duplicateSummary.customer.verificationItems.some(item=>/hourly labor.*reconcile/.test(item)));
});

function handymanExtraction():ScopeExtraction{
  return validateExtraction({
    summary:'Two-page handyman drywall and paint scope',
    facts:[
      {
        field:'service',
        value:'handyman',
        confidence:1,
        source:'handyman-pages.pdf',
        evidence:'Requested service is Handyman.',
        basis:'stated',
      },
      {
        field:'taskList',
        value:'Repair drywall and paint the affected areas. Appliances are excluded.',
        confidence:1,
        source:'handyman-pages.pdf',
        evidence:'Page 1 requests drywall repair; page 2 requests painting. No measured quantity is supplied.',
        basis:'stated',
      },
      {
        field:'exclusions',
        value:'Appliance purchases and installation are excluded.',
        confidence:1,
        source:'typed scope',
        evidence:'Only appliance purchases and installation are excluded from this request.',
        basis:'stated',
      },
    ],
    conflicts:[],
    missingInformation:[],
    reviewNotes:[],
    instructions:{
      ...emptyInstructions(),
      inclusions:['Drywall repair and paint the affected areas'],
      exclusions:['Appliance purchases and installation are excluded.'],
      questions:[],
    },
    pages:[page('handyman-pages.pdf',1),page('handyman-pages.pdf',2)],
    takeoffs:[
      {
        id:'drywall-repair',
        description:'Drywall repair',
        building:'Main',
        floor:'1',
        component:'drywall',
        quantity:null,
        unit:'SF',
        basis:'uncertain',
        evidence:'Drywall repair is requested, but no measured area is supplied.',
        sources:[pageSource('handyman-pages.pdf',1)],
        supersedes:[],
        issues:[],
      },
      {
        id:'interior-paint',
        description:'Interior paint',
        building:'Main',
        floor:'1',
        component:'paint',
        quantity:null,
        unit:'SF',
        basis:'uncertain',
        evidence:'Interior painting is requested, but no measured area is supplied.',
        sources:[pageSource('handyman-pages.pdf',2)],
        supersedes:[],
        issues:[],
      },
    ],
  });
}

test('two-page handyman drywall and paint scope keeps only the appliance exclusion and refuses invented areas',async()=>{
  const extraction=handymanExtraction();
  assert.equal(extraction.documentCoverage?.expectedPages,2);
  assert.equal(extraction.documentCoverage?.complete,true);
  assert.deepEqual(extraction.instructions?.exclusions,['Appliance purchases and installation are excluded.']);
  assert.equal(extraction.facts.some(fact=>fact.field==='sqft'),false);
  assert.equal(extraction.facts.some(fact=>/80\s*(?:sf|square feet)/i.test(`${fact.value} ${fact.evidence}`)),false);

  const configuration=createPlanningConfiguration(catalog(),['handyman']);
  const payloads:string[]=[];
  const stages:string[]=[];
  const request:PricingRequest=async(instructions,input,search)=>{
    assert.equal(search,false);
    const serialized=JSON.stringify(input);
    payloads.push(serialized);
    assert.doesNotMatch(serialized,/bathroom|80\s*(?:sf|square feet)|painting\s+exclusions/i);
    if(instructions.startsWith('Inventory ')){
      stages.push('inventory');
      return providerReply({
        tasks:[
          {id:'drywall-repair',description:'Drywall repair; measured area unknown',evidence:'Page 1 requests drywall repair; no measured area or quantity is supplied.'},
          {id:'interior-paint',description:'Interior paint; measured area unknown',evidence:'Page 2 requests painting; no measured area or quantity is supplied.'},
        ],
        issues:[],
        notes:[],
      });
    }
    if(instructions.startsWith('You are a construction estimator')){
      stages.push('mapping');
      const data=input as Record<string,any>;
      return providerReply({
        tasks:data.taskBatch.map((task:any)=>({
          id:task.id,
          description:task.description,
          evidence:task.evidence,
          existingLineIds:[],
          additions:[],
          researchDescription:'',
          issues:['Quantity remains unknown; measured area is required before pricing.'],
        })),
        issues:[],
        notes:[],
        replacements:[],
        removeExclusions:[],
      });
    }
    assert.ok(instructions.startsWith('Independently audit'));
    stages.push('audit');
    return providerReply({
      coveredTaskIds:[],
      issues:['Drywall and painting quantities remain unmeasured; no measured area was fabricated.'],
      notes:[],
      resolvedIssues:[],
    });
  };
  const scope:ReviewedScope={
    text:'Repair drywall and paint. Exclude appliance purchases and installation.',
    answers:{
      service:'handyman',
      location:'Boise',
      taskList:'Repair drywall and paint the affected areas.',
      exclusions:'Appliance purchases and installation are excluded.',
    },
    extraction,
    uploads:[],
    reviewedAt:date,
    corrections:[],
  };
  const priced=await priceCompleteScope(scope,configuration,request,now);
  assert.equal(priced.customer.range,null);
  assert.deepEqual(priced.customer.exclusions,['Appliance purchases and installation are excluded.']);
  assert.equal(priced.customer.lineItems.length,0);
  assert.ok(priced.customer.verificationItems.some(item=>/unmeasured|unknown|measured area/i.test(item)));
  assert.ok(stages.includes('inventory'));
  assert.ok(stages.includes('mapping'));
  assert.ok(stages.includes('audit'));
  assert.doesNotMatch(JSON.stringify(priced.customer),/bathroom|80\s*(?:sf|square feet)|painting\s+exclusions/i);
  assert.doesNotMatch(JSON.stringify(priced.internal),/bathroom|80\s*(?:sf|square feet)|painting\s+exclusions/i);
  assert.ok(payloads.every(payload=>!/"(?:quantity|area)"\s*:\s*80\b/i.test(payload)));
});