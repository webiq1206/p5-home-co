import type {ScopeAnswers,ScopeExtraction,ScopeField} from './scope.ts';

/** Recover explicit selections omitted by a reader. Never turn a product adjective,
 * brand default, ambiguous alternative or negated selection into a project fact. */
export function retainExplicitSelections(extraction:ScopeExtraction,text:string,previous:ScopeAnswers={}):ScopeExtraction {
 const clauses=text.split(/\n|;|\.(?:\s|$)/).filter(clause=>! /\b(?:not|no|without|exclude\w*|unsure|undecided|maybe|either|perhaps|considering)\b|\?/i.test(clause));
 const facts=[...extraction.facts];
 const add=(field:ScopeField,value:string,evidence:string)=>{
  if(previous[field]?.trim()||facts.some(f=>f.field===field)||extraction.conflicts.some(c=>c.field===field))return;
  facts.push({field,value,evidence:evidence.slice(0,200),source:'Typed scope',basis:'stated',confidence:1});
 };
 const tiers:[RegExp,string][]=[
  [/\b(?:standard|builder[ -]grade|mid[ -]range)(?:\s+builder[ -]grade)?(?:\s+new)?\s+(?:finishes|materials|finish level)\b/ig,'mid-range'],
  [/\b(?:premium|high[ -]end|upgraded)\s+(?:finishes|materials|finish level)\b/ig,'high-end'],
  [/\b(?:luxury|custom luxury|top[ -]tier)\s+(?:finishes|materials|finish level)\b/ig,'luxury'],
 ];
 const selected=tiers.flatMap(([pattern,value])=>clauses.flatMap(clause=>Array.from(clause.matchAll(pattern),match=>({value,evidence:match[0]}))));
 if(new Set(selected.map(s=>s.value)).size===1)add('finish',selected[0].value,selected[0].evidence);
 // A measured trim installation is already a repair task. Do not ask the visitor
 // to choose among repair, inspection, rush or change-order when none is in doubt.
 const trim=clauses.find(clause=>/\b(?:install|replace|repair)(?:\s+and\s+paint)?\s+\d+(?:\.\d+)?\s+(?:linear feet|lf)\s+of\s+(?:owner[ -]supplied\s+)?(?:\d+(?:\.\d+)?[ -]inch\s+)?(?:(?:primed|painted|MDF|wood|PVC)\s+){0,3}(?:baseboard(?:\s+trim)?|trim)\b/i.test(clause));
 if(trim&&!/\b(?:new[ -]build|new home|new construction|remodel|renovat\w*|addition|adu|inspection|re[ -]?10|change order|rush|emergency)\b/i.test(text))add('service','handyman',trim.trim());
 return facts.length===extraction.facts.length?extraction:{...extraction,facts};
}
