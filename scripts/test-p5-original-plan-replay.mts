import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {priceCompleteScope} from '../lib/p5/scopePricing.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import {validateExtraction} from '../lib/p5/scope.ts';
import {ESTIMATOR_MODEL} from '../lib/p5/modelPolicy.ts';
import {canonical,sha} from './lib/recoveryEpoch.mjs';
import {pricingReplayRequestHash,shortlistReplayRequestHash} from './lib/exactPricingReplay.mjs';
import {capturePricingDelivery} from './lib/capturedPricingDelivery.ts';

// Synthetic wiring regression only. No real-plan/model acceptance claim.
const now='2026-10-03T00:00:00.000Z';
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const configuration=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'SYNTHETIC ONLY',authorizedBy:'TEST ONLY',importedAt:now,
 rates:codes.map(code=>({code,description:'Synthetic cabinet supply',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'SYNTHETIC ONLY',basis:'owner-average-cost'}))});
const document=await PDFDocument.create();document.addPage().drawText('SYNTHETIC ONLY - ten feet of cabinetry');
const bytes=Buffer.from(await document.save()),name='synthetic-pricing.pdf';
const extraction=validateExtraction({summary:'Supply ten feet of cabinetry.',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],
 pages:[{source:name,page:1,sheet:'',revision:'',status:'read',notes:[],coverageState:'readable'}]});
const scope:any={text:'Supply ten feet of cabinetry.',answers:{service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'},
 extraction,uploads:[{id:'synthetic-source',name,type:'application/pdf',size:bytes.length,sha256:sha(bytes),status:'stored'}],reviewedAt:now,corrections:[]};
const ids=(priceReviewedScope(scope,configuration,new Date(now)).internal as any).lines.map((line:any)=>line.id);
const task={id:'cabinets',description:'Cabinet supply',evidence:'ten feet',existingLineIds:ids,additions:[],researchDescription:'',issues:[]};
const replies=[{tasks:[{id:task.id,description:task.description,evidence:task.evidence}],issues:[]},{tasks:[task],issues:[]},{coveredTaskIds:['cabinets'],issues:[]}];
const transcript:any={version:1,model:ESTIMATOR_MODEL,stages:[],shortlists:[]};
const enclosingFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('offline-test:network-denied');};
const directory=await mkdtemp(path.join(tmpdir(),'p5-original-replay-test-'));
try{
 const first=await priceCompleteScope(scope,configuration,async(instructions,input,search)=>{
  assert.equal(search,false);assert.ok(replies.length,'Unexpected pricing stage');
  const reply={value:replies.shift(),sourceUrls:[]};transcript.stages.push({requestSha256:pricingReplayRequestHash(instructions,input,search),replySha256:sha(canonical(reply)),reply});
  return reply;
 },new Date(now),undefined,undefined,0,undefined,async(tasks,rates)=>{
  const entries:any[]=[];transcript.shortlists.push({requestSha256:shortlistReplayRequestHash(tasks,rates),replySha256:sha(canonical(entries)),entries});return new Map();
 });
 assert.ok(first.customer.range);assert.equal(replies.length,0);
 const manifest=await capturePricingDelivery(null,scope,directory,enclosingFetch,{uploads:[{name,type:'application/pdf',data:bytes}],expectedPages:[{source:name,page:1}],
  modelEvidence:{verified:true,requestedModel:ESTIMATOR_MODEL,responseModels:[ESTIMATOR_MODEL],calls:1},
  pricingReplay:{configuration,configurationSha256:sha(canonical(configuration)),transcript,transcriptSha256:sha(canonical(transcript)),resultSha256:sha(canonical(first)),now}});
 const saved=JSON.parse(await readFile(path.join(directory,'saved-estimate.json'),'utf8'));
 assert.deepEqual(saved.customer.range,first.customer.range);assert.deepEqual(saved.internal,JSON.parse(JSON.stringify(first.internal)));
 assert.equal(manifest.replayedStages,3);assert.equal(manifest.persistedAfterReopen,true);
 console.log(JSON.stringify({passed:true,syntheticOnly:true,actualPricingEngine:true,replayedStages:manifest.replayedStages,providerNetworkCalls:0,externalSends:0,crmEnabled:false}));
}finally{globalThis.fetch=enclosingFetch;await rm(directory,{recursive:true,force:true});}
