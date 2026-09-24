import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution} from '../lib/p5/scopePricing.ts';
import {PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {DEFAULT_FINANCE} from '../lib/p5/pricing.ts';
import type {EstimatorConfiguration} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const now=new Date('2026-09-24');
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic regression rates, not production prices',authorizedBy:'Test',importedAt:now.toISOString(),rates:[
  {code:'TEST-PAN',description:'Tiled shower pan with waterproofing',type:'Subcontractor',unit:'EA',amount:100,source:'Test',basis:'owner-average-cost'},
  {code:'TEST-BACKER',description:'Moisture-resistant cement wall backer, installed',type:'Subcontractor',unit:'SF',amount:10,source:'Test',basis:'owner-average-cost'},
  {code:'TEST-MEMBRANE',description:'Waterproofing membrane, installed',type:'Subcontractor',unit:'SF',amount:5,source:'Test',basis:'owner-average-cost'},
  {code:'TEST-LABOR',description:'Carpenter labor',type:'Labor',unit:'HR',amount:50,source:'Test',basis:'owner-average-cost'},
  {code:'TEST-SITE',description:'Footprint excavation and backfill, installed',type:'Subcontractor',unit:'SF',amount:8,source:'Test',basis:'owner-average-cost'},
]};
const config:EstimatorConfiguration={finance:DEFAULT_FINANCE,costBooks:[],planningCatalog:catalog};
const scope:ReviewedScope={text:'Two showers. Each shower has 90 SF of walls and 15 SF of floor. Contractor supplies and installs waterproof pans, wall backer and membranes.',answers:{service:'bathroom',location:'Boise'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]};
const task=(room:number)=>({id:`waterproof-bath${room}`,description:`Bathroom ${room} shower: contractor supply and install one new waterproof shower pan and waterproof wall backer/membrane assembly.`,evidence:'Scope requires a separately included waterproof pan and wall backer/membrane assembly for each shower; contractor supplies waterproofing and installation materials.',existingLineIds:[],additions:[
  {code:'TEST-PAN',quantity:1,quantityEvidence:`One new waterproof tiled shower pan for Bathroom ${room}.`},
  {code:'TEST-BACKER',quantity:90,quantityEvidence:`90 SF of shower wall area is explicitly specified for Bathroom ${room}.`},
  {code:'TEST-MEMBRANE',quantity:90,quantityEvidence:`90 SF of shower wall area is explicitly specified for Bathroom ${room}.`},
],researchDescription:'',issues:[]});
const resolve=(tasks:ReturnType<typeof task>[])=>catalogResolution({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]},config,[],now,scope);

test('a shower count cannot replace the area units of either shower wall assembly',()=>{
  const result=resolve([task(1),task(2)]);
  assert.deepEqual(result.issues,[]);
  assert.equal(result.rules.length,6);
  assert.deepEqual(result.rules.map(rule=>rule.quantity.fixed),[1,90,90,1,90,90]);
});
test('an explicit area mismatch still rejects the wrong wall quantity',()=>{
  const item={...task(1),description:'Supply and install 90 SF of waterproof wall backer.',evidence:'Bathroom 1 wall backer is 90 SF.',additions:[{code:'TEST-BACKER',quantity:120,quantityEvidence:'120 SF of wall backer.'}]};
  const result=resolve([item]);
  assert.equal(result.rules.length,0);
  assert.match(result.issues.join(' '),/does not match the explicit quantity/);
});
test('a count does not invent a labor-hours claim while explicit hours remain enforced',()=>{
  const item={...task(1),description:'Install one new shower pan.',evidence:'Four hours of installation labor.',additions:[{code:'TEST-LABOR',quantity:4,quantityEvidence:'Four hours of installation labor.'}]};
  assert.deepEqual(resolve([item]).issues,[]);
  assert.match(resolve([{...item,additions:[{...item.additions[0],quantity:8}]}]).issues.join(' '),/does not match the explicit quantity/);
});
test('owner-provided land does not reject contractor site work, while supplied materials remain protected',()=>{
  const site={...task(1),id:'T01',description:'Perform ordinary site preparation for the level, accessible vacant lot, including clearing as needed, layout, excavation, grading and compaction for the detached ADU.',evidence:'The scope includes ordinary site preparation on an owner-provided level, accessible vacant lot.',additions:[{code:'TEST-SITE',quantity:600,quantityEvidence:'600 SF ADU footprint.'}]};
  assert.equal(resolve([site]).rules.length,1,'the live owner-lot wording cannot make site preparation free');
  for(const evidence of ['Owner supplies backfill material for ordinary site preparation.','Ordinary site preparation on an owner-provided lot and backfill material.','Owner supplies all site preparation materials.']){
    const rejected=resolve([{...site,evidence}]);
    assert.equal(rejected.rules.length,0,evidence);
    assert.match(rejected.issues.join(' '),/owner-supplied material/);
  }
});
