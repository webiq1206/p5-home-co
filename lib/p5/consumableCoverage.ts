import {z} from 'zod';

type SupplyTask={id:string;description:string;evidence:string;researchDescription:string;existingLineIds:string[]};
export type PricedSupplyComponent={id:string;description:string;quantity:number;unit:string;unitCost:number;category?:string};
const words=z.string().trim().min(1).max(4000);
export const consumableCoverageSchema=z.object({tasks:z.array(z.object({
 id:words,
 covered:z.array(z.object({lineId:words,excerpt:words,reason:words}).strict()),
 remaining:z.array(z.object({material:words,application:words,operationTaskId:words,operationEvidence:words,quantityEvidence:words}).strict()),
}).strict())}).strict();

const normalized=(text:string)=>text.toLowerCase().replace(/\s+/g,' ').trim();
const namedProducts=(text:string)=>['screw','nail','fastener','shim','caulk','adhesive','sealant','thinset','grout'].filter(word=>new RegExp('\\b'+word+'s?\\b','i').test(text));
const productPresent=(word:string,text:string)=>new RegExp('\\b'+(word==='adhesive'?'(?:adhesive|thinset|mortar)':word==='fastener'?'(?:fastener|screw|nail)':word==='sealant'?'(?:sealant|silicone|caulk)':word)+'s?\\b','i').test(text);

/** A scope check may narrow a purchase, but cannot invent a price or erase a
 * named supply without citing real positive coverage. Original task evidence
 * remains intact for the subsequent independent whole-scope audit. Invalid
 * decisions leave the original gap unchanged in the caller. */
export function applyConsumableCoverage<T extends SupplyTask>(raw:unknown,gaps:T[],operations:SupplyTask[],priced:PricedSupplyComponent[]):T[]{
 const plan=consumableCoverageSchema.parse(raw);
 if(plan.tasks.length!==gaps.length||new Set(plan.tasks.map(t=>t.id)).size!==gaps.length||plan.tasks.some(t=>!gaps.some(g=>g.id===t.id)))throw new Error('Incomplete consumable coverage plan');
 const updates=plan.tasks.map(decision=>{
  const task=gaps.find(g=>g.id===decision.id)!;
  if(!decision.covered.length&&!decision.remaining.length)throw new Error('Consumable task has no coverage or remaining material');
  for(const claim of decision.covered){
   const line=priced.find(line=>line.id===claim.lineId&&line.quantity>0&&line.unitCost>0);
   if(!line||!normalized(line.description).includes(normalized(claim.excerpt))||claim.excerpt.length<12
    ||!(line.category==='materials'||line.category==='subcontractors'||/\b(?:consumables?|materials?) included\b/i.test(line.description)))throw new Error('Unsupported consumable coverage reference');
   // Quoting an exclusion is not affirmative inclusion.
   if(/\b(?:exclud\w*|not included|labor only|labour only)\b/i.test(claim.excerpt))throw new Error('Consumable coverage cites an exclusion');
  }
  for(const item of decision.remaining){
   const operation=operations.find(t=>t.id===item.operationTaskId&&t.id!==task.id);
   if(!operation||!normalized(operation.description+' '+operation.evidence).includes(normalized(item.operationEvidence))||item.operationEvidence.length<12)throw new Error('Uncovered material has no grounded operation');
   // Installation tools cannot masquerade as job consumables. A separate
   // explicitly requested tool purchase keeps its own ordinary pricing task.
   if(/\b(?:grout (?:application )?bag|trowel|drill|saw|caulk(?:ing)? gun)\b/i.test(item.material))throw new Error('Reusable tool is not an installation consumable');
  }
  const accounted=decision.covered.map(c=>c.excerpt).concat(decision.remaining.map(c=>c.material)).join(' ');
  const explicit=namedProducts((task.researchDescription||task.description).split(/[.;]\s+/)[0]);
  if(explicit.some(word=>!productPresent(word,accounted)))throw new Error('Named consumable disappeared from the coverage plan');
  const ids=[...new Set([...task.existingLineIds,...decision.covered.map(c=>c.lineId)])];
  return {task,ids,remaining:decision.remaining};
 });
 // Validate the whole response before changing any parent coverage.
 const result:T[]=[];
 for(const {task,ids,remaining} of updates){
  task.existingLineIds=ids;
  if(!remaining.length){task.researchDescription='';continue;}
  task.researchDescription='Material purchase only: '+remaining.map(item=>item.material).join(', ')+'. '+remaining.map(item=>item.application+'; '+item.quantityEvidence).join(' ');
  for(const item of remaining)result.push({...task,existingLineIds:ids,
   description:'Supply contractor installation '+item.material,
   researchDescription:`Material purchase only: ${item.material}. Uncovered application: ${item.application}. Quantity basis: ${item.quantityEvidence}. Do not substitute another product or buy any already-priced components.`,
   evidence:task.evidence+'\nUncovered operation: '+item.operationEvidence,
  });
 }
 return result;
}
