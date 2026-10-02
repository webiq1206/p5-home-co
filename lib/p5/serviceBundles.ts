import {createHash} from 'node:crypto';
import type {ReviewedScope} from './scope.ts';
import {priceReviewedScope,type EstimatorConfiguration,type ScopePriceResolution} from './costBook.ts';
import {priceBookRates} from './priceBook.ts';
import {applyMinorWorkAllowance} from './minorWorkAllowance.ts';
import {customerSafeProjection} from './pricing.ts';

/** These are scope grammars paired with existing approved rates, not guessed
 * package prices. An unconsumed word, different operation, ambiguous count,
 * document or unresolved qualification returns control to the full estimator.
 * No model output or model finding participates in a coverage certificate. */
const families=[
 {id:'door-hardware',code:'PB-08-71-01',noun:/\b(?:levers?|knobs?)\b/i,words:'door doors passage interior lever levers knob knobs',requiresCompatible:true},
 {id:'cabinet-hardware',code:'PB-12-01-05',noun:/\b(?:cabinet pulls?|cabinet knobs?)\b/i,words:'cabinet cabinets pull pulls knob knobs',requiresCompatible:true},
 {id:'towel-bar',code:'PB-10-28-02',noun:/\btowel bars?\b/i,words:'towel bar bars',requiresCompatible:false},
 {id:'towel-ring',code:'PB-10-28-02',noun:/\btowel rings?\b/i,words:'towel ring rings',requiresCompatible:false},
 {id:'paper-holder',code:'PB-10-28-02',noun:/\btoilet paper holders?\b/i,words:'toilet paper holder holders',requiresCompatible:false},
 {id:'robe-hook',code:'PB-10-28-02',noun:/\brobe hooks?\b/i,words:'robe hook hooks',requiresCompatible:false},
] as const;
const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
const vocabulary=`a an the and or of on in at to for from with by only all each per same existing old replacement replace replaced replacing install installing installation remove removed removal dispose disposal supply supplies supplied supplying provide provided owner homeowner customer contractor normal ordinary minor small incidental routine standard compatible predrilled pre drilled holes hole good condition conditions hardware fasteners screws washers finishing materials consumables clean cleanup handling included include includes including required requireds as needed no new easy ground floor access scheduling schedule home occupied residential interior room rooms bedroom bedrooms bathroom bathrooms hallway hall kitchen living dining item items unit units total count stated explicitly work scope handyman service please estimate this these those is are have has remain remains will be then labor material materialonly laboronly confirm before firm proposal products product primary supported not independent separately price priced prices cost budget greater less than quantity mounting anchors mount mounted basic light duty existinghome you your our us it its`.split(/\s+/);
const action=/\b(?:install|installation|replace|replacing|replacement|remove|removal|dispose|disposal|supply|supplies|supplied|provide)\b/i;
const clauses=(text:string)=>text.split(/[;\n]|\.(?:\s|$)/).map(part=>part.trim()).filter(Boolean);
const normalized=(text:string)=>text.toLowerCase().replace(/[’']/g,'').replace(/[-–—/]/g,' ');
const inert=(text:string)=>/^(?:please\s+)?estimate only this handyman replacement scope$/i.test(text)
 ||/^(?:boise|meridian|nampa|eagle|garden city|star|kuna),?\s*(?:idaho|id)?\s*\d{5}?$/i.test(text);
const exclusion=(text:string)=>/^(?:no|exclude|excluding)\b/i.test(text)&&! /\b(?:but|except|also|then|install|repair|replace|add|provide|include)\b/i.test(text);

export function supportedServiceBundle(scope:ReviewedScope,configuration:EstimatorConfiguration,now:Date){
 const extraction=scope.extraction,instructions=extraction?.instructions;
 if(scope.answers.service!=='handyman'||scope.uploads?.length||scope.uncertainFields?.length||scope.corrections?.length
  ||extraction?.conflicts?.length||extraction?.missingInformation?.length||extraction?.clarifications?.length
  ||instructions?.questions?.length||instructions?.separateBuildings||instructions?.materialsOnly||instructions?.laborOnly
  ||extraction?.takeoffs?.length||extraction?.documentCoverage?.complete===false)return null;
 if(!configuration.planningCatalog||!Number.isFinite(Date.parse(configuration.planningCatalog.importedAt)))return null;
 // Do not use a certificate to replace text/instructions in an attachment or
 // a customer's separately entered task list, monetary allowance or override.
 const supportedAnswers=new Set(['service','location','fixtureCount','installation','demolition','ownerSupplied','exclusions','access','schedule','urgency','finish']);
 if(Object.entries(scope.answers).some(([key,value])=>String(value||'').trim()&&!supportedAnswers.has(key)))return null;
 if(extraction?.sourceText?.trim()){
  const source=extraction.sourceText.trim().replace(/^Typed scope:\s*"([\s\S]*)"$/, '$1');
  if(source!==scope.text.trim())return null;
 }
 const raw=scope.text.replace(/SYNTHETIC QA\s*[—–-]\s*release \d{4}-\d{2}-\d{2}\.\d+ acceptance only, not a real customer job\.?/gi,'');
 const active=clauses(raw).filter(part=>!inert(part)&&!exclusion(part));
 const answerWork=['installation','demolition','ownerSupplied','access','schedule'].flatMap(key=>clauses(String((scope.answers as any)[key]||'')));
 const included=instructions?.inclusions||[];
 const work=[...active,...answerWork,...included,...(instructions?.responsibilities||[])];
 if(!work.length)return null;
 const text=normalized(work.join('\n'));
 // Cabinet knobs must not accidentally select the door-knob family.
 const candidates=families.filter(family=>family.noun.test(text)&&!(family.id==='door-hardware'&&/\bcabinets?\b/i.test(text)));
 if(candidates.length!==1)return null;
 const family=candidates[0];
 const excluded=[scope.answers.exclusions||'',...(instructions?.exclusions||[])].filter(item=>!/^owner[- ]supplied (?:hardware|primary products?)(?: product)? costs?$/i.test(item)).join(' ');
 if(family.noun.test(excluded)||/\b(?:hardware|installation|all work|consumables?|supplies|cleanup|disposal|labor|materials?)\b/i.test(excluded))return null;

 if(!/\b(?:install|installation|replace|replacement)\b/i.test(text)||! /\bowner\s+(?:supplied|supplies|provides?)\b/i.test(text))return null;
 if(/\b(?:owner|homeowner|customer)\s+(?:does not|will not|not|wont)\s+(?:supply|provide|supplied)|\b(?:supplies|provides?)\s+no\b/i.test(text))return null;
 if(family.requiresCompatible&&!/\b(?:compatible|predrilled|pre drilled)\b/i.test(text))return null;
 // A complete door or cabinet replacement is never a hardware installation.
 if(/\b(?:install|replace|remove|supply)\s+(?:(?:\d+|one|two|three|new|old|existing|interior|passage)\s+)*(?:doors?|cabinets?)\b(?!\s+(?:levers?|knobs?|pulls?))/i.test(text))return null;
 if([...text.matchAll(/\bcontractor\s+(?:suppl\w*|provid\w*|furnish\w*)\s+([^.;\n]*)/gi)].some(match=>family.noun.test(match[1])))return null;
 if(/\b(?:no|not|without)\s+(?:owner|homeowner|customer|installation|install|replacement|replace)\b/i.test(text))return null;
 const operations=active.filter(part=>/\b(?:install|replace)\b/i.test(part));
 if(operations.length>1||operations.some(part=>/\b(?:install|replace)\b.+\b(?:and|plus)\s+(?:(?:install|replace)\s+)?(?:\d+|one|two|three|four|five|six)\b/i.test(part)))return null;
 const allowed=new Set([...vocabulary,...family.words.split(' '),...Object.keys(numbers)]);
 for(const part of work){
  if(inert(part))continue;
  const words=normalized(part).match(/[a-z]+|\d+(?:\.\d+)?/g)||[];
  if(words.some(word=>!allowed.has(word)&&!/^\d+$/.test(word)))return null;
  // An operation on a different object cannot borrow a family named elsewhere.
  if(action.test(part)&&!family.noun.test(part)&&!/\b(?:consumables?|fasteners?|screws?|washers?|supplies|finishing materials|removed levers|removed knobs)\b/i.test(part))return null;
 }
 const countWords='(?:\\d+(?:\\.\\d+)?|'+Object.keys(numbers).join('|')+')';
 const countPattern=new RegExp('\\b('+countWords+')\\s+(?:(?:existing|old|interior|passage|owner[- ]supplied|compatible|replacement|cabinet|towel|toilet|paper|robe|door)\\s+)*(?:levers?|knobs?|pulls?|bars?|rings?|holders?|hooks?)\\b','gi');
 const counts=[...text.matchAll(countPattern)].map(match=>numbers[match[1]]??Number(match[1]));
 for(const fact of extraction?.facts||[])if(fact.field==='fixtureCount'){
  if(!/^\d+$/.test(fact.value.trim()))return null;
  counts.push(Number(fact.value));
 }
 const suppliedCount=scope.answers.fixtureCount;
 if(suppliedCount?.trim()){
  if(!/^\d+$/.test(suppliedCount.trim()))return null;
  counts.push(Number(suppliedCount));
 }
 const unique=[...new Set(counts)];
 // No inferred quantity, summing repeated prose, or family-wide reuse of a
 // count for several independent rooms/operations. Those need normal takeoff.
 if(unique.length!==1||!Number.isInteger(unique[0])||unique[0]<=0||unique[0]>12)return null;
 if(/\b(?:additional|another|different|separate|each room|per room)\b/i.test(text))return null;
 const quantity=unique[0];
 if(family.id==='door-hardware'){
  const doors=new RegExp('\\b('+countWords+')\\s+(?:(?:same|existing|interior|passage|bedroom|bathroom)\\s+)*doors?\\b(?!\\s+(?:levers?|knobs?))','gi');
  if([...text.matchAll(doors)].some(match=>(numbers[match[1]]??Number(match[1]))!==quantity)||/\b(?:per|each)\s+door\b/i.test(text))return null;
 }

 const rate=priceBookRates(scope.answers).find(item=>item.code===family.code&&item.type==='Labor'&&item.unit==='EA');
 if(!rate||!Number.isFinite(rate.amount)||rate.amount<=0)return null;
 const verifiedAt=configuration.planningCatalog.importedAt,validUntil=new Date(Date.parse(verifiedAt)+92*86400000).toISOString();
 if(Date.parse(validUntil)<now.getTime())return null;
 const quantityEvidence=`${quantity} ${family.id} items explicitly stated in reviewed scope; owner supplies primary products.`;
 const resolution:ScopePriceResolution={replaceBase:true,completeScopeVerified:true,issues:[],assumptions:[
  `Preliminary service bundle for ${quantity} ${family.id} items. Owner supplies compatible primary products. Approved installation labor is charged once per item.`,
  'The supporting-work budget covers ordinary installation fasteners, minor handling, cleanup and removal of the replaced small hardware where requested. Confirm compatibility and site conditions before a firm proposal. Additional repairs and primary products require separate pricing.',
 ],rules:[{id:'bundle-labor',scopeTaskId:'bundle-install',description:rate.description,category:'field-labor',unit:'EA',quantity:{fixed:quantity,factor:1},unitCost:rate.amount,
  priceBasis:'direct-cost',estimatingBasis:rate.basis,
  evidence:{basis:'owner-estimating-schedule',reference:`${rate.source}; ${rate.code}; ${quantityEvidence}`,verifiedAt,validUntil}}]};
 const supporting={id:'bundle-support',description:`Minor installation supplies, handling and disposal for ${quantity} ${family.id} items`,evidence:raw,researchDescription:'Minor installation consumables, handling and disposal of replaced small hardware',existingLineIds:[] as string[],costClass:'minor-job-support'};
 applyMinorWorkAllowance([supporting],resolution,[],now);
 if(!resolution.rules.some(rule=>rule.id==='minor-work-allowance'))return null;
 const priced=priceReviewedScope(scope,configuration,now,resolution);
 // The normal pricing engine remains authoritative for finance, floors,
 // contingency, risk, missing information and release eligibility.
 if(!priced.customer.range)return null;
 const certificate={version:'supported-service-bundle-v1',family:family.id,quantity,quantityEvidence,rateCode:rate.code,
  sourceHash:createHash('sha256').update(JSON.stringify({scope,configuration})).digest('hex'),
  tasks:[{id:'bundle-install',description:resolution.assumptions[0],existingLineIds:['bundle-labor']},supporting],
  originalResolution:resolution,issues:[],research:null,verification:{method:'deterministic-scope-grammar-and-approved-rate',issues:[]}};
 return {...priced,customer:customerSafeProjection({...priced.customer,instructions,documentCoverage:extraction?.documentCoverage,
  verificationItems:resolution.assumptions,scopeTasks:certificate.tasks.map(task=>({description:task.description,category:'General Conditions & Other'}))}),
  internal:{...priced.internal,scopePricing:certificate}};
}
