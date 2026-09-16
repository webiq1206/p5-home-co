import type {ScopeExtraction} from './scope.ts';

const completedCabinets=/(?:^|[.!;\n]\s*)(?:The\s+)?(?:existing|old)\s+(?:(?:kitchen|bathroom|base|upper)\s+)?cabinets?\s+(?:(?:are|were|have been|has been)\s+(?:already\s+)?|already\s+)removed\s*(?=[.!;\n]|$)/i;
const cabinetRemoval=/\b(?:remov(?:al of|es?|ed|ing)|demolition of)\s+(?:the\s+)?(?:existing|old)\s+(?:(?:kitchen|bathroom|base|upper)\s+)?cabinets?\b/gi;
/** An explicit completed task cannot become newly included work. Preserve
 * all other demolition and the verbatim source as independent evidence. */
export function retainCompletedCabinetRemoval(extraction:ScopeExtraction,sourceText:string):ScopeExtraction{
 const evidence=sourceText.match(completedCabinets)?.[0];if(!evidence)return extraction;
 const note='Existing cabinet removal is already complete and excluded from this estimate.';
 const correct=(text:string)=>text.split(/(?<=[.;!?])\s+|\n+/).map(clause=>
  /\b(?:no|not|without|exclud\w*|already|completed?)\b/i.test(clause)?clause:clause.replace(cabinetRemoval,'existing cabinet removal already completed')
 ).join(' ');
 const fields=new Set(['installation','demolition','taskList']);
 const facts=extraction.facts.map(fact=>fields.has(fact.field)?{...fact,value:correct(fact.value)}:fact);
 if(!facts.some(fact=>fact.field==='exclusions'&&fact.value.includes(note)))facts.push({field:'exclusions',value:note,confidence:1,basis:'stated',source:'Supplied scope',evidence});
 const instructions=extraction.instructions;
 return {...extraction,summary:correct(extraction.summary),facts,...(instructions?{instructions:{...instructions,
  inclusions:instructions.inclusions.map(correct),responsibilities:instructions.responsibilities.map(correct),
  exclusions:[...new Set([...instructions.exclusions,note])],
 }}:{})};
}
