import {createHash} from 'node:crypto';
import type {CostRule} from './costBook.ts';

export const rateLocation=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ')||'boise / treasure valley, idaho';
/** Units of measure the estimator prices in. Each has a dimension, so a unit is
 * never converted into one of another kind: square feet never becomes linear
 * feet, a roofing square (100 SF) is not a square foot, and an unfamiliar unit
 * is refused rather than forced into "each" or a lump sum. */
export type UnitDimension='area'|'length'|'count'|'time'|'volume'|'weight'|'power'|'lump';
export const UNIT_REGISTRY:Record<string,{dimension:UnitDimension;label:string}>={
 sf:{dimension:'area',label:'SF'},sy:{dimension:'area',label:'SY'},square:{dimension:'area',label:'roofing square'},
 lf:{dimension:'length',label:'LF'},
 each:{dimension:'count',label:'EA'},pair:{dimension:'count',label:'pair'},set:{dimension:'count',label:'set'},load:{dimension:'count',label:'load'},sheet:{dimension:'count',label:'sheet'},roll:{dimension:'count',label:'roll'},
 hour:{dimension:'time',label:'HR'},day:{dimension:'time',label:'day'},week:{dimension:'time',label:'week'},month:{dimension:'time',label:'month'},
 cy:{dimension:'volume',label:'CY'},gallon:{dimension:'volume',label:'gallon'},
 ton:{dimension:'weight',label:'ton'},
 acre:{dimension:'area',label:'acre'},watt:{dimension:'power',label:'watt'},
 ls:{dimension:'lump',label:'lump sum'},
};
/** Things a repair list counts one at a time. "each vent", "per fixture" and "device location" are all a count of one. */
const COUNTED='(?:items?|fixtures?|devices?|locations?|device locations?|assembl(?:y|ies)|terminations?|vents?|receptacles?|outlets?|switch(?:es)?|lights?|doors?|windows?|openings?|breakers?|valves?|hose bibs?|traps?|boots?|caps?|pumps?|units?|pieces?|pcs?|components?|repairs?|occurrences?|rooms?|bathrooms?|cabinets?|systems?|shelves|shelf|drawers?|panels?|fans?|detectors?|sinks?|faucets?|toilets?|vanit(?:y|ies)|appliances?|heaters?|fixture sets?|stops?|stations?)';
const COUNTED_UNIT=new RegExp(`^(?:each|ea|per|one)? ?${COUNTED}$`);
export const unitKey=(unit:string)=>{
 const key=unit.toLowerCase().replace(/[.²]/g,m=>m==='²'?'2':'').replace(/[-_]/g,' ').replace(/\s+/g,' ').trim().replace(/^(?:per |\/)/,'').trim();
 const aliases:Record<string,string>={'sf':'sf','sq ft':'sf','sqft':'sf','square foot':'sf','square feet':'sf','ft2':'sf','sy':'sy','sq yd':'sy','square yard':'sy','square yards':'sy','sq':'square','square':'square','squares':'square','roofing square':'square','roofing squares':'square',
  'lf':'lf','lin ft':'lf','linear ft':'lf','lineal foot':'lf','lineal feet':'lf','linear foot':'lf','linear feet':'lf',
  'ea':'each','each':'each','unit':'each','units':'each','count':'each','qty':'each','pair':'pair','pairs':'pair','pr':'pair','set':'set','sets':'set','load':'load','loads':'load','pickup load':'load','pickup loads':'load','truck load':'load','truckload':'load','trailer load':'load','dump load':'load','sheet':'sheet','sheets':'sheet','roll':'roll','rolls':'roll',
  'hr':'hour','hrs':'hour','h':'hour','hour':'hour','hours':'hour','labor hour':'hour','labor hours':'hour','day':'day','days':'day','crew day':'day','wk':'week','week':'week','weeks':'week','mo':'month','month':'month','months':'month',
  'cy':'cy','cubic yard':'cy','cubic yards':'cy','gal':'gallon','gallon':'gallon','gallons':'gallon','ton':'ton','tons':'ton','rl':'roll','ac':'acre','acre':'acre','acres':'acre','w':'watt','watt':'watt','watts':'watt',
  'ls':'ls','lump sum':'ls','lumpsum':'ls','lot':'ls','job':'ls','allowance':'ls','package':'ls','trip':'ls','visit':'ls','service call':'ls','minimum charge':'ls'};
 if(aliases[key])return aliases[key];
 return COUNTED_UNIT.test(key)?'each':key;
};
/** Units a line may be priced in. */
export const supportedUnit=(unit:string)=>unitKey(unit) in UNIT_REGISTRY;
/** Units whose rate may be saved and reused on another project. A lump sum or a load belongs to the job it was priced for. */
const reusableUnits=new Set(['sf','lf','each','hour','cy']);
export const reusableUnit=(unit:string)=>reusableUnits.has(unitKey(unit));
/** Keep only a reusable direct unit cost. Project quantities/conditions never travel. */
export function reusableUnitRate(rule:CostRule,location:string,now=new Date()):CostRule|null{
 const context=rule.unitRateContext,provenance=rule.evidence?.provenance;
 const basis=rule.estimatingBasis;
 if(!context||context.currency!=='USD'||!provenance||provenance.status!=='estimated'||rule.priceBasis!=='direct-cost')return null;
 if(!['sourced-market-average','regional-planning-average'].includes(basis||''))return null;
 if(basis==='sourced-market-average'&&provenance.sources.length<2)return null;
 const categories={'material-purchase':'materials','trade-labor':'field-labor','subcontractor-installed':'subcontractors'};
 if(categories[context.basis]!==rule.category||!context.includes.trim())return null;
 const unit=unitKey(rule.unit),expires=Date.parse(rule.evidence.validUntil),retrieved=Date.parse(provenance.retrievedAt);
 if(!reusableUnit(unit)||!Number.isFinite(expires)||expires<=now.getTime()||!Number.isFinite(retrieved)||retrieved>now.getTime()||expires>retrieved+30*86400000)return null;
 if(rateLocation(provenance.location)!==rateLocation(location))return null;
 if(!Number.isFinite(rule.unitCost)||rule.unitCost<=0)return null;
 if(rule.unitCostRange&&(!Number.isFinite(rule.unitCostRange.low)||!Number.isFinite(rule.unitCostRange.high)||rule.unitCostRange.low<=0||rule.unitCostRange.low>rule.unitCost||rule.unitCostRange.high<rule.unitCost))return null;
 const identity=createHash('sha256').update(JSON.stringify([rateLocation(location),rule.description,unit,rule.category,basis,context])).digest('hex');
 const label=basis==='sourced-market-average'?'Published benchmark allowance':'Provisional planning allowance, not verified local pricing';
 const assumptions=[label,...context.assumptions,'Includes: '+context.includes,'Excludes: '+context.excludes];
 // Whitelist fields. Do not retain quantityRange, project evidence, floor,
 // building, scopeTaskId, conditions or fixed package quantities from the source.
 return {id:'regional-'+identity,description:rule.description,unit,trade:rule.trade,category:rule.category,priceBasis:'direct-cost',estimatingBasis:basis,unitCost:rule.unitCost,unitCostRange:rule.unitCostRange?{...rule.unitCostRange}:undefined,allowance:true,quantity:{fixed:1,factor:1},unitRateContext:structuredClone(context),evidence:{basis:rule.evidence.basis,verifiedAt:rule.evidence.verifiedAt,validUntil:rule.evidence.validUntil,reference:[label,`${rule.unitCost} USD/${unit}`,`Location: ${provenance.location}`,`Recorded: ${provenance.retrievedAt}`,...assumptions,...provenance.sources.map(s=>`${s.url} (${s.date}; ${s.region}; ${s.low} to ${s.high} USD/${unit})`)].join('. '),provenance:{...structuredClone(provenance),assumptions}}};
}
