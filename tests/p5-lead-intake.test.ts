/**
 * The document estimator's leads on their way to P5 Home Co's lead system (lib/p5/p5LeadIntake.ts,
 * lib/p5/documentEstimateFigures.ts). FAKE FETCH ONLY: nothing here reaches a real site.
 *
 * Held here: the estimate's figures are customer prices only and add up to the contract price; the
 * post carries what the intake contract names; a project request and the estimate published for it
 * carry the same project key; failures throw short errors; a synthetic QA record is never posted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedDatabase} from './fixtures/p5-pglite.ts';
import {COST_CATEGORIES,calculateP5Estimate,customerEstimate,type FinancePolicy,type PricingInput,type Service} from '../lib/p5/pricing.ts';
import {documentEstimate,documentEstimateBody,linesByTrade,DOCUMENT_ESTIMATE_MAX_LINES} from '../lib/p5/documentEstimateFigures.ts';
import {
  P5_INTAKE_URL,P5_INTAKE_BODY_LIMIT_BYTES,P5_LEAD_RETRY_WINDOW_MS,PROJECT_REQUEST_LEADS_SINCE,
  estimateExternalId,estimateIntakeBody,forwardEstimateToP5,projectLeadKey,projectRequestKey,
  p5LeadIntakeTransport,projectRequestHold,projectRequestIntakeBody,projectRequestLead,projectRequestTooOld,
} from '../lib/p5/p5LeadIntake.ts';
import {intakeDeliveryEnvelope,intakeLeadKey} from '../lib/p5/intakeDeliveryPayload.ts';
import {intakeDeliveryWorker,type IntakeTransport,type IntakeChannelState} from '../lib/p5/intakeDelivery.ts';
import {INTAKE_CHANNELS,type IntakeChannel} from '../lib/p5/intakeDeliveryPolicy.ts';
import {intakeStore,deliveryKey,type IntakeRow} from '../lib/p5/intakeStore.ts';
import {routeIntake,INTAKE_SITES,type IntakeSite} from '../lib/p5/intakePolicy.ts';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const round2=(value:number)=>Math.round(value*100)/100;
const sum=(values:number[])=>round2(values.reduce((a,b)=>a+b,0));
const INTERNAL_WORD=/cost|margin|mark-?up|profit|overhead|contingenc/i;
const DRAFT='12345678-1234-4234-8234-123456789abc';
const now=new Date('2026-09-10T12:00:00Z');
const finance:FinancePolicy={annualOverhead:420000,annualRevenue:6000000,forecastSource:'TEST FIXTURE ONLY: conservative forecast',reviewedAt:'2026-09-10',approvedBy:['Nick']};

/** A priced record exactly as the estimator builds one: the real pricing engine, then the real customer view. */
function pricedRecord(service:Service,lines:{description:string;quantity:number;unit:string;unitCost:number;trade?:string}[],extra:Record<string,unknown>={}){
  const input:PricingInput={service,revision:'fixture-revision-1',scopeSummary:'Fixture project scope',uncertainty:'low',locationProvided:true,
    lines:lines.map((line,index)=>({id:`line-${index+1}`,category:'subcontractors',description:line.description,unit:line.unit,quantity:line.quantity,unitCost:line.unitCost,
      ...(line.trade?{trade:line.trade as never}:{}),quantitySource:'TEST signed scope',evidence:{basis:'written-quote',reference:'TEST quote',verifiedAt:'2026-09-01',validUntil:'2026-10-01'}})),
    coverage:COST_CATEGORIES.map(category=>({category,status:category==='subcontractors'?'included':'not-applicable',reason:'TEST ONLY: reviewed fixture coverage'})),
    risks:[],assumptions:[],exclusions:[],missingInformation:[],allowances:[]};
  const internal=calculateP5Estimate(input,finance,[],now);
  const customer=customerEstimate(internal,'Fixture scope summary for the customer');
  return {draftId:DRAFT,revision:2,brand:'Boise Remodeling Co',estimator:'p5-policy',
    contact:{name:'Pat Example',email:'pat@example.invalid',phone:'(208) 555-0142'},
    scope:{text:'Fixture scope',answers:{service,address:'123 N Main St',location:'Boise'}},internal,customer,...extra};
}
const KITCHEN=[
  {description:'Demolish existing kitchen and haul away',quantity:1,unit:'LS',unitCost:1873.37,trade:'Demolition'},
  {description:'Install shaker cabinets, painted',quantity:24,unit:'LF',unitCost:412.19,trade:'Cabinets'},
  {description:'Quartz countertops, eased edge',quantity:52.5,unit:'SF',unitCost:88.83,trade:'Countertops'},
  {description:'Rough and finish plumbing for sink and dishwasher',quantity:1,unit:'LS',unitCost:2944.61,trade:'Plumbing'},
  {description:'Luxury vinyl plank flooring',quantity:187,unit:'SF',unitCost:7.13},
];
/** Every number an internal estimate holds that the customer must never be sent. */
function internalFigures(internal:Record<string,unknown>):number[]{
  const values:number[]=[];
  const walk=(value:unknown,key:string)=>{
    if(typeof value==='number'){if(INTERNAL_WORD.test(key)||/riskAdjusted|divisor|allocation/i.test(key))values.push(round2(value));return;}
    if(Array.isArray(value)){for(const item of value)walk(item,key);return;}
    if(value&&typeof value==='object')for(const [name,item] of Object.entries(value))walk(item,INTERNAL_WORD.test(key)||/allocation/i.test(key)?key:name);
  };
  walk(internal,'');
  return values.filter(value=>value>1);
}
const numbersIn=(value:unknown):number[]=>typeof value==='number'?[round2(value)]:Array.isArray(value)?value.flatMap(numbersIn):value&&typeof value==='object'?Object.values(value).flatMap(numbersIn):[];

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

test('the estimate is customer prices only: by word, by value, and it adds up to the contract price',()=>{
  for(const service of ['kitchen','bathroom','handyman','addition','cabinet-install','new-construction'] as Service[]){
    const record=pricedRecord(service,KITCHEN);
    const estimate=documentEstimateBody(record)!;
    assert.ok(estimate,service);
    assert.deepEqual(Object.keys(estimate).sort(),['base','high','kind','label','lines','low','verified']);
    assert.equal(estimate.kind,'document');
    assert.equal(estimate.verified,true,'the server priced it');
    assert.deepEqual([estimate.low,estimate.high],[record.customer.range!.low,record.customer.range!.high],'the range the customer was shown');
    assert.equal(estimate.base,round2(record.internal.contractPrice),'the contract price');
    assert.equal(estimate.label,`Document estimate, ${service}`);
    assert.equal(estimate.lines.length,KITCHEN.length);
    // To the cent, whatever rounding each line needed.
    assert.equal(sum(estimate.lines.map(line=>line.amount)),estimate.base,service);
    for(const line of estimate.lines)for(const key of Object.keys(line))assert.ok(['title','description','quantity','unit','amount','division'].includes(key),key);
    // By word: no field and no text names an internal figure.
    assert.doesNotMatch(JSON.stringify(estimate),INTERNAL_WORD);
    // By value: no cost, contingency, overhead or profit figure of the internal estimate is among the numbers sent.
    const secret=new Set(internalFigures(record.internal as unknown as Record<string,unknown>));
    assert.ok(secret.size>10,'the fixture really holds internal figures');
    const sent=numbersIn(estimate).filter(value=>value>1&&!KITCHEN.some(line=>line.quantity===value));
    for(const value of sent)assert.ok(!secret.has(value),`${service}: ${value} is an internal figure`);
    // Each line is that line's customer selling amount.
    record.internal.lines.forEach((line,index)=>assert.ok(Math.abs(estimate.lines[index].amount-line.sellingAmount)<=0.01*KITCHEN.length));
    assert.deepEqual(estimate.lines.map(line=>line.division),['Demolition','Cabinets','Countertops','Plumbing','Flooring'],'the engine names a trade for a line that came without one');
    assert.deepEqual(estimate.lines.map(line=>[line.quantity,line.unit]),KITCHEN.map(line=>[line.quantity,line.unit]));
  }
});

test('the cents rounding moves go on the largest line, long text is capped, and nothing priced at nothing is sent',()=>{
  const record={scope:{answers:{service:'installation'}},customer:{range:{low:3000,high:3600}},internal:{contractPrice:3333.335,lines:[
    {description:'Install owner-supplied trim',quantity:120,unit:'LF',trade:'Trim & Finish Carpentry',sellingAmount:1111.1117,cost:700,operatingProfit:120,overheadRecovery:200,contingency:70},
    {description:`Paint new trim ${'and touch up '.repeat(40)}`,quantity:1,unit:'LS',trade:'Painting',sellingAmount:2222.2233,cost:1400},
    {description:'No charge item',quantity:1,unit:'EA',trade:'Painting',sellingAmount:0},
    {description:'',quantity:1,unit:'EA',sellingAmount:50},
    null,
  ]}};
  const {estimate,notes}=documentEstimate(record)!;
  assert.deepEqual(notes,[]);
  assert.deepEqual([estimate.low,estimate.high,estimate.base],[3000,3600,3333.34]);
  assert.deepEqual(estimate.lines.map(line=>line.amount),[1111.11,2222.23]);
  assert.equal(estimate.lines[1].title.length,200);
  assert.ok(estimate.lines[1].description!.length>200&&estimate.lines[1].description!.length<=1000);
  assert.equal(estimate.lines[0].description,undefined,'a short description is the title, said once');
  assert.doesNotMatch(JSON.stringify(estimate),INTERNAL_WORD);
});

test('no price shown to the customer means no estimate, and more lines than one estimate carries become one per trade',()=>{
  const record=pricedRecord('kitchen',KITCHEN);
  for(const broken of [null,undefined,'text',{},{...record,customer:{}},{...record,customer:{range:null}},{...record,internal:{lines:[]}},{...record,internal:{...record.internal,contractPrice:Number.NaN}},{...record,customer:{range:{low:0,high:10}}}])
    assert.equal(documentEstimateBody(broken),null);
  const many={customer:{range:{low:7000,high:9000}},internal:{contractPrice:8000,lines:Array.from({length:80},(_,i)=>({description:`Item ${i}`,quantity:1,unit:'EA',trade:i%2?'Plumbing':'Electrical',sellingAmount:100}))}};
  const combined=documentEstimate(many)!;
  assert.deepEqual(combined.estimate.lines,[{title:'Electrical',amount:4000,division:'Electrical'},{title:'Plumbing',amount:4000,division:'Plumbing'}]);
  assert.match(combined.notes.join(' '),/80 lines were combined into one line per trade/);
  assert.equal(combined.estimate.label,'Document estimate');
  assert.equal(DOCUMENT_ESTIMATE_MAX_LINES,60);
  assert.deepEqual(linesByTrade([{title:'a',amount:1.25},{title:'b',amount:2,division:'Tile'},{title:'c',amount:3}]),[{title:'Other Project Work',amount:4.25,division:'Other Project Work'},{title:'Tile',amount:2,division:'Tile'}]);
});

// ---------------------------------------------------------------------------
// The published estimate's post
// ---------------------------------------------------------------------------

test('the estimate post: the lead, a stable id per draft, the project key, the figures and team_alert site',()=>{
  const record=pricedRecord('kitchen',KITCHEN,{projectId:`construction:${DRAFT}`,attribution:{utm_source:'google',utm_medium:'cpc',utm_campaign:'kitchens',gclid:'abc123',first_gclid:'first456',landing_page:'/kitchen-remodel?gclid=abc123',referrer:'https://www.google.com',unknown:'dropped'}});
  const body=estimateIntakeBody(record,'p5-outbox-key',{brand:'Boise Remodeling Co'});
  const {estimate,...lead}=body;
  assert.deepEqual(lead,{
    brand:'Boise Remodeling Co',name:'Pat Example',email:'pat@example.invalid',phone:'(208) 555-0142',
    projectType:'kitchen',address:'123 N Main St',city:'Boise',message:'Fixture scope summary for the customer',
    form:'p5-estimator',sourceDetail:`p5-estimator:${DRAFT}`,external_id:`p5-estimator:${DRAFT}`,
    request_external_id:intakeLeadKey(`construction:${DRAFT}`),
    first_gclid:'first456',utm_source:'google',utm_medium:'cpc',utm_campaign:'kitchens',gclid:'abc123',landing_page:'/kitchen-remodel?gclid=abc123',referrer:'https://www.google.com',
    team_alert:'site',
  });
  assert.deepEqual(estimate,documentEstimateBody(record));
  // The id belongs to the draft, not the revision: a revised estimate is the same lead and the same QuickBooks estimate.
  assert.equal(estimateIntakeBody({...record,revision:9},'another-key',{brand:'Boise Remodeling Co'}).external_id,body.external_id);
  assert.equal(estimateExternalId({},'p5-outbox-key'),'p5-estimator:p5-outbox-key','a record with no draft id still has a stable id');
  // Never an internal figure, in any field.
  assert.doesNotMatch(JSON.stringify(body),INTERNAL_WORD);
  for(const forbidden of ['team_notes','team_internal_notes','internal','verified_by'])assert.equal(forbidden in body,false);
});

test('the project key: the one stamped at publication, else the project that began on this site',()=>{
  assert.equal(projectLeadKey(`p5:${DRAFT}`),intakeLeadKey(`p5:${DRAFT}`),'the same formula as the request delivery');
  assert.match(projectLeadKey(`p5:${DRAFT}`),/^p5-intake-[0-9a-f]{64}$/);
  assert.equal(projectRequestKey({draftId:DRAFT,projectId:`cabinet:${DRAFT}`},'Boise Remodeling Co'),intakeLeadKey(`cabinet:${DRAFT}`),'a project handed over from another site keeps its id');
  for(const [site,value] of Object.entries(INTAKE_SITES))assert.equal(projectRequestKey({draftId:DRAFT},value.name),intakeLeadKey(`${site}:${DRAFT}`),site);
  assert.equal(projectRequestKey({draftId:DRAFT,projectId:'not a project id'},'Boise Handyman Co'),intakeLeadKey(`handyman:${DRAFT}`));
  assert.equal(projectRequestKey({draftId:DRAFT},'Some Other Co'),'');
  assert.equal(projectRequestKey({draftId:'not-a-draft'},'P5 Home Co'),'');
  assert.equal('request_external_id' in estimateIntakeBody({draftId:'x',contact:{email:'a@example.invalid'}},'k',{brand:'Nobody'}),false);
});

test('figures that cannot be used: the lead still goes, without estimate and without team_alert, so P5 sends its usual email',()=>{
  const record=pricedRecord('kitchen',KITCHEN);
  const body=estimateIntakeBody({...record,customer:{summary:'Held for review',range:null}},'k',{brand:'Boise Remodeling Co'});
  assert.equal('estimate' in body,false);
  assert.equal('team_alert' in body,false);
  assert.equal(body.form,'p5-estimator');
  assert.equal(body.external_id,`p5-estimator:${DRAFT}`);
  assert.equal(body.message,'Held for review');
});

test('a body too large for the intake keeps its total and gives up detail',()=>{
  const size=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const big=(count:number,words:number,trades:number)=>({draftId:DRAFT,contact:{name:'Pat Example',email:'pat@example.invalid'},customer:{summary:'s',range:{low:50000,high:70000}},
    internal:{contractPrice:count*1000,lines:Array.from({length:count},(_,i)=>({description:`Line ${i} ${'detail '.repeat(words)}`,quantity:1,unit:'EA',trade:`Trade ${i%trades}`,sellingAmount:1000}))}});
  const total=(body:Record<string,unknown>)=>{const e=body.estimate as {base:number;lines:{amount:number;description?:string}[]};return {base:e.base,lines:e.lines,sum:e.lines.length?sum(e.lines.map(l=>l.amount)):e.base};};
  // Sixty long lines: the descriptions go, the titles and every amount stay.
  const long=estimateIntakeBody(big(60,120,7),'k',{brand:'Boise Remodeling Co'});
  assert.ok(size(long)<=P5_INTAKE_BODY_LIMIT_BYTES);
  assert.deepEqual([total(long).lines.length,total(long).sum,total(long).base],[60,60000,60000]);
  assert.ok(total(long).lines.every(line=>line.description===undefined));
  // A small estimate is sent whole.
  const small=estimateIntakeBody(big(3,60,3),'k',{brand:'Boise Remodeling Co'});
  assert.ok(total(small).lines.every(line=>typeof line.description==='string'));
  // Titles alone too large (multi-byte text): one line per trade, the same total.
  const wide=big(60,0,4);
  wide.internal.lines.forEach((line,i)=>{line.description=`${'€'.repeat(199)}${i%10}`;});
  const perTrade=estimateIntakeBody(wide,'k',{brand:'Boise Remodeling Co'});
  assert.ok(size(perTrade)<=P5_INTAKE_BODY_LIMIT_BYTES);
  assert.deepEqual([total(perTrade).lines.length,total(perTrade).sum],[4,60000]);
  assert.equal(perTrade.team_alert,'site');
});

const ok=(body:unknown={ok:true,accepted:true,alert:'none'},status=201)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
type Call={url:string;init:RequestInit};
function fakeFetch(answer:(call:Call)=>Response|Promise<Response>){
  const calls:Call[]=[];
  const fetcher=(async(input:RequestInfo|URL,init?:RequestInit)=>{const call={url:String(input),init:init||{}};calls.push(call);return answer(call);}) as typeof fetch;
  return {calls,fetcher};
}

test('forwardEstimateToP5 posts once to the intake and returns a provider id',async()=>{
  const record=pricedRecord('bathroom',KITCHEN);
  const {calls,fetcher}=fakeFetch(()=>ok());
  const id=await forwardEstimateToP5(record,'p5-outbox-key',{brand:'Boise Remodeling Co',fetch:fetcher});
  assert.equal(id,`p5-intake:p5-estimator:${DRAFT}`);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://p5homeco.com/api/leads/intake');
  assert.equal(P5_INTAKE_URL,'https://p5homeco.com/api/leads/intake');
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.redirect,'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal,'the post is timed');
  assert.deepEqual(calls[0].init.headers,{'Content-Type':'application/json'},'no credential is sent');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)),JSON.parse(JSON.stringify(estimateIntakeBody(record,'p5-outbox-key',{brand:'Boise Remodeling Co'}))));
  // Another address only when a caller names one, and only over HTTPS without credentials.
  const other=fakeFetch(()=>ok({ok:true}));
  await forwardEstimateToP5(record,'k',{brand:'Boise Remodeling Co',fetch:other.fetcher,url:'https://staging.example.invalid/api/leads/intake'});
  assert.equal(other.calls[0].url,'https://staging.example.invalid/api/leads/intake');
  for(const url of ['http://p5homeco.com/api/leads/intake','https://user:secret@p5homeco.com/api/leads/intake','not a url'])
    await assert.rejects(forwardEstimateToP5(record,'k',{brand:'Boise Remodeling Co',fetch:other.fetcher,url}),/credential-free HTTPS endpoint/);
  assert.equal(other.calls.length,1);
});

test('a failure throws a short error with no response body in it, so the outbox marks the job for review',async()=>{
  const record=pricedRecord('kitchen',KITCHEN);
  const secret='SECRET-RESPONSE-BODY pat@example.invalid';
  const timeout=()=>{const error=new Error('The operation was aborted due to timeout');error.name='TimeoutError';throw error;};
  const cases:[string,(call:Call)=>Response,RegExp][]=[
    ['refused',()=>new Response(secret,{status:500}),/^P5 intake refused the estimate \(HTTP 500\)$/],
    ['rate limited',()=>ok({ok:false,error:secret},429),/^P5 intake refused the estimate \(HTTP 429\)$/],
    ['rejected',()=>ok({ok:false,errors:[secret]},422),/^P5 intake refused the estimate \(HTTP 422\)$/],
    ['not accepted',()=>ok({ok:false,error:secret},200),/^P5 intake did not accept the estimate$/],
    ['ok missing',()=>ok({accepted:true,note:secret},200),/^P5 intake did not accept the estimate$/],
    ['not json',()=>new Response(`<html>${secret}</html>`,{status:200}),/^P5 intake answer was not valid JSON$/],
    ['not an object',()=>ok('ok',200),/^P5 intake did not accept the estimate$/],
    ['unreachable',()=>{throw new Error(`connect ECONNREFUSED ${secret}`);},/^P5 intake could not be reached; the estimate was not confirmed$/],
    ['timed out',timeout,/^P5 intake did not answer in time; the estimate was not confirmed$/],
  ];
  for(const [name,answer,expected] of cases){
    const {calls,fetcher}=fakeFetch(answer);
    const error=await forwardEstimateToP5(record,'k',{brand:'Boise Remodeling Co',fetch:fetcher}).then(()=>null,(e:Error)=>e);
    assert.ok(error instanceof Error,name);
    assert.match(error.message,expected,name);
    assert.ok(error.message.length<120&&!error.message.includes('SECRET')&&!error.message.includes('@'),name);
    assert.equal(calls.length,1,`${name}: one post, never a second`);
  }
});

test('a synthetic QA record is never forwarded, and neither is a record nobody could be reached about',async()=>{
  const record=pricedRecord('kitchen',KITCHEN);
  const {calls,fetcher}=fakeFetch(()=>ok());
  for(const qa of [{contact:{name:'[QA] Acceptance',email:'qa@example.invalid'}},{contact:{name:'SYNTHETIC QA run',email:'qa@example.invalid'}},{scope:{answers:{service:'kitchen',projectName:'[QA] kitchen'}}}])
    await assert.rejects(forwardEstimateToP5({...record,...qa},'k',{brand:'Boise Remodeling Co',fetch:fetcher}),/synthetic QA estimate is never forwarded/);
  await assert.rejects(forwardEstimateToP5({...record,contact:{name:'Pat Example',email:'',phone:''}},'k',{brand:'Boise Remodeling Co',fetch:fetcher}),/email address or a phone number/);
  await assert.rejects(forwardEstimateToP5(record,'k',{brand:' ',fetch:fetcher}),/needs the brand name/);
  assert.equal(calls.length,0,'nothing was posted');
  // With no usable figures the lead is still forwarded, for P5 to email the team about.
  await forwardEstimateToP5({...record,customer:{summary:'Held for review'}},'k',{brand:'Boise Remodeling Co',fetch:fetcher});
  const sent=JSON.parse(String(calls[0].init.body));
  assert.equal('estimate' in sent,false);
  assert.equal('team_alert' in sent,false);
});

// ---------------------------------------------------------------------------
// The visitor's project request
// ---------------------------------------------------------------------------

function snapshot(site:IntakeSite,service:string,extra:Record<string,unknown>={}):IntakeSnapshot{
  return {schema:1,projectId:`${site}:${DRAFT}`,reference:'RMD-4F7K2Q',originSite:site,currentSite:site,draftId:DRAFT,revision:1,contextVersion:0,savedAt:'2099-01-02T12:00:00.000Z',
    contact:{name:'Pat Example',email:'pat@example.invalid',phone:'2085550142',preferredContact:'phone'},
    details:{...emptyIntakeDetails(),desiredOutcome:'A brighter kitchen with an island',budget:'Around 60,000',workContext:'We live in the house during the work'},
    scope:{text:'Remove the wall between kitchen and dining. New cabinets, tops and floor.',answers:{service,address:'123 N Main St',location:'Boise'},extraction:null,
      uploads:[{id:'11111111-1111-4111-8111-111111111111',name:'private-plan-name.pdf',type:'application/pdf',size:1234,sha256:'c'.repeat(64),status:'stored'},{id:'22222222-2222-4222-8222-222222222222',name:'kitchen-photo.jpg',type:'image/jpeg',size:99,sha256:'d'.repeat(64),status:'stored'}]},
    routing:routeIntake(site,service,['cabinetry','electrical']),unresolved:['Confirm whether the wall is load bearing.'],...extra} as unknown as IntakeSnapshot;
}
const envelopeFor=(s:IntakeSnapshot)=>intakeDeliveryEnvelope(s,'crm','e'.repeat(64));

test('a project request is filed under its primary team, with its lead key as its id and no price',()=>{
  const envelope=envelopeFor(snapshot('p5','kitchen'));
  const body=projectRequestIntakeBody(envelope);
  const {message,...rest}=body;
  assert.deepEqual(rest,{
    brand:'Boise Remodeling Co',name:'Pat Example',email:'pat@example.invalid',phone:'2085550142',
    projectType:'kitchen',address:'123 N Main St',city:'Boise',form:'p5-project-request',request_kind:'quote',contact_preference:'phone',
    sourceDetail:`p5-project-request:${DRAFT}`,external_id:envelope.leadKey,team_alert:'site',
  });
  assert.equal(body.external_id,intakeLeadKey(`p5:${DRAFT}`));
  // The same id for every revision of the request: P5 keeps one lead.
  assert.equal(projectRequestIntakeBody(envelopeFor(snapshot('p5','kitchen',{revision:4}))).external_id,body.external_id);
  // The summary: plain text, the reference, how many files, no price, no file names, hashes or storage ids.
  const text=String(message);
  assert.match(text,/^Project request RMD-4F7K2Q, revision 1, sent from p5homeco\.com\. No price has been given\.$/m);
  assert.match(text,/^Team: Boise Remodeling Co\. Supporting services: cabinetry, electrical$/m);
  assert.match(text,/^Preferred contact: Phone$/m);
  assert.match(text,/^What they want: A brighter kitchen with an island$/m);
  assert.match(text,/^Budget: Around 60,000$/m);
  assert.match(text,/^Scope: Remove the wall between kitchen and dining\./m);
  assert.match(text,/^Files attached: 2$/m);
  assert.match(text,/^To confirm: Confirm whether the wall is load bearing\.$/m);
  assert.match(text,new RegExp(`^Full request and files \\(staff sign-in\\): https://p5homeco\\.com/api/admin/p5-intake\\?draftId=${DRAFT}&revision=1$`,'m'));
  assert.doesNotMatch(text,/private-plan-name|kitchen-photo|c{20}|d{20}|11111111-1111|sha256|[{}]/);
  assert.equal('estimate' in body,false);
  assert.equal('team_notes' in body,false);
  // Every brand name is one the intake accepts, and each site's own work stays with it.
  for(const [site,service,brand] of [['remodeling','bathroom','Boise Remodeling Co'],['remodeling','addition','Boise Construction Co'],['handyman','handyman','Boise Handyman Co'],['cabinet','cabinet-install','Boise Cabinet Co'],['construction','new-construction','Boise Construction Co'],['p5','something-else','P5 Home Co']] as const)
    assert.equal(projectRequestLead(envelopeFor(snapshot(site,service))).brand,brand,`${site} ${service}`);
  assert.equal(projectRequestLead(envelopeFor(snapshot('p5','kitchen',{contact:{name:'Pat Example',email:'pat@example.invalid',phone:'',preferredContact:'either'}}))).contactPreference,'');
});

test('the request summary is bounded, and campaign fields travel under the names the intake reads',()=>{
  const huge=snapshot('remodeling','kitchen',{scope:{text:'word '.repeat(20000),answers:{service:'kitchen'},extraction:null,uploads:[]},details:{...emptyIntakeDetails(),desiredOutcome:'x'.repeat(4000),budget:'y'.repeat(500),workContext:'z'.repeat(1000)},unresolved:Array.from({length:40},(_,i)=>`Question ${i}`)});
  const body=projectRequestIntakeBody(envelopeFor(huge));
  assert.ok(String(body.message).length<=3500);
  assert.ok(new TextEncoder().encode(JSON.stringify(body)).byteLength<8000);
  assert.match(String(body.message),/^Files attached: 0$/m);
  assert.equal(projectRequestHold(envelopeFor(huge)),null);
  // Flat names, as p5homeco.com saves them.
  const flat=projectRequestIntakeBody(envelopeFor(snapshot('p5','kitchen',{details:{...emptyIntakeDetails(),attribution:{utm_source:'google',utm_medium:'cpc',gclid:'abc',first_utm_source:'facebook',landing_page:'/quote?gclid=abc',other:'dropped'}}})));
  assert.deepEqual([flat.utm_source,flat.utm_medium,flat.gclid,flat.first_utm_source,flat.landing_page,flat.other],['google','cpc','abc','facebook','/quote?gclid=abc',undefined]);
  // A first and a latest touch, as a brand site saves them. A landing page travels as a path.
  const touches=projectRequestIntakeBody(envelopeFor(snapshot('remodeling','kitchen',{attribution:{version:1,consent:'granted',first:{at:1,landingPage:'https://boiseremodeling.co/kitchens',utm_source:'facebook'},latest:{at:2,landingPage:'https://boiseremodeling.co/estimate/scope',referrer:'https://www.google.com',gclid:'xyz',utm_medium:'cpc'}}})));
  assert.deepEqual([touches.first_utm_source,touches.first_landing_page,touches.gclid,touches.utm_medium,touches.landing_page,touches.referrer],['facebook','/kitchens','xyz','cpc','/estimate/scope','https://www.google.com']);
});

test('what is held back: a synthetic request, one nobody can be reached about, and an envelope that is not this request',()=>{
  assert.equal(projectRequestHold(envelopeFor(snapshot('p5','kitchen'))),null);
  assert.equal(projectRequestHold(envelopeFor(snapshot('p5','kitchen',{contact:{name:'[QA] Acceptance',email:'qa@example.invalid',phone:'',preferredContact:'either'}}))),'synthetic-suppressed');
  assert.equal(projectRequestHold(envelopeFor(snapshot('p5','kitchen',{contact:{name:'Pat Example',email:'',phone:'',preferredContact:'either'}}))),'contact-review');
  const good=envelopeFor(snapshot('p5','kitchen'));
  assert.equal(projectRequestHold({...good,leadKey:'p5-intake-'+'0'.repeat(64)}),'payload-review');
  assert.equal(projectRequestHold({...good,channel:'team'}),'payload-review');
  assert.equal(projectRequestHold({...good,request:undefined}),'payload-review');
  assert.equal(projectRequestHold({...good,request:{...good.request!,routing:{...good.request!.routing,primaryTeam:'nobody' as IntakeSite}}}),'payload-review');
  assert.equal(projectRequestHold({...good,request:{...good.request!,projectId:'p5:not-a-project'}}),'payload-review');
});

test('requests saved before the lead system began taking them are held, so old requests do not arrive all at once',()=>{
  assert.equal(PROJECT_REQUEST_LEADS_SINCE,'2026-11-18T00:00:00.000Z');
  assert.equal(projectRequestTooOld({savedAt:'2026-11-17T23:59:59.999Z'}),true);
  assert.equal(projectRequestTooOld({savedAt:'2026-11-18T00:00:00.000Z'}),false);
  assert.equal(projectRequestTooOld({savedAt:'2026-10-09T10:00:00.000Z'},'2026-10-01T00:00:00Z'),false,'a runtime may bring older requests in on purpose');
  assert.equal(projectRequestTooOld({savedAt:'2026-12-01T00:00:00Z'},'not a date'),false,'a bad setting falls back to the reviewed moment');
  assert.equal(projectRequestTooOld({savedAt:'2026-11-01T00:00:00Z'},'not a date'),true);
  assert.equal(projectRequestTooOld({savedAt:''}),true);
});

test('the transport: readiness, a side-effect free validate, one post, and a provider id',async()=>{
  const {calls,fetcher}=fakeFetch(()=>ok({ok:true,accepted:true,alert:'none'}));
  const transport=p5LeadIntakeTransport({enabled:true,fetch:fetcher});
  const request=snapshot('remodeling','kitchen');
  const envelope=envelopeFor(request);
  assert.equal(await transport.readiness(request),null);
  assert.equal(await p5LeadIntakeTransport({enabled:false,fetch:fetcher}).readiness(request),'crm-disabled');
  assert.equal(await transport.readiness(snapshot('remodeling','kitchen',{savedAt:'2026-10-20T12:00:00.000Z'})),'crm-disabled');
  assert.equal(await p5LeadIntakeTransport({enabled:true,fetch:fetcher,since:'2026-10-01T00:00:00Z'}).readiness(snapshot('remodeling','kitchen',{savedAt:'2026-10-20T12:00:00.000Z'})),null);
  // validate is deterministic and never touches the network.
  assert.equal(transport.validate!(envelope),null);
  assert.equal(transport.validate!(envelope),null);
  assert.equal(transport.validate!(envelopeFor(snapshot('remodeling','kitchen',{contact:{name:'[QA] run',email:'qa@example.invalid',phone:'',preferredContact:'either'}}))),'synthetic-suppressed');
  assert.equal(calls.length,0);
  assert.equal(await transport.send(envelope),`p5-intake:${envelope.leadKey}`);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,P5_INTAKE_URL);
  assert.deepEqual(calls[0].init.headers,{'Content-Type':'application/json'});
  assert.equal(calls[0].init.redirect,'error');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)),JSON.parse(JSON.stringify(projectRequestIntakeBody(envelope))));
  // A retry is allowed, inside a window, and the scope names no credential.
  assert.equal(transport.retryWindowMs,P5_LEAD_RETRY_WINDOW_MS);
  assert.ok(transport.retryWindowMs>0&&transport.retryWindowMs<=6*60*60*1000);
  assert.match(transport.identityScope,/^[0-9a-f]{64}$/);
  assert.notEqual(transport.identityScope,p5LeadIntakeTransport({enabled:true,url:'https://staging.example.invalid/api/leads/intake'}).identityScope);
  // Never posted: a disabled transport, a synthetic request, a refused answer is an error.
  await assert.rejects(p5LeadIntakeTransport({enabled:false,fetch:fetcher}).send(envelope),/crm-disabled/);
  await assert.rejects(transport.send(envelopeFor(snapshot('remodeling','kitchen',{contact:{name:'[QA] run',email:'qa@example.invalid',phone:'',preferredContact:'either'}}))),/synthetic-suppressed/);
  assert.equal(calls.length,1);
  const refused=fakeFetch(()=>ok({ok:false,error:'SECRET'},429));
  await assert.rejects(p5LeadIntakeTransport({enabled:true,fetch:refused.fetcher}).send(envelope),/^Error: P5 intake refused the project request \(HTTP 429\)$/);
});

test('in the delivery worker: a failed post is retried with the same id, and a synthetic request is never posted',async()=>{
  const db=await isolatedDatabase();
  try{
    await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer,brand text,status text);
     CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,lease_token text,lease_until timestamptz,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));`);
    const query=async(sql:string,values:unknown[]=[])=>(await db.query<IntakeRow>(sql,values)).rows;
    const site:IntakeSite='remodeling';
    let clock=Date.parse('2099-01-02T12:00:00Z');
    const posted:Record<string,unknown>[]=[];
    let fail=true;
    const {fetcher}=fakeFetch(call=>{posted.push(JSON.parse(String(call.init.body)));if(fail){fail=false;return new Response('down',{status:503});}return ok({ok:true,duplicate:false,accepted:true,alert:'none'});});
    const mail={retryWindowMs:0,identityScope:'mock-mail',readiness:async()=>null,send:async()=> 'mock-mail-id'} as IntakeTransport;
    const transports={customer:mail,team:mail,crm:p5LeadIntakeTransport({enabled:true,fetch:fetcher})} as Record<IntakeChannel,IntakeTransport>;
    const channels=async(id:string)=>(await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,deliveryKey(1)]))[0].payload.channels as Record<IntakeChannel,IntakeChannelState>;
    const save=async(id:string,contact:IntakeSnapshot['contact'])=>{
      await query("INSERT INTO p5_estimator_drafts VALUES($1,1,$2,'draft')",[id,site]);
      const input:Partial<IntakeSnapshot>={...snapshot(site,'kitchen'),projectId:`${site}:${id}`,draftId:id,contact};
      delete input.savedAt;
      await intakeStore(query,()=>new Date(clock).toISOString()).save(input as Omit<IntakeSnapshot,'savedAt'>);
    };
    const run=()=>intakeDeliveryWorker({query,site,transports,now:()=>clock,suppressed:s=>/^\[QA\]/.test(s.contact.name)}).run();
    await save(DRAFT,{name:'Pat Example',email:'pat@example.invalid',phone:'',preferredContact:'email'});
    await run();
    let state=await channels(DRAFT);
    assert.equal(state.team.status,'accepted','the site has emailed the team');
    assert.deepEqual([state.crm.status,state.crm.reason,state.crm.attempts],['retry','safe-retry',1]);
    clock+=2*60*1000;
    await run();
    state=await channels(DRAFT);
    assert.deepEqual([state.crm.status,state.crm.attempts,state.crm.providerId],['accepted',2,`p5-intake:${intakeLeadKey(`${site}:${DRAFT}`)}`]);
    assert.equal(posted.length,2);
    assert.deepEqual(posted[0],posted[1],'the retry is the same post: the same id, so P5 keeps one lead');
    assert.equal(posted[0].team_alert,'site');
    assert.equal(INTAKE_CHANNELS.indexOf('team')<INTAKE_CHANNELS.indexOf('crm'),true,'the team email is sent before the lead is posted');
    // A synthetic request: every channel suppressed, nothing posted.
    const qa='22345678-1234-4234-8234-123456789abc';
    await save(qa,{name:'[QA] Acceptance',email:'qa@example.invalid',phone:'',preferredContact:'email'});
    await run();
    assert.equal((await channels(qa)).crm.status,'suppressed');
    assert.equal(posted.length,2);
  }finally{await db.close();}
});

test('house style and wiring: no em dash, nothing outside lib/p5, and the figures file imports nothing',()=>{
  const forward=read('lib/p5/p5LeadIntake.ts'),figures=read('lib/p5/documentEstimateFigures.ts');
  for(const [name,source] of [['p5LeadIntake.ts',forward],['documentEstimateFigures.ts',figures],['this test',read('tests/p5-lead-intake.test.ts')]])
    assert.ok(!source.includes(String.fromCharCode(8212)),`${name} has an em dash`);
  assert.doesNotMatch(figures,/^import /m);
  for(const match of forward.matchAll(/from '([^']+)'/g))assert.match(match[1],/^(?:node:crypto|\.\/[A-Za-z]+\.ts)$/,match[1]);
  // Only the customer amount of a line is ever read.
  assert.doesNotMatch(figures,/\.(?:cost|unitCost|riskAdjustedCost|overheadRecovery|operatingProfit|contingency|directCost)\b/);
  assert.match(figures,/entry\?\.sellingAmount/);
});
