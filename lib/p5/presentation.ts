import {SCOPE_FIELDS} from './scope.ts';
import {suggestedTrade} from './trades.ts';
export type EstimateSection={title:string;text?:string;bullets?:string[];rows?:[string,string][]};
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
export const readable=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
// Preserve original wording, numbers and exclusions. Never split decimal values or URLs.
export const scopeBullets=(s:string)=>s.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.trim().replace(/^[•*]\s*/, '')).filter(Boolean);
const overview=new Set(['service','location','address','sqft','garageSqft','coveredOutdoorSqft','rooms','bathrooms','stories','schedule','urgency','complexity','finish']);
const categories:Record<string,string>={site:'Site & utilities',utilities:'Site & utilities',access:'Site & utilities',demolition:'Demolition',structural:'Structure',mechanical:'Heating & Cooling',plumbing:'Plumbing',electrical:'Electrical',appliances:'Appliances',permits:'Permits & design',engineering:'Permits & design',materials:'Materials & finishes',fixtures:'Fixtures & finishes',allowances:'Allowances & selections',exclusions:'Excluded work',ownerSupplied:'Owner responsibilities',alternates:'Alternates'};
function itemPriceText(item:any){
 const quantity=`${Number(item.quantity).toLocaleString('en-US')} ${item.unit}${item.quantityRange?` modeled allowance (${item.quantityRange.low.toLocaleString('en-US')} to ${item.quantityRange.high.toLocaleString('en-US')} ${item.unit} to verify)`:''}`;
 const total=`${money(item.low)} to ${money(item.high)} total`;
 // A one-package price is already its unit price. Avoid repeating it.
 if(item.quantity===1&&!item.quantityRange)return `${quantity} • ${total}`;
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
  const title=overview.has(key)?'Project at a glance':categories[key]||'Additional scope details';
  const rows=groups.get(title)||[];active=[definition.label,value];rows.push(active);groups.set(title,rows);
 }
 const sections:EstimateSection[]=[];
 if(groups.has('Project at a glance')){sections.push({title:'Project at a glance',rows:groups.get('Project at a glance')});groups.delete('Project at a glance');}
 if(original.join('\n').trim())sections.push({title:'Project brief',bullets:scopeBullets(original.join('\n'))});
 for(const [title,rows]of groups)sections.push({title,rows});return sections;
}
export function estimateSections(result:any):EstimateSection[]{
 const sections=summarySections(result.summary||'');
 const lines:any[]=result.lineItems||[], tasks:any[]=result.scopeTasks||[];
 const instructions=result.instructions;
 if(instructions){
  sections.unshift({title:'Requested estimating scope',bullets:[...instructions.inclusions.map((x:string)=>`Include: ${x}`),...instructions.exclusions.map((x:string)=>`Exclude: ${x}`),...instructions.responsibilities,...instructions.floors.map((x:string)=>`Floor: ${x}`),...instructions.buildings.map((x:string)=>`Building: ${x}`),...(instructions.laborOnly?['Labor only; materials are not charged.']:[]),...(instructions.materialsOnly?['Materials only; labor is not charged.']:[])]});
  if(instructions.questions.length)sections.push({title:'Scope questions requiring clarification',bullets:instructions.questions});
 }
 if(result.documentCoverage){const c=result.documentCoverage;sections.push({title:'Document review coverage',text:`${c.pages.filter((p:any)=>p.status==='read').length} of ${c.expectedPages} pages fully read. ${c.complete?'Every page has a completed review record.':'Analysis is incomplete; review the exceptions below.'}`,bullets:c.pages.filter((p:any)=>p.status!=='read').map((p:any)=>`${p.source}, page ${p.page}${p.sheet?` (${p.sheet})`:''}: ${p.status}. ${p.notes.join(' ')}`)});}
 const buildings=[...new Set<string>(lines.map(l=>l.building).filter(Boolean))];
 if(buildings.length)sections.push({title:'Separate building prices',rows:buildings.map(b=>[b,`${money(lines.filter(l=>l.building===b).reduce((n,l)=>n+l.low,0))} to ${money(lines.filter(l=>l.building===b).reduce((n,l)=>n+l.high,0))}`]),text:'Building totals are included in, not added to, the overall estimate.'});
 const estimated=lines.filter(l=>l.pricingStatus==='estimated-allowance');
 if(lines.some(l=>l.pricingStatus==='owner-planning-rate'))sections.push({title:'Pricing basis',text:'Owner planning rates provide the foundation for this preliminary range. They are not current supplier quotes; verify local availability, selections and trade pricing before a firm proposal.'});
 if(estimated.length)sections.push({title:'Included preliminary allowances',bullets:estimated.map(l=>`${[l.building,l.floor,l.description].filter(Boolean).join(' / ')}: ${money(l.low)} to ${money(l.high)} included. ${l.verification}${l.rateLocation?` Cost location: ${l.rateLocation}.`:''}${l.rateDate?` Researched: ${l.rateDate.slice(0,10)}.`:''}`)});
 if(result.verificationItems?.length)sections.push({title:'Items to verify before a firm proposal',bullets:[...new Set<string>(result.verificationItems)]});
 const categories=[...new Set<string>([...(result.includedCategories||[]),...lines.map(x=>x.category),...tasks.map(x=>x.category||suggestedTrade(x.description))])];
 const breakdown:EstimateSection[]=categories.map(category=>{
  const range=result.categoryRanges?.find((x:any)=>x.category===category);
  return {title:category,text:range?`${money(range.low)} to ${money(range.high)}`:undefined,
   bullets:[...new Set<string>(tasks.filter(x=>(x.category||suggestedTrade(x.description))===category).map(x=>x.description))],
   rows:lines.filter(x=>x.category===category).map(x=>[[x.building,x.floor?`Floor ${x.floor}`:'',x.description].filter(Boolean).join(' / '),itemPriceText(x)])};
 });
 if(breakdown.length){
  sections.splice(sections[0]?.title==='Project at a glance'?1:0,0,{title:result.range?'Included scope by category':'Requested scope by category',text:result.range?'Category and item ranges are parts of the overall range, not additional charges. Where several tasks share an assembly, its price is shown once.':'Scope details are organized below. Pricing coverage still requires review.'});
  for(const category of breakdown){const existing=sections.find(s=>s.title===category.title);if(existing){existing.text=category.text;existing.rows=[...(existing.rows||[]),...(category.rows||[])];existing.bullets=category.bullets;}else sections.push(category);}
 }
 for(const [title,key] of [['Allowances','allowances'],['Planning assumptions','assumptions'],['Exclusions','exclusions'],['Factors that may change the range','factors']]){
  const values=result[key]||[];if(!values.length)continue;
  sections.push({title,bullets:values.map((x:any)=>typeof x==='string'?x:`${x.description}${x.amount!=null?`: ${money(x.amount)} included`:': selection to confirm'}. Includes ${(x.includes||[]).join(', ')}. ${['tax','freight','delivery','installation','waste'].map(k=>`${k}: ${x[k+'Included']?'included':'excluded'}`).join('; ')}. Selection deadline: ${x.selectionDeadline}. ${x.adjustment}`)});
 }
 return sections;
}
