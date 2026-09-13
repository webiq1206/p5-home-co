import type {ExtractedFact,ScopeAnswers,ScopeConflict,ScopeExtraction,ScopeField} from './scope.ts';
import type {ScopeInstructions} from './instructions.ts';
import type {DocumentCoverage,Takeoff} from './documentLedger.ts';

/**
 * A retained-document choice is deliberately kept separate from the
 * InstructionPrompt string.  The prompt is UI data; these records are the
 * source-backed values used when a reply is applied without reading a PDF
 * again.
 */
export interface RetainedChoice {
  option:number;
  key:'butcher-block'|'matching-painted-mdf-wood'|'laminate'|'quartz';
  label:string;
  laborHours:number;
  evidence:string[];
  sources:string[];
}

export interface RetainedChoiceQuestion {
  kind:'cabinet-bench-top';
  question:string;
  choices:RetainedChoice[];
}

export interface RetainedClarificationSelection {
  option:number;
  key:RetainedChoice['key'];
  label:string;
  laborHours:number;
}

export interface RetainedClarificationHistory {
  version:'p5-retained-clarification-v1';
  question:string;
  answer:string;
  selected:RetainedClarificationSelection;
  excluded:RetainedChoice[];
  source:{
    choices:RetainedChoice[];
    facts:ExtractedFact[];
    conflicts:ScopeConflict[];
    missingInformation:string[];
    reviewNotes:string[];
    takeoffs:Takeoff[];
    instructions:ScopeInstructions|null;
    documentCoverage:DocumentCoverage|null;
  };
  applied:{
    laborHours?:number;
    cabinetUnits?:number;
    knobsOrPulls?:number;
  };
}

export interface RetainedClarificationProvenance {
  version:'p5-retained-clarification-v1';
  clarifications:RetainedClarificationHistory[];
}

export interface RetainedLaborCoverage {
  totalHours:number;
  components:{id:string;description:string;hours:number}[];
  nonAdditiveSummary:true;
  basis:'retained-document-clarification';
}

export type RetainedExtraction = ScopeExtraction & {
  clarificationProvenance?:RetainedClarificationProvenance;
  /** Alias used by older draft readers; both keys intentionally carry the
   * same source-only overlay and neither is used as active priced scope. */
  sourceHistory?:RetainedClarificationProvenance;
  /** Active ledger coverage metadata. Components are additive; totalHours is
   * an audit summary and must not be priced as another line. */
  laborCoverage?:RetainedLaborCoverage;
};

type EvidenceRow={text:string;source:string};

const CHOICE_SPECS:readonly {
  key:RetainedChoice['key'];
  label:string;
  pattern:RegExp;
}[]=[
  {key:'butcher-block',label:'butcher block',pattern:/\bbutcher[\s-]+block\b/ig},
  {key:'matching-painted-mdf-wood',label:'matching painted MDF\/wood',pattern:/\bmatching\s+painted\s+(?:MDF\s*(?:\/|or)\s*wood|wood\s*(?:\/|or)\s*MDF)\b|\bpainted\s+(?:MDF\s*(?:\/|or)\s*wood|wood\s*(?:\/|or)\s*MDF)\b/ig},
  {key:'laminate',label:'laminate',pattern:/\blaminate\b/ig},
  {key:'quartz',label:'quartz',pattern:/\bquartz\b/ig},
];

const HOUR=/\+?\s*(\d+(?:\.\d+)?)\s*(?:labor\s*)?(?:h|hrs?\.?|hours?)\b/ig;

function addRow(rows:EvidenceRow[],text:unknown,source:string){
  if(typeof text==='string'&&text.trim())rows.push({text:text.trim(),source});
}

/** Text already retained by extraction.  No upload bytes or page is read here. */
export function retainedEvidenceRows(extraction:ScopeExtraction):EvidenceRow[]{
  const rows:EvidenceRow[]=[];
  addRow(rows,extraction.summary,'summary');
  for(const fact of extraction.facts||[]){
    addRow(rows,fact.value,fact.source);
    addRow(rows,fact.evidence,fact.source);
    addRow(rows,`${fact.value}; ${fact.evidence}`,fact.source);
  }
  // Labor aggregation keeps the component facts out of active canonical
  // facts, but retained-document clarification still needs those source rows
  // to recover component hours such as assembly and cabinet installation.
  const archivedLaborFacts=(extraction.sourceHistory as unknown as {laborFacts?:ExtractedFact[]}|undefined)?.laborFacts;
  for(const fact of archivedLaborFacts||[]){
    if(fact.field!=='laborHours')continue;
    addRow(rows,fact.value,`sourceHistory:${fact.source}`);
    addRow(rows,fact.evidence,`sourceHistory:${fact.source}`);
    addRow(rows,`${fact.value}; ${fact.evidence}`,`sourceHistory:${fact.source}`);
  }
  const instructions=extraction.instructions;
  if(instructions){
    // The pending question is not source evidence. Choices must be recovered
    // from retained facts, instructions, takeoffs or clarification rationale,
    // never invented from a question's wording.
    for(const field of ['inclusions','exclusions','responsibilities','buildings','floors'] as const)
      for(const value of instructions[field]||[])addRow(rows,value,`instructions.${field}`);
  }
  for(const item of extraction.takeoffs||[]){
    addRow(rows,item.description,`takeoff:${item.id}`);
    addRow(rows,item.evidence,`takeoff:${item.id}`);
    addRow(rows,`${item.description}; ${item.quantity===null?'':item.quantity} ${item.unit}; ${item.evidence}`,`takeoff:${item.id}`);
    for(const issue of item.issues||[])addRow(rows,issue,`takeoff:${item.id}`);
  }
  for(const clarification of extraction.clarifications||[]){
    addRow(rows,clarification.reason,`clarification:${clarification.field}`);
  }
  return rows;
}

function nearbyHours(text:string,start:number,end:number):number|undefined{
  const from=Math.max(0,start-120),to=Math.min(text.length,end+120);
  const nearby=text.slice(from,to);
  const matches=[...nearby.matchAll(HOUR)];
  if(!matches.length)return;
  const center=(start+end)/2-from;
  const nearest=matches
    .map(match=>({value:Number(match[1]),distance:Math.abs((match.index||0)-center)}))
    .filter(match=>Number.isFinite(match.value))
    .sort((a,b)=>a.distance-b.distance)[0];
  return nearest?.value;
}

function nearbyOption(text:string,start:number):number|undefined{
  const before=text.slice(Math.max(0,start-80),start);
  const match=before.match(/(?:option|choice)\s*#?\s*([1-9]\d*)\s*[:.)-]?\s*$/i);
  return match?Number(match[1]):undefined;
}

function choiceByKey(choices:RetainedChoice[],key:RetainedChoice['key']){return choices.find(choice=>choice.key===key);}

/**
 * Find the four cabinet-top alternatives in the retained extraction.  A
 * material name alone is not enough: each selected value must have a
 * retained labor-hour increment beside it.  This prevents the clarification
 * layer from inventing prices or options from the question wording.
 */
export function retainedBenchTopChoices(extraction:ScopeExtraction):RetainedChoice[]{
  const rows=retainedEvidenceRows(extraction);
  const found=new Map<RetainedChoice['key'],RetainedChoice>();
  for(const row of rows){
    for(const spec of CHOICE_SPECS){
      spec.pattern.lastIndex=0;
      const matches=[...row.text.matchAll(spec.pattern)];
      for(const match of matches){
        const start=match.index||0,end=start+match[0].length;
        const hours=nearbyHours(row.text,start,end);
        if(hours===undefined)continue;
        const prior=found.get(spec.key);
        const explicitOption=nearbyOption(row.text,start);
        if(prior&&prior.laborHours!==hours){
          // A contradictory retained document is not a safe deterministic
          // choice. Keep its evidence visible in history, but omit it from
          // the actionable choice list.
          found.delete(spec.key);
          continue;
        }
        const evidence=row.text.slice(Math.max(0,start-90),Math.min(row.text.length,end+90)).trim();
        if(!prior)found.set(spec.key,{option:explicitOption||0,key:spec.key,label:spec.label,laborHours:hours,evidence:[evidence],sources:[row.source]});
        else{
          if(evidence&&!prior.evidence.includes(evidence))prior.evidence.push(evidence);
          if(!prior.sources.includes(row.source))prior.sources.push(row.source);
          if(explicitOption&&prior.option===0)prior.option=explicitOption;
        }
      }
    }
  }
  if(found.size!==CHOICE_SPECS.length)return[];
  const values=[...found.values()];
  const explicit=values.filter(value=>value.option>0);
  if(explicit.length&&new Set(explicit.map(value=>value.option)).size!==explicit.length)return[];
  // A document can list the alternatives without numbering them.  The
  // retained order is then the only supported ordering; this does not derive
  // a new choice or a new labor value.
  const ordered=values.sort((a,b)=>a.option-b.option||CHOICE_SPECS.findIndex(spec=>spec.key===a.key)-CHOICE_SPECS.findIndex(spec=>spec.key===b.key));
  ordered.forEach((choice,index)=>{if(!choice.option)choice.option=index+1;});
  if(new Set(ordered.map(choice=>choice.option)).size!==ordered.length)return[];
  const result=ordered.sort((a,b)=>a.option-b.option);
  return result.length===4?result:[];
}

export function isBenchTopClarificationQuestion(question:string){
  return /\bbench[\s-]*top\b/i.test(question)
    &&/\b(?:which|what|select|choose|option|choice)\b/i.test(question)
    &&/\b(?:include|included|estimate|estimated|use|used|want)\b/i.test(question);
}

export function retainedClarificationQuestion(extraction:ScopeExtraction|null,question:string):RetainedChoiceQuestion|null{
  if(!extraction||!isBenchTopClarificationQuestion(question))return null;
  const choices=retainedBenchTopChoices(extraction);
  return choices.length===4?{kind:'cabinet-bench-top',question,choices}:null;
}

function numberValue(value:string){
  const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,first:1,second:2,third:3,fourth:4};
  return /^\d+(?:\.\d+)?$/.test(value)?Number(value):words[value.toLowerCase()];
}

function occurrenceNegated(text:string,start:number,end:number){
  const before=text.slice(Math.max(0,start-90),start);
  const after=text.slice(end,Math.min(text.length,end+60));
  // Include/exclude lists commonly put "exclude" only before their first
  // item. Looking back through punctuation catches all following list items.
  const lastBoundary=Math.max(before.lastIndexOf('.'),before.lastIndexOf(';'),before.lastIndexOf('\n'));
  const clause=before.slice(lastBoundary+1);
  const negated=/(?:^|\b)(?:not|no|without|exclude(?:d|ing)?|omit(?:ted|ting)?|don't|do\s+not|never|rather\s+than|instead\s+of)\b/ig;
  const included=/(?:^|\b)(?:include|included|including|use|uses|choose|chooses|select|selected|want|keep|kept)\b/ig;
  const negationMatches=[...clause.matchAll(negated)];
  const inclusionMatches=[...clause.matchAll(included)]
    .filter(match=>!/\b(?:not|never|without|don't|do\s+not)\s*$/i.test(clause.slice(0,match.index||0)));
  const lastNegation=negationMatches.length?Math.max(...negationMatches.map(match=>match.index||0)):-1;
  const lastInclusion=inclusionMatches.length?Math.max(...inclusionMatches.map(match=>match.index||0)):-1;
  // A positive transition later in the same clause wins: "exclude quartz,
  // but include painted MDF/wood." This keeps a clear selection from being
  // mistaken for a negated list merely because the list shares punctuation.
  if(lastNegation>lastInclusion)return true;
  if(/^\s*(?:excluded|omitted)\b/i.test(after))return true;
  return false;
}

function answerOptionNumbers(answer:string){
  const numbers:number[]=[];
  const patterns=[
    /\b(?:option|choice)\s*#?\s*([1-9]\d*)\b/ig,
    /\b(first|second|third|fourth)\s+(?:option|choice)\b/ig,
  ];
  for(const pattern of patterns){
    for(const match of answer.matchAll(pattern)){
      const index=match.index||0;
      if(occurrenceNegated(answer,index,index+match[0].length))continue;
      const raw=match[1].toLowerCase();
      const number=numberValue(raw);
      if(number!==undefined)numbers.push(number);
    }
  }
  return [...new Set(numbers)];
}

function answerChoiceKeys(answer:string,choices:RetainedChoice[]){
  const keys:RetainedChoice['key'][]=[];
  for(const choice of choices){
    const spec=CHOICE_SPECS.find(item=>item.key===choice.key)!;
    spec.pattern.lastIndex=0;
    for(const match of answer.matchAll(spec.pattern)){
      const start=match.index||0;
      if(!occurrenceNegated(answer,start,start+match[0].length))keys.push(choice.key);
    }
  }
  return [...new Set(keys)];
}

function answerNegatedChoiceKeys(answer:string,choices:RetainedChoice[]){
  const keys:RetainedChoice['key'][]=[];
  for(const choice of choices){
    const spec=CHOICE_SPECS.find(item=>item.key===choice.key)!;
    spec.pattern.lastIndex=0;
    for(const match of answer.matchAll(spec.pattern)){
      const start=match.index||0;
      if(occurrenceNegated(answer,start,start+match[0].length))keys.push(choice.key);
    }
  }
  for(const match of answer.matchAll(/\b(?:option|choice)\s*#?\s*([1-9]\d*)\b/ig)){
    const start=match.index||0;
    if(!occurrenceNegated(answer,start,start+match[0].length))continue;
    const option=Number(match[1]);
    const choice=choices.find(value=>value.option===option);
    if(choice)keys.push(choice.key);
  }
  return [...new Set(keys)];
}

function sourceText(extraction:ScopeExtraction){return retainedEvidenceRows(extraction).map(row=>row.text).join('\n');}

function termHours(text:string,term:RegExp):number|undefined{
  term.lastIndex=0;
  const match=term.exec(text);
  if(!match)return;
  return nearbyHours(text,match.index,match.index+match[0].length);
}

function findTermHours(extraction:ScopeExtraction,terms:RegExp[]){
  const values:number[]=[];
  const evidence:string[]=[];
  for(const row of retainedEvidenceRows(extraction)){
    // A combined ledger row is an aggregate, not independent evidence that
    // assembly and installation each equal its total. It is split into
    // stable components after the retained answer confirms the components.
    if((row.source.startsWith('takeoff:')||/\b(?:combined|combines|aggregate|total)\b/i.test(row.text))&&/\bassembly\b/i.test(row.text)&&/\bcabinet\s+install(?:ation|ing)?\b/i.test(row.text))continue;
    for(const term of terms){
      const value=termHours(row.text,term);
      if(value!==undefined){
        values.push(value);
        evidence.push(row.text);
      }
    }
  }
  const unique=[...new Set(values)];
  return {value:unique.length===1?unique[0]:undefined,conflict:unique.length>1,evidence:[...new Set(evidence)]};
}

function quantityFromText(text:string,patterns:RegExp[]){
  for(const pattern of patterns){
    pattern.lastIndex=0;
    const match=pattern.exec(text);
    if(match){
      const value=numberValue(match[1]||match[2]||'');
      if(value!==undefined)return value;
    }
  }
  return;
}

function quantities(extraction:ScopeExtraction,answer:string){
  const answerCabinet=quantityFromText(answer,[
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|existing\s+)?(?:cabinet\s+)?units?\b/i,
    /\b(?:cabinet\s+units?|cabinets?)\s*(?:number|count|quantity)?\s*[:=]\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+cabinets?\b/i,
  ]);
  const answerHardware=quantityFromText(answer,[
    /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:cabinet\s+)?(?:knobs?(?:\s*\/\s*|\s+or\s+)?pulls?|pulls?)\b/i,
    /\b(?:knobs?|pulls?)\s*(?:number|count|quantity)?\s*[:=]\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  ]);
  const retained=sourceText(extraction);
  return {
    cabinetUnits:answerCabinet??quantityFromText(retained,[
      /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|existing\s+)?(?:cabinet\s+)?units?\b/i,
      /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+cabinets?\b/i,
    ]),
    knobsOrPulls:answerHardware??quantityFromText(retained,[
      /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:cabinet\s+)?(?:knobs?(?:\s*\/\s*|\s+or\s+)?pulls?|pulls?)\b/i,
    ]),
  };
}

function totalHoursFromAnswer(answer:string){
  const matches=[
    ...answer.matchAll(/(?:=\s*|(?:total|sum)\s*(?:of|:)?\s*)(\d+(?:\.\d+)?)\s*(?:labor\s*)?hours?\b/ig),
    ...answer.matchAll(/\b(\d+(?:\.\d+)?)\s+labor\s+hours?\b/ig),
  ];
  const values=[...new Set(matches.map(match=>Number(match[1])).filter(Number.isFinite))];
  return values.length===1?values[0]:undefined;
}

function cloneInstructions(instructions:ScopeInstructions|null):ScopeInstructions|null{
  return instructions?{
    ...instructions,
    inclusions:[...instructions.inclusions],
    exclusions:[...instructions.exclusions],
    responsibilities:[...instructions.responsibilities],
    buildings:[...instructions.buildings],
    floors:[...instructions.floors],
    questions:[...instructions.questions],
  }:null;
}

function cloneCoverage(coverage:DocumentCoverage|undefined):DocumentCoverage|null{
  return coverage?{...coverage,pages:coverage.pages.map(page=>({...page,notes:[...page.notes]}))}:null;
}

function cloneFact(fact:ExtractedFact):ExtractedFact{return {...fact};}
function cloneTakeoff(item:Takeoff):Takeoff{return {...item,sources:item.sources.map(source=>({...source})),supersedes:[...item.supersedes],issues:[...item.issues]};}

function phrase(value:string){return value.toLowerCase().replace(/\s+/g,' ').trim();}
function resolvedAlternativeMention(value:string){
  const choice=CHOICE_SPECS.some(spec=>{spec.pattern.lastIndex=0;return spec.pattern.test(value);});
  return choice&&(/\bbench[\s-]*top\b|\b(?:option|alternative|alternate)\b|\+\s*\d+(?:\.\d+)?\s*(?:h|hours?)\b/i.test(value));
}

function quantityClause(value:string){
  return /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|existing\s+)?(?:cabinet\s+)?units?\b|\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:cabinet\s+)?(?:knobs?(?:\s*\/\s*|\s+or\s+)?pulls?|pulls?)\b/i.test(value);
}

function optionMention(value:string){return resolvedAlternativeMention(value)||/\bbench[\s-]*top\b/i.test(value);}

function appendUnique(values:string[],items:string[]){
  for(const item of items)if(item.trim()&&!values.some(value=>phrase(value)===phrase(item)))values.push(item);
}

function questionKey(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}

function removeAnsweredQuestion(values:string[],question:string){
  const id=questionKey(question);
  return [...new Set(values.flatMap(value=>value.match(/[^?]+\??/g)||[])
    .map(part=>part.replace(/\s+/g,' ').trim())
    .filter(part=>part&&questionKey(part)!==id))];
}

function withoutAlternativeClauses(values:string[],choices:RetainedChoice[]){
  return values.flatMap(value=>value.split(/\r?\n|;/).map(part=>part.trim()).filter(Boolean))
    .filter(value=>!resolvedAlternativeMention(value)||/\b(?:exclude|excluded|omit|omitted|not|without)\b/i.test(value));
}

function updateText(existing:string|undefined,addition:string,choices:RetainedChoice[],removeQuantities=false){
  const base=(existing||'').split(/\r?\n|;/).map(line=>line.trim()).filter(Boolean);
  const retained=base.filter(line=>!optionMention(line)&&!(removeQuantities&&quantityClause(line)));
  if(!retained.some(line=>phrase(line)===phrase(addition)))retained.push(addition);
  return retained.join('\n');
}

function removeAlternativeText(existing:string|undefined){
  return (existing||'').split(/\r?\n|;/).map(line=>line.trim()).filter(Boolean)
    .filter(line=>!resolvedAlternativeMention(line)).join('\n');
}

function retainedFactValue(item:ExtractedFact){
  if(item.field==='exclusions')return item.value;
  if(item.field==='laborHours'&&(/\b(?:assembly|cabinet\s+install|bench[\s-]*top)\b/i.test(`${item.value} ${item.evidence}`)||resolvedAlternativeMention(`${item.value} ${item.evidence}`)))return;
  const chunks=item.value.split(/\r?\n|;/).map(value=>value.trim()).filter(Boolean);
  const retained=chunks.filter(chunk=>{
    const inBenchTopEvidence= /\bbench[\s-]*top\b/i.test(item.evidence)&&CHOICE_SPECS.some(spec=>{spec.pattern.lastIndex=0;return spec.pattern.test(chunk);});
    return !resolvedAlternativeMention(chunk)&&!inBenchTopEvidence&&!(quantityClause(chunk)&&['cabinetConstruction','taskList','otherDetails'].includes(item.field));
  });
  return retained.join('\n').trim()||undefined;
}

function unsupportedSourceCabinetBaseLength(fact:ExtractedFact){
  if(fact.field!=='cabinetBaseLf')return false;
  if(/\b(?:typed\s+(?:scope|clarification)|manual|visitor)\b/i.test(fact.source))return false;
  const text=`${fact.evidence} ${fact.value}`;
  const explicitlyBase=/\b(?:base|lower)\s+cabinet(?:s)?\b|\b(?:base|lower)[^.;\n]{0,50}\b(?:linear\s+feet?|lf)\b|\b(?:linear\s+feet?|lf)[^.;\n]{0,50}\b(?:base|lower)\b/i.test(text);
  if(explicitlyBase)return false;
  return /\bbench[\s-]*top\b|\bcounter[\s-]*top\b|\btop\s+(?:length|run|dimension)\b/i.test(text);
}

function sameNumericValue(a:string|undefined,b:string){
  return a!==undefined&&Number(a.replaceAll(',',''))===Number(b.replaceAll(',',''));
}

function resolvedSelectionBlocker(text:string,selected:RetainedChoice,laborConfirmed:boolean){
  if(/\b(?:dimension|length|width|depth|measure(?:ment)?|linear\s+feet?|sq\.?\s*ft|square\s+feet?)\b/i.test(text))return false;
  if(/\b(?:labor|hours?|assembly|cabinet\s+install(?:ation)?)\b/i.test(text)&&!laborConfirmed)return false;
  const hasChoice=CHOICE_SPECS.some(spec=>{spec.pattern.lastIndex=0;return spec.pattern.test(text);});
  const hasSelectionContext=/\bbench[\s-]*top\b|\bcounter[\s-]*top\b|\b(?:option|alternative|alternate)\b/i.test(text);
  const hasAlternative=/\b(?:conflict|conflicting|alternative|alternates?|different|multiple|choose|select|unresolved|unconfirmed|confirm|missing|must\s+decide|ambiguous)\b/i.test(text);
  if(hasSelectionContext&&hasAlternative&&(hasChoice||/\b(?:bench[\s-]*top|counter[\s-]*top)\b/i.test(text)))return true;
  return laborConfirmed&&/\b(?:labor|hours?|assembly|cabinet\s+install(?:ation)?)\b/i.test(text)&&hasAlternative&&(hasChoice||hasSelectionContext);
}

function fact(field:ScopeField,value:string,evidence:string,basis:'stated'|'calculated'='stated'):ExtractedFact{
  return {field,value,confidence:1,source:'typed clarification',evidence,basis};
}

function activeTakeoffs(items:Takeoff[],choices:RetainedChoice[],selected:RetainedChoice,totalHours:number|undefined,cabinetUnits:number|undefined,knobsOrPulls:number|undefined){
  const selectedPattern=CHOICE_SPECS.find(spec=>spec.key===selected.key)!.pattern;
  const takeoffText=(item:Takeoff)=>{
    const primary=`${item.description} ${item.component}`;
    const matches=(value:string)=>{
      const keys=CHOICE_SPECS.filter(spec=>{spec.pattern.lastIndex=0;return spec.pattern.test(value);});
      return keys.length===1;
    };
    // Evidence can quote the complete four-option schedule. Prefer the
    // physical takeoff label, and only fall back to evidence when it names
    // exactly one alternative.
    if(matches(primary))return primary;
    return matches(item.evidence)?`${primary} ${item.evidence}`:'';
  };
  return items
    .filter(item=>{
      const text=takeoffText(item);
      for(const choice of choices){
        if(choice.key===selected.key)continue;
        const pattern=CHOICE_SPECS.find(spec=>spec.key===choice.key)!.pattern;
        pattern.lastIndex=0;
        if(pattern.test(text))return false;
      }
      return true;
    })
    .map(item=>{
      const text=takeoffText(item);
      const quantityText=`${item.description} ${item.component} ${item.evidence}`;
      const descriptiveText=text||quantityText;
      if(totalHours!==undefined&&/\b(?:total\s+labor|labor\s+total)\b/i.test(descriptiveText))return null;
      selectedPattern.lastIndex=0;
      if(selectedPattern.test(text)&&totalHours!==undefined&&/\b(?:hr|hrs|hour|hours)\b/i.test(item.unit)){
        return {...item,quantity:selected.laborHours,basis:'stated' as const,evidence:`${item.evidence} Selected by typed clarification: ${selected.label} (${selected.laborHours} labor hours).`};
      }
      if(totalHours!==undefined&&/\b(?:assembly|cabinet\s+install)\b/i.test(descriptiveText)&&/\b(?:hr|hrs|hour|hours)\b/i.test(item.unit)){
        return {...item,quantity:totalHours,basis:'stated' as const,evidence:`${item.evidence} Updated by typed clarification: ${totalHours} labor hours.`};
      }
      if(cabinetUnits!==undefined&&/\b(?:cabinet\s+)?units?\b|\bcabinets?\b/i.test(quantityText)&&/\b(?:ea|each|unit)\b/i.test(item.unit)){
        return {...item,quantity:cabinetUnits,basis:'stated' as const,evidence:`${item.evidence} Updated by typed clarification: ${cabinetUnits} cabinet units.`};
      }
      if(knobsOrPulls!==undefined&&/\b(?:knobs?|pulls?)\b/i.test(quantityText)&&/\b(?:ea|each|unit)\b/i.test(item.unit)){
        return {...item,quantity:knobsOrPulls,basis:'stated' as const,evidence:`${item.evidence} Updated by typed clarification: ${knobsOrPulls} knobs/pulls.`};
      }
      return item;
    })
    .filter((item):item is Takeoff=>item!==null);
}

function sourceRefs(items:Takeoff[],extraction:ScopeExtraction):Takeoff['sources']{
  const fromTakeoffs=items.flatMap(item=>item.sources||[]);
  if(fromTakeoffs.length)return [...new Map(fromTakeoffs.map(source=>[JSON.stringify(source),source])).values()];
  return (extraction.documentCoverage?.pages||[]).map(page=>({source:page.source,page:page.page,sheet:page.sheet,revision:page.revision}));
}

function ensureLaborComponent(items:Takeoff[],id:string,description:string,component:string,hours:number,refs:Takeoff['sources'],evidence:string){
  const existing=items.find(item=>new RegExp(`\\b${component.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(`${item.description} ${item.component}`)||new RegExp(`\\b${description.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(item.description));
  if(existing){
    existing.quantity=hours;
    existing.basis='stated';
    existing.unit='HR';
    existing.evidence=`${existing.evidence} ${evidence}`;
    return existing.id;
  }
  if(!refs.length)return;
  items.push({id,description,building:'',floor:'',component,quantity:hours,unit:'HR',basis:'stated',evidence,sources:refs.map(ref=>({...ref})),supersedes:[],issues:[]});
  return id;
}

function splitCombinedLaborTakeoff(items:Takeoff[],assemblyHours:number|undefined,cabinetInstallHours:number|undefined){
  if(assemblyHours===undefined||cabinetInstallHours===undefined)return;
  const index=items.findIndex(item=>/\bassembly\b/i.test(`${item.description} ${item.component}`)&&/\bcabinet\s+install(?:ation|ing)?\b/i.test(`${item.description} ${item.component}`)&&/\b(?:hr|hrs|hour|hours)\b/i.test(item.unit));
  if(index<0)return;
  const combined=items[index];
  const base={...combined,sources:combined.sources.map(source=>({...source})),supersedes:[...combined.supersedes],issues:[...combined.issues],basis:'stated' as const};
  const used=new Set(items.map(item=>item.id));
  const assemblyId=used.has('assembly-labor')?`${combined.id}-assembly`:'assembly-labor';
  const installationId=used.has('cabinet-installation-labor')?`${combined.id}-cabinet-installation`:'cabinet-installation-labor';
  const assembly={...base,id:assemblyId,description:'Assembly',component:'assembly',quantity:assemblyHours,evidence:`${combined.evidence} Split from retained assembly and cabinet-installation labor row: ${assemblyHours} hours.`};
  const cabinetInstallation={...base,id:installationId,description:'Cabinet installation',component:'cabinet installation',quantity:cabinetInstallHours,evidence:`${combined.evidence} Split from retained assembly and cabinet-installation labor row: ${cabinetInstallHours} hours.`};
  const others=items.filter((_,itemIndex)=>itemIndex!==index);
  const hasAssembly=others.some(item=>/\bassembly\b/i.test(`${item.description} ${item.component}`)&&!/\bcabinet\s+install/i.test(`${item.description} ${item.component}`));
  const hasInstallation=others.some(item=>/\bcabinet\s+install(?:ation|ing)?\b/i.test(`${item.description} ${item.component}`));
  items.splice(index,1,...(hasAssembly?[]:[assembly]),...(hasInstallation?[]:[cabinetInstallation]));
}

function ensureSelectedTakeoff(items:Takeoff[],selected:RetainedChoice,refs:Takeoff['sources']){
  const pattern=CHOICE_SPECS.find(spec=>spec.key===selected.key)!.pattern;
  if(items.some(item=>{
    pattern.lastIndex=0;
    return pattern.test(`${item.description} ${item.component}`);
  })||!refs.length)return;
  items.push({id:`bench-top-${selected.key}`,description:`${selected.label} bench top fabrication/install`,building:'',floor:'',component:'bench top selected option',quantity:selected.laborHours,unit:'HR',basis:'stated',evidence:`Retained document option ${selected.option}: ${selected.label} (+${selected.laborHours} labor hours).`,sources:refs.map(ref=>({...ref})),supersedes:[],issues:[]});
}

function ensureQuantityTakeoff(items:Takeoff[],id:string,description:string,component:string,quantity:number,refs:Takeoff['sources'],evidence:string,term:RegExp){
  const existing=items.find(item=>term.test(`${item.description} ${item.component}`));
  term.lastIndex=0;
  if(existing){
    existing.quantity=quantity;
    existing.basis='stated';
    existing.evidence=`${existing.evidence} ${evidence}`;
    return;
  }
  if(!refs.length)return;
  items.push({id,description,building:'',floor:'',component,quantity,unit:'EA',basis:'stated',evidence,sources:refs.map(ref=>({...ref})),supersedes:[],issues:[]});
}

function overlayFor(extraction:ScopeExtraction,choices:RetainedChoice[],question:string,answer:string,selected:RetainedChoice,excluded:RetainedChoice[],applied:RetainedClarificationHistory['applied']):RetainedClarificationHistory{
  return {
    version:'p5-retained-clarification-v1',
    question,
    answer,
    selected:{option:selected.option,key:selected.key,label:selected.label,laborHours:selected.laborHours},
    excluded:excluded.map(choice=>({...choice,evidence:[...choice.evidence],sources:[...choice.sources]})),
    source:{
      choices:choices.map(choice=>({...choice,evidence:[...choice.evidence],sources:[...choice.sources]})),
      facts:(extraction.facts||[]).map(cloneFact),
      conflicts:(extraction.conflicts||[]).map(conflict=>({...conflict,values:[...conflict.values]})),
      missingInformation:[...(extraction.missingInformation||[])],
      reviewNotes:[...(extraction.reviewNotes||[])],
      takeoffs:(extraction.takeoffs||[]).map(cloneTakeoff),
      instructions:cloneInstructions(extraction.instructions||null),
      documentCoverage:cloneCoverage(extraction.documentCoverage),
    },
    applied,
  };
}

export type RetainedAnswerResult=
  | {status:'resolved';extraction:RetainedExtraction;answers:ScopeAnswers;history:RetainedClarificationHistory}
  | {status:'ambiguous';question:string};

function ambiguity(choices:RetainedChoice[],detail?:string):RetainedAnswerResult{
  const options=choices.map(choice=>`Option ${choice.option}: ${choice.label} (+${choice.laborHours}h)`).join('; ');
  return {status:'ambiguous',question:detail||`Please choose one bench top option: ${options}.`};
}

/**
 * Apply a retained-document cabinet-top decision locally.  This function
 * intentionally never invokes a provider and never replaces page records.
 */
export function applyRetainedBenchTopAnswer(extraction:ScopeExtraction,answers:ScopeAnswers,question:string,answer:string):RetainedAnswerResult{
  const retained=retainedClarificationQuestion(extraction,question);
  if(!retained)return {status:'ambiguous',question:'The retained document does not provide the bench top choices needed to answer this question.'};
  const optionNumbers=answerOptionNumbers(answer);
  const materialKeys=answerChoiceKeys(answer,retained.choices);
  const negatedKeys=answerNegatedChoiceKeys(answer,retained.choices);
  const selectedKeys=[...new Set([...optionNumbers.map(number=>retained.choices.find(choice=>choice.option===number)?.key).filter((key):key is RetainedChoice['key']=>Boolean(key)),...materialKeys])];
  if(selectedKeys.length!==1)return ambiguity(retained.choices);
  const selected=choiceByKey(retained.choices,selectedKeys[0]);
  if(!selected)return ambiguity(retained.choices);
  if(negatedKeys.includes(selected.key))return ambiguity(retained.choices,'Please choose one bench top option that is not excluded in the reply.');
  // An explicit option and material must agree. This rejects "Option 2 and
  // quartz" rather than silently trusting whichever token occurred first.
  if(optionNumbers.some(number=>retained.choices.find(choice=>choice.option===number)?.key!==selected.key))return ambiguity(retained.choices,'Please choose one bench top option; the option number and material in the reply do not match.');
  const source=sourceText(extraction);
  const assembly=findTermHours(extraction,[/\bassembly\b/i,/\bassembled\b/i]);
  const cabinetInstall=findTermHours(extraction,[/\bcabinet\s+install(?:ation|ing)?\b/i,/\binstall(?:ation|ing)?\s+(?:the\s+)?cabinet(?:s)?\b/i]);
  const answerAssembly=termHours(answer,/\bassembly\b/i);
  const answerCabinetInstall=termHours(answer,/\bcabinet\s+install(?:ation|ing)?\b/i);
  const baseValues=[assembly.value??answerAssembly,cabinetInstall.value??answerCabinetInstall];
  const hasBaseConflict=assembly.conflict||cabinetInstall.conflict
    ||(assembly.value!==undefined&&answerAssembly!==undefined&&assembly.value!==answerAssembly)
    ||(cabinetInstall.value!==undefined&&answerCabinetInstall!==undefined&&cabinetInstall.value!==answerCabinetInstall);
  if(hasBaseConflict)return ambiguity(retained.choices,'Please confirm the assembly and cabinet-installation labor hours for the selected bench top.');
  const calculatedTotal=baseValues.every(value=>value!==undefined)?(baseValues[0] as number)+(baseValues[1] as number)+selected.laborHours:undefined;
  const statedTotal=totalHoursFromAnswer(answer);
  if(calculatedTotal!==undefined&&statedTotal!==undefined&&calculatedTotal!==statedTotal)return ambiguity(retained.choices,'Please confirm the labor-hour total for the selected bench top.');
  const laborHours=calculatedTotal??statedTotal;
  const quantity=quantities(extraction,answer);
  const details=[
    quantity.cabinetUnits===undefined?'':`${quantity.cabinetUnits} cabinet units`,
    quantity.knobsOrPulls===undefined?'':`${quantity.knobsOrPulls} knobs/pulls`,
  ].filter(Boolean).join('; ');
  const selectedTop=`${selected.label} bench top`;
  const arithmetic=laborHours===undefined
    ?`${selectedTop} fabrication/install: ${selected.laborHours} labor hours.`
    :`Assembly ${baseValues[0]===undefined?'':`${baseValues[0]} `}hours + cabinet installation ${baseValues[1]===undefined?'':`${baseValues[1]} `}hours + selected ${selectedTop} fabrication/install ${selected.laborHours} hours = ${laborHours} labor hours.`;
  const selectionText=[details,selectedTop].filter(Boolean).join('; ');
  const exclusions=retained.choices.filter(choice=>choice.key!==selected.key);
  const excludedText=`Excluded bench top alternatives: ${exclusions.map(choice=>choice.label).join(', ')}.`;
  const originalFacts=(extraction.facts||[]).map(cloneFact);
  const unsupportedBaseFacts=originalFacts.filter(unsupportedSourceCabinetBaseLength);
  const nextAnswers:{[K in ScopeField]?:string}={...answers};
  for(const stale of unsupportedBaseFacts){
    // A matching stale auto-derived answer is invalidated. A different value
    // is an explicit correction/resolution and must remain authoritative.
    if(nextAnswers.cabinetBaseLf===undefined||sameNumericValue(nextAnswers.cabinetBaseLf,stale.value))delete nextAnswers.cabinetBaseLf;
  }
  const facts=originalFacts.flatMap(item=>{
    if(unsupportedBaseFacts.includes(item)&&answers.cabinetBaseLf===undefined)return [];
    if(unsupportedBaseFacts.includes(item)&&sameNumericValue(answers.cabinetBaseLf,item.value))return [];
    const value=retainedFactValue(item);
    return value&&value!==item.value?[{...item,value}]:value?[item]:[];
  });
  facts.push(fact('materials',selectedTop,`Selected from retained document option ${selected.option}: ${selected.label} (+${selected.laborHours}h).`));
  facts.push(fact('cabinetConstruction',selectionText,`Typed clarification selects option ${selected.option}; retained source lists ${selectionText||selectedTop}.`));
  const activeEvidence=[selectionText,arithmetic].filter(Boolean).join('; ');
  facts.push(fact('taskList',[selectionText,arithmetic].filter(Boolean).join('; '),activeEvidence));
  facts.push(fact('installation',arithmetic,activeEvidence));
  if(laborHours!==undefined)facts.push(fact('laborHours',String(laborHours),arithmetic,'calculated'));
  facts.push(fact('exclusions',excludedText,`Typed clarification excludes the unselected retained alternatives: ${exclusions.map(choice=>choice.label).join(', ')}.`));
  const nextInstructions=cloneInstructions(extraction.instructions||null);
  if(nextInstructions){
    nextInstructions.inclusions=withoutAlternativeClauses(nextInstructions.inclusions,retained.choices);
    appendUnique(nextInstructions.inclusions,[selectedTop,...details? [details]:[], ...(baseValues.some(value=>value!==undefined)?['Assembly and cabinet installation']:[])]);
    nextInstructions.exclusions=withoutAlternativeClauses(nextInstructions.exclusions,retained.choices);
    appendUnique(nextInstructions.exclusions,[...exclusions.map(choice=>`${choice.label} bench top alternative`),excludedText]);
    appendUnique(nextInstructions.responsibilities,[arithmetic]);
    nextInstructions.questions=removeAnsweredQuestion(nextInstructions.questions,question);
  }
  nextAnswers.materials=updateText(nextAnswers.materials,selectedTop,retained.choices);
  nextAnswers.cabinetConstruction=updateText(nextAnswers.cabinetConstruction,selectionText||selectedTop,retained.choices,true);
  nextAnswers.taskList=updateText(nextAnswers.taskList,[selectionText,arithmetic].filter(Boolean).join('; '),retained.choices,true);
  nextAnswers.installation=updateText(nextAnswers.installation,arithmetic,retained.choices);
  if(nextAnswers.otherDetails!==undefined)nextAnswers.otherDetails=removeAlternativeText(nextAnswers.otherDetails);
  nextAnswers.exclusions=updateText(nextAnswers.exclusions,excludedText,retained.choices);
  if(nextAnswers.alternates!==undefined)nextAnswers.alternates=removeAlternativeText(nextAnswers.alternates);
  if(laborHours!==undefined)nextAnswers.laborHours=String(laborHours);
  const originalTakeoffs=(extraction.takeoffs||[]).map(cloneTakeoff);
  const nextTakeoffs=activeTakeoffs(originalTakeoffs,retained.choices,selected,laborHours,quantity.cabinetUnits,quantity.knobsOrPulls);
  const refs=sourceRefs(originalTakeoffs,extraction);
  splitCombinedLaborTakeoff(nextTakeoffs,baseValues[0],baseValues[1]);
  ensureSelectedTakeoff(nextTakeoffs,selected,refs);
  if(baseValues[0]!==undefined)ensureLaborComponent(nextTakeoffs,'assembly-labor','Assembly','assembly',baseValues[0],refs,`Retained document assembly labor: ${baseValues[0]} hours.`);
  if(baseValues[1]!==undefined)ensureLaborComponent(nextTakeoffs,'cabinet-installation-labor','Cabinet installation','cabinet installation',baseValues[1],refs,`Retained document cabinet installation labor: ${baseValues[1]} hours.`);
  if(quantity.cabinetUnits!==undefined)ensureQuantityTakeoff(nextTakeoffs,'cabinet-units','Cabinet units','cabinet units',quantity.cabinetUnits,refs,`Typed clarification: ${quantity.cabinetUnits} cabinet units.`,/\bcabinet\s+units?\b|\bcabinets?\b/i);
  if(quantity.knobsOrPulls!==undefined)ensureQuantityTakeoff(nextTakeoffs,'cabinet-hardware','Knobs/pulls','cabinet hardware',quantity.knobsOrPulls,refs,`Typed clarification: ${quantity.knobsOrPulls} knobs/pulls.`,/\bknobs?|pulls?\b/i);
  const selectedPattern=CHOICE_SPECS.find(spec=>spec.key===selected.key)!.pattern;
  const selectedTakeoff=nextTakeoffs.find(item=>{
    selectedPattern.lastIndex=0;
    return selectedPattern.test(`${item.description} ${item.component}`);
  });
  const assemblyTakeoff=nextTakeoffs.find(item=>/\bassembly\b/i.test(`${item.description} ${item.component}`)&&!/\bcabinet\s+install/i.test(`${item.description} ${item.component}`));
  const installationTakeoff=nextTakeoffs.find(item=>/\bcabinet\s+install(?:ation|ing)?\b/i.test(`${item.description} ${item.component}`));
  const laborConfirmed=calculatedTotal!==undefined&&laborHours===calculatedTotal;
  const blockerResolved=(text:string)=>resolvedSelectionBlocker(text,selected,laborConfirmed);
  const activeConflicts=(extraction.conflicts||[]).filter(conflict=>!blockerResolved(`${conflict.field}: ${conflict.values.join('; ')}. ${conflict.explanation}`));
  const activeReviewNotes=(extraction.reviewNotes||[]).filter(note=>!blockerResolved(note));
  const activeMissingInformation=(extraction.missingInformation||[]).filter(note=>!blockerResolved(note));
  const cleanedTakeoffs=nextTakeoffs.map(item=>({
    ...item,
    issues:(item.issues||[]).filter(issue=>!blockerResolved(`${item.description} ${item.component} ${issue}`)),
  }));
  const applied={...(laborHours===undefined?{}:{laborHours}),...(quantity.cabinetUnits===undefined?{}:{cabinetUnits:quantity.cabinetUnits}),...(quantity.knobsOrPulls===undefined?{}:{knobsOrPulls:quantity.knobsOrPulls})};
  const history=overlayFor(extraction,retained.choices,question,answer,selected,exclusions,applied);
  const prior=(extraction as RetainedExtraction).clarificationProvenance;
  const provenance:RetainedClarificationProvenance={version:'p5-retained-clarification-v1',clarifications:[...(prior?.clarifications||[]),history]};
  const updated:RetainedExtraction={
    ...extraction,
    facts,
    conflicts:activeConflicts,
    reviewNotes:activeReviewNotes,
    missingInformation:activeMissingInformation,
    ...(nextInstructions?{instructions:nextInstructions}:{}),
    ...(extraction.takeoffs?{takeoffs:cleanedTakeoffs}:{}),
    ...(baseValues.every(value=>value!==undefined)&&laborHours!==undefined?{laborCoverage:{totalHours:laborHours,components:[{id:assemblyTakeoff?.id||'assembly-labor',description:'Assembly',hours:baseValues[0] as number},{id:installationTakeoff?.id||'cabinet-installation-labor',description:'Cabinet installation',hours:baseValues[1] as number},{id:selectedTakeoff?.id||`bench-top-${selected.key}`,description:`${selected.label} bench top fabrication/install`,hours:selected.laborHours}],nonAdditiveSummary:true,basis:'retained-document-clarification'}}:{}),
    clarificationProvenance:provenance,
    sourceHistory:provenance,
  };
  return {status:'resolved',extraction:updated,answers:nextAnswers,history};
}

export function retainedChoiceValue(choice:RetainedChoice){return `Option ${choice.option}: ${choice.label} (+${choice.laborHours}h)`;}

/**
 * Provider clarification runs have no document bytes. If a provider returns a
 * revised takeoff, merge it by stable id while retaining the original source
 * references/evidence. When it returns only revised structured facts, update
 * the directly corresponding active quantity instead of leaving a
 * contradicted old quantity in the billable ledger forever.
 */
export function reconcileClarificationTakeoffs(previous:Takeoff[]|undefined,returned:Takeoff[]|undefined,changedFacts:ExtractedFact[]):Takeoff[]|undefined{
  if(!previous?.length&&!returned?.length)return previous||returned;
  const clone=(item:Takeoff)=>cloneTakeoff(item);
  if(returned?.length){
    const updates=new Map(returned.map(item=>[item.id,item]));
    const merged=previous?previous.map(item=>{
      const next=updates.get(item.id);
      if(!next)return clone(item);
      const sources=[...new Map([...item.sources,...next.sources].map(source=>[JSON.stringify(source),source])).values()];
      const evidence=next.quantity!==item.quantity
        ?`${next.evidence} Retained prior source evidence: ${item.evidence}.`
        :next.evidence;
      updates.delete(item.id);
      return {...clone(next),sources,evidence};
    }):[];
    merged.push(...[...updates.values()].map(clone));
    return merged;
  }
  const merged=(previous||[]).map(clone);
  for(const fact of changedFacts){
    const value=fact.value;
    const quantities=[
      {match:value.match(/\b(\d+(?:\.\d+)?)\s+(?:new\s+|existing\s+)?(?:cabinet\s+)?units?\b|\b(\d+(?:\.\d+)?)\s+cabinet(?:s)?\b/i),term:/\b(?:cabinet|unit)/i,label:'cabinet units'},
      {match:value.match(/\b(\d+(?:\.\d+)?)\s+(?:knobs?(?:\s*\/\s*|\s+or\s+)?pulls?|pulls?)\b/i),term:/\b(?:knobs?|pulls?)\b/i,label:'knobs/pulls'},
    ];
    for(const quantity of quantities){
      if(!quantity.match||fact.confidence<.85)continue;
      const parsed=Number(quantity.match[1]||quantity.match[2]);
      if(!Number.isFinite(parsed))continue;
      for(const item of merged.filter(candidate=>/\b(?:ea|each|unit)\b/i.test(candidate.unit)&&quantity.term.test(`${candidate.description} ${candidate.component}`))){
        item.quantity=parsed;
        item.basis='stated';
        item.evidence=`${item.evidence} Updated by typed clarification for ${quantity.label}: ${parsed}.`;
      }
    }
  }
  const mappings:[
    ScopeField,RegExp,RegExp
  ][]=[
    ['laborHours',/\b(?:hr|hrs|hour|hours)\b/i,/\b(?:labor|assembly|cabinet\s+install|bench[\s-]*top|total)\b/i],
    ['cabinetBaseLf',/\b(?:lf|linear\s+feet?|linear\s+foot)\b/i,/\b(?:base|lower)\s+cabinet/i],
    ['cabinetUpperLf',/\b(?:lf|linear\s+feet?|linear\s+foot)\b/i,/\b(?:upper|wall)\s+cabinet/i],
    ['cabinetTallLf',/\b(?:lf|linear\s+feet?|linear\s+foot)\b/i,/\btall\s+cabinet/i],
    ['trimLf',/\b(?:lf|linear\s+feet?|linear\s+foot)\b/i,/\b(?:trim|baseboard)/i],
    ['flooringSqft',/\b(?:sf|sq\.?\s*ft|square\s+feet?)\b/i,/\b(?:floor|flooring)/i],
    ['tileSqft',/\b(?:sf|sq\.?\s*ft|square\s+feet?)\b/i,/\btile|backsplash/i],
  ];
  for(const fact of changedFacts){
    const mapping=mappings.find(([field])=>field===fact.field);
    if(!mapping||fact.confidence<.85)continue;
    const quantity=Number(fact.value.replaceAll(',',''));
    if(!Number.isFinite(quantity)||quantity<0)continue;
    const [,unit,term]=mapping;
    const matches=merged.filter(item=>unit.test(item.unit)&&term.test(`${item.description} ${item.component}`));
    for(const item of matches){
      item.quantity=quantity;
      item.basis='stated';
      item.evidence=`${item.evidence} Updated by typed clarification for ${fact.field}: ${fact.value}.`;
    }
  }
  return merged;
}

/**
 * Active pricing must consume only the selected projection.  The original
 * alternatives remain persisted in clarificationProvenance/sourceHistory for
 * audit and customer-review history, but are not pricing inputs.
 *
 * The pricing source adapter should call this immediately before serializing
 * an extraction.  Keeping the projection here makes it difficult for a
 * future mapper to accidentally reintroduce retained alternatives.
 */
export function retainedPricingProjection(extraction:ScopeExtraction|null):ScopeExtraction|null{
  if(!extraction)return null;
  const projection={...extraction} as RetainedExtraction;
  delete projection.clarificationProvenance;
  delete projection.sourceHistory;
  return projection;
}

/**
 * Complete scope projection for adapters that serialize answers and
 * extraction together (for example, the pricing source mapper). The active
 * exclusions field remains explicit so the mapper knows what not to price;
 * the verbose raw reply is kept in wizard instruction history, not sent as an
 * additional active task narrative.
 */
export function retainedPricingScopeProjection<T extends {answers:ScopeAnswers;extraction:ScopeExtraction|null}>(scope:T):T{
  const retained=scope.extraction as RetainedExtraction|null;
  const histories=retained?.clarificationProvenance?.clarifications||[];
  let instructions=scope.answers.estimatingInstructions;
  for(const history of histories){
    if(!instructions)break;
    const raw=`Question: ${history.question}\nAnswer: ${history.answer}`;
    const active=`Question: ${history.question}\nAnswer: Selected option ${history.selected.option}: ${history.selected.label} (+${history.selected.laborHours}h).`;
    instructions=instructions.split(raw).join(active);
  }
  const answers=instructions===scope.answers.estimatingInstructions
    ?scope.answers
    :{...scope.answers,estimatingInstructions:instructions};
  return {...scope,answers,extraction:retainedPricingProjection(scope.extraction)} as T;
}