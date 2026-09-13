import type {ScopeAnswers,ScopeConflict,ScopeExtraction,ScopeField} from './scope.ts';

/** Quantities belong to saved fields, so an answer never needs a second AI pass. */
export function cabinetQuestionField(text:string):ScopeField|undefined{
 if(!/\bcabinet\w*\b/i.test(text))return;
 if(/\b(?:lengths?|measurements?|dimensions?|linear|LF)\b/i.test(text)){
  if(/\b(?:base|lower)\b/i.test(text))return 'cabinetBaseLf';
  if(/\b(?:upper|wall)\b/i.test(text))return 'cabinetUpperLf';
  if(/\btall\b/i.test(text))return 'cabinetTallLf';
 }
 if(/\brooms?\b/i.test(text))return 'cabinetRoom';
}

/** Separate independent requests without splitting a list of answer choices. */
export function atomicInstructionQuestions(text:string,answers:ScopeAnswers={},conflicts:ScopeConflict[]=[]):string[]{
 if(/\bcabinet\w*\s+(?:lengths?|measurements?|dimensions?)\b/i.test(text)&&!/\b(?:base|lower|upper|wall|tall)\b/i.test(text))text=text.replace(/\bcabinet\w*\s+(?:lengths?|measurements?|dimensions?)\b/i,'base cabinet linear feet, upper cabinet linear feet, tall cabinet linear feet');
 const topics:{pattern:RegExp;question:string;field?:ScopeField}[]=[
  {pattern:/\bbase\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of base cabinets are included?',field:'cabinetBaseLf'},
  {pattern:/\b(?:upper|wall)\s+cabinet\w*\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of wall cabinets are included?',field:'cabinetUpperLf'},
  {pattern:/\btall\s+cabinet\w*\b.{0,30}\b(?:linear\s+(?:footage|feet)|length|LF)\b/i,question:'How many linear feet of tall cabinets are included?',field:'cabinetTallLf'},
  {pattern:/\broom(?:\(s\)|s)?\b/i,question:'Which rooms are the cabinets for?',field:'cabinetRoom'},
  {pattern:/\b(?:chosen|choose|select(?:ed)?|option|material)\b[\s\S]*\b(?:bench\s*top|counter\s*top)\b|\b(?:bench\s*top|counter\s*top)\b[\s\S]*\b(?:option|material|selection)\b/i,question:'Which bench top option would you like?'},
 ];
 const found=topics.filter(topic=>topic.pattern.test(text));
 if(found.length<2||!/\bcabinet\w*\b/i.test(text))return [text];
 return found.filter(topic=>!topic.field||!answers[topic.field]?.trim()||conflicts.some(c=>c.field===topic.field)).map(topic=>topic.question);
}
/** Only offer material names actually present in the retained scope. */
export function textBenchTopChoices(extraction:ScopeExtraction|null,question:string):string[]|undefined{
 if(!extraction||!/\b(?:bench[- ]?top|counter[- ]?top)\b/i.test(question))return;
 const rows=extraction.takeoffs||[];
 if(rows.length){
  const alternatives=rows.filter(item=>('alternativeGroup' in item&&item.alternativeGroup)||/\b(?:alternate|alternative|option|selection required)\b/i.test([item.description,...item.issues].join(' ')));
  if(!alternatives.length||alternatives.some(item=>!/\b(?:bench\s*top|counter\s*top|work\s*top)\b/i.test(item.description+' '+item.component)))return;
 }
 const choices=[
  {label:'Butcher block',pattern:/\bbutcher\s+block\b/i},
  {label:'Matching painted MDF/wood',pattern:/\b(?:matching\s+)?painted\s+(?:mdf(?:\s*\/\s*wood)?|wood(?:\s*\/\s*mdf)?)\b/i},
  {label:'Laminate',pattern:/\blaminate\b/i},
  {label:'Quartz',pattern:/\bquartz\b/i},
 ];
 const retained=JSON.stringify([extraction.summary,extraction.facts,extraction.instructions,extraction.takeoffs,question]);
 const excluded=(extraction.instructions?.exclusions||[]).join('\n');
 const values=choices.filter(choice=>choice.pattern.test(retained)&&!choice.pattern.test(excluded)).map(choice=>choice.label);
 return values.length>=2?values:undefined;
}
