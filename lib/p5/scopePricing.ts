ingReply>=>{
  const fingerprint=pricingFingerprint(provider,instructions,input,search,identity);
  const reservation=await reservePricingCharge(fingerprint,provider,provider==='anthropic'?4:1);
  try {
    const reply=await requestPricingWithUnsafe(provider,instructions,input,search,remainingMs,fingerprint);
    await settlePricingCharge(fingerprint);
    return reply;
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    if(process.env.NODE_TEST_CONTEXT&&process.env.P5_PRICING_LEDGER_TEST_MODE==='memory')throw error;
    // A syntactically valid 4xx rejection before provider acceptance is
    // known non-chargeable (except 408/429, whose acknowledgement is not
    // reliable). Keep the existing provider fallback for those responses.
    const knownRejection=/^pricing-provider-unavailable:4(?:0[0-3]|0[5-7])\b/.test(message);
    if(error instanceof PricingChargeUnknownError)throw error;
    if(knownRejection){await rejectPricingCharge(fingerprint,message);throw error;}
    if(reservation)await markPricingChargeUnknown(fingerprint,message);
    throw new PricingChargeUnknownError();
  }
};
/** Anthropic prices first when configured. A refusal it will repeat (billing
 * block, invalid request, oversized reply) falls back to OpenAI for the rest
 * of the stage when an OpenAI key exists; a billing block also parks
 * Anthropic for ten minutes so later stages skip straight to OpenAI. */
export const requestPricing:PricingRequest=async(instructions,input,search,remainingMs,identity)=>{
  const started=Date.now();
  const integrated=Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY&&process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  const openai=Boolean(integrated?process.env.AI_INTEGRATIONS_OPENAI_API_KEY:process.env.OPENAI_API_KEY);
  const anthropic=Boolean(process.env.ANTHROPIC_API_KEY)&&(providerRuntime.p5AnthropicBlockedUntil||0)<=Date.now();
  // Live timings: gpt-4.1 returns a pricing stage in 5 to 40 s where claude-sonnet-5 took 70 to 150 s, so OpenAI leads when both are configured unless P5_PRICING_PROVIDER says otherwise; either provider still covers a refusal by the other.
  const preferOpenAI=openai&&(process.env.P5_PRICING_PROVIDER||'openai')!=='anthropic';
  if(preferOpenAI){
    try{return await requestPricingWith('openai',instructions,input,search,remainingMs,identity);}
    catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(!anthropic||!providerRefused(message))throw error;
      const left=remainingMs-(Date.now()-started);
      console.error(`[p5-pricing] OpenAI refused the stage (${message.slice(0,140)}); ${left>=5000?'continuing with Anthropic':'no time left for Anthropic'}.`);
      if(left<5000)throw error;
      return requestPricingWith('anthropic',instructions,input,search,left,identity);
    }
  }
  if(anthropic){
    try{return await requestPricingWith('anthropic',instructions,input,search,remainingMs,identity);}
    catch(error){
      const message=error instanceof Error?error.message:String(error);
      if(!openai||!providerRefused(message))throw error;
      if(/credit balance|billing|:402:/i.test(message))providerRuntime.p5AnthropicBlockedUntil=Date.now()+10*60_000;
      const left=remainingMs-(Date.now()-started);
      console.error(`[p5-pricing] Anthropic refused the stage (${message.slice(0,140)}); ${left>=5000?'continuing with OpenAI':'no time left for OpenAI'}.`);
      if(left<5000)throw error;
      return requestPricingWith('openai',instructions,input,search,left,identity);
    }
  }
  if(!openai)throw new Error(process.env.ANTHROPIC_API_KEY?'pricing-provider-unavailable:anthropic-blocked':'pricing-provider-unavailable');
  return requestPricingWith('openai',instructions,input,search,remainingMs,identity);
};

function existingLines(priced:ReturnType<typeof priceReviewedScope>){
  return 'lines' in priced.internal?priced.internal.lines:[];
}
export function catalogResolution(mapping:Mapping,configuration:EstimatorConfiguration,existing:ReturnType<typeof existingLines>,now:Date,scope?:ReviewedScope):ScopePriceResolution{
  const result:ScopePriceResolution={rules:[],assumptions:[...(mapping.notes||[])],issues:[...mapping.issues],removeLineIds:mapping.replacements.map(r=>r.lineId),removeExclusions:mapping.removeExclusions.map(e=>e.text)};
  for(const r of mapping.replacements)if(!existing.some(l=>l.id===r.lineId))throw new Error('Unknown replacement line');
  const ids=new Set<string>();
  for(const t of mapping.tasks){
    if(ids.has(t.id))throw new Error('Duplicate scope task');ids.add(t.id);
    // Historical alternatives can be present in a plan set or prior estimate,
    // but they are not selected scope. Holding the task is safer than silently
    // billing it; the final audit then has a visible reason to resolve.
    if(taskIsUnselected(t)){
      result.issues.push(`${t.description}: unselected alternative or excluded work is not billable.`);
      continue;
    }
    result.issues.push(...t.issues.map(i=>`${t.description}: ${i}`));
    const unresolved=unresolvedQuantityIssue(t);
    const hasAllowance=t.additions.some(a=>/^ALLOWANCE\s*:/i.test(a.quantityEvidence)&&Boolean(a.quantityRange));
    if(unresolved&&!hasAllowance)result.issues.push(unresolved);
    for(const id of t.existingLineIds){
      const line=existing.find(l=>l.id===id);
      if(result.removeLineIds?.includes(id)||!line||line.quantity*line.unitCost<=0)result.issues.push(`${t.description}: invalid existing price reference.`);
      else result.issues.push(...existingQuantityIssues(t,line,scope,mapping.tasks.length));
    }
    for(const a of t.additions){
      const rate=configuration.planningCatalog?.rates.find(r=>r.code===a.code);
      const regional=configuration.regionalRates?.find(r=>r.id===a.code);
      const rateUnit=rate?.unit||regional?.unit||'';
      const quantityFindings=quantityIssues(t,a,rateUnit,scope,mapping.tasks.length,rate?.description||regional?.description||a.code,rate?.type==='Material'||regional?.category==='materials');
      if(quantityFindings.length){result.issues.push(...quantityFindings);continue;}
      if(!rate&&regional){
        if(!reusableUnitRate(regional,scope?.answers.location||'',now)){result.issues.push(`${t.description}: regional rate needs current evidence.`);continue;}
        result.rules.push({...regional,scopeTaskId:t.id,id:`scope-${result.rules.length+1}`,description:regional.description,quantity:{fixed:a.quantity,factor:1},allowance:true,quantityRange:a.quantityRange||undefined,building:a.building,floor:a.floor});
        result.assumptions.push(`${regional.description}: reused ${regional.estimatingBasis==='regional-planning-average'?'provisional planning':'published benchmark'} allowance, ${a.quantity} ${regional.unit}. ${a.quantityEvidence}. ${regional.evidence.provenance?.assumptions.join(' ')||''} Rate recorded ${regional.evidence.provenance?.retrievedAt}; valid until ${regional.evidence.validUntil}.`);continue;
      }
      if(!rate){result.issues.push(`${t.description}: catalog rate is unavailable.`);continue;}
      result.rules.push({scopeTaskId:t.id,id:`scope-${result.rules.length+1}`,description:`${t.description}: ${rate.description}`,trade:suggestedTrade(rate.description),unit:rate.unit==='HR'||rate.unit==='HRS'?'hour':rate.unit,quantity:{fixed:a.quantity,factor:1},unitCost:rate.amount,allowance:/^ALLOWANCE:/i.test(a.quantityEvidence),quantityRange:a.quantityRange||undefined,building:a.building,floor:a.floor,category:rate.type==='Material'?'materials':rate.type==='Labor'?'field-labor':rate.type==='Subcontractor'?'subcontractors':rate.type==='Equipment'?'equipment-rentals':'other-direct',priceBasis:'direct-cost',estimatingBasis:rate.basis,evidence:{basis:'owner-estimating-schedule',reference:`${rate.source}; ${rate.code}; ${a.quantityEvidence}`,verifiedAt:configuration.planningCatalog!.importedAt,validUntil:new Date(Date.parse(configuration.planningCatalog!.importedAt)+92*86400000).toISOString()}});
      result.assumptions.push(`${t.description}: mapped to ${rate.description}, ${a.quantity} ${rate.unit}. ${a.quantityEvidence}`);
    }
    if(!t.existingLineIds.length&&!t.additions.length&&!t.researchDescription)result.issues.push(`${t.description}: no supported price.`);
  }
  return result;
}

type QuantityClaim={quantity:number;unit:string};
const NUMBER_WORDS:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
const UNKNOWN_QUANTITY=/\b(?:unknown|not\s+(?:known|documented|specified|provided|measured|shown)|undocumented|unmeasured|tbd|to\s+be\s+determined|n\/?a)\b/i;
const UNSELECTED_SCOPE=/\b(?:alternate|alternative|optional|not\s+selected|not\s+included|excluded|by\s+others|previous(?:ly)?\s+proposed|discarded)\b/i;
const INCLUDED_SCOPE=/\b(?:included|selected|requested|approved|retain(?:ed)?|keep|kept|yes)\b/i;
const TASK_STATUS_SCOPE=/\b(?:alternate|alternative|optional|not\s+selected|not\s+included|by\s+others|previous(?:ly)?\s+proposed|discarded)\b/i;
const COMPONENT_STOP_WORDS=new Set(['a','an','and','are','be','by','for','in','installation','install','labor','labour','material','materials','of','on','package','requested','scope','the','work']);
const componentTerms=(description:string)=>description.toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter(term=>!COMPONENT_STOP_WORDS.has(term))||[];
const clauseHasComponent=(clause:string,terms:string[])=>terms.some(term=>{
  const stem=term.replace(/(?:ing|ed|es|s)$/,'');
  return new RegExp(`\\b(?:${term}|${stem})\\b`,'i').test(clause);
});
/**
 * Status is scoped to a mapped component. "Appliances are excluded; painting
 * is included" must not suppress a painting task merely because the evidence
 * contains the word excluded. A bare "alternate/not selected" status still
 * applies to the task when no component is named.
 */
function taskIsUnselected(task:Mapping['tasks'][number]){
  const description=task.description.trim();
  if(UNSELECTED_SCOPE.test(description))return true;
  const terms=componentTerms(description);
  const clauses=task.evidence.split(/[.;\n]+|\s*,\s*/).map(clause=>clause.trim()).filter(Boolean);
  const statusClauses=clauses.filter(clause=>UNSELECTED_SCOPE.test(clause));
  const componentStatuses=statusClauses.filter(clause=>clauseHasComponent(clause,terms));
  if(componentStatuses.some(clause=>UNSELECTED_SCOPE.test(clause)&&!INCLUDED_SCOPE.test(clause)))return true;
  if(componentStatuses.some(clause=>INCLUDED_SCOPE.test(clause)))return false;
  // Generic alternate/not-selected language refers to the task itself. A
  // component-specific "excluded" clause without a task term does not.
  return statusClauses.some(clause=>TASK_STATUS_SCOPE.test(clause))||(statusClauses.length>0&&!terms.length);
}
function unresolvedQuantityIssue(task:Mapping['tasks'][number]){
  return UNKNOWN_QUANTITY.test(`${task.description} ${task.evidence}`)?`${task.description}: quantity remains unmeasured; do not publish a confirmed quantity.`:null;
}
/**
 * Read quantities only from the short task evidence supplied to the mapper.
 * This is a negative defense, not an estimator: it never creates a quantity.
 * Its job is to stop a mapper from changing a reviewed 14 HR fact into an
 * arbitrary 10 HR addition, or from turning an unresolved quantity into a
 * confirmed line.
 */
function quantityClaims(textValue:string):QuantityClaim[]{
  const textValueWithWords=textValue.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi,(word)=>String(NUMBER_WORDS[word.toLowerCase()]));
  const claims:QuantityClaim[]=[];
  const add=(quantity:number,unit:string)=>{if(Number.isFinite(quantity)&&quantity>0)claims.push({quantity,unit:unitKey(unit)});};
  const pattern=/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:(?:labor|labour)\s*)?(hours?|hrs?|hr|h|feet?|ft|linear\s+feet?|lineal\s+feet?|lf|square\s+feet?|square\s+foot|sq\.?\s*ft|sf|cubic\s+yards?|cubic\s+yard|cy|each|units?|fixtures?|doors?|windows?|toilets?|faucets?|lights?)(?=$|[^\w])/gi;
  for(const match of textValueWithWords.matchAll(pattern)){
    const unit=match[2].toLowerCase();
    add(Number(match[1]),/\bhours?\b|\bhrs?\b|\bhr\b|\bh\b/.test(unit)?'hour':/\b(?:square|sq|sf)\b/.test(unit)?'sf':/\b(?:cubic|cy)\b/.test(unit)?'cy':/\b(?:linear|lineal|lf|feet?|ft)\b/.test(unit)?'lf':unit);
  }
  return claims;
}
function isCorrectionEvidence(value:string){
  return /\b(?:correct(?:ed|ion)?|revis(?:ed|ion)|replacement|adjust(?:ed|ment)|supersed(?:ed|es))\b/i.test(value);
}
function knownScopeClaims(scope:ReviewedScope|undefined,task:Mapping['tasks'][number]):QuantityClaim[]{
  if(!scope)return [];
  const taskText=`${task.description} ${task.evidence}`.toLowerCase();
  const claims:QuantityClaim[]=[];
  const addAnswer=(field:keyof ReviewedScope['answers'],unit:string,terms:RegExp)=>{
    const value=scope.answers[field];if(value?.trim()&&terms.test(taskText)){const quantity=Number(value.replaceAll(',',''));if(Number.isFinite(quantity)&&quantity>0)claims.push({quantity,unit:unitKey(unit)});}
  };
  addAnswer('laborHours','hour',/\b(?:labor|labour|hour|hr)\b/);
  addAnswer('cabinetBaseLf','lf',/\b(?:base|lower)\s+cabinet|\bcabinet\s+(?:base|lower)|\bcabinet\s+run\b/);
  addAnswer('cabinetUpperLf','lf',/\b(?:upper|wall)\s+cabinet|\bcabinet\s+(?:upper|wall)/);
  addAnswer('cabinetTallLf','lf',/\b(?:tall|pantry)\s+cabinet/);
  addAnswer('flooringSqft','sf',/\bfloor(?:ing)?\b/);
  addAnswer('tileSqft','sf',/\btile\b/);
  addAnswer('countertopSqft','sf',/\bcountertop|bench\s+top|worktop\b/);
  addAnswer('demolitionSqft','sf',/\bdemolition|tear.?out\b/);
  addAnswer('trimLf','lf',/\btrim|baseboard\b/);
  addAnswer('sqft','sf',/\b(?:drywall|paint(?:ing)?|floor(?:ing)?|tile|project\s+area)\b/);
  return claims;
}
function quantityIssues(task:Mapping['tasks'][number],addition:{quantity:number;quantityEvidence:string;quantityRange?:{low:number;high:number}|null},unit:string,scope:ReviewedScope|undefined,taskCount:number,componentDescription='',materialPurchase=false){
  const taskText=`${task.description} ${task.evidence}`;
  const evidence=addition.quantityEvidence.trim();
  const claims=[...quantityClaims(taskText),...(taskCount===1?knownScopeClaims(scope,task):[])];
  const unknown=UNKNOWN_QUANTITY.test(taskText);
  const allowance=/^ALLOWANCE\s*:/i.test(evidence);
  const issues:string[]=[];
  const matching=matchingClaims(claims,unit);
  // Procurement overage changes purchased material, never installed work.
  // Require an explicit base quantity, waste percentage, labeled allowance
  // and range, and verify the arithmetic against the one reviewed quantity.
  const waste=evidence.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:(?:cutting|cut|material)\s+)?(?:waste|overage)\b/i);
  const range=addition.quantityRange;
  const procurementAllowance=materialPurchase&&allowance&&matching.length===1&&Boolean(waste)&&Number(waste?.[1])>0&&Number(waste?.[1])<=100
    &&Boolean(range&&range.low>0&&range.low<=addition.quantity&&range.high>=addition.quantity)
    &&matchingClaims(quantityClaims(evidence),unit).some(claim=>claim.quantity===matching[0].quantity)
    &&Math.abs(matching[0].quantity*(1+Number(waste?.[1])/100)-addition.quantity)<0.0001;
  // An unknown sibling component must not suppress a positive line for the
  // component that has an explicit reviewed quantity. The task-level issue is
  // still retained by catalogResolution, so the incomplete scope stays held.
  if(unknown&&!allowance&&!matching.length)issues.push(`${task.description}: quantity remains unmeasured; do not publish a confirmed ${unit} quantity.`);
  if(unknown&&allowance&&!addition.quantityEvidence.match(/ALLOWANCE\s*:/i))issues.push(`${task.description}: unresolved quantity allowances must be labeled.`);
  if(unknown&&allowance&&!addition.quantityRange)issues.push(`${task.description}: an allowance for an unresolved quantity needs a positive quantity range.`);
  if(matching.length&&(!matching.some(claim=>Math.abs(claim.quantity-addition.quantity)<0.0001)||matching.length>1)&&!isCorrectionEvidence(evidence)&&!procurementAllowance){
    issues.push(`${task.description}: mapped ${addition.quantity} ${unit} does not match the explicit quantity in the reviewed scope.`);
  }
  // A bench/counter top can share LF units with cabinetry but is not evidence
  // of a base run. Keep this semantic distinction even when the number agrees.
  if(/\b(?:bench\s*top|countertop|worktop)\b/i.test(task.evidence)&&
    /\b(?:base|lower)\s+cabinet|\bcabinet\s+run\b/i.test(`${task.description} ${task.evidence} ${componentDescription}`)&&
    !/\b(?:base|lower)\s+cabinet|\bcabinet\s+run\b/i.test(task.evidence)){
    issues.push(`${task.description}: a bench/counter top measurement cannot establish base cabinet length.`);
  }
  return [...new Set(issues)];
}
function matchingClaims(claims:QuantityClaim[],unit:string){
  return [...new Map(claims.filter(claim=>unitKey(claim.unit)===unitKey(unit)).map(claim=>[`${claim.quantity}:${unitKey(claim.unit)}`,claim])).values()];
}
function existingQuantityIssues(task:Mapping['tasks'][number],line:{quantity:number;unit:string},scope:ReviewedScope|undefined,taskCount:number){
  const taskText=`${task.description} ${task.evidence}`;
  const claims=[...quantityClaims(taskText),...(taskCount===1?knownScopeClaims(scope,task):[])].filter(claim=>unitKey(claim.unit)===unitKey(line.unit));
  if(claims.length&&!claims.some(claim=>Math.abs(claim.quantity-line.quantity)<0.0001)){
    return [`${task.description}: existing priced ${line.quantity} ${line.unit} does not match the explicit quantity in the reviewed scope.`];
  }
  if(UNKNOWN_QUANTITY.test(taskText)&&!claims.length){
    return [`${task.description}: an unmeasured quantity cannot be covered by an existing confirmed line.`];
  }
  return [];
}

/** Research sees only actual positive priced components. Proposed additions
 * may have been rejected; reporting them as covered silently omits material. */
export function coveredWork(task:{id:string;existingLineIds:string[]},priced:{id:string;description:string;quantity:number;unit:string;unitCost:number}[],acceptedRules:CostRule[]){
  const ids=new Set([...task.existingLineIds,...acceptedRules.filter(rule=>rule.scopeTaskId===task.id).map(rule=>rule.id)]);
  return priced.filter(line=>ids.has(line.id)&&line.quantity>0&&line.unitCost>0)
    .map(({description,quantity,unit})=>({description,quantity,unit}));
}
export function marketResolution(raw:unknown,urls:string[],tasks:Mapping['tasks'],now:Date,offset=0,location='',scope?:ReviewedScope):ScopePriceResolution{
  const market=marketSchema.parse(raw);const result:ScopePriceResolution={rules:[],assumptions:[...market.notes],issues:[...market.issues]};
  for(const r of market.rates){
    const t=tasks.find(t=>t.id===r.taskId&&t.researchDescription);
    if(!t)throw new Error('Unknown researched scope task');
    if(taskIsUnselected(t)){
      result.issues.push(`${t.description}: unselected alternative or excluded work is not billable.`);
      continue;
    }
    const unresolved=unresolvedQuantityIssue(t);
    const hasAllowance=/^ALLOWANCE\s*:/i.test(r.quantityEvidence)&&Boolean(r.quantityRange);
    if(unresolved&&!hasAllowance)result.issues.push(unresolved);
    const quantityFindings=quantityIssues(t,{quantity:r.quantity,quantityEvidence:r.quantityEvidence,quantityRange:r.quantityRange},r.unit,scope,tasks.length,r.description,r.basis==='material-purchase');
    if(quantityFindings.length){result.issues.push(...quantityFindings);continue;}
    const hosts=new Set<string>();
    for(const s of r.sources){
      const u=new URL(s.url);const date=Date.parse(s.publishedAt);
      if(unitKey(s.unit)!==unitKey(r.unit)||s.costBasis!==r.basis)throw new Error('Incompatible benchmark unit or cost basis');
      if(u.protocol!=='https:'||!urls.includes(s.url)||s.dateBasis!=='retrieved'&&(!Number.isFinite(date)||date>now.getTime()||now.getTime()-date>365*86400000)||s.high<s.low||s.excerpt.split(/\s+/).length>25)throw new Error('Unsupported market source');
      hosts.add(u.hostname.replace(/^www\./,''));
    }
    if(hosts.size<2)throw new Error('Independent market sources required');
    if(r.basis!=='material-purchase'&&r.landedCost)throw new Error('Purchase adjustments cannot apply to a labor or installed offering');
    if(r.landedCost)for(const evidence of [r.landedCost.taxEvidence,r.landedCost.freightEvidence]){
      const date=Date.parse(evidence.publishedAt);
      if(new URL(evidence.url).protocol!=='https:'||!urls.includes(evidence.url)||evidence.dateBasis==='published'&&(!Number.isFinite(date)||date>now.getTime()||now.getTime()-date>365*86400000)||evidence.excerpt.split(/\s+/).length>25)throw new Error('Unsupported purchase adjustment evidence');
    }
    const landed=(product:number)=>r.landedCost?product*(1+r.landedCost.taxRate)+r.landedCost.freightPerUnit*(1+(r.landedCost.taxOnFreight?r.landedCost.taxRate:0)):product;
    const amount=r.sources.reduce((sum,s)=>sum+landed((s.low+s.high)/2),0)/r.sources.length;
    const purchaseNote=r.landedCost?`Purchase calculation per ${r.unit}: product price plus ${(r.landedCost.taxRate*100).toFixed(4)}% tax, plus $${r.landedCost.freightPerUnit.toFixed(2)} freight${r.landedCost.taxOnFreight?' with tax on freight':''}. Tax evidence: ${JSON.stringify(r.landedCost.taxEvidence)}. Freight evidence: ${JSON.stringify(r.landedCost.freightEvidence)}. Retrieved ${now.toISOString()}.`:'';

    const sourceDate=(s:z.infer<typeof observation>)=>s.dateBasis==='retrieved'?now.toISOString().slice(0,10):s.publishedAt;
    const sources=r.sources.map(s=>`${s.url} (${s.dateBasis==='retrieved'?'retrieved':'published'} ${sourceDate(s)}; ${s.region}; ${s.low} to ${s.high} USD/${r.unit})`).join('; ');
    result.rules.push({scopeTaskId:t.id,id:`market-${offset+result.rules.length+1}`,unitRateContext:{currency:'USD',basis:r.basis,includes:r.includes,excludes:r.excludes,assumptions:['Regional average unit-cost allowance; not a supplier quote. Benchmark locality and purchase incidentals require verification.',...(purchaseNote?[purchaseNote]:[])]},description:r.description,unit:r.unit,building:r.building,floor:r.floor,quantityRange:r.quantityRange||undefined,allowance:true,unitCostRange:{low:Math.min(...r.sources.map(s=>landed(s.low))),high:Math.max(...r.sources.map(s=>landed(s.high)))},quantity:{fixed:r.quantity,factor:1},unitCost:Math.round(amount*10000)/10000,category:r.basis==='material-purchase'?'materials':r.basis==='trade-labor'?'field-labor':'subcontractors',priceBasis:'direct-cost',estimatingBasis:'sourced-market-average',evidence:{basis:'sourced-market-average',provenance:{status:'estimated',location:location||r.sources.map(s=>s.region).join('; '),retrievedAt:now.toISOString(),assumptions:[r.quantityEvidence,'Regional average unit-cost allowance; not a supplier quote. Benchmark locality and purchase incidentals require verification.',...(purchaseNote?[purchaseNote]:[]),'Includes: '+r.includes,'Excludes: '+r.excludes],sources:r.sources.map(s=>({url:s.url,date:sourceDate(s),dateBasis:s.dateBasis||'published',region:s.region,low:s.low,high:s.high}))},reference:`Mean of published source midpoints with sourced purchase adjustments: ${sources}. ${purchaseNote} Includes: ${r.includes}. Excludes: ${r.excludes}. ${r.quantityEvidence}`,verifiedAt:now.toISOString(),validUntil:new Date(now.getTime()+30*86400000).toISOString()}});
    result.assumptions.push(`${r.description}: sourced average-cost allowance for ${r.quantity} ${r.unit}. Includes ${r.includes}. ${purchaseNote} ${r.excludes?`Excludes ${r.excludes}.`:""} Basis: ${r.sources.map(s=>`${s.region} (${s.sourceType})`).join('; ')}. ${r.sources.some(s=>s.dateBasis==='retrieved')?'Publication date unavailable; freshness requires verification. ':''}Preliminary unit-cost benchmark, not a supplier quote. Verify selections and any incidental charges not specified in the benchmark. Sources: ${r.sources.map(s=>s.url).join("; ")}`);
  }
  for(const t of tasks.filter(t=>t.researchDescription))if(!market.rates.some(r=>r.taskId===t.id))result.issues.push(`${t.description}: no defensible average rate found.`);
  return result;
}

/** Clearly labeled regional planning averages. Same quantity defenses as sourced rates; never presented as verified pricing. */
export function planningResolution(raw:unknown,tasks:Mapping['tasks'],now:Date,offset=0,location='',scope?:ReviewedScope):ScopePriceResolution{
  const planning=planningSchema.parse(raw);const result:ScopePriceResolution={rules:[],assumptions:[...planning.notes],issues:[...planning.issues]};
  for(const r of planning.rates){
    const t=tasks.find(t=>t.id===r.taskId&&t.researchDescription);
    if(!t)throw new Error('Unknown planning scope task');
    if(taskIsUnselected(t)){result.issues.push(`${t.description}: unselected alternative or excluded work is not billable.`);continue;}
    const unresolved=unresolvedQuantityIssue(t);
    const hasAllowance=/^ALLOWANCE\s*:/i.test(r.quantityEvidence)&&Boolean(r.quantityRange);
    if(unresolved&&!hasAllowance)result.issues.push(unresolved);
    const quantityFindings=quantityIssues(t,{quantity:r.quantity,quantityEvidence:r.quantityEvidence,quantityRange:r.quantityRange},r.unit,scope,tasks.length,r.description,r.basis==='material-purchase');
    if(quantityFindings.length){result.issues.push(...quantityFindings);continue;}
    if(r.high<r.low||r.high>r.low*6)throw new Error('Unsupported planning average range');
    const amount=(r.low+r.high)/2;
    const region=location||'Boise / Treasure Valley, Idaho';
    result.rules.push({scopeTaskId:t.id,id:`planning-${offset+result.rules.length+1}`,unitRateContext:{currency:'USD',basis:r.basis,includes:r.includes,excludes:r.excludes,assumptions:['Regional planning average from general estimating knowledge; not a supplier quote, published benchmark or verified local price. Confirm current local rates before a firm proposal.',`Confidence: ${r.confidence}. ${r.rationale}`]},description:r.description,unit:r.unit,building:r.building,floor:r.floor,quantityRange:r.quantityRange||undefined,allowance:true,unitCostRange:{low:r.low,high:r.high},quantity:{fixed:r.quantity,factor:1},unitCost:Math.round(amount*10000)/10000,category:r.basis==='material-purchase'?'materials':r.basis==='trade-labor'?'field-labor':'subcontractors',priceBasis:'direct-cost',estimatingBasis:'regional-planning-average',evidence:{basis:'regional-planning-average',provenance:{status:'estimated',location:region,retrievedAt:now.toISOString(),assumptions:[r.quantityEvidence,'Regional planning average from general estimating knowledge; not a supplier quote, published benchmark or verified local price. Confirm current local rates before a firm proposal.',`Confidence: ${r.confidence}. ${r.rationale}`,'Includes: '+r.includes,'Excludes: '+r.excludes],sources:[]},reference:`Regional planning average (${r.confidence} confidence, unverified) for ${region}: ${r.low} to ${r.high} USD/${r.unit}. ${r.rationale} Includes: ${r.includes}. Excludes: ${r.excludes}. ${r.quantityEvidence}`,verifiedAt:now.toISOString(),validUntil:new Date(now.getTime()+30*86400000).toISOString()}});
    result.assumptions.push(`${r.description}: regional planning average allowance for ${r.quantity} ${r.unit} (${r.confidence} confidence; not verified local pricing). ${r.rationale} Includes ${r.includes}. ${r.excludes?`Excludes ${r.excludes}.`:''} Confirm current local rates before a firm proposal.`);
  }
  for(const t of tasks.filter(t=>t.researchDescription))if(!planning.rates.some(r=>r.taskId===t.id))result.issues.push(`${t.description}: no defensible planning average could be supported.`);
  return result;
}
/** Audit findings that only ask for later confirmation (dimensions, owner
 * selections, an allowance's site extent, the methodology used) are
 * assumptions to disclose, not reasons to withhold a preliminary range. A
 * finding that names omitted, duplicated, conflicting, unsupported or
 * unverified pricing stays blocking. */
export function advisoryIssue(text:string):boolean{
  const t=text.toLowerCase();
  // An allowance basis never excuses omitted work or a rejected priced line.
  // Check concrete defects before the planning-basis exceptions below.
  if(/duplicat|double[- ]count|\bomit|omission|\bunpriced\b|missing (?:work|materials?|labor|components?|quantit(?:y|ies)|scope)|not (?:fully |been )?(?:priced|covered|included|supported)|no positive priced|not converted into a priced line|does not match|disagrees|wrong (?:unit|uom|responsibilit)|fabricat|out of scope/.test(t))return false;
  // A planning-average or allowance caveat is disclosed with the range, never a
  // reason to withhold it. These notes routinely say "not verified local
  // pricing", which the defect list below would otherwise treat as a defect.
  if(/\b(regional planning average|planning average allowance|planning allowances?|published cost research was not used|not verified local (?:pricing|quotes))\b/.test(t))return true;
  // The audit may fault a regional planning allowance (planning-N line) for what it is by design: uncited, unranged, unlabelled. That is disclosure, not a defect; a duplicate, omission or wrong unit on the same line still blocks.
  if(/\bplanning-\d+\b/.test(t)&&!/duplicat|double[- ]count|\bomit|omission|missing work|wrong (?:unit|uom|responsibilit)|fabricat|not (?:been )?requested|out of scope/.test(t))return true;
  if(/\b(omit(?:s|ted|ting)?|omission|missing|not (?:been |be )?(?:verified|covered|priced|supported|found|included)|unverified|duplicat|double[- ]count|conflict|unsupported|fabricat|incorrect|wrong|mismatch|reconcile|cannot|could not|unpriced|unknown component|no (?:catalog|rate|price|evidence)|exceeds|out of scope|not (?:in|part of) the|excluded work|hidden in exclusion)\b/.test(t))return false;
  // Word forms of the same concept must classify the same way. A research
  // note reading "should be confirmed as available" was refused here because
  // this matched only \bconfirm\b, and that single note, carrying no defect,
  // withheld an entire estimate. The negative list above is the guarantee and
  // is unchanged; this only stops a suffix deciding whether a range ships.
  return /\b(confirm(?:ed|ation|ing)?|verif(?:y|ied|ication)|verify at site|allowance|assum(?:e|ed|es|ing|ption|ptions)|methodology|per stated|see each line|to be selected|owner selection|pending selection|subject to|typical|estimat(?:e|ed|es|ing)|modeled|rounded)\b/.test(t);
}

/** Map one batch of inventory tasks, and keep going when the provider is slow.
 *
 * A twelve-task batch of a large scope was measured at over two minutes on the
 * live site and hit the stage ceiling; the replay then repeated the identical
 * call, three times, and the visitor got no estimate. A batch that times out
 * is now split in half and both halves run at once - same model, same prompt,
 * fewer tasks per call - down to three tasks. A batch that still cannot finish
 * pauses the job so the next pass resumes it, instead of counting as a failed
 * attempt; only a batch that has timed out three times is a real failure. */
async function mapBatch<T extends {id:string}>(request:PricingRequest,taskBatch:T[],build:(batch:T[])=>unknown,remaining:()=>number):Promise<Mapping>{
  try{
    const mapped=await request(MAP,build(taskBatch),false,remaining());
    return mappingSchema.parse(mapped.value);
  }catch(error){
    if(!isPricingStageTimeout(error))throw error;
    if(error.message==='pricing-stage-exhausted'||taskBatch.length<=3){
      if(error.message==='pricing-stage-exhausted')throw error;
      throw new PricingPending('Pricing is taking longer than usual on part of your scope. Your finished steps are saved; continuing.',1500);
    }
    const middle=Math.ceil(taskBatch.length/2);
    const halves=await Promise.all([taskBatch.slice(0,middle),taskBatch.slice(middle)].map(half=>mapBatch(request,half,build,remaining)));
    return mergeMappings(halves);
  }
}
/** Combine concurrently mapped batches deterministically. Tasks are disjoint by
 * construction; replacements and removed exclusions are deduplicated because
 * two batches can each name the same wrong line. The independent audit still
 * verifies every cross-batch interaction afterwards. */
function mergeMappings(parts:Mapping[]):Mapping{
  const seenLine=new Set<string>(),seenExclusion=new Set<string>();
  return {
    tasks:parts.flatMap(p=>p.tasks),
    issues:[...new Set(parts.flatMap(p=>p.issues))],
    notes:[...new Set(parts.flatMap(p=>p.notes))],
    replacements:parts.flatMap(p=>p.replacements).filter(r=>!seenLine.has(r.lineId)&&seenLine.add(r.lineId)),
    removeExclusions:parts.flatMap(p=>p.removeExclusions).filter(e=>!seenExclusion.has(e.text)&&seenExclusion.add(e.text)),
  };
}
/** Shown to a visitor when pricing genuinely could not finish automatically.
 * Nothing about it asks them for anything, because nothing they can type will
 * change it. It is the one review item that is a handoff, not a question. */
/** Split a list into consecutive groups of `size`; the last group may be shorter. */
const batchesOf=<T,>(items:T[],size:number):T[][]=>{const out:T[][]=[];for(let start=0;start<items.length;start+=size)out.push(items.slice(start,start+size));return out;};
export const HANDOFF_ISSUE='Automatic pricing could not finish for part of this scope. Your project and details are saved, and a person will complete your estimate and email it - nothing further is needed from you.';
export async function priceCompleteScope(scope:ReviewedScope,configuration:EstimatorConfiguration,request:PricingRequest=requestPricing,now=new Date(),absoluteDeadline=Date.now()+SERVER_BUDGET_MS){
  // Retained clarification alternatives are archival provenance, not active
  // scope. Every mapper/audit payload below must use the projected extraction
  // so an old option cannot be priced as if the customer selected it.
  const pricingSource=activePricingSource(scope);
  const pricingExtraction=pricingSource.extraction;
  const pricingScope={...scope,answers:pricingSource.answers,extraction:pricingExtraction};
  const replaceBase=hasRestrictedScope(scope.answers,pricingExtraction?.instructions);
  const resolution:ScopePriceResolution={rules:[],assumptions:[],issues:[],replaceBase};
  const base=priceReviewedScope(scope,configuration,now,replaceBase?resolution:undefined);
  // The caller bounds the pass; stages are saved individually so a pass that
  // ends between stages loses nothing. Capping here at one browser budget
  // aborted any stage longer than the remaining pass and restarted it forever.
  const deadline=absoluteDeadline;
  const original=pricingSource;
  const sourceParts=pricingSourceParts(pricingScope);
  const taskSources=new Map<string,number>();
  const auditTrail:{version:string;scopeHash:string;tasks:unknown[];adjustments:unknown;research:unknown;verification:unknown;issues:string[]}={version:'complete-scope-v3',scopeHash:createHash('sha256').update(JSON.stringify({scope:pricingScope,configuration})).digest('hex'),tasks:[],adjustments:null,research:null,verification:null,issues:[]};
  try{
    const lines=existingLines(base);
    const inventory:z.infer<typeof inventorySchema>={tasks:[],issues:[],notes:[]};
    for(const [index,part] of sourceParts.entries()){
      const retained=sourceParts.length===1?retainedScopeInventory(scope):null;
      const inventoried=retained?{value:retained,sourceUrls:[]}:await request(INVENTORY,{original:part,priorTaskDescriptions:inventory.tasks.map(t=>({id:t.id,description:t.description,evidence:t.evidence}))},false,deadline-Date.now());
      const section=inventorySchema.parse(inventoried.value);inventory.issues.push(...section.issues);inventory.notes.push(...section.notes);
      for(const item of section.tasks){
        const previous=inventory.tasks.find(t=>taskSources.get(t.id)!==index&&t.id.endsWith(`:${item.id}`)&&t.description===item.description&&t.evidence===item.evidence);if(previous)continue;
        const t={...item,id:sourceParts.length===1?item.id:`${index+1}:${item.id}`};inventory.tasks.push(t);taskSources.set(t.id,index);
      }
    }
    if(new Set(inventory.tasks.map(t=>t.id)).size!==inventory.tasks.length)throw new Error('Duplicate inventory task');
    // Batches map concurrently. priorMappedTasks used to serialise them so a
    // later batch could see earlier additions; the independent audit below
    // already verifies duplicates and conflicts across the whole mapping, so
    // that ordering bought latency, not correctness. Wall-clock for mapping is
    // now the slowest batch, not the sum of all of them.
    const mappingInput=(taskBatch:typeof inventory.tasks)=>({original:sourceParts.length===1?original:{sections:[...new Set(taskBatch.map(t=>taskSources.get(t.id)!))].map(i=>sourceParts[i])},taskBatch,priorMappedTasks:[],priorReplacements:[],existingLines:lines.map(({id,description,quantity,unit,unitCost,category,trade,quantitySource})=>({id,description,quantity,unit,unitCost,category,trade,quantitySource})),defaultExclusions:base.customer.exclusions,date:now.toISOString(),catalogImportedAt:configuration.planningCatalog?.importedAt,regionalRates:configuration.regionalRates,catalog:(configuration.planningCatalog?.rates||[]).map(({code,description,type,unit,amount,basis})=>({code,description,type,unit,amount,basis}))});
    const mappedBatches=await Promise.all(batchesOf(inventory.tasks,6).map(taskBatch=>mapBatch(request,taskBatch,mappingInput,()=>deadline-Date.now())));
    const mapping:Mapping={tasks:[],issues:[...inventory.issues],notes:[...inventory.notes],replacements:[],removeExclusions:[]};
    for(const [batchIndex,batch] of mappedBatches.entries()){
      const taskBatch=batchesOf(inventory.tasks,6)[batchIndex];
      if(batch.tasks.length!==taskBatch.length||new Set(batch.tasks.map(t=>t.id)).size!==taskBatch.length||batch.tasks.some(t=>!taskBatch.some(expected=>expected.id===t.id)))throw new Error('Incomplete mapping batch');
      // Preserve inventory wording so later stages cannot quietly rewrite scope.
      mapping.tasks.push(...batch.tasks.map(t=>({...t,...taskBatch.find(expected=>expected.id===t.id)!})));
      mapping.issues.push(...batch.issues);mapping.notes.push(...batch.notes);mapping.replacements.push(...batch.replacements);mapping.removeExclusions.push(...batch.removeExclusions);
    }
    mapping.replacements=mapping.replacements.filter((r,i,all)=>all.findIndex(v=>v.lineId===r.lineId)===i);
    mapping.removeExclusions=mapping.removeExclusions.filter((r,i,all)=>all.findIndex(v=>v.text===r.text)===i);
    auditTrail.tasks=mapping.tasks;
    const catalog=catalogResolution(mapping,configuration,lines,now,scope);
    if(mapping.removeExclusions.some(e=>!base.customer.exclusions.some(value=>value===e.text)))throw new Error('Unknown default exclusion');
    resolution.removeLineIds=catalog.removeLineIds;resolution.removeExclusions=catalog.removeExclusions;
    auditTrail.adjustments={replacements:mapping.replacements,removeExclusions:mapping.removeExclusions};
    resolution.rules.push(...catalog.rules);resolution.assumptions.push(...catalog.assumptions);resolution.issues.push(...catalog.issues);
    const modelIssues=new Set([...mapping.issues,...mapping.tasks.flatMap(t=>t.issues.map(issue=>`${t.description}: ${issue}`))]);
    const gaps=mapping.tasks.filter(t=>t.researchDescription);
    const research:PricingReply[]=[];auditTrail.research=research;
    const region=scope.answers.location||'Boise / Treasure Valley, Idaho';
    /** Published cost research first, within a bounded time; otherwise a clearly
     * labeled regional planning average. Independent batches run in parallel and
     * every provider reply is saved by content, so a resumed request reuses them. */
    const priceGapBatch=async(gapBatch:Mapping['tasks'],batchIndex:number,covered:(task:Mapping['tasks'][number])=>unknown[],priorIssues?:string[]):Promise<{replies:PricingReply[];resolution:ScopePriceResolution;modelIssues:string[]}>=>{
      const replies:PricingReply[]=[];const offset=batchIndex*100;
      const tasksInput=gapBatch.map(t=>({id:t.id,description:t.researchDescription,quantityEvidence:t.evidence,alreadyCovered:covered(t)}));
      let researchFailure='';
      // Past the research window the job goes straight to the labeled planning average; the visitor is not kept waiting on a second search.
      const age=Date.now()-now.getTime();const pastWindow=age>RESEARCH_WINDOW_MS&&age<6*60*60*1000;
      if(pastWindow)researchFailure='the pricing job passed its research window';
      if(!pastWindow)try{
        let researched=await request(RESEARCH,{date:now.toISOString().slice(0,10),region,tasks:tasksInput,...(priorIssues?{priorIssues}:{})},true,Math.min(RESEARCH_STAGE_MS,deadline-Date.now()));
        // JSON syntax alone does not ensure the research schema is valid. Save a
        // separate formatting stage for valid JSON with arrays/objects in string
        // fields, retaining the original report and tool-returned source URLs.
        if(!marketSchema.safeParse(researched.value).success){
          const normalized=await request(normalizeResearch,{requested:{tasks:gapBatch.map(t=>({id:t.id,description:t.researchDescription,quantityEvidence:t.evidence}))},report:researched.sourceReport||JSON.stringify(researched.value),sourceUrls:researched.sourceUrls},false,deadline-Date.now());
          researched={...researched,value:marketSchema.parse(normalized.value)};
        }
        replies.push(researched);
        const market=marketResolution(researched.value,researched.sourceUrls,gapBatch,now,offset,region,scope);
        return {replies,resolution:market,modelIssues:marketSchema.parse(researched.value).issues};
      }catch(error){
        if(isPricingPending(error)||isProcessingDeadline(error))throw error;
        researchFailure=isPricingStageTimeout(error)?'published cost research did not finish within its time allowance':error instanceof Error?error.message:'invalid source';
      }
      const planned=await request(PLANNING_AVERAGE,{date:now.toISOString().slice(0,10),region,tasks:tasksInput,...(priorIssues?{priorIssues}:{})},false,deadline-Date.now());
      replies.push(planned);
      const planning=planningResolution(planned.value,gapBatch,now,offset,region,scope);
      planning.assumptions.unshift(`Published cost research was not used for ${gapBatch.map(t=>t.description).join('; ')} (${researchFailure}). A regional planning average allowance is included instead; it is not verified local pricing.`);
      return {replies,resolution:planning,modelIssues:planningSchema.parse(planned.value).issues};
    };
    const mergeGapResults=(results:Awaited<ReturnType<typeof priceGapBatch>>[])=>{
      for(const priced of results){research.push(...priced.replies);priced.modelIssues.forEach(issue=>modelIssues.add(issue));resolution.rules.push(...priced.resolution.rules);resolution.assumptions.push(...priced.resolution.assumptions);resolution.issues.push(...priced.resolution.issues);}
    };
    const mappedLines=existingLines(priceReviewedScope(scope,configuration,now,resolution));
    mergeGapResults(await Promise.all(batchesOf(gaps,3).map((gapBatch,index)=>priceGapBatch(gapBatch,index,t=>coveredWork(t,mappedLines,resolution.rules)))));
    const audit:z.infer<typeof auditSchema>={coveredTaskIds:[],issues:[],notes:[],resolvedIssues:[]};
    const reconcileIssues=()=>{
      if(audit.issues.length||mapping.tasks.some(t=>!audit.coveredTaskIds.includes(t.id)))return;
      const positiveLines=new Set(existingLines(priceReviewedScope(scope,configuration,now,resolution)).filter(line=>line.quantity*line.unitCost>0).map(line=>line.id));
      for(const resolved of audit.resolvedIssues){
        if(!resolution.issues.includes(resolved.issue))continue;
        if(!modelIssues.has(resolved.issue)||resolved.lineIds.some(id=>!positiveLines.has(id)))throw new Error('Unsupported pricing issue resolution');
        resolution.issues=resolution.issues.filter(issue=>issue!==resolved.issue);
        resolution.assumptions.push(`${resolved.issue} Review evidence: ${resolved.reason}`);
      }
    };
    const verifiedParts=await Promise.all(sourceParts.map((part,index)=>request(AUDIT,{original:part,tasks:mapping.tasks.filter(t=>sourceParts.length===1||taskSources.get(t.id)===index),allTaskDescriptions:mapping.tasks.map(t=>({id:t.id,description:t.description})),priorPricingIssues:resolution.issues,existingLines:lines.filter(l=>!resolution.removeLineIds?.includes(l.id)),removedLines:lines.filter(l=>resolution.removeLineIds?.includes(l.id)),adjustments:auditTrail.adjustments,additionalRules:resolution.rules,existingExclusions:base.customer.exclusions.filter(e=>!resolution.removeExclusions?.includes(e)),research:auditTrail.research},false,deadline-Date.now())));
    for(const verified of verifiedParts){
      const section=auditSchema.parse(verified.value);audit.coveredTaskIds.push(...section.coveredTaskIds);audit.issues.push(...section.issues);audit.notes.push(...section.notes);resolution.assumptions.push(...section.notes);audit.resolvedIssues.push(...section.resolvedIssues);
    }
    audit.coveredTaskIds=[...new Set(audit.coveredTaskIds)];
    reconcileIssues();
    // A failed coverage audit is actionable work, not immediately a dead end.
    // Re-map against the actually priced components, then independently audit
    // the repaired estimate. Removed components cannot remain in the total.
    // Advisory notes (allowances, items to confirm) are not defects; they are
    // released with the range. Only blocking issues, audit findings or an
    // uncovered task justify the repair pass, which costs a second mapping,
    // research and audit round.
    const blockingIssues=resolution.issues.filter(issue=>!advisoryIssue(issue));
    // An audit note about a planning allowance's basis, or a task left uncovered only because a planning or sourced allowance prices it, is disclosure, not a reason for a repair round.
    const allowancePricedTask=(taskId:string)=>resolution.rules.some(rule=>rule.scopeTaskId===taskId&&(rule.id.startsWith('planning-')||rule.id.startsWith('market-'))&&rule.quantity.fixed!==undefined&&rule.quantity.fixed>0);
    const blockingAuditIssues=audit.issues.filter(issue=>!advisoryIssue(issue));
    // A repair round costs a second mapping, research and audit. Past the repair budget (measured from the pricing job's start) the
    // scope stays saved with unresolved findings; time alone cannot authorize a partial price.
    // Measured against the job's pricing clock. A clock older than any job lifetime is a replay or a fixed test clock, not a
    // running job, and does not count against the budget.
    const sinceStart=Date.now()-now.getTime();
    const repairBudgetLeft=!(sinceStart>REPAIR_BUDGET_MS&&sinceStart<6*60*60*1000);
    const repairNeeded=blockingIssues.length||blockingAuditIssues.length||mapping.tasks.some(t=>!audit.coveredTaskIds.includes(t.id)&&!allowancePricedTask(t.id));
    if(repairNeeded&&!repairBudgetLeft)auditTrail.issues.push('Repair round skipped: the pricing job exceeded its repair budget; unresolved scope findings remain blocking.');
    if(repairNeeded&&repairBudgetLeft){
      const priorIssues=[...resolution.issues,...audit.issues];
      const beforeRepair=priceReviewedScope(scope,configuration,now,resolution);
      const pricedComponents=existingLines(beforeRepair);
      const fixes:Mapping={tasks:[],issues:[],notes:[],replacements:[],removeExclusions:[]};
      const repairInput=(taskBatch:typeof mapping.tasks)=>({original:sourceParts.length===1?original:{sections:[...new Set(taskBatch.map(t=>taskSources.get(t.id)!))].map(i=>sourceParts[i])},taskBatch:taskBatch.map(({id,description,evidence})=>({id,description,evidence})),pricingIssues:priorIssues,repairInstruction:'Resolve the audit findings with measured costs or item-specific allowances. Existing components already contain prior additions. Reference them instead of charging again; explicitly replace wrong or incomplete components. An unknown dimension may use an evidenced modeled quantity range, never an invented measurement.',priorMappedTasks:[],priorReplacements:[],existingLines:pricedComponents,defaultExclusions:beforeRepair.customer.exclusions,catalog:configuration.planningCatalog?.rates||[],regionalRates:configuration.regionalRates,date:now.toISOString()});
      const repairedBatches=await Promise.all(batchesOf(mapping.tasks,6).map(taskBatch=>mapBatch(request,taskBatch,repairInput,()=>deadline-Date.now())));
      for(const [batchIndex,batch] of repairedBatches.entries()){
        const taskBatch=batchesOf(mapping.tasks,6)[batchIndex];
        if(batch.tasks.length!==taskBatch.length||new Set(batch.tasks.map(t=>t.id)).size!==taskBatch.length||batch.tasks.some(t=>!taskBatch.some(expected=>expected.id===t.id)))throw new Error('Incomplete repair batch');
        fixes.tasks.push(...batch.tasks.map(t=>({...t,...taskBatch.find(x=>x.id===t.id)!,existingLineIds:t.existingLineIds,additions:t.additions,researchDescription:t.researchDescription,issues:t.issues})));
        fixes.issues.push(...batch.issues);fixes.notes.push(...batch.notes);fixes.replacements.push(...batch.replacements);fixes.removeExclusions.push(...batch.removeExclusions);
      }
      const repaired=catalogResolution(fixes,configuration,pricedComponents,now,scope);
      if(fixes.removeExclusions.some(e=>!beforeRepair.customer.exclusions.some(value=>value===e.text)))throw new Error('Unknown repair exclusion');
      resolution.rules=resolution.rules.filter(r=>!repaired.removeLineIds?.includes(r.id));
      resolution.rules.push(...repaired.rules.map(r=>({...r,id:`repair-${r.id}`})));
      resolution.removeLineIds=[...new Set([...(resolution.removeLineIds||[]),...(repaired.removeLineIds||[])])];
      resolution.removeExclusions=[...new Set([...(resolution.removeExclusions||[]),...(repaired.removeExclusions||[])])];
      resolution.assumptions.push(...repaired.assumptions);
      // Repair is additive. A repair response may add findings, but it
      // cannot erase a genuine issue already attached to the staged
      // resolution (for example an unresolved quantity or rejected source).
      // The one intentional exception is a task-scoped "no supported price"
      // finding that this repair actually replaces with a positive rule.
      // Keep inventory findings as well; the final audit can still resolve a
      // specific issue through its existing evidence-backed path.
      const repairedTaskIds=new Set(repaired.rules.filter(rule=>rule.scopeTaskId&&rule.quantity.fixed!==undefined&&rule.quantity.fixed>0).map(rule=>rule.scopeTaskId));
      const repairedDescriptions=new Set(fixes.tasks.filter(task=>repairedTaskIds.has(task.id)).map(task=>task.description));
      // A positive repair resolves only the exact no-price placeholder that
      // it replaces. Quantity mismatches, unknown components, audit failures
      // and other blockers remain attached to the repaired scope.
      const repairedNoPriceIssues=new Set([...repairedDescriptions].map(description=>`${description}: no supported price.`));
      const carriedIssues=resolution.issues.filter(issue=>!repairedNoPriceIssues.has(issue));
      resolution.issues=[...new Set([...carriedIssues,...inventory.issues,...repaired.issues])];
      [...fixes.issues,...fixes.tasks.flatMap(t=>t.issues.map(issue=>`${t.description}: ${issue}`))].forEach(issue=>modelIssues.add(issue));
      mapping.tasks=fixes.tasks;
      // Research already priced a task's gap in the first pass. The repair round
      // researches a gap again only when the audit named that task; those
      // earlier rules are replaced, not counted a second time. Every other
      // researched task keeps its rules, which is also what makes repair fast.
      const researchRule=(rule:{id:string;scopeTaskId?:string})=>Boolean(rule.scopeTaskId)&&(rule.id.startsWith('market-')||rule.id.startsWith('planning-'));
      const researchedTaskIds=new Set(resolution.rules.filter(researchRule).map(rule=>rule.scopeTaskId));
      const namedByAudit=(task:{description:string})=>priorIssues.some(issue=>issue.toLowerCase().includes(task.description.toLowerCase()));
      const repairGaps=fixes.tasks.filter(t=>t.researchDescription&&(!researchedTaskIds.has(t.id)||namedByAudit(t)));
      const replaced=new Set(repairGaps.map(t=>t.id));
      resolution.rules=resolution.rules.filter(rule=>!(researchRule(rule)&&replaced.has(rule.scopeTaskId!)));
      const repairedLines=existingLines(priceReviewedScope(scope,configuration,now,resolution));
      mergeGapResults(await Promise.all(batchesOf(repairGaps,3).map((gapBatch,index)=>priceGapBatch(gapBatch,1000+index,t=>coveredWork(t,repairedLines,resolution.rules),priorIssues))));
      audit.coveredTaskIds=[];audit.issues=[];audit.resolvedIssues=[];
      const checkedParts=await Promise.all(sourceParts.map((part,index)=>request(AUDIT,{original:part,tasks:mapping.tasks.filter(t=>sourceParts.length===1||taskSources.get(t.id)===index),priorPricingIssues:resolution.issues,existingLines:lines.filter(l=>!resolution.removeLineIds?.includes(l.id)),additionalRules:resolution.rules,priorAuditIssues:priorIssues,removedLines:pricedComponents.filter(l=>resolution.removeLineIds?.includes(l.id)),existingExclusions:base.customer.exclusions.filter(e=>!resolution.removeExclusions?.includes(e)),research},false,deadline-Date.now())));
      for(const checked of checkedParts){
        const section=auditSchema.parse(checked.value);audit.coveredTaskIds.push(...section.coveredTaskIds);audit.issues.push(...section.issues);audit.notes.push(...section.notes);resolution.assumptions.push(...section.notes);audit.resolvedIssues.push(...section.resolvedIssues);
      }
      auditTrail.tasks=mapping.tasks;
      auditTrail.adjustments={initial:auditTrail.adjustments,repairReplacements:fixes.replacements,repairExclusions:fixes.removeExclusions,priorAuditIssues:priorIssues};
      reconcileIssues();
    }
    auditTrail.verification=audit;
    const ids=new Set(mapping.tasks.map(t=>t.id));
    if(audit.coveredTaskIds.some(id=>!ids.has(id)))throw new Error('Unknown audited task');
    resolution.issues.push(...audit.issues,...(pricingExtraction?.instructions?.questions||[]));
    for(const t of mapping.tasks)if(!t.existingLineIds.some(id=>(lines.some(l=>l.id===id)||resolution.rules.some(r=>r.id===id))&&!resolution.removeLineIds?.includes(id))&&!resolution.rules.some(r=>r.scopeTaskId===t.id))resolution.issues.push(`${t.description}: no positive priced component or allowance was produced.`);
    // Deterministic corrections come before the integrity checks: what the
    // code can prove wrong it fixes, and discloses; only judgement calls ride
    // along as items to confirm.
    const ruleKey=(rule:CostRule)=>JSON.stringify([rule.scopeTaskId,rule.description,rule.unit,rule.quantity,(rule as {unitCost?:number}).unitCost,(rule as {category?:string}).category]);
    const seenRules=new Set<string>();const repeated:string[]=[];
    resolution.rules=resolution.rules.filter(rule=>{const key=ruleKey(rule);if(seenRules.has(key)){repeated.push(rule.description);return false;}seenRules.add(key);return true;});
    if(repeated.length)resolution.assumptions.push(`Removed ${repeated.length} repeated component${repeated.length===1?'':'s'} so nothing is billed twice: ${[...new Set(repeated)].join('; ')}.`);
    const offCategory=(category:string,keep:(c:string|undefined)=>boolean)=>{
      const removeBase=lines.filter(l=>!resolution.removeLineIds?.includes(l.id)&&!keep(l.category)).map(l=>l.id);
      const removeRules=resolution.rules.filter(rule=>!keep((rule as {category?:string}).category)).map(rule=>rule.description);
      if(removeBase.length||removeRules.length){
        resolution.removeLineIds=[...new Set([...(resolution.removeLineIds||[]),...removeBase])];
        resolution.rules=resolution.rules.filter(rule=>keep((rule as {category?:string}).category));
        resolution.assumptions.push(`Per the ${category} instruction, ${removeBase.length+removeRules.length} component${removeBase.length+removeRules.length===1?' was':'s were'} left out of the range.`);
      }
    };
    if(pricingExtraction?.instructions?.laborOnly)offCategory('labor-only',c=>c==='field-labor');
    if(pricingExtraction?.instructions?.materialsOnly)offCategory('materials-only',c=>c==='materials');
    const allLines=[...lines.filter(l=>!resolution.removeLineIds?.includes(l.id)),...resolution.rules];
    const confirmedHours=Number(scope.answers.laborHours);
    const laborLines=allLines.filter(line=>line.category==='field-labor');
    const hourlyLines=laborLines.filter(line=>/^(?:h|hr|hrs|hour|hours)$/i.test(line.unit));
    const pricedHours=hourlyLines.reduce((sum,line)=>sum+(typeof line.quantity==='number'?line.quantity:line.quantity.fixed||0),0);
    // A task inventory can repeat a summary as another task. An audit claiming
    // coverage is not permission to bill both the components and their total.
    if(Number.isFinite(confirmedHours)&&confirmedHours>0&&hourlyLines.length
      &&(pricedHours>confirmedHours+0.000001
        ||hourlyLines.length===laborLines.length&&Math.abs(pricedHours-confirmedHours)>0.000001)){
      resolution.issues.push(`Priced hourly labor (${pricedHours}) does not reconcile with the confirmed ${confirmedHours} hours. Do not add summary totals to their components.`);
    }
    if(pricingExtraction?.instructions?.separateBuildings&&allLines.some(l=>!l.building))resolution.issues.push('Assign every priced component to a building before presenting separate building prices.');
    for(const t of mapping.tasks)if(!audit.coveredTaskIds.includes(t.id)){
      // A task the audit did not cover but that a planning or sourced allowance prices positively is released with that caveat; the audit's own findings about it are classified above.
      const allowancePriced=resolution.rules.some(rule=>rule.scopeTaskId===t.id&&(rule.id.startsWith('planning-')||rule.id.startsWith('market-'))&&rule.quantity.fixed!==undefined&&rule.quantity.fixed>0);
      if(allowancePriced&&audit.issues.length>0&&audit.issues.every(advisoryIssue))resolution.assumptions.push(`${t.description}: priced by a preliminary allowance pending published research; confirm current local rates before a firm proposal.`);
      else resolution.issues.push(`${t.description}: full pricing coverage has not been verified.`);
    }
  }catch(error){
    if(isPricingPending(error)||isProcessingDeadline(error))throw error;
    // A stage that ran out of time is not a verdict on the scope. The job
    // pauses and resumes from its saved stages; only a stage that has timed
    // out three times falls through to a real failure below.
    if(isPricingStageTimeout(error)&&error.message!=='pricing-stage-exhausted')throw new PricingPending('Pricing is taking longer than usual. Your finished steps are saved; continuing.',1500);
    const reason=error instanceof Error?`${error.name}: ${error.message}`:'Invalid pricing response';
    console.error('[p5-pricing] scope verification failure', {name:error instanceof Error?error.name:'UnknownError',message:error instanceof Error?error.message:'Invalid pricing response'});
    // Never expose a partial total on provider failure, invalid output or
    // inadequate evidence - that guarantee is unchanged. What changed is the
    // sentence the visitor reads. "An estimator must resolve the remaining
    // work" was an instruction to staff shown to a customer, under a headline
    // that promised details to add and listed none. The precise cause stays
    // in the internal audit trail; the visitor is told what is true.
    auditTrail.issues.push(`Automatic pricing did not complete: ${reason}`);
    resolution.issues.push(HANDOFF_ISSUE);
  }
  // Disclose ordinary selection/allowance caveats. Missing work, conflicting
  // quantities, duplicate charges and unknown findings remain blocking even
  // after a timeout or repair-budget expiry. A preliminary range must cover
  // the requested scope; disclosure cannot turn an omitted component into one.
  const findings=[...new Set(resolution.issues)];
  auditTrail.issues=[...new Set([...auditTrail.issues,...findings])];
  const kept=findings.filter(issue=>issue===HANDOFF_ISSUE||missingScopeFields([issue]).length>0||!advisoryIssue(issue));
  const disclosed=findings.filter(issue=>!kept.includes(issue));
  resolution.assumptions.push(...disclosed.map(item=>/^to confirm:/i.test(item)?item:`To confirm: ${item}`));
  resolution.issues=kept;
  resolution.completeScopeVerified=Boolean(auditTrail.verification)&&kept.length===0;
  const priced=priceReviewedScope(scope,configuration,now,resolution);
  return {...priced,customer:{...priced.customer,instructions:pricingExtraction?.instructions,documentCoverage:pricingExtraction?.documentCoverage,verificationItems:[...resolution.assumptions.filter(a=>/allowance|preliminary|confirm/i.test(a)),...resolution.issues],scopeTasks:(auditTrail.tasks as {description:string}[]).map(t=>({description:t.description,category:suggestedTrade(t.description)}))},internal:{...priced.internal,scopePricing:auditTrail}};
}
