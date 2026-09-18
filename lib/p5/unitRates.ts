import {createHash} from 'node:crypto';
import type {CostRule} from './costBook.ts';

export const rateLocation=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ')||'boise / treasure valley, idaho';
export const unitKey=(unit:string)=>{
 const key=unit.toLowerCase().replace(/[.²]/g,m=>m==='²'?'2':'').replace(/[-_]/g,' ').replace(/\s+/g,' ').trim().replace(/^(?:per |\/)/,'').trim();
 const aliases:Record<string,string>={'sf':'sf','sq ft':'sf','sqft':'sf','square foot':'sf','square feet':'sf','ft2':'sf','lf':'lf','lin ft':'lf','linear ft':'lf','lineal foot':'lf','lineal feet':'lf','linear foot':'lf','linear feet':'lf','ea':'each','each':'each','unit':'each','units':'each','hr':'hour','hrs':'hour','h':'hour','hour':'hour','hours':'hour','cy':'cy','cubic yard':'cy','cubic yards':'cy'};
 return aliases[key]||key;
};
const units=new Set(['sf','lf','each','hour','cy']);
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
 if(!units.has(unit)||!Number.isFinite(expires)||expires<=now.getTime()||!Number.isFinite(retrieved)||retrieved>now.getTime()||expires>retrieved+30*86400000)return null;
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
