import type {ReviewedScope} from './scope.ts';

type CountInput={
 scope:ReviewedScope|undefined;
 task:{description:string};
 rate:{code?:string;description:string;unit:string};
 addition:{quantity:number;quantityEvidence:string;quantityRange?:{low:number;high:number}|null};
};
export type CabinetCountFact={source:string;text:string;quantity:number;unit:'EA'|'LF'};
export type CabinetCountFacts={sourceCount?:number;sourceLengthFt?:number;proposedWidthIn?:number;proposedCount:number;quantityUnit:'EA';sourceFacts:CabinetCountFact[]};
export type CabinetCountValidation={applicable:false}|{applicable:true;valid:true;basis:'stated-count'|'width-allowance';facts:CabinetCountFacts}|{applicable:true;valid:false;issue:string;facts:CabinetCountFacts};

const family='(?:(?:tall|full[- ]height)(?:\\s+(?:pantry|oven))?|pantry|oven)(?:\\s*[/&]\\s*(?:pantry|oven))?\\s+cabinets?';
const cabinet=new RegExp('\\b'+family+'\\b','i');
const accessory=/\b(?:hardware|accessor\w*|hinges?|handles?|pulls?|knobs?|latches?|shelves?|shelving|panels?|fillers?|trim|brackets?|screws?|fasteners?)\b/i;
const wholeFamily=family+'\\b(?!\\s+(?:doors?|fronts?|drawers?|hardware|accessor\\w*|hinges?|handles?|pulls?|knobs?|latches?|shelves?|shelving|panels?|fillers?|trim|brackets?|screws?|fasteners?)\\b)';
const number='(\\d+(?:\\.\\d+)?)';
const lengthUnit='(?:LF|line(?:ar|al)\\s+(?:feet|foot))';
const widthUnit='(?:inches|inch|in\\.?|["″]|feet|foot|ft\\.?|LF)';
const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
const normalized=(text:string)=>text.replace(/[\u2010-\u2015]/g,'-').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi,word=>String(words[word.toLowerCase()]));
const positive=(value:number)=>Number.isFinite(value)&&value>0;
const close=(a:number,b:number)=>Math.abs(a-b)<.0001;
const unique=(values:number[])=>[...new Set(values)];

function withoutDimensions(text:string){
 const dimensionUnit='(?:'+widthUnit+'|[\'′]|mm|cm|meters?|metres?)';
 const dimensionRange=new RegExp('(?<![\\w.])\\d+(?:\\.\\d+)?(?:\\s*[- ]?'+dimensionUnit+'(?![a-z]))?\\s*(?:-|to)\\s*\\d+(?:\\.\\d+)?\\s*[- ]?'+dimensionUnit+'(?![a-z])(?:[- ](?:wide|high|deep|width|height|depth))?','gi');
 const value='\\d+(?:\\.\\d+)?(?:\\s*[- ]?'+dimensionUnit+'(?![a-z]))?(?:\\s*(?:wide|high|deep|width|height|depth|[WHD])\\b)?';
 const chain=new RegExp('(?<![\\w.])'+value+'(?:\\s*(?:[x×]|by)\\s*'+value+')+','gi');
 const sized=new RegExp('(?<![\\w.])\\d+(?:\\.\\d+)?\\s*[- ]?'+dimensionUnit+'(?![a-z])(?:[- ](?:wide|high|deep|width|height|depth))?','gi');
 // Preserve positions and the untouched original clause in the returned facts.
 // Dimension tokens may qualify a real preceding count, never become one.
 return text.replace(dimensionRange,match=>' '.repeat(match.length)).replace(chain,match=>' '.repeat(match.length)).replace(sized,match=>' '.repeat(match.length));
}
function withoutQuantityRanges(text:string){
 const unit='(?:EA|each|'+lengthUnit+'|'+widthUnit+')';
 const value='\\d+(?:\\.\\d+)?(?:\\s*'+unit+'(?![a-z]))?';
 const range=new RegExp('(?<![\\w.])'+value+'\\s*(?:-|to|and)\\s*'+value,'gi');
 // A placeholder prevents a preceding unrelated number from being attached to
 // the cabinet noun after a source count range has been removed.
 return text.replace(range,match=>'?'.repeat(match.length));
}
function exactQuantityAt(text:string,start:number){
 return !/\b(?:(?:about|around|roughly|circa|approximately|approx\.?|estimate(?:d)?)(?:\s+(?:at|of))?|up\s+to|at\s+(?:least|most)|(?:more|less|fewer)\s+than)\s*$/i.test(text.slice(0,start));
}
function currentCount(text:string,start:number,end:number,task:string){
 const before=text.slice(0,start),after=text.slice(end);
 if(!exactQuantityAt(text,start)||/^\s*(?:minimum|maximum|min\.?|max\.?|approximately|approx\.?)\b/i.test(after))return false;
 const actions=[...before.matchAll(/\b(remove|removed|removing|removal|demolish|demolition|dispose|disposal|discard|discarded|haul(?:[- ]off)?|retain|retained|retention|keep|keeping|reuse|supply|install|replace|reinstall|provide|furnish|purchase|need|request|requests|new)\b/gi)];
 const action=actions.at(-1)?.[1].toLowerCase();
 const oldRole=/\b(?:remov\w*|demoli\w*|dispos\w*|discard\w*|haul\w*|retain\w*|retention|keep\w*|reuse|remain\w*|stay\w*|old|existing)\b/i;
 if(action&&/^(?:remov|demoli|dispos|discard|haul|retain|retention|keep|reuse)/.test(action))return false;
 if(action==='reinstall'&&/\b(?:new|supply|purchase|furnish|provide)\b/i.test(task))return false;
 const nextOperation=after.search(/\b(?:and|then)\s+(?:remove|dispose|retain|keep|supply|install|replace|provide|furnish)\b/i);
 if(oldRole.test(nextOperation<0?after:after.slice(0,nextOperation)))return false;
 if(action)return !oldRole.test(before.slice(actions.at(-1)!.index!+action.length));
 // A bare BOM entry has no competing operation. Other narratives need an
 // explicit current request; merely having a cabinet count is not new scope.
 const bomPrefix=/^\s*(?:[-*•]\s*)?$/.test(before)||/:\s*$/.test(before);
 const bomSuffix=/^\s*$|^\s*[,)]|^\s+(?:EA|each|units?|total|in|with|at)\b/i.test(after);
 return bomPrefix&&bomSuffix&&!oldRole.test(text);
}

function originalFacts(scope:ReviewedScope|undefined,task:string){
 const facts:CabinetCountFact[]=[];
 if(!scope)return {facts,multipleCounts:false};
 const sources=[['scope.text',scope.text],['extraction.sourceText',scope.extraction?.sourceText],
  ...(['taskList','otherDetails','cabinetConstruction','estimatingInstructions'] as const).map(field=>['answers.'+field,scope.answers[field]])];
 const before=new RegExp('(?<![\\w.+/×-])'+number+'(?:\\s*(?:EA|each)\\b)?\\s+(?:(?:new|replacement|factory-painted)\\s+)?'+wholeFamily,'gi');
 const after=new RegExp('\\b'+wholeFamily+'\\s*(?:(?:count|quantity|qty)\\s*[:=]?|[:=])\\s*'+number+'(?:\\s*(?:EA|each|units?))?\\b','gi');
 const lengthBefore=new RegExp('(?<![\\w.])'+number+'\\s*'+lengthUnit+'\\s+(?:of\\s+)?(?:new\\s+)?'+wholeFamily,'gi');
 const lengthAfter=new RegExp('\\b'+wholeFamily+'\\s*(?:(?:run|length|extent)\\s*)?(?:[:=]|is|are|of)\\s*'+number+'\\s*'+lengthUnit+'\\b','gi');
 let multipleCounts=false;
 for(const [source,raw] of sources){
  if(!raw)continue;
  let counts=0;
  for(const clause of raw.split(/[;\n]|\.(?!\d)/)){
   const text=normalized(clause);
   if(!cabinet.test(text)||/\b(?:assum\w*|model\w*|optional|alternate|or|not|exclude\w*|without)\b/i.test(text))continue;
   // A pantry quantity cannot authenticate an unrelated oven-cabinet task.
   if(/\bpantry\b/i.test(task)&&!/\boven\b/i.test(task)&&/\boven\b/i.test(text)&&!/\bpantry\b/i.test(text))continue;
   if(/\boven\b/i.test(task)&&!/\bpantry\b/i.test(task)&&/\bpantry\b/i.test(text)&&!/\boven\b/i.test(text))continue;
   const countText=withoutQuantityRanges(withoutDimensions(text));
   for(const match of [...countText.matchAll(before),...countText.matchAll(after)]){
    if(!currentCount(text,match.index!,match.index!+match[0].length,task))continue;
    const quantity=Number(match[1]);
    if(Number.isSafeInteger(quantity)&&quantity>0){facts.push({source:source!,text:clause.trim(),quantity,unit:'EA'});counts++;}
   }
   const lengthText=withoutQuantityRanges(text);
   for(const match of [...lengthText.matchAll(lengthBefore),...lengthText.matchAll(lengthAfter)]){
    if(!exactQuantityAt(text,match.index!))continue;
    const quantity=Number(match[1]);if(positive(quantity))facts.push({source:source!,text:clause.trim(),quantity,unit:'LF'});
   }
  }
  if(counts>1)multipleCounts=true;
 }
 const length=Number(scope.answers.cabinetTallLf?.replaceAll(',',''));
 if(positive(length)&&!scope.uncertainFields?.includes('cabinetTallLf'))facts.push({source:'answers.cabinetTallLf',text:scope.answers.cabinetTallLf!+' LF',quantity:length,unit:'LF'});
 return {facts,multipleCounts};
}

function proposedWidths(evidence:string):number[]{
 const text=normalized(evidence),widths:number[]=[];
 const patterns=[
  new RegExp('(?<![\\w.])'+number+'\\s*[- ]?('+widthUnit+')(?:[- ]|\\s)*(?:wide|width)\\b','gi'),
  new RegExp('\\b(?:cabinet\\s+)?width\\s*(?::|=|of|is)?\\s*'+number+'\\s*('+widthUnit+')(?![a-z])','gi'),
 ];
 for(const pattern of patterns)for(const match of text.matchAll(pattern)){
  const value=Number(match[1]),unit=match[2].toLowerCase();
  if(positive(value))widths.push(value*(/^(?:feet|foot|ft\.?|lf)$/.test(unit)?12:1));
 }
 return unique(widths);
}
function cabinetWidthNamed(evidence:string){
 const text=normalized(evidence),namedCabinet='(?:(?:tall(?:\\s+pantry)?|pantry|oven|full[- ]height)\\s+)?cabinet';
 return new RegExp('(?<![\\w.])'+number+'\\s*[- ]?'+widthUnit+'(?:[- ]|\\s)*(?:wide|width)\\s+(?:(?:per|for each)\\s+)?'+namedCabinet+'\\b','i').test(text)
  ||new RegExp('\\b'+namedCabinet+'\\s+width\\s*(?::|=|of|is)?\\s*'+number+'\\s*'+widthUnit+'(?![a-z])','i').test(text);
}

/** A run length is not an each count. Original reviewed source supplies facts;
 * mapper prose can supply only a clearly disclosed, checked width assumption.
 * This function never changes quantities, rate units, ranges or source text. */
export function validateCabinetCountEvidence({scope,task,rate,addition}:CountInput):CabinetCountValidation{
 const canonicalRate=/^(?:PB-)?12-32-04(?:-[ML])?$/i.test(rate.code||'');
 if(!/^(?:EA|each)$/i.test(rate.unit.trim())||!new RegExp('\\b'+wholeFamily,'i').test(task.description)
  ||!(canonicalRate||cabinet.test(rate.description)&&!accessory.test(rate.description)))return {applicable:false};
 const original=originalFacts(scope,task.description);
 const counts=unique(original.facts.filter(fact=>fact.unit==='EA').map(fact=>fact.quantity));
 const lengths=unique(original.facts.filter(fact=>fact.unit==='LF').map(fact=>fact.quantity));
 const facts:CabinetCountFacts={proposedCount:addition.quantity,quantityUnit:'EA',sourceFacts:original.facts,
  ...(counts.length===1?{sourceCount:counts[0]}:{}),...(lengths.length===1?{sourceLengthFt:lengths[0]}:{})};
 const invalid=(reason:string):CabinetCountValidation=>({applicable:true,valid:false,issue:task.description+': '+reason,facts});
 if(!Number.isSafeInteger(addition.quantity)||addition.quantity<1)return invalid('a tall/pantry/oven cabinet quantity in EA needs a positive whole cabinet count.');
 if(counts.length){
  if(original.multipleCounts||counts.length!==1)return invalid('original cabinet counts are multiple or conflicting; identify this component count before using an EA rate.');
  return close(addition.quantity,counts[0])?{applicable:true,valid:true,basis:'stated-count',facts}:invalid('the proposed EA quantity does not match the original stated cabinet count.');
 }
 if(lengths.length!==1)return invalid('the EA cabinet rate needs an original stated count or one verified run length with a disclosed width-to-count allowance.');
 const evidence=addition.quantityEvidence.trim(),range=addition.quantityRange;
 if(!/^ALLOWANCE\s*:/i.test(evidence))return invalid('cabinet run length in LF cannot be copied into confirmed EA; disclose the assumed cabinet width and count with ALLOWANCE: evidence.');
 if(!range||!positive(range.low)||!positive(range.high)||range.low>=range.high||range.low>addition.quantity||range.high<addition.quantity)return invalid('a modeled cabinet count needs a positive, non-degenerate quantity range containing the proposed EA count.');
 const widths=proposedWidths(evidence);
 if(widths.length!==1||!cabinetWidthNamed(evidence))return invalid('the width-to-count allowance needs one explicit cabinet width in inches or feet; height, depth and other component widths are not cabinet widths.');
 facts.proposedWidthIn=widths[0];
 const explicitLength=[...normalized(evidence).matchAll(new RegExp('(?<![\\w.])'+number+'\\s*'+lengthUnit+'\\b','gi'))].some(match=>close(Number(match[1]),lengths[0]));
 const explicitCount=[...normalized(evidence).matchAll(new RegExp('(?<![\\w.])'+number+'\\s*(?:EA|each|(?:cabinet\\s+)?units?|cabinets?)\\b','gi'))].some(match=>close(Number(match[1]),addition.quantity));
 if(!explicitLength||!explicitCount)return invalid('the allowance must disclose the original LF extent and resulting EA cabinet count.');
 if(!close(lengths[0]*12/widths[0],addition.quantity))return invalid('the disclosed LF extent divided by cabinet width does not equal the proposed EA count.');
 return {applicable:true,valid:true,basis:'width-allowance',facts};
}
