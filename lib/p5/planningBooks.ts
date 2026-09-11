import {COST_CATEGORIES,DEFAULT_FINANCE,SERVICE_MATRIX,type CostCategory,type Service} from './pricing.ts';
import {SCOPE_FIELDS,type ScopeAnswers,type ScopeField,type ReviewedScope} from './scope.ts';
import type {CostRule,EstimatorConfiguration,ServiceCostBook} from './costBook';

/** Private owner data lives in the policy database, never in the public bundle. */
export interface PlanningRate {code:string;description:string;type:'Material'|'Labor'|'Subcontractor'|'Equipment'|'Other';unit:string;amount:number;source:string;basis:'owner-average-cost'|'historical-cost-budget'}
export interface PlanningCatalog {version:string;source:string;importedAt:string;authorizedBy:string;rates:PlanningRate[]}
export const PLANNING_MODEL_VERSION='owner-schedule-2026-09-11';
const SMALL=new Set(['handyman','re10','change-order','rush']);
const BUILDS=new Set(['new-construction','addition','adu']);
const EXCLUDED_CODES=new Set(['03-23-03','03-23-04','L-01-02','L-03-00','03-24-02']);
export function validatePlanningCatalog(catalog:PlanningCatalog){
 if(!catalog||catalog.version!==PLANNING_MODEL_VERSION||!catalog.source?.trim()||!catalog.authorizedBy?.trim()||!Number.isFinite(Date.parse(catalog.importedAt))||!Array.isArray(catalog.rates)||catalog.rates.length>500)throw new Error('Invalid owner planning catalog.');
 const ids=new Set<string>();
 for(const r of catalog.rates){
  if(!r.code?.trim()||ids.has(r.code)||!r.description?.trim()||!r.source?.trim()||!['Material','Labor','Subcontractor','Equipment','Other'].includes(r.type)||!['SF','LF','EA','HR','HRS','MO','LS'].includes(r.unit)||!['owner-average-cost','historical-cost-budget'].includes(r.basis)||!Number.isFinite(r.amount)||r.amount<=0||EXCLUDED_CODES.has(r.code)||r.code.endsWith('-99'))throw new Error(`Invalid planning rate: ${r.code||'unknown'}`);
  ids.add(r.code);
 }
 for(const code of ['03-17-01-M','03-17-01-L','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'])if(!ids.has(code))throw new Error(`Planning catalog is missing ${code}.`);
 return catalog;
}
export function createPlanningConfiguration(catalog:PlanningCatalog,services:readonly string[]=Object.keys(SERVICE_MATRIX),finance=DEFAULT_FINANCE):EstimatorConfiguration{
 validatePlanningCatalog(catalog);
 const costBooks=services.map(service=>{
  if(!Object.hasOwn(SERVICE_MATRIX,service))throw new Error('Unknown service in planning configuration.');
  return {service:service as Service,mode:'owner-planning' as const,rules:[],coverage:[],assumptions:[],exclusions:[],verifiedScope:'Owner-authorized preliminary estimating model; project takeoff and current procurement costs require confirmation.',reviewedAt:catalog.importedAt};
 });
 return {finance:{...finance},costBooks,planningCatalog:catalog};
}
const fieldNumber=(a:ScopeAnswers,k:ScopeField)=>a[k]?.trim()?Number(a[k]!.replaceAll(',','')):undefined;
const words=(scope:ReviewedScope)=>[scope.text,...Object.entries(scope.answers).filter(([k])=>!['service','exclusions','ownerSupplied'].includes(k)).map(([,v])=>v)].join(' ').toLowerCase();
const mentions=(s:string,term:RegExp)=>term.test(s);
/** Required quantities remain questions. Assembly allowances are separately disclosed. */
export function planningQuestionFields(a:ScopeAnswers):ScopeField[]{
 const fields:ScopeField[]=[];
 if(BUILDS.has(a.service||'')){fields.push('sqft','garageIncluded');if(a.garageIncluded==='yes')fields.push('garageSqft');}
 else if(a.service?.startsWith('cabinet-'))fields.push('cabinetBaseLf','cabinetUpperLf','cabinetTallLf');
 else if(SMALL.has(a.service||'')){
  const text=[a.taskList,a.otherDetails].join(' ').toLowerCase();
  if(/paint|drywall/.test(text))fields.push('sqft');
  if(/floor|lvp|hardwood|laminate|carpet/.test(text))fields.push('flooringSqft');
  if(/tile|backsplash/.test(text))fields.push('tileSqft');
  if(/demoli|tear.?out/.test(text))fields.push('demolitionSqft');
  if(/trim|baseboard/.test(text))fields.push('trimLf');
  if(!/paint|drywall|floor|tile|demoli|toilet|faucet|disposal|door|outlet|switch|gfci|light|fan|trim|baseboard|cabinet|caulk|shelv|handrail/.test(text))fields.push('laborHours');
 }
 return [...new Set(fields)];
}
export function materializePlanningBook(book:ServiceCostBook,catalog:PlanningCatalog,scope:ReviewedScope,now=new Date()){
 validatePlanningCatalog(catalog);
 const rates=new Map(catalog.rates.map(r=>[r.code,r]));const rules:CostRule[]=[];const missing:string[]=[];
 const assumptions=['This preliminary budget uses estimated material and installation costs. A site review, final selections and current trade quotes are required before a firm proposal.'];
 const exclusions:string[]=["Appliance purchases and installation are excluded unless separately itemized after scope review."]; const a=scope.answers;const service=book.service;const text=words(scope);
 const quantity=(field:ScopeField,fallback?:number)=>{const n=fieldNumber(a,field);if(n!==undefined)return n;if(fallback!==undefined){assumptions.push(`${SCOPE_FIELDS[field].label}: modeled allowance of ${Math.round(fallback*100)/100}; confirm during scope review.`);return fallback;}missing.push(`Missing quantity: ${field}`);return 0;};
 const category=(r:PlanningRate):CostCategory=>r.type==='Material'?'materials':r.type==='Labor'?'field-labor':r.type==='Equipment'?'equipment-rentals':r.type==='Subcontractor'?'subcontractors':'other-direct';
 const add=(code:string,q:number,note:string,override?:CostCategory,label?:string)=>{
  if(!Number.isFinite(q)||q<0)throw new Error(`Invalid modeled quantity for ${code}.`);if(q===0)return;
  const r=rates.get(code);if(!r){missing.push(`Missing cost rate: ${code}`);return;}
  const finishFactor=r.type==='Material'?({refresh:.85,'mid-range':1,'high-end':1.25,luxury:1.6}[a.finish||'mid-range']||1):1;
  rules.push({id:`${code}-${rules.length+1}`,description:label||r.description,category:override||category(r),unit:r.unit==='HR'||r.unit==='HRS'?'hour':r.unit,unitCost:Math.round(r.amount*finishFactor*10000)/10000,priceBasis:'direct-cost',quantity:{fixed:q,factor:1},
   evidence:{basis:'owner-estimating-schedule',reference:`${r.source}; ${r.code}; ${r.basis}. ${note} Material selection budgeting factor: ${finishFactor}.`,verifiedAt:catalog.importedAt,validUntil:new Date(Date.parse(catalog.importedAt)+92*86400000).toISOString()},
   estimatingBasis:r.basis,quantitySource:note} as CostRule);
 };
 const pair=(code:string,q:number,note:string,material=true,labor=true)=>{if(material)add(`${code}-M`,q,note);if(labor)add(`${code}-L`,q,note);};
 const unchanged=(re:RegExp)=>Boolean(a.exclusions&&re.test(a.exclusions))||new RegExp(`(?:retain|keep|reuse|no new|do not replace)\\s+(?:the\\s+)?(?:existing\\s+)?(?:${re.source})|(?:${re.source}).{0,20}(?:remain|stay|retained|reused)`,'i').test(text);
 const retained=(re:RegExp)=>Boolean(a.ownerSupplied&&re.test(a.ownerSupplied))||unchanged(re);
 const count=(noun:string,defaultCount=1)=>{const normalized=text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,w=>String(['one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(w)+1));const match=normalized.match(new RegExp(`\\b(\\d+)\\s+(?:new\\s+|existing\\s+)?(?:${noun})`,'i'));return match?Number(match[1]):defaultCount;};
 const elapsed=(fallback:number)=>{const n=fieldNumber(a,'projectMonths');if(n!==undefined)return n;assumptions.push(`Temporary site facilities: ${fallback} month(s) for budgeting; adjust to the confirmed schedule.`);return fallback;};
 const cabinet=(fallbackBase:number|undefined,fallbackUpper:number|undefined)=>{
  const base=quantity('cabinetBaseLf',fallbackBase),upper=quantity('cabinetUpperLf',fallbackUpper),tall=quantity('cabinetTallLf',0);
  // Tall units use a disclosed 2x base-run budget, not a false measured run.
  const run=base+upper+tall*2;if(tall)assumptions.push('Tall cabinetry carries twice the base-run unit budget; supplier design will replace this allowance.');
  const supply=service==='cabinet-product';const material=!retained(/cabinet/);const labor=!supply&&!unchanged(/cabinet/);
  pair('03-17-01',run,'Reviewed base and upper runs plus twice the tall run.',material,labor);
  // Cabinet source installation already includes hardware mounting.
  if(material)add('03-19-02-M',run,'Decorative pulls/knobs allowance; no duplicate installation labor.');
  return run;
 };
 const finishes=(area:number,full:boolean)=>{
  const bathroomAssembly=service==='bathroom'&&full;
  const tile=quantity('tileSqft',bathroomAssembly?area*1.75:0),floor=quantity('flooringSqft',bathroomAssembly?0:Math.max(0,area-(/tile(?:d)? floor|floor tile/.test(text)?Math.min(tile,area):0)));
  if(bathroomAssembly&&!a.tileSqft)assumptions.push('The bathroom assembly allows tile over the floor and shower walls; the combined surface budget is 1.75 times the room floor area. Confirm actual tile takeoff.');
  if(/tile|backsplash/.test(text)&&!tile&&!unchanged(/tile/))missing.push('Missing quantity: tileSqft for the requested tile work');
  if((full||/floor|hardwood|lvp|laminate|carpet/.test(text))&&!unchanged(/flooring|floors?/)){
   const prefix=/hardwood|engineered wood/.test(text)?'03-15-01':/laminate/.test(text)?'03-15-03':/carpet/.test(text)?'03-15-05':'03-15-02';
   pair(prefix,floor,'Reviewed non-tile flooring area, or modeled floor area with only explicitly labeled floor tile deducted.',!retained(/flooring|floor materials/));
  }
  if(tile&&!unchanged(/tile/))pair('03-16-01',tile,'Reviewed tile surface area, including separately stated wall tile.',!retained(/tile/));
  if(full||/paint/.test(text))pair('03-14-01',area,'Project floor-area budgeting basis for interior paint; verify surface takeoff before a proposal.');
  if((full||/drywall/.test(text))&&!unchanged(/drywall/))pair('03-13-01',area,'Project floor-area budgeting basis for drywall; verify actual wall and ceiling takeoff.');
 };
 if(service.startsWith('cabinet-')){
  cabinet(undefined,undefined);
  exclusions.push('Countertops, appliances, electrical and plumbing changes are excluded unless separately itemized.');
  if(service==='cabinet-product')exclusions.push('Cabinet installation is excluded.');
 }else if(SMALL.has(service)){
  let matched=false;const area=fieldNumber(a,'sqft');
  if(/paint/.test(text)){pair('03-14-01',quantity('sqft'),'Reviewed painted surface area.');matched=true;}
  if(/drywall/.test(text)){pair('03-13-01',quantity('sqft'),'Reviewed drywall repair surface area.');matched=true;}
  if(/floor|lvp|hardwood|laminate|carpet/.test(text)){const prefix=/hardwood/.test(text)?'03-15-01':/laminate/.test(text)?'03-15-03':/carpet/.test(text)?'03-15-05':'03-15-02';pair(prefix,quantity('flooringSqft',area),'Reviewed flooring area.',!retained(/flooring/));matched=true;}
  if(/tile|backsplash/.test(text)){pair('03-16-01',quantity('tileSqft'),'Reviewed tile area.',!retained(/tile/));matched=true;}
  if(/demoli|tear.?out/.test(text)){add('03-03-04',quantity('demolitionSqft',area),'Reviewed demolition area, including haul-off.');matched=true;}
  const tasks:[RegExp,string,number,string,string?][]=[[/toilet/,'toilets?',2,'REF-PLUMBING-HOUR','REF-TOILET'],[/faucet/,'faucets?',2,'REF-PLUMBING-HOUR','REF-FAUCET'],[/disposal/,'disposals?',2,'REF-PLUMBING-HOUR','REF-DISPOSAL'],[/outlet|gfci|switch/,'outlets?|gfcis?|switches?',1,'REF-ELECTRICAL-HOUR','REF-DEVICE'],[/light|ceiling fan/,'lights?|fans?',2,'REF-ELECTRICAL-HOUR'],[/caulk/,'caulking tasks?',2,'REF-GENERAL-HOUR'],[/shelv|handrail/,'shelves|handrails?',2,'REF-GENERAL-HOUR']];
  for(const[match,noun,hours,code,product]of tasks)if(match.test(text)){const n=count(noun);add(code,n*hours,`${n} ${noun.replace(/[?|]/g,'')} at ${hours} modeled hours each.`,undefined,`${noun.replace(/[?|]/g,'')} installation labor`);assumptions.push(`${noun.replace(/[?|]/g,'')}: ${hours} labor hours per item; existing accessible connections and no concealed repairs.`);if(product&&!retained(match))add(product,n,'Historical product allowance; confirm selection before purchase.');matched=true;}
  if(/door/.test(text)){pair('03-18-01',count('doors?'),'Stated door quantity or one door if singular.',!retained(/door/));matched=true;}
  if(/trim|baseboard/.test(text)){pair('03-18-02',quantity('trimLf'),'Reviewed trim length.',!retained(/trim|baseboard/));matched=true;}
  if(/cabinet/.test(text)){cabinet(undefined,0);matched=true;}
  if(!matched)add('REF-GENERAL-HOUR',quantity('laborHours'),'Reviewed labor allowance for the listed tasks.');
  if(/roof|foundation|load.bearing|structural|electrical panel|service upgrade|hvac|furnace|concrete|mold|asbestos|water damage/.test(text))missing.push('Missing quantity: specialist trade takeoff for the additional work in this task list');
  exclusions.push('Concealed damage, hazardous materials, structural alterations and permit-driven system upgrades require a revised scope.');
 }else{
  const area=quantity('sqft');const build=BUILDS.has(service);const full=build||service==='whole-home'||/full|complete|gut|entire|new kitchen|new bathroom/.test(text)||(!a.taskList&&!a.demolition&&!a.structural);
  if(build){
   const stories=quantity('stories',1),footprint=area/Math.max(1,stories),perimeter=4*Math.sqrt(footprint);
   assumptions.push('Early construction takeoff models a compact footprint from living area and story count. The range must be revised for actual geometry, engineering, soils and utility requirements.');
   add('03-04-01',footprint,'Modeled foundation footprint.');add('03-04-02',perimeter,'Modeled square-footprint perimeter; structural takeoff required.');add('03-04-03',footprint,'Modeled ground-floor slab.');
   for(const code of ['03-05-02','03-05-03','03-06-01','03-11-01','03-11-06','03-12-01'])pair(code,area,'Living-area budgeting basis; actual trade takeoff required.');
   pair('03-07-03',area,'Window allowance on the source schedule project-area basis, not measured glazing area.');pair('03-07-02',2,'Two exterior door allowances.');
   add('03-08-01',Math.max(.4,area/2500),'HVAC system budget normalized to a 2,500 SF home; mechanical design required.');
   add('03-09-04-M',area,'Source standard interior electrical fixture allowance.');add('03-09-08-L',area,'Source electrical rough and finish labor budget.');pair('03-10-03',area,'Source plumbing system budget.');
   add('03-10-01',1,'One water-heater system allowance.');add('03-03-08',1,'Water and sewer connection allowance; actual utility costs require review.');add('03-03-09',1,'Gas and electric connection allowance; actual utility costs require review.');
   add('01-00-06',area,'Schematic architectural planning allowance.','engineering-design');add('02-00-01',area,'Construction document allowance.','engineering-design');add('02-00-03',area/125,'Structural engineering budget at one hour per 125 SF.','engineering-design');add('03-01-01',1,'Source municipal permit allowance; jurisdiction confirmation required.','permits-inspections');
   const garage=a.garageIncluded==='yes'?quantity('garageSqft'):quantity('garageSqft',0);if(garage){
    add('03-04-01',garage,'Garage footprint.');add('03-04-02',4*Math.sqrt(garage),'Modeled garage perimeter.');add('03-04-03',garage,'Garage slab.');
    for(const code of ['03-05-02','03-05-03','03-06-01','03-11-01','03-11-06'])pair(code,garage,'Garage-only structure area, separate from living area.');add('03-07-01',Math.ceil(garage/400),'One garage-door allowance per 400 SF.');
   }
   const outdoor=quantity('coveredOutdoorSqft',0);if(outdoor){pair('03-22-01',outdoor,'Covered outdoor paving.');pair('03-22-02',outdoor,'Covered outdoor structure.');}
   cabinet(Math.max(12,area*.012),Math.max(8,area*.008));
  }else{
   if(full||/demo|remove|replace/.test(text))add('03-03-04',quantity('demolitionSqft',area),'Selected interior demolition and haul-off.');
   if(/structur|load.bearing|beam|wall removal/.test(text)){pair('03-05-02',area,'Structural remodel allowance on affected area.');add('02-00-03',8,'Engineering allowance for structural review.','engineering-design');}
   if(full||/electri|light|outlet/.test(text)){add('REF-ELECTRICAL-HOUR',service==='bathroom'?8:service==='kitchen'?16:area/50,'Modeled electrical trade hours, confirmed at walkthrough.');}
   if(full||/plumb|sink|toilet|shower|faucet/.test(text)){add('REF-PLUMBING-HOUR',service==='bathroom'?16:service==='kitchen'?12:area/60,'Modeled plumbing trade hours, confirmed at walkthrough.');pair('03-10-03',area,'Source plumbing fixture material allowance.',!retained(/fixture|plumbing materials/),false);}
   if((full||/cabinet|vanit/.test(text))&&!unchanged(/cabinet/))cabinet(service==='bathroom'?4:service==='kitchen'?20:area*.012,service==='bathroom'?0:service==='kitchen'?15:area*.008);
   if(full||/permit/.test(text))add('03-01-01',service==='bathroom'?.25:service==='kitchen'?.4:1,'Proportional source permit budget, reconciled with local requirements.','permits-inspections');
  }
  finishes(area,full);
  if((full||/countertop/.test(text))&&!retained(/countertop/)){const sf=quantity('countertopSqft',service==='bathroom'?10:service==='kitchen'?50:Math.max(30,area*.02));pair('03-17-02',sf/2.083333333333333,'Countertop SF converted to LF using a disclosed 25-inch depth.');assumptions.push('Countertops use a 25-inch modeled depth to convert the source LF rate; islands and specialty edges need a supplier takeoff.');}
  if((service==='bathroom'&&full)||/shower glass/.test(text))pair('03-19-06',1,'One shower-glass enclosure allowance.');
  if(full){pair('03-18-02',area*.35,'Trim allowance of 0.35 LF per SF of project area.');pair('03-23-01',area,'Closeout and touch-up allowance.');add('03-23-02',area,'Final clean allowance.','closeout');}
  const months=elapsed(build?Math.max(4,Math.ceil(area/600)):service==='bathroom'?1:service==='kitchen'?2:3);
  add('03-02-02',months,'Portable facilities for the modeled construction duration.');add('03-02-06',months,'Source waste-management allowance.','disposal');add('03-02-04',area,'Protection of the work area.','protection-cleanup');
  if(build){add('03-02-01',months,'Temporary utilities.');add('03-02-05',months,'Temporary site storage.');add('03-01-02',months,'Project-specific builder risk, separate from company insurance.');}
  exclusions.push('Land acquisition, financing, furnishings and landscaping are excluded unless separately itemized.');
 }
 // These are explicit estimating reserves, not invented tax or payroll records.
 const materialCost=rules.filter(r=>r.category==='materials').reduce((sum,r)=>sum+r.unitCost*(r.quantity.fixed||0),0);
 const baseCost=rules.reduce((sum,r)=>sum+r.unitCost*(r.quantity.fixed||0),0);
 const reserve=(id:string,description:string,amount:number,category:CostCategory)=>{if(amount<=0)return;rules.push({id,description,category,unit:'LS',unitCost:Math.round(amount*100)/100,priceBasis:'direct-cost',quantity:{fixed:1,factor:1},estimatingBasis:'owner-average-cost',evidence:{basis:'owner-estimating-schedule',reference:`Disclosed estimating reserve, ${PLANNING_MODEL_VERSION}. This is not a supplier invoice, tax calculation or payroll record.`,verifiedAt:catalog.importedAt,validUntil:new Date(Date.parse(catalog.importedAt)+92*86400000).toISOString()}});};
 reserve('material-procurement','Material purchasing, freight, waste and handling budget',materialCost*.12,'other-direct');
 if(baseCost){reserve('mobilization','Project mobilization and small equipment budget',Math.max(SMALL.has(service)?35:75,baseCost*.015),'travel-mobilization');if(!rules.some(r=>r.category==='closeout'))reserve('closeout','Cleanup and closeout budget',Math.max(25,baseCost*.015),'closeout');}
 assumptions.push('Material purchasing, delivery, waste and handling are included as budgeting allowances. Confirm quantities and delivered prices before ordering.');
 if(a.finish==='high-end'||a.finish==='luxury')assumptions.push(`The material budget reflects the selected ${a.finish} finish level. Custom selections require supplier confirmation.`);
 const present=new Set(rules.map(r=>r.category));
 const coverage=COST_CATEGORIES.map(category=>({category,status:present.has(category)?'included' as const:'not-applicable' as const,reason:present.has(category)?'Included in the itemized preliminary cost model.':category==='owner-production'||category==='project-supervision'?'Ordinary owner labor and supervision are already covered by the company overhead budget; additional separately hired project management requires a scope revision.':'No separate charge in this defined preliminary assembly. Additional work requires revised scope and takeoff.'}));
 if(now.getTime()-Date.parse(catalog.importedAt)>92*86400000)missing.push('Planning catalog quarterly review is due.');
 return {book:{...book,rules,coverage,assumptions:[...new Set(assumptions)],exclusions},missing};
}
