/** Rules for every sentence a customer can see: progress cards, chat, errors,
 * assumptions, questions, email and PDF. Internal detail (provider errors,
 * pricing-research wording, financial terms) stays in staff diagnostics. */

/** Wording the owner has ruled out, plus signs that internal detail leaked. */
export const BANNED_CUSTOMER_COPY:readonly RegExp[]=[
  /local averages?/i,/researching/i,/pricing research/i,/missing (?:local )?rates?/i,/published (?:cost )?(?:research|evidence)/i,
  /pricing-(?:search|provider|stage)[-\w:]*/i,/sourced-market-average/i,/\b(?:AI|model|pricing|search) provider\b/i,/\bprovider (?:error|timeout|response|unavailable)\b/i,/\b(?:input|output|max) tokens?\b/i,/\bHTTP \d{3}\b/i,
  /\bscopeTaskId\b/i,/\bquantityEvidence\b/i,/\bJSON\b/,/\bjson schema\b/i,
  // Financial terms are judged in context by the customer projection, which
  // keeps ordinary scope wording such as overhead doors or an architect's markup.
];
export function bannedCustomerCopy(text:string):string|null{for(const rule of BANNED_CUSTOMER_COPY){const hit=text.match(rule);if(hit)return hit[0];}return null;}

/** Progress wording approved for customers. */
export const PROGRESS_COPY={reviewing:'Reviewing your project',preparing:'Preparing your estimate',quantities:'Checking quantities',checking:'Checking your estimate'} as const;

/** The customer wording for a line priced from a planning allowance. */
export const BUDGET_ALLOWANCE_NOTE='Budget allowance; final selection to be confirmed.';

/** A question may be shown to a customer only when it asks about their
 * project in plain words. Anything that reads like an estimator's or a
 * model's working note is withheld for staff review instead. */
export function customerSafeQuestion(question:string):string|null{
  const text=question.replace(/\s+/g,' ').trim();
  if(text.length<12||text.length>220||!text.endsWith('?'))return null;
  if(bannedCustomerCopy(text))return null;
  if(/[$€£{}\[\]<>_=|]|\btask\s*\d|\bid\b|\brule\b|\bbasis\b|\bevidence\b|\bsource[sd]?\b|\ballowance prefix\b|\brate\b|\bbenchmark\b|\bconfidence\b|\baudit\b|\bmapping\b|\binventory\b|\bline item\b|\b(?:unit|direct)[- ]costs?\b|\bmarkup\b|\bmargin\b|\boverhead (?:rate|allocation|recovery)\b/i.test(text))return null;
  if(!/^(?:Should|Will|What|Which|How|Who|Do|Does|Did|Is|Are|Can|Would|Where|When)\b/.test(text))return null;
  return text;
}


const quantityLabel=(amount:string,unit:string)=>` (${amount} ${unit})`;
/** Rewrite the estimator's internal allowance wording into approved customer
 * wording. Internal records keep the full audit text; only the customer
 * projection calls this. */
export function plainCustomerLine(line:string):string{
  let text=line;
  text=text.replace(/^Published cost research was not used for (.+?) \([\s\S]*\)\. A regional planning average allowance is included instead; it is not verified local pricing\.?$/,(_,items)=>`${items}: ${BUDGET_ALLOWANCE_NOTE}`);
  text=text.replace(/^(.+?): regional planning average allowance for ([\d.,]+) ([^\s(]+) \([^)]*\)\.\s*([\s\S]*)$/,(_,item,amount,unit,rest)=>{
    const kept=[...String(rest).matchAll(/\b(?:Includes|Excludes) [^.]+\./g)].map(m=>m[0]).join(' ');
    return `${item}${quantityLabel(amount,unit)}: ${BUDGET_ALLOWANCE_NOTE}${kept?' '+kept:''}`;
  });
  text=text.replace(/^(.+?): reused (?:provisional planning|published benchmark) allowance, ([\d.,]+) ([^\s.]+)\.[\s\S]*$/,(_,item,amount,unit)=>`${item}${quantityLabel(amount,unit)}: ${BUDGET_ALLOWANCE_NOTE}`);
  text=text.replace(/^(.+?): priced by a preliminary allowance pending published research;[\s\S]*$/,(_,item)=>`${item}: ${BUDGET_ALLOWANCE_NOTE}`);
  text=text.replace(/Regional planning average, not verified local pricing\.\s*Confirm current local rates, quantities and selections before a firm proposal\.?/gi,BUDGET_ALLOWANCE_NOTE);
  text=text.replace(/(^|[.!?]\s+)Not verified local (?:pricing|quotes)\.?/g,'$1Final selection to be confirmed.').replace(/\s*Confirm current local rates[^.]*\./gi,'').replace(/\bregional planning averages?(?: allowances?)?/gi,'budget allowance').replace(/\bplanning average allowances?/gi,'budget allowance')
    .replace(/[;,]?\s*(?:it is |this is )?not verified local (?:pricing|quotes)/gi,'; final selection to be confirmed').replace(/\bretry pricing research\b/gi,'try again').replace(/[ \t]+/g,' ').trim();
  return text.replace(/(^|[.!?]\s+)budget allowance/g,'$1Budget allowance');
}
/** Final gate for one customer sentence: null means withhold it. */
export function customerSentence(sentence:string):string|null{
  const hit=bannedCustomerCopy(sentence);
  if(hit){console.error(`[p5-copy] withheld a customer sentence containing "${hit}"`);return null;}
  return sentence;
}
