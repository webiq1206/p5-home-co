import {createHash} from 'node:crypto';
import {createPlanningConfiguration,validatePlanningCatalog,type PlanningCatalog} from './planningBooks.ts';
import {priceReviewedScope} from './costBook.ts';
import type {ReviewedScope} from './scope.ts';

export type CabinetAlternateScenario='supply-only'|'labor-only'|'mixed';
export const APPROVED_PLANNING_CATALOG_SHA256='b33cd09bca5532a0b7fa11d21ac6cbd8577aa84f23b769a908002034f54e827f';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const planningCatalogFingerprint=(catalog:PlanningCatalog)=>createHash('sha256').update(JSON.stringify(canonical(catalog))).digest('hex');

export function verifyCabinetAlternateCatalog(catalog:PlanningCatalog,now=new Date(),expectedFingerprint=APPROVED_PLANNING_CATALOG_SHA256){
  validatePlanningCatalog(catalog);
  if(planningCatalogFingerprint(catalog)!==expectedFingerprint)throw new Error('The planning catalog does not match the production-approved catalog fingerprint.');
  if(/\b(?:synthetic|fixture|test only)\b/i.test(`${catalog.source} ${catalog.authorizedBy}`))
    throw new Error('The catalog is synthetic or test-only; production acceptance requires an approved catalog.');
  const configuration=createPlanningConfiguration(catalog,['cabinet-product','cabinet-install']);
  const scenarios:Record<CabinetAlternateScenario,ReviewedScope>={
    'supply-only':{text:'Supply 20 linear feet of assembled base cabinets; owner installs.',answers:{service:'cabinet-product',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0',installation:'Owner installs the cabinets.',location:'Caldwell'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]},
    'labor-only':{text:'Install 20 linear feet of owner-supplied assembled base cabinets; labor only.',answers:{service:'cabinet-install',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0',ownerSupplied:'Owner supplies the cabinets.',location:'Caldwell'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]},
    'mixed':{text:'Supply and install 20 linear feet of assembled base cabinets.',answers:{service:'cabinet-install',cabinetBaseLf:'20',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Caldwell'},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]},
  };
  const reports=Object.entries(scenarios).map(([scenario,scope])=>{
    const result=priceReviewedScope(scope,configuration,now);
    const lines=(result.internal as any).lines||[];
    if(!lines.length||!result.customer.range)throw new Error(`${scenario} did not produce a complete local range.`);
    const categories=new Set(lines.map((line:any)=>line.category));
    if(scenario==='supply-only'&&(categories.has('field-labor')||!categories.has('materials')))throw new Error('Supply-only responsibility leaked field labor or omitted materials.');
    if(scenario==='labor-only'&&(categories.has('materials')||!categories.has('field-labor')))throw new Error('Labor-only responsibility leaked materials or omitted field labor.');
    if(scenario==='mixed'&&(!categories.has('materials')||!categories.has('field-labor')))throw new Error('Mixed responsibility did not retain both materials and field labor.');
    return {scenario,synthetic:true,approvedCatalog:{version:catalog.version,source:catalog.source,authorizedBy:catalog.authorizedBy,importedAt:catalog.importedAt},range:result.customer.range,lineCount:lines.length,categories:[...categories]};
  });
  return {synthetic:true,brand:'cabinet',catalog:{version:catalog.version,source:catalog.source,authorizedBy:catalog.authorizedBy,importedAt:catalog.importedAt},scenarios:reports};
}