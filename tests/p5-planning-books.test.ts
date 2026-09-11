import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanningConfiguration,PLANNING_MODEL_VERSION,materializePlanningBook,planningQuestionFields,type PlanningCatalog} from '../lib/p5/planningBooks.ts';
import {priceReviewedScope} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const date='2026-09-11T00:00:00.000Z';
const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR','REF-TOILET'];
const catalog:PlanningCatalog={version:PLANNING_MODEL_VERSION,source:'Synthetic test catalog. Not business cost data.',importedAt:date,authorizedBy:'Test fixture',rates:codes.map(code=>({code,description:code.includes('17-01')?'Cabinets':code.includes('19-02')?'Decorative cabinet hardware':'Synthetic work',type:code.endsWith('-M')||code==='REF-TOILET'?'Material':code.endsWith('-L')||code.includes('HOUR')?'Labor':'Subcontractor',unit:code.includes('HOUR')?'HR':code==='REF-TOILET'?'EA':'LF',amount:code==='03-17-01-M'?100:code==='03-17-01-L'?40:10,source:'Synthetic unit-cost fixture',basis:'owner-average-cost'}))};
const scope=(answers:ReviewedScope['answers'],text=''):ReviewedScope=>({text,answers,extraction:null,uploads:[],reviewedAt:date,corrections:[]});
const now=new Date(date);
test('Every service has an explicit owner-planning book; rates remain in private configuration',()=>{const config=createPlanningConfiguration(catalog);assert.equal(config.costBooks.length,12);assert.equal(new Set(config.costBooks.map(b=>b.service)).size,12);assert.ok(config.costBooks.every(b=>b.mode==='owner-planning'));});
test('Cabinet supply and installation use distinct scope and preserve the overhead/profit reconciliation',()=>{
 const config=createPlanningConfiguration(catalog);
 const answers={cabinetBaseLf:'10',cabinetUpperLf:'5',cabinetTallLf:'0',cabinetRoom:'kitchen',location:'Boise'};
 const supply=priceReviewedScope(scope({...answers,service:'cabinet-product'}),config,now);const installed=priceReviewedScope(scope({...answers,service:'cabinet-install'}),config,now);
 assert.equal(supply.customer.status,'planning-range');assert.equal(installed.customer.status,'planning-range');
 const s=supply.internal as any,i=installed.internal as any;assert.equal(s.currentCostsConfirmed,false);assert.equal(s.estimatePurpose,'preliminary');assert.equal(s.lines.filter((l:any)=>l.category==='field-labor').length,0);
 assert.equal(i.lines.find((l:any)=>l.id.startsWith('03-17-01-L')).cost,600);assert.ok(Math.abs(i.reconciliation)<1e-8);assert.ok(i.contractPrice>s.contractPrice);
 assert.equal(i.allocations.overhead,.2);assert.equal(i.targetOperatingProfit,.2);
 const publicData=JSON.stringify(installed.customer);assert.ok(!publicData.includes('Synthetic unit-cost fixture'));assert.ok(!publicData.includes('unitCost'));assert.ok(!publicData.includes('overheadRecovery'));
});
test('Missing cabinet measurements are blocked; a real zero stays zero',()=>{const config=createPlanningConfiguration(catalog);const missing=priceReviewedScope(scope({service:'cabinet-product',cabinetBaseLf:'10'}),config,now);assert.equal(missing.customer.range,null);const zero=priceReviewedScope(scope({service:'cabinet-product',cabinetBaseLf:'0',cabinetUpperLf:'10',cabinetTallLf:'0'}),config,now);assert.ok(zero.customer.range);});
test('Supplied fixtures are not purchased twice and explicit task counts determine hours',()=>{
 const config=createPlanningConfiguration(catalog);const review=scope({service:'handyman',taskList:'Replace two toilets',ownerSupplied:'Both toilets',location:'Boise'});
 const result=priceReviewedScope(review,config,now);const internal=result.internal as any;assert.ok(result.customer.range);assert.equal(internal.lines.find((r:any)=>r.id.startsWith('REF-PLUMBING-HOUR')).quantity,4);assert.ok(!internal.lines.some((r:any)=>r.id.startsWith('REF-TOILET')));
});
test('Unknown specialist work and expired planning catalogs cannot produce misleading partial ranges',()=>{
 const config=createPlanningConfiguration(catalog);const review=scope({service:'handyman',taskList:'Replace one toilet and repair structural foundation',location:'Boise'});assert.equal(priceReviewedScope(review,config,now).customer.range,null);
 const cabinet=scope({service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0'});assert.equal(priceReviewedScope(cabinet,config,new Date('2027-01-01')).customer.range,null);
});
test('Question policy requests all relevant quantities in a combined task list',()=>{const fields=planningQuestionFields({service:'handyman',taskList:'Paint walls, install flooring and tile, replace baseboards'});for(const field of ['sqft','flooringSqft','tileSqft','trimLf'])assert.ok(fields.includes(field as any));});
test('The catalog rejects duplicate contingency, owner-management salary and zero-price placeholders',()=>{for(const code of ['03-23-04','L-03-00','03-24-99'])assert.throws(()=>createPlanningConfiguration({...catalog,rates:[...catalog.rates,{...catalog.rates[0],code}]}));});
