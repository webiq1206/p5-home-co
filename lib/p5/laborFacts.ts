import type {ExtractedFact} from './scope.ts';
import type {Takeoff} from './documentLedger.ts';

/**
 * Labor hours are a slightly unusual scope field.  A document can state one
 * total, several additive trade components, or both.  Treating every numeric
 * occurrence as a competing answer either rejects legitimate trade scope or
 * silently chooses a subtotal.  This module only makes an additive total when
 * the component identity is explicit; it deliberately does not use broad
 * construction vocabulary as a semantic classifier.
 */
export interface LaborAggregation {
  facts:ExtractedFact[];
  conflicts:{field:'laborHours';values:string[];explanation:string}[];
  missingInformation:string[];
  replacedCanonicalFacts:boolean;
  originalFacts:ExtractedFact[];
}

const UNKNOWN=/\b(?:unknown|partial(?:ly)?|remaining|unmeasured|not\s+(?:known|documented|specified|provided|measured|stated)|tbd|n\/?a)\b/i;
const SUBTOTAL=/\bsub[\s-]?total\b/i;
const TOTAL=/\b(?:total|overall|combined|subtotal|sub-total|summary)\b/i;
const HOUR_WORD=/\b(?:labor\s*)?(?:h|hr|hrs|hour|hours)\b/i;

// These words describe a measurement, not a work component.  Everything else
// is retained in the normalized identity.  Thus "driveway labor" and
// "driveway labor" conflict when their hours differ, while "driveway
// excavation" and "driveway concrete" are separate additive components.
const GENERIC=new Set([
  'a','an','and','are','as','at','be','by','for','from','in','is','of','on','or',
  'the','to','with','work','scope','task','project','labor','hours','hour','hr',
  'hrs','h','estimated','estimate','approximately','approx','about','needed',
  'required','included','includes','include','total','overall','combined',
  'subtotal','sub','summary','remaining','partial','known','unknown','not',
  'documented','specified','provided','measured','stated','unmeasured','tbd',
  'n','a','reviewed','reviews','states','state','reports','reported','page',
  'document','documents','says','saying','shows','shown',
]);

const COMPONENT_TERMS=new Set([
  'assembly','cabinet','concrete','countertop','countertops','demolition',
  'drywall','electrical','excavation','flooring','framing','installation',
  'install','painting','paint','plumbing','roofing','siding','tile','trim',
  'stucco','masonry','insulation','landscape','landscaping','grading',
]);

function normalizeText(value:string){
  return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

function numberText(value:number){
  return Number.isInteger(value)?String(value):String(value);
}

function explicitTokens(text:string):string[]{
  return normalizeText(text)
    .split(' ')
    .filter(token=>token&&!GENERIC.has(token)&&!/^\d+(?:\.\d+)?$/.test(token));
}

function takeoffMatches(fact:ExtractedFact,takeoffs:Takeoff[],hours:number){
  const factText=normalizeText(`${fact.evidence} ${fact.source}`);
  return takeoffs.filter(item=>{
    if(!/^(?:h|hr|hrs|hour|hours)$/i.test(item.unit)||item.quantity!==hours)return false;
    const sourceMatch=item.sources.some(source=>normalizeText(source.source)===normalizeText(fact.source));
    const words=explicitTokens(`${item.description} ${item.component}`);
    const evidenceMatch=words.length>0&&words.every(word=>factText.includes(word));
    return sourceMatch||evidenceMatch;
  });
}

/**
 * Return a stable identity only when the source names one.  A bare
 * "16 labor hours" occurrence is intentionally not classified as a guessed
 * trade.  Takeoffs are accepted as supporting identity only when exactly one
 * cited hourly row can support the fact.
 */
export function laborComponentIdentity(fact:ExtractedFact,takeoffs:Takeoff[]=[]):string|undefined{
  const hours=Number(fact.value);
  const supported=Number.isFinite(hours)?takeoffMatches(fact,takeoffs,hours):[];
  if(supported.length===1){
    const supportedTokens=explicitTokens(`${supported[0].description} ${supported[0].component}`);
    if(supportedTokens.length)return supportedTokens.join(' ');
  }

  const text=normalizeText(fact.evidence);
  if(!text||!HOUR_WORD.test(text))return undefined;
  // An occurrence naming multiple possible components is ambiguous.  Do not
  // turn "excavation and concrete: 40 hours" into two invented quantities.
  const hourMatch=/\b(?:labor\s*)?(?:h|hr|hrs|hour|hours)\b/i.exec(text);
  const beforeHour=hourMatch?text.slice(0,hourMatch.index):text;
  const afterHour=hourMatch?text.slice(hourMatch.index+hourMatch[0].length):'';
  const beforeTokens=explicitTokens(beforeHour);
  const afterTokens=explicitTokens(afterHour);
  const tokens=beforeTokens.length?beforeTokens:afterTokens;
  if(!tokens.length)return undefined;
  const knownTerms=[...new Set(tokens.filter(token=>COMPONENT_TERMS.has(token)))];
  const distinctConjunction=(text.match(/\band\b|\bor\b/g)||[]).length;
  if((distinctConjunction>0&&tokens.length>1)||knownTerms.length>1)return undefined;
  return tokens.join(' ');
}

function isSummary(fact:ExtractedFact,identity:string|undefined){
  return !identity&&TOTAL.test(fact.evidence);
}

function hasIncompleteMarker(fact:ExtractedFact){
  return UNKNOWN.test(fact.evidence)||UNKNOWN.test(fact.value)||SUBTOTAL.test(fact.evidence);
}

function factKey(fact:ExtractedFact,identity:string|undefined){
  return JSON.stringify([fact.value.trim(),identity||'',normalizeText(fact.evidence)]);
}

function uniqueFacts(facts:ExtractedFact[],takeoffs:Takeoff[]){
  const seen=new Set<string>();
  return facts.filter(fact=>{
    if(fact.field!=='laborHours')return true;
    const key=factKey(fact,laborComponentIdentity(fact,takeoffs));
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}

function componentDescription(identity:string){
  return identity.replace(/\b\d+(?:\.\d+)?\b/g,' ').replace(/\s+/g,' ').trim();
}

/**
 * Normalize all explicit additive labor components into one canonical
 * laborHours fact.  The original component facts are returned separately so
 * scope.ts can retain them in sourceHistory without making them active
 * pricing answers.
 */
export function aggregateLaborFacts(input:ExtractedFact[],takeoffs:Takeoff[]=[],laborCoverage?:{totalHours:number;components:{id:string;description:string;hours:number}[]}):LaborAggregation{
  const labor=input.filter(fact=>fact.field==='laborHours');
  // Retained cabinet labor is an explicitly non-additive ledger.  Its
  // laborHours fact is already the ledger total and must not be regrouped.
  if(laborCoverage)return {facts:input,conflicts:[],missingInformation:[],replacedCanonicalFacts:false,originalFacts:[]};
  if(labor.length<2){
    if(labor.length===1&&hasIncompleteMarker(labor[0])){
      return {
        facts:input,
        conflicts:[{field:'laborHours',values:[labor[0].value],explanation:'Labor hours are only partially known; confirm every included component quantity before pricing.'}],
        missingInformation:['A labor component remains unknown or partial; confirm its quantity before treating total labor hours as complete.'],
        replacedCanonicalFacts:false,
        originalFacts:[],
      };
    }
    return {facts:input,conflicts:[],missingInformation:[],replacedCanonicalFacts:false,originalFacts:[]};
  }

  const deduped=uniqueFacts(labor,takeoffs);
  const rows=deduped.map(fact=>({fact,hours:Number(fact.value),identity:laborComponentIdentity(fact,takeoffs),summary:false,incomplete:hasIncompleteMarker(fact)}));
  const summaries=rows.filter(row=>row.identity===undefined&&isSummary(row.fact,row.identity));
  const components=rows.filter(row=>row.identity!==undefined);
  const ambiguous=rows.filter(row=>row.identity===undefined&&!isSummary(row.fact,row.identity));
  const incomplete=rows.some(row=>row.incomplete);
  const conflicts:LaborAggregation['conflicts']=[];
  const missingInformation:string[]=[];

  const values=[...new Set(rows.map(row=>row.fact.value.trim()))];
  const makeConflict=(valuesForConflict:string[],explanation:string)=>{
    conflicts.push({field:'laborHours',values:[...new Set(valuesForConflict.filter(Boolean))],explanation});
  };

  // A repeated summary is not additive.  If the same total is accompanied by
  // identified components, it is checked against their sum below.
  const summaryValues=[...new Set(summaries.map(row=>row.hours))];
  if(summaryValues.length>1){
    makeConflict(summaryValues.map(numberText),'Different total labor-hour values are stated. Confirm the intended total.');
  }

  const grouped=new Map<string,typeof components>();
  for(const row of components){
    const prior=grouped.get(row.identity!)||[];
    prior.push(row);grouped.set(row.identity!,prior);
  }
  const componentConflicts:string[]=[];
  for(const [identity,group] of grouped){
    const componentValues=[...new Set(group.map(row=>row.hours))];
    if(componentValues.length>1){
      componentConflicts.push(`${componentDescription(identity)} (${componentValues.map(numberText).join(' vs ')} hours)`);
    }
  }
  if(componentConflicts.length){
    makeConflict(values,`Different labor-hour values describe the same work: ${componentConflicts.join('; ')}. Confirm the intended quantity.`);
  }

  // Without an explicit total, multiple unclassified occurrences cannot be
  // safely added.  This also preserves same-work conflicts when the wording
  // never identifies a component.
  if(ambiguous.length>1){
    makeConflict(ambiguous.map(row=>numberText(row.hours)),'Labor-hour descriptions are ambiguous or refer to the same work. Identify each additive component before combining them.');
  }else if(ambiguous.length&&components.length){
    makeConflict(values,'One labor-hour occurrence has no explicit component identity, so it cannot be safely added to the identified labor components.');
  }else if(ambiguous.length&&summaries.length){
    makeConflict(values,'A labor-hour occurrence has no explicit component identity and cannot be safely reconciled with the stated total.');
  }

  const componentTotal=[...grouped.values()]
    .filter(group=>new Set(group.map(row=>row.hours)).size===1)
    .reduce((sum,group)=>sum+group[0].hours,0);
  const hasDistinctComponents=grouped.size>1;
  const totalValue=summaryValues.length===1?summaryValues[0]:undefined;
  if(incomplete){
    missingInformation.push('A labor component remains unknown or partial; confirm its quantity before treating total labor hours as complete.');
    makeConflict(totalValue!==undefined?[numberText(totalValue),numberText(componentTotal)]:[numberText(componentTotal)],'Labor hours are only partially known; confirm every included component quantity before pricing.');
  }else if(componentConflicts.length){
    // Keep source facts and the explicit conflict; never synthesize a total.
  }else if(hasDistinctComponents){
    if(totalValue!==undefined&&totalValue!==componentTotal){
      makeConflict([numberText(totalValue),numberText(componentTotal)],'The stated total labor hours do not equal the identified additive components.');
    }else if(!conflicts.length){
      const representative=(totalValue!==undefined?summaries[0]?.fact:components[0]?.fact)||deduped[0];
      const componentEvidence=components.map(row=>`${componentDescription(row.identity!)}: ${numberText(row.hours)} labor hours`).join('; ');
      const evidence=`Explicit additive labor components: ${componentEvidence}. Total labor hours: ${numberText(componentTotal)}.`;
      const aggregate:ExtractedFact={...representative,field:'laborHours',value:numberText(componentTotal),evidence,source:[...new Set(deduped.map(fact=>fact.source))].join('; '),basis:'calculated',confidence:Math.min(...deduped.map(fact=>fact.confidence))};
      const nonLabor=input.filter(fact=>fact.field!=='laborHours');
      return {facts:[...nonLabor,aggregate],conflicts,missingInformation,replacedCanonicalFacts:true,originalFacts:deduped};
    }
  }else if(totalValue!==undefined&&summaries.length&&!ambiguous.length){
    // One or more copies of one summary are a single supported fact.
    const representative=summaries[0].fact;
    return {facts:[...input.filter(fact=>fact.field!=='laborHours'),representative],conflicts,missingInformation,replacedCanonicalFacts:deduped.length!==1,originalFacts:deduped.length>1?deduped:[]};
  }

  return {facts:input,conflicts,missingInformation,replacedCanonicalFacts:false,originalFacts:[]};
}