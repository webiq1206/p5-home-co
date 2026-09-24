import test from 'node:test';
import assert from 'node:assert/strict';
import {contractorConsumableIncluded} from '../lib/p5/contractorConsumables.ts';
import {suggestedTrade} from '../lib/p5/trades.ts';
import {applyCabinetIntent,cabinetIntent} from '../lib/p5/projectIntent.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {advisoryIssue,pricedTaskRemark,findingBlocks,correctableDuplicate,planningResolution,marketResolution} from '../lib/p5/scopePricing.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const text='Install 100 linear feet of owner-supplied 3.25-inch primed MDF baseboard. Labor only. Owner supplies the baseboard; contractor supplies nails and caulk. No painting.';
const scope:ReviewedScope={text,answers:{service:'handyman',ownerSupplied:'Owner supplies baseboard; contractor supplies nails and caulk'},extraction:null,uploads:[],reviewedAt:'2026-09-24',corrections:[]};
test('contractor consumables are item-specific and do not authorize owner products or extra materials',()=>{
 for(const component of ['Finish nails','Paintable caulk','Install baseboard: finish nails (materials)'])assert.equal(contractorConsumableIncluded(scope,component),true,component);
 for(const component of ['Baseboard','Install nails and caulk: MDF baseboard','Owner-supplied nails','Adhesive','Supply and install baseboard','Cabinets including fasteners','Baseboard with nails'])assert.equal(contractorConsumableIncluded(scope,component),false,component);
 assert.equal(contractorConsumableIncluded({...scope,text:'Labor only. Owner supplies all nails and caulk.',answers:{}},'Nails'),false);
 assert.equal(contractorConsumableIncluded({...scope,text:'Include normal fastening and leveling consumables.',answers:{}},'Cabinet shims'),true);
});
test('catalog section labels cannot turn installation into painting',()=>{
 assert.equal(suggestedTrade('Cabinet install labor only (12-39 Cabinet Refacing, Refinishing & Install)'), 'Cabinets');
 assert.equal(suggestedTrade('Finish carpenter (12-39 Cabinet Refacing, Refinishing & Install)'), 'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Repainting cabinets (12-39 Cabinet Refacing, Refinishing & Install)'), 'Painting');
});
test('multi-trade sites retain the actual scope when cabinets are excluded',()=>{
 const services=['whole-home','handyman','cabinet-install','cabinet-product'];
 const flooring='Supply and install 200 SF of LVP flooring. Exclude plumbing, electrical, painting, cabinets and all other rooms.';
 assert.equal(cabinetIntent(flooring,services),undefined);
 assert.equal(applyCabinetIntent(flooring,services,{service:'whole-home'}).answers.service,'whole-home');
 assert.equal(cabinetIntent('Supply and install cabinets throughout a new home.',services),undefined);
 assert.equal(cabinetIntent('Supply and install cabinets.',['cabinet-install','cabinet-product']),'cabinet-install');
 if(ESTIMATOR_BRAND.id==='cabinet')assert.equal(cabinetIntent('Install 10 LF of owner-supplied base cabinets. Exclude cabinet purchase, demolition, countertops, plumbing and electrical.',ESTIMATOR_BRAND.services),'cabinet-install');
});
test('a verified missing consumable component cannot be downgraded because its parent labor is priced',()=>{
 const tasks=[{id:'base-cab-install',description:'Install base cabinets'}];
 const issue='base-cab-install uses labor-only PB rates that require materials separately, but no positive material line covers the requested contractor-provided normal fastening and leveling consumables. The task is incomplete.';
 assert.equal(advisoryIssue(issue),false);assert.equal(pricedTaskRemark(issue,tasks),false);assert.equal(findingBlocks(issue,tasks,tasks),true);
 assert.equal(correctableDuplicate('scope-1 duplicates scope-2. '+issue),false);
});
test('planning and sourced materials do not inherit owner supply from the baseboard they fasten',()=>{
 const task={id:'fasteners-caulk',description:'Supply nails and caulk required for installation of the 100 LF of baseboard.',evidence:text,existingLineIds:[],additions:[],researchDescription:'Nails and caulk material only',issues:[]};
 const rate={taskId:task.id,description:'Contractor-supplied finish nails and caulk',unit:'LS',quantity:1,quantityEvidence:'ALLOWANCE: One small installation consumables package; confirm usage.',quantityRange:{low:1,high:1},basis:'material-purchase',includes:'Nails and caulk only',excludes:'Baseboard, installation labor, painting',low:18,high:40,confidence:'medium',rationale:'Synthetic regression fixture only.'};
 const now=new Date('2026-09-24');
 const planned=planningResolution({rates:[rate],issues:[],notes:[]},[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope);
 assert.equal(planned.rules.length,1,JSON.stringify(planned.issues));assert.equal(planned.rules[0].category,'materials');
 const urls=['https://fixture-a.invalid','https://fixture-b.invalid'];
 const evidence={url:urls[0],publishedAt:'2026-09-23',dateBasis:'published',region:'Idaho',excerpt:'Synthetic tax and pickup included.'};
 const marketRate=Object.fromEntries(Object.entries(rate).filter(([key])=>!['low','high','confidence','rationale'].includes(key)));
 const sourced={...marketRate,sources:urls.map(url=>({url,low:18,high:40,unit:'LS',costBasis:'material-purchase',sourceType:'regional-guide',dateBasis:'published',publishedAt:'2026-09-23',region:'Idaho',excerpt:'Synthetic material purchase price.'})),landedCost:{taxRate:0,freightPerUnit:0,taxOnFreight:false,taxEvidence:evidence,freightEvidence:evidence}};
 assert.equal(marketResolution({rates:[sourced],issues:[],notes:[]},urls,[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,1);
 // The exception applies only to consumable material. A combined installed package remains blocked.
 assert.equal(planningResolution({rates:[{...rate,basis:'subcontractor-installed'}],issues:[],notes:[]},[task] as Parameters<typeof planningResolution>[1],now,0,'Boise',scope).rules.length,0);
});
