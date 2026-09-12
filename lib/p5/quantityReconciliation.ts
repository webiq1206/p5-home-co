import type {ExtractedFact,ScopeExtraction} from './scope.ts';
import type {Takeoff} from './documentLedger.ts';

const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const marker=(item:Takeoff,value:string)=>item.issues.some(issue=>normalized(issue).includes(normalized(value)));
const corpus=(item:Takeoff)=>normalized([item.description,item.component,item.evidence].join(' '));
const optionTokens=(value:string)=>normalized(value).split(' ').filter(token=>token.length>2&&!['the','top','option','alternate','alternative','include','included'].includes(token));
const matches=(item:Takeoff,value:string)=>{const text=corpus(item);const tokens=optionTokens(value);return Boolean(tokens.length&&tokens.every(token=>text.includes(token)));};

/** Short buttons only when the source question itself presents two alternatives. */
export function alternativeOptions(question:string){
  const match=question.match(/\(([^()]{2,55}?)\s+or\s+([^()]{2,55}?)\)/i)||question.match(/(?:choose|select|use|include|be|:)\s+([^?;:,]{2,55}?)\s+or\s+([^?;:,]{2,55}?)(?:\?|$)/i);
  if(!match)return undefined;
  const clean=(value:string)=>value.replace(/^(?:the|a|an)\s+/i,'').replace(/\s+/g,' ').trim();
  const values=[clean(match[1]),clean(match[2])];
  return values.every(value=>value.length>=2&&value.length<=55)?values:undefined;
}

const isSummary=(item:Takeoff)=>/^(?:total|subtotal|summary)$/i.test(item.id.trim())||/\b(?:grand total|subtotal|summary total|total labor|total hours)\b/i.test([item.id,item.description,item.component].join(' '))||item.issues.some(issue=>/\b(?:summary|subtotal|repeated total|do not add|do not include)\b/i.test(issue));
const isHours=(item:Takeoff)=>/^(?:h|hr|hrs|hour|hours)$/i.test(item.unit.trim());
const active=(item:Takeoff)=>!marker(item,'unselected alternative')&&!marker(item,'selection required');

/** Derive one global labor total while retaining each evidence-linked trade takeoff. */
export function reconcileAdditiveQuantities(extraction:ScopeExtraction):ScopeExtraction {
  const takeoffs=extraction.takeoffs||[];
  const unresolved=(extraction.instructions?.questions||[]).flatMap(question=>{
    const options=alternativeOptions(question);return options?takeoffs.filter(item=>options.some(option=>matches(item,option))):[];
  });
  const included=takeoffs.filter(item=>item.quantity!==null&&isHours(item)&&active(item)&&!isSummary(item)&&!unresolved.includes(item));
  if(!included.length)return extraction;
  const total=Math.round(included.reduce((sum,item)=>sum+item.quantity!,0)*10000)/10000;
  const evidence=included.map(item=>`${item.quantity} ${item.unit} ${item.description} (${item.sources.map(source=>`${source.source} page ${source.page}`).join(', ')})`).join(' + ');
  const source=[...new Set(included.flatMap(item=>item.sources.map(source=>source.source)))].join(', ');
  const fact:ExtractedFact={field:'laborHours',value:String(total),confidence:.99,source,evidence:`${evidence} = ${total} hours`,basis:'calculated'};
  return {...extraction,facts:[...extraction.facts.filter(item=>item.field!=='laborHours'),fact],conflicts:extraction.conflicts.filter(item=>item.field!=='laborHours'),clarifications:(extraction.clarifications||[]).filter(item=>item.field!=='laborHours')};
}

/** Apply an explicit alternative answer to retained takeoffs without rereading files. */
export function applyQuantityClarification(extraction:ScopeExtraction,question:string,answer:string):ScopeExtraction {
  const options=alternativeOptions(question);
  if(!options?.length||!extraction.takeoffs?.length)return reconcileAdditiveQuantities(extraction);
  const selected=options.find(option=>normalized(answer).includes(normalized(option))||optionTokens(option).every(token=>normalized(answer).includes(token)));
  if(!selected)return extraction;
  const takeoffs=extraction.takeoffs.map(item=>{
    const option=options.find(value=>matches(item,value));if(!option)return item;
    const issues=item.issues.filter(issue=>!/(?:unselected alternative|selection required|selected alternative)/i.test(issue));
    issues.push(option===selected?'Selected alternative':'Unselected alternative - do not include in pricing');
    return {...item,issues};
  });
  return reconcileAdditiveQuantities({...extraction,takeoffs});
}

/** Pricing receives included physical work only; the saved extraction keeps the full evidence ledger. */
export function pricingExtraction(extraction:ScopeExtraction|null):ScopeExtraction|null {
  if(!extraction)return null;
  const reconciled=reconcileAdditiveQuantities(extraction);
  const takeoffs=reconciled.takeoffs||[];
  const unresolved=new Set((reconciled.instructions?.questions||[]).flatMap(question=>{
    const options=alternativeOptions(question);return options?takeoffs.filter(item=>options.some(option=>matches(item,option))):[];
  }));
  return {...reconciled,takeoffs:takeoffs.filter(item=>active(item)&&!unresolved.has(item)&&!isSummary(item))};
}