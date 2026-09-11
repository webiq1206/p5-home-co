import {SCOPE_FIELDS} from './scope.ts';
import {suggestedTrade} from './trades.ts';
export type EstimateSection={title:string;text?:string;bullets?:string[];rows?:[string,string][]};
export const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
export const readable=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
// Preserve original wording, numbers and exclusions. Never split decimal values or URLs.
export const scopeBullets=(s:string)=>s.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.trim().replace(/^[•*]\s*/, '')).filter(Boolean);
const overview=new Set(['service','location','address','sqft','garageSqft','coveredOutdoorSqft','rooms','bathrooms','stories','schedule','urgency','complexity','finish']);
const categories:Record<string,string>={site:'Site & utilities',utilities:'Site & utilities',access:'Site & utilities',demolition:'Demolition',structural:'Structure',mechanical:'Heating & Cooling',plumbing:'Plumbing',electrical:'Electrical',appliances:'Appliances',permits:'Permits & design',engineering:'Permits & design',materials:'Materials & finishes',fixtures:'Fixtures & finishes',allowances:'Allowances & selections',exclusions:'Excluded work',ownerSupplied:'Owner responsibilities',alternates:'Alternates'};
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
 const categories=[...new Set<string>([...(result.includedCategories||[]),...lines.map(x=>x.category),...tasks.map(x=>x.category||suggestedTrade(x.description))])];
 const breakdown:EstimateSection[]=categories.map(category=>{
  const range=result.categoryRanges?.find((x:any)=>x.category===category);
  return {title:category,text:range?`${money(range.low)} to ${money(range.high)}`:undefined,
   bullets:[...new Set<string>(tasks.filter(x=>(x.category||suggestedTrade(x.description))===category).map(x=>x.description))],
   rows:lines.filter(x=>x.category===category).map(x=>[x.description,`${Number(x.quantity).toLocaleString('en-US')} ${x.unit} • ${money(x.low)} to ${money(x.high)} total • ${Number(x.unitLow).toLocaleString('en-US',{style:'currency',currency:'USD'})} to ${Number(x.unitHigh).toLocaleString('en-US',{style:'currency',currency:'USD'})} / ${x.unit}`])};
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
