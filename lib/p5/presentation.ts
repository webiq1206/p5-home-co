import {SCOPE_FIELDS} from './scope.ts';
import {splitWhere} from './estimateDocument.ts';
import {suggestedTrade} from './trades.ts';
import {ESTIMATOR_BRAND as brand} from './brand.ts';
import {customerPresentation,publicPricingText,scopeBullets} from './customerProjection.ts';
// The customer boundary lives in customerProjection.ts; it is re-exported here so every presenter imports one module.
export {customerPresentation,publicPricingText,projectCustomerEstimate,customerText,customerSafeText,customerSafeValue,scopeBullets} from './customerProjection.ts';
/**
 * What a section means to the reader. Every consumer (estimator, email, PDF,
 * admin preview) labels sections by kind so excluded work is never shown as
 * included work, and assumptions are never shown as confirmed scope.
 */
export type SectionKind='glance'|'brief'|'included'|'category'|'excluded'|'allowance'|'assumption'|'info';
export type EstimateSection={title:string;kind?:SectionKind;text?:string;bullets?:string[];rows?:[string,string][]};
/** Short labels for the customer-facing summary; the long form labels are for the questions. */
const DISPLAY_LABEL:Record<string,string>={location:'Location',address:'Property address',sqft:'Project area (SF)',service:'Project type',finish:'Finish level',garageSqft:'Garage area (SF)',coveredOutdoorSqft:'Covered outdoor area (SF)',bathrooms:'Bathrooms',stories:'Stories'};
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
/** One price when the estimate is firm (an RE-10), otherwise the range. */
export const isFirmPrice=(range?:{low:number;high:number}|null)=>Boolean(range&&range.low===range.high);
export const priceText=(range:{low:number;high:number})=>isFirmPrice(range)?money(range.low):`${money(range.low)} to ${money(range.high)}`;
export const priceLabel=(range?:{low:number;high:number}|null)=>range?(isFirmPrice(range)?'Your price':'Preliminary planning range'):'Status';
export const readable=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
const overview=new Set(['service','location','address','sqft','garageSqft','coveredOutdoorSqft','rooms','bathrooms','stories','schedule','urgency','complexity','finish']);
export const FIELD_CATEGORY_TITLES:Record<string,string>={site:'Site & utilities',utilities:'Site & utilities',access:'Site & utilities',demolition:'Demolition',structural:'Structure',mechanical:'Heating & Cooling',plumbing:'Plumbing',electrical:'Electrical',appliances:'Appliances',permits:'Permits & design',engineering:'Permits & design',materials:'Materials & finishes',fixtures:'Fixtures & finishes',allowances:'Allowances & selections',exclusions:'Excluded work',ownerSupplied:'Owner responsibilities',alternates:'Alternates'};
const FIELD_SECTION_KIND:Record<string,SectionKind>={'Excluded work':'excluded','Allowances & selections':'allowance','Owner responsibilities':'info','Alternates':'info'};
/** Section titles used by consumers that group by kind; kept in one place. */
export const SECTION_TITLES={included:'Included work',excluded:'Excluded work',responsibilities:'Responsibilities',buildings:'Buildings and floors',questions:'Scope questions requiring clarification',coverage:'Document review coverage',buildingPrices:'Separate building prices',pricingBasis:'Pricing basis',allowances:'Included preliminary allowances',verify:'Items to verify before a firm proposal',categoriesIntro:'Included scope by category',requestedIntro:'Requested scope by category'} as const;
/**
 * Cabinet customers see quantities and totals only: per-unit selling rates and
 * rate provenance stay in the administrative record. Every other brand shows
 * the unit range beside each priced line. Administrative renderers are never
 * affected.
 */
export const HIDE_CUSTOMER_UNIT_RATES=(brand.id as string)==='cabinet';
function itemPriceText(item:any){
 const quantity=`${Number(item.quantity).toLocaleString('en-US')} ${item.unit}${item.quantityRange?` modeled allowance (${item.quantityRange.low.toLocaleString('en-US')} to ${item.quantityRange.high.toLocaleString('en-US')} ${item.unit} to verify)`:''}`;
 const total=`${money(item.low)} to ${money(item.high)} total`;
 // A one-package price is already its unit price. Avoid repeating it.
 if((item.quantity===1&&!item.quantityRange)||!Number.isFinite(Number(item.unitLow))||!Number.isFinite(Number(item.unitHigh))||item.unitLow==null||item.unitHigh==null)return `${quantity} • ${total}`;
 const unit=`${Number(item.unitLow).toLocaleString('en-US',{style:'currency',currency:'USD'})} to ${Number(item.unitHigh).toLocaleString('en-US',{style:'currency',currency:'USD'})} / ${item.unit}${item.quantityRange?' at the modeled quantity':''}`;
 return `${quantity}\n${total}\n${unit}`;
}
export function summarySections(summary:string):EstimateSection[]{
 const groups=new Map<string,[string,string][]>(); const original:string[]=[];
 let active:[string,string]|undefined;
 for(const line of summary.split('\n')){
  const entry=Object.entries(SCOPE_FIELDS).find(([,v])=>line.startsWith(v.label+': '));
  if(!entry){if(active)active[1]+='\n'+line;else original.push(line);continue;}
  const [key,definition]=entry;let value=line.slice(definition.label.length+2);
  if(definition.kind==='number'&&/^\d[\d,.]*$/.test(value))value=Number(value.replaceAll(',','')).toLocaleString('en-US');
  if(definition.kind==='choice')value=readable(value);
  const title=overview.has(key)?'Project at a glance':FIELD_CATEGORY_TITLES[key]||'Additional scope details';
  const rows=groups.get(title)||[];active=[DISPLAY_LABEL[key]||definition.label,value];rows.push(active);groups.set(title,rows);
 }
 const sections:EstimateSection[]=[];
 if(groups.has('Project at a glance')){sections.push({title:'Project at a glance',kind:'glance',rows:groups.get('Project at a glance')});groups.delete('Project at a glance');}
 if(original.join('\n').trim())sections.push({title:'Project brief',kind:'brief',bullets:scopeBullets(original.join('\n'))});
 for(const [title,rows]of groups)sections.push({title,kind:FIELD_SECTION_KIND[title]||'info',rows});return sections;
}
/** Merge sections that share a title so one heading never appears twice. */
function mergeByTitle(sections:EstimateSection[]):EstimateSection[]{
 const merged:EstimateSection[]=[];
 for(const section of sections){
  const existing=merged.find(s=>s.title===section.title);
  if(!existing){merged.push({...section});continue;}
  existing.kind=existing.kind||section.kind;
  existing.text=[existing.text,section.text].filter(Boolean).join('\n')||undefined;
  if(section.bullets?.length)existing.bullets=[...new Set([...(existing.bullets||[]),...section.bullets])];
  if(section.rows?.length)existing.rows=[...(existing.rows||[]),...section.rows];
 }
 return merged;
}
/** Remove repeated presentation text without merging distinct scope or prices. */
function uniqueCustomerSections(sections:EstimateSection[]):EstimateSection[]{
 const key=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim().replace(/[.!;]+$/,'').toLowerCase();
 const seen=new Map<string,Set<string>>();
 const normalized=sections.map(s=>s.kind==='excluded'?{...s,title:SECTION_TITLES.excluded,bullets:[...(s.bullets||[]),...(s.rows||[]).flatMap(([name,value])=>name==='Excluded work'?scopeBullets(value):[`${name}: ${value}`])],rows:undefined}:s);
 return mergeByTitle(normalized).map(section=>{
  const bucket=section.kind==='assumption'?'assumption':section.title;
  const used=seen.get(bucket)||new Set<string>();seen.set(bucket,used);
  const bullets=(section.bullets||[]).filter(b=>{const k=key(b);if(used.has(k))return false;used.add(k);return true;});
  const rows=(section.rows||[]).filter(([a,b])=>{const k=key(a)+'\n'+key(b);if(used.has(k))return false;used.add(k);return true;});
  return {...section,bullets,rows};
 }).filter(s=>s.text||s.bullets?.length||s.rows?.length);
}
/** A location fragment that tells the customer nothing. A compound value carries them mixed in with
 * real places ("Kitchen and garage; Floor not specified"), so filtering whole values is not enough. */
const PLACEHOLDER_PLACE=/^(?:(?:the\s+)?(?:main|new|existing|single[- ]family)\s+)?(?:residence|house|home|building|project|site|dwelling|property)$|^(?:not specified|unspecified(?: building| floor)?|unknown|n\/a|none|tbd|various|same)$/i;
/** Location fragments the customer can act on, in order, without repeats. "Floor" is dropped in front of
 * a named area ("Floor Roof" is the roof, not a storey) but kept in front of a numbered storey. */
export function placeParts(values:(string|undefined)[]):string[]{
 const parts:string[]=[];
 for(const value of values)for(const raw of String(value||'').split(/\s*[;,]\s*|\s+\/\s+/)){
  const part=raw.trim().replace(/^floor\s+(?=[A-Za-z])/i,'').replace(/\.$/,'').trim();
  if(part&&!PLACEHOLDER_PLACE.test(part)&&!parts.some(p=>p.toLowerCase()===part.toLowerCase()))parts.push(part);
 }
 return parts;
}
/** The work first and the location after it, in brackets; generic words ("Residence") dropped. Before,
 * "Residence / Floor Main level / task" ran the location into the work (owner report 2026-09-22). */
function lineLabel(description:unknown,location:string[]):string{
 const {where,rest}=splitWhere(String(description||''));
 const places=placeParts([...location,...(where?where.split(', '):[])]);
 const work=rest.replace(/\s*\.\s*:\s*/,': ').trim();
 return places.length?`${work} (${places.join(', ')})`:work;
}
export function estimateSections(result:any,hideUnitRates=HIDE_CUSTOMER_UNIT_RATES):EstimateSection[]{
 result=customerPresentation(result,{hideUnitRates});
 const sections=summarySections(result.summary||'');
 const lines:any[]=result.lineItems||[], tasks:any[]=result.scopeTasks||[];
 const suppliedInstructions=result.instructions;
 const list=(value:unknown):string[]=>Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'&&item.trim().length>0):[];
 const instructions=suppliedInstructions?{...suppliedInstructions,...Object.fromEntries(['inclusions','exclusions','responsibilities','floors','buildings','questions'].map(key=>[key,list(suppliedInstructions[key])]))}:null;
 if(instructions){
  // Inclusions and exclusions are separate sections. Excluded work must never
  // sit inside a list labeled as included work.
  const included=[...instructions.inclusions,...(instructions.laborOnly?['Installation labor with owner-supplied products. Any expressly included contractor consumables are listed separately.']:[]),...(instructions.materialsOnly?['Materials only; labor is not charged.']:[])];
  const leading:EstimateSection[]=[];
  if(included.length)leading.push({title:SECTION_TITLES.included,kind:'included',bullets:included});
  if(instructions.exclusions.length)leading.push({title:SECTION_TITLES.excluded,kind:'excluded',bullets:instructions.exclusions});
  if(instructions.responsibilities.length)leading.push({title:SECTION_TITLES.responsibilities,kind:'info',bullets:instructions.responsibilities});
  if(instructions.buildings.length||instructions.floors.length)leading.push({title:SECTION_TITLES.buildings,kind:'info',bullets:[...instructions.buildings.map((x:string)=>`Building: ${x}`),...instructions.floors.map((x:string)=>`Floor: ${x}`)]});
  sections.unshift(...leading);
  if(instructions.questions.length)sections.push({title:SECTION_TITLES.questions,kind:'assumption',bullets:instructions.questions});
 }
 if(result.documentCoverage){const c=result.documentCoverage;const expected=Number(c.expectedPages)||0;const pages:any[]=Array.isArray(c.pages)?c.pages:[];
  // A typed scope has no pages; a coverage line for it only confuses the reader.
  if(expected>0||pages.length>0)sections.push({title:SECTION_TITLES.coverage,kind:'info',text:`${pages.filter((p:any)=>p.status==='read').length} of ${expected||pages.length} pages fully read. ${c.complete?'Every page has a completed review record.':'Analysis is incomplete; review the exceptions below.'}`,bullets:pages.filter((p:any)=>p.status!=='read').map((p:any)=>`${p.source}, page ${p.page}${p.sheet?` (${p.sheet})`:''}: ${p.status}. ${(p.notes||[]).join(' ')}`)});}
 // A placeholder label ("unspecified building") is no building at all and never counts; a default one ("main") counts toward
 // building totals when another named building exists but is not repeated on every row.
 const placeholderBuilding=(b?:string)=>!b||/^(unspecified(?: building)?|unknown|not specified|n\/a|none|same|whole project)$/i.test(b.trim());
 const realBuilding=(b?:string)=>placeholderBuilding(b)?'':b!;
 const namedBuilding=(b?:string)=>!severalBuildings||placeholderBuilding(b)||/^(main(?: residence| house| building| home)?|default)$/i.test(b!.trim())?'':b!;
 const namedFloor=(f?:string)=>f&&!/^(unspecified(?: floor)?|unknown|not specified|n\/a|none|floor not specified)$/i.test(f.trim())?f:'';
 const buildings=[...new Set<string>(lines.map(l=>realBuilding(l.building)).filter(Boolean))];
 // One unnamed or default building is the whole project; a per-building table repeats the total.
 // The table answers a request for separate building prices, or a project that names more than one
 // building. Pricing labels alone ("Residence", "Single-family residence", the street address) are
 // one house described four ways, and produced four invented building totals on a live repair list.
 const oneHouseLabel=(b:string)=>/^(?:the\s+)?(?:main|primary|existing|single[- ]family)?\s*(?:residence|house|home|dwelling|property|building|site|residence site|project site)?$/i.test(b.trim())||/^\d+\s+\S/.test(b.trim());
 const severalBuildings=Boolean(instructions?.separateBuildings)||(instructions?.buildings?.length||0)>1||buildings.length>1&&buildings.some(b=>!oneHouseLabel(b));
 if(buildings.length>1&&severalBuildings)sections.push({title:SECTION_TITLES.buildingPrices,kind:'included',rows:buildings.map(b=>[b,`${money(lines.filter(l=>l.building===b).reduce((n,l)=>n+l.low,0))} to ${money(lines.filter(l=>l.building===b).reduce((n,l)=>n+l.high,0))}`]),text:'Building totals are included in, not added to, the overall estimate.'});
 const estimated=lines.filter(l=>l.pricingStatus==='estimated-allowance');
 if(lines.some(l=>l.pricingStatus==='owner-planning-rate'))sections.push({title:SECTION_TITLES.pricingBasis,kind:'assumption',text:'Owner planning rates provide the foundation for this preliminary range. They are not current supplier quotes; verify local availability, selections and trade pricing before a firm proposal.'});
 if(estimated.length){
  const notes=[...new Set<string>(estimated.map(l=>l.verification).filter(Boolean))];
  sections.push({title:SECTION_TITLES.allowances,kind:'allowance',text:`These amounts are included in the range as preliminary allowances. ${notes.length===1?notes[0]:'Confirm quantities, selections and current supplier and trade pricing before a firm proposal.'}`,rows:estimated.map(l=>[lineLabel(l.description,[namedBuilding(l.building),namedFloor(l.floor)]),`${money(l.low)} to ${money(l.high)}${l.rateLocation?` · cost location: ${l.rateLocation}`:''}${l.rateDate?` · researched ${String(l.rateDate).slice(0,10)}`:''}`])});
 }
 if(result.verificationItems?.length)sections.push({title:SECTION_TITLES.verify,kind:'assumption',bullets:[...new Set<string>(result.verificationItems)]});
 const categories=[...new Set<string>([...(result.includedCategories||[]),...lines.map(x=>x.category),...tasks.map(x=>x.category||suggestedTrade(x.description))])];
 const breakdown:EstimateSection[]=categories.map(category=>{
  const range=result.categoryRanges?.find((x:any)=>x.category===category);
  return {title:category,kind:'category',text:range?`${money(range.low)} to ${money(range.high)}`:undefined,
   bullets:[...new Set<string>(tasks.filter(x=>(x.category||suggestedTrade(x.description))===category).map(x=>x.description))],
   rows:lines.filter(x=>x.category===category).map(x=>[lineLabel(x.description,[namedBuilding(x.building),namedFloor(x.floor)]),itemPriceText(x)])};
 });
 if(breakdown.length){
  const at=sections.findIndex(s=>s.kind==='glance');
  sections.splice(at>=0?at+1:0,0,{title:result.range?SECTION_TITLES.categoriesIntro:SECTION_TITLES.requestedIntro,kind:'info',text:result.range?'Category and item ranges are parts of the overall range, not additional charges. Where several tasks share an assembly, its price is shown once.':'Scope details are organized below. Pricing coverage still requires review.'});
  for(const category of breakdown){const existing=sections.find(s=>s.title===category.title);if(existing){existing.kind='category';existing.text=category.text;existing.rows=[...(existing.rows||[]),...(category.rows||[])];existing.bullets=category.bullets;}else sections.push(category);}
 }
 for(const [title,key,kind] of [['Allowances','allowances','allowance'],['Planning assumptions','assumptions','assumption'],['Exclusions','exclusions','excluded'],['Factors that may change the range','factors','assumption']] as [string,string,SectionKind][]){
  const values=result[key]||[];if(!values.length)continue;
  sections.push({title,kind,bullets:values.map((x:any)=>typeof x==='string'?x:`${x.description}${x.amount!=null?`: ${money(x.amount)} included`:': selection to confirm'}. Includes ${(x.includes||[]).join(', ')}. ${['tax','freight','delivery','installation','waste'].map(k=>`${k}: ${x[k+'Included']?'included':'excluded'}`).join('; ')}. Selection deadline: ${x.selectionDeadline}. ${x.adjustment}`)});
 }
 return uniqueCustomerSections(sections);
}
/** Customer renderers (page, email, PDF). estimateSections already applies the single customer projection; rendered selling prices are not re-scrubbed. */
export const customerEstimateSections=(result:any):EstimateSection[]=>estimateSections(result);
export interface GroupedSections{glance?:EstimateSection;brief?:EstimateSection;categoriesIntro?:EstimateSection;included:EstimateSection[];categories:EstimateSection[];excluded:EstimateSection[];allowances:EstimateSection[];assumptions:EstimateSection[];info:EstimateSection[]}
/**
 * Reading order for every customer-facing output: what the project is, what
 * is included, what it costs by category, what is excluded, what is carried
 * as an allowance, what still needs confirming, then supporting notes.
 */
export function groupSections(sections:EstimateSection[]):GroupedSections{
 const grouped:GroupedSections={included:[],categories:[],excluded:[],allowances:[],assumptions:[],info:[]};
 for(const section of sections){
  const kind=section.kind||'info';
  if(kind==='glance'&&!grouped.glance)grouped.glance=section;
  else if(kind==='brief'&&!grouped.brief)grouped.brief=section;
  else if(section.title===SECTION_TITLES.categoriesIntro||section.title===SECTION_TITLES.requestedIntro)grouped.categoriesIntro=section;
  else if(kind==='included')grouped.included.push(section);
  else if(kind==='category')grouped.categories.push(section);
  else if(kind==='excluded')grouped.excluded.push(section);
  else if(kind==='allowance')grouped.allowances.push(section);
  else if(kind==='assumption')grouped.assumptions.push(section);
  else grouped.info.push(section);
 }
 return grouped;
}
/** Flat, ordered list for linear outputs such as the PDF and plain-text email. */
export function orderedSections(sections:EstimateSection[]):EstimateSection[]{
 const g=groupSections(sections);
 return [g.glance,g.brief,...g.included,g.categoriesIntro,...g.categories,...g.excluded,...g.allowances,...g.assumptions,...g.info].filter((s):s is EstimateSection=>Boolean(s));
}
export const KIND_LABEL:Record<SectionKind,string>={glance:'',brief:'',included:'Included',category:'Included',excluded:'Excluded',allowance:'Allowance',assumption:'To confirm',info:''};

/** Review-screen grouping for a scope field. */
export function fieldCategory(field:string):string{
 return overview.has(field)?"Project at a glance":FIELD_CATEGORY_TITLES[field]||"Additional scope details";
}
export interface CategoryLine {id:string;label:string;quantity:number;unit:string;quantityRange?:{low:number;high:number};low:number;high:number;unitLow?:number;unitHigh?:number;status:string;verification?:string;rateLocation?:string;rateDate?:string}
export interface CategoryBreakdown {category:string;low?:number;high?:number;tasks:string[];items:CategoryLine[]}
/** Structured category accordions for the customer result. Same data as estimateSections, without prose. */
/** customerSafe=false is for authenticated administrative views only: it skips the customer projection and keeps unit rates. */
export function categoryBreakdown(result:any,customerSafe=true,hideUnitRates=HIDE_CUSTOMER_UNIT_RATES):CategoryBreakdown[]{
  if(customerSafe)result=customerPresentation(result,{hideUnitRates});
 const lines:any[]=result?.lineItems||[],tasks:any[]=result?.scopeTasks||[];
 const categories=[...new Set<string>([...(result?.includedCategories||[]),...lines.map(x=>x.category),...tasks.map(x=>x.category||suggestedTrade(x.description))])];
 return categories.map(category=>{
  const range=result?.categoryRanges?.find((x:any)=>x.category===category);
  const items:CategoryLine[]=lines.filter(x=>x.category===category).map(x=>({id:String(x.id),label:lineLabel(x.description,[x.building&&!/^(main|default)$/i.test(x.building)?x.building:"",x.floor||""]),quantity:Number(x.quantity),unit:String(x.unit),...(x.quantityRange?{quantityRange:x.quantityRange}:{}),low:Number(x.low),high:Number(x.high),...(x.unitLow!=null&&x.unitHigh!=null?{unitLow:Number(x.unitLow),unitHigh:Number(x.unitHigh)}:{}),status:String(x.pricingStatus||"verified-cost"),...(x.verification?{verification:x.verification}:{}),...(x.rateLocation?{rateLocation:x.rateLocation}:{}),...(x.rateDate?{rateDate:String(x.rateDate).slice(0,10)}:{})}));
  return {category,...(range?{low:range.low,high:range.high}:{}),tasks:[...new Set<string>(tasks.filter(x=>(x.category||suggestedTrade(x.description))===category).map(x=>x.description))],items};
 });
}
