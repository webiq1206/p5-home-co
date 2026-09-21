import {customerPresentation} from './customerProjection.ts';
/**
 * The approved preliminary online estimate (owner template, 2026-09-21), as data.
 *
 * One model feeds every customer channel: the PDF (download, email attachment, admin customer
 * preview and resend), the email and the plain-text email. It is built only from the saved
 * customer estimate and the issue record stamped on it at submission, never from a fresh model
 * read, so the same saved revision always renders the same reference, date, brand, finish, scope
 * and total.
 *
 * Two decisions are kept apart on purpose: the SITE that received the submission decides the brand
 * (the deployment's own brand.ts, checked against the brand stamped on the record), and the
 * SERVICE decides the title, grouping wording and follow-up. A cabinet request on the remodeling
 * site is a Boise Remodeling Co document with cabinet wording; RE-10 is a service, never a brand.
 */
export const ESTIMATE_TEMPLATE_VERSION='p5-online-estimate-2026-09-21';

export interface EstimateBrand {id:string;name:string;domain:string;email:string;phone:string;accent:string;ink:string;logo:string;consultationPath:string}
/** Stamped once at submission; every later render reads it back unchanged. */
export interface EstimateIssue {
  brandId:string;templateVersion:string;reference:string;revision:number;issuedAt:string;service:string;
  projectName:string;contact:{name:string;email:string;phone:string};location:string;address:string;
  finish:string;finishBasis:'selected'|'document'|'assumed'|'not-applicable';timing:string;sources:string[];
}
export type FinishBasis=EstimateIssue['finishBasis'];

const REPAIR_SERVICES=new Set(['handyman','re10','change-order','rush']);
const CABINET_SERVICES=new Set(['cabinet-product','cabinet-install']);
const CONSTRUCTION_SERVICES=new Set(['new-construction','addition','adu']);
export const SERVICE_TITLE:Record<string,string>={
  'kitchen':'Kitchen remodel estimate','bathroom':'Bathroom remodel estimate','whole-home':'Whole-home remodel estimate',
  'addition':'Home addition estimate','adu':'ADU estimate','new-construction':'New home construction estimate',
  'cabinet-product':'Cabinet estimate','cabinet-install':'Cabinet installation estimate','handyman':'Handyman estimate',
  're10':'RE-10 repair estimate','change-order':'Change order estimate','rush':'Priority repair estimate',
};
/** Step 2 of the approved next steps, worded for what each service actually has to confirm. */
export function confirmStep(service:string):string{
  if(CABINET_SERVICES.has(service))return "We'll verify layouts, dimensions, materials, hardware and installation scope.";
  if(service==='re10')return "We'll confirm each repair item, the finish you expect, access to the home and your contract deadline.";
  if(REPAIR_SERVICES.has(service))return "We'll confirm the repair details, the finish you expect and access to the home.";
  if(CONSTRUCTION_SERVICES.has(service))return "We'll review your plans, site conditions, selections and schedule.";
  return "We'll verify measurements, selections, existing conditions and the scope of work.";
}
/** The book's four finish tiers, in words a homeowner uses. "Refresh" is the builder-grade tier and is
 * never called a refresh on new construction. */
const FINISH:Record<string,{name:string;detail:string}>={
  'refresh':{name:'Builder grade',detail:'Durable, standard-grade materials, fixtures and finishes in widely available styles.'},
  'mid-range':{name:'Mid-range',detail:'Quality mid-grade materials, fixtures and finishes, with selected upgrades.'},
  'high-end':{name:'High-end',detail:'Premium materials, fixtures and finishes with more custom detailing.'},
  'luxury':{name:'Luxury',detail:'Top-tier and custom materials, fixtures and finishes throughout.'},
};
const BASIS_TEXT:Record<FinishBasis,string>={
  'selected':'Basis: selected by you in the online estimator.',
  'document':'Basis: taken from the documents you uploaded.',
  'assumed':'Basis: estimating assumption. Please confirm or tell us what you have in mind.',
  'not-applicable':'Basis: finish selections do not apply to this work.',
};
export const PRELIMINARY_NOTICE={lead:'Preliminary estimate, not a contract.',text:'Based on your online submission and subject to confirmed scope, measurements, selections and site conditions. No payment or signature is required now.'};

/** An estimate saved before issue records existed names its project from the first line of its brief. */
const briefLine=(summary:string)=>clean(summary.split(/\n/).find(line=>line.trim()&&!/^[A-Z][A-Za-z ,()/-]{2,60}: /.test(line))||'',140);
export interface EstimateCategory {number:string;title:string;amount:string;low:number;high:number;work:string[];allowances:string[]}
export interface EstimateDocument {
  templateVersion:string;brand:EstimateBrand&{endorsed:boolean};reference:string;revision:number;issuedAt:string;issuedLabel:string;
  service:string;title:string;projectName:string;customer:{name:string;email:string;phone:string};location:string[];
  finish:{heading:string;name:string;detail:string;basis:string};
  priceKind:'single'|'range'|'none';status:'complete'|'partial';total:{label:string;amount:string;low:number;high:number}|null;
  categories:EstimateCategory[];subtotal:string|null;totalNotes:string[];partialNote:string;
  exclusions:string[];exclusionsNote:string;assumptionRows:[string,string[]][];
  nextSteps:[string,string][];legalLine:string;review:{label:string;email:string;phone:string;mailto:string;tel:string;url:string};notice:typeof PRELIMINARY_NOTICE;
}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.round(n));
const clean=(value:unknown,max=400)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const dateLabel=(iso:string)=>{const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'America/Boise'}):'';};
/** The short reference printed on every channel: the first block of the draft id, stable forever. */
export const estimateReference=(id:string)=>`P5-${id.replace(/[^0-9a-f]/gi,'').slice(0,8).toUpperCase()}`;
/** The work named in a "not priced yet" exclusion, which is really an item awaiting pricing. */
const UNPRICED=/\s*\((?:not included in this price|not priced in this estimate)[^)]*\)\s*$/i;

/**
 * Split whole dollars across categories in proportion to their priced midpoints, so a single-amount
 * estimate's categories add up to the total exactly. The total is the pricing engine's number;
 * only the display split is computed here, and the remainder of rounding goes to the largest share.
 */
export function allocate(total:number,weights:number[]):number[]{
  const sum=weights.reduce((t,w)=>t+Math.max(0,w),0);
  if(!weights.length)return [];
  if(sum<=0){const even=weights.map(()=>Math.floor(total/weights.length));even[0]+=total-even.reduce((t,v)=>t+v,0);return even;}
  const shares=weights.map(w=>Math.floor(total*Math.max(0,w)/sum));
  const largest=weights.indexOf(Math.max(...weights));shares[largest]+=total-shares.reduce((t,v)=>t+v,0);
  return shares;
}
const lineText=(x:any)=>{
  const q=Number(x.quantity);const unit=String(x.unit||'').trim();
  const qty=Number.isFinite(q)&&q>0&&!(q===1&&/^(ls|lump|package|job|ea)$/i.test(unit))?`, ${q.toLocaleString('en-US')} ${unit}`:'';
  return `${clean(x.description,300)}${qty}`;
};

export function buildEstimateDocument(input:{id:string;result:unknown;brand:EstimateBrand;issue?:Partial<EstimateIssue>|null;submittedAt?:string|null;legalLine?:string}):EstimateDocument{
  const {id,brand}=input;
  // The issue record is read from the saved estimate itself; the customer projection that follows
  // allowlists pricing fields only.
  const issue=(input.issue||(input.result as any)?.issue||{}) as Partial<EstimateIssue>;
  const result=customerPresentation(input.result);
  // The site that received the submission is the brand. A record stamped for another brand is a
  // configuration error, never re-rendered under this site's name.
  if(issue.brandId&&issue.brandId!==brand.id)throw new Error(`estimate-brand-mismatch: saved for ${issue.brandId}, rendering site is ${brand.id}`);
  const service=clean(issue.service,40);
  const repair=REPAIR_SERVICES.has(service);
  const issuedAt=issue.issuedAt||input.submittedAt||'';
  const range=result.range as {low:number;high:number}|null;
  const priceKind:EstimateDocument['priceKind']=!range?'none':range.low===range.high?'single':'range';

  // Requested work that is not priced yet is an item awaiting pricing, never an exclusion.
  const unpriced:string[]=[];const exclusions:string[]=[];
  for(const item of [...(result.exclusions||[]),...(result.instructions?.exclusions||[])] as string[]){
    const text=clean(item);if(!text)continue;
    if(UNPRICED.test(text))unpriced.push(text.replace(UNPRICED,''));else exclusions.push(text);
  }
  for(const item of (result.instructions?.responsibilities||[]) as string[])if(clean(item))exclusions.push(`By others or supplied by the owner: ${clean(item)}`);
  // Exclusions and owner responsibilities the customer stated in the reviewed scope travel too.
  for(const raw of String(result.summary||'').split(/\n/)){
    const excluded=raw.match(/^Excluded work: (.+)$/),owner=raw.match(/^Owner-supplied items and responsibilities: (.+)$/);
    if(excluded)exclusions.push(clean(excluded[1]));
    if(owner)exclusions.push(`By others or supplied by the owner: ${clean(owner[1])}`);
  }
  const status:EstimateDocument['status']=unpriced.length?'partial':'complete';

  // Categories in the engine's order, each with its customer amount, the work it covers and the
  // allowances already inside it.
  const lines:any[]=result.lineItems||[];const tasks:any[]=result.scopeTasks||[];
  const names=[...new Set<string>([...(result.categoryRanges||[]).map((c:any)=>c.category),...lines.map(l=>l.category)])];
  const ranges=names.map(name=>{const r=(result.categoryRanges||[]).find((c:any)=>c.category===name);if(r)return {low:r.low,high:r.high};const own=lines.filter(l=>l.category===name);return {low:own.reduce((t,l)=>t+l.low,0),high:own.reduce((t,l)=>t+l.high,0)};});
  const split=priceKind==='single'?allocate(range!.low,ranges.map(r=>(r.low+r.high)/2)):[];
  const categories:EstimateCategory[]=names.map((name,i)=>{
    const own=lines.filter(l=>l.category===name);
    // A priced line's description repeats its task ("Task: book item."). The task is listed once as the
    // work; the line contributes only its item and quantity, so nothing reads twice.
    const taskTexts=tasks.filter(t=>t.category===name).map(t=>clean(t.description,300)).filter(Boolean);
    const allTasks=tasks.map(t=>clean(t.description,300)).filter(Boolean);
    const item=(l:any)=>{const d=clean(l.description,300);const task=allTasks.find(t=>d.startsWith(`${t}:`));return {task,text:lineText({...l,description:task?d.slice(task.length+1).trim()||d:d})};};
    const allowanceLines=own.filter(l=>l.pricingStatus==='estimated-allowance');
    const work=[...new Set<string>([...taskTexts,...own.filter(l=>l.pricingStatus!=='estimated-allowance').map(l=>{const x=item(l);return x.task?(taskTexts.includes(x.task)?`${x.task} (${x.text})`:`${x.task}: ${x.text}`):x.text;})].filter(Boolean))]
      // A task shown on its own and again with its item keeps only the fuller line.
      .filter((w,_,all)=>!all.some(o=>o!==w&&o.startsWith(`${w} (`)));
    const allowances=allowanceLines.map(l=>{
      const amount=priceKind==='range'?(l.low===l.high?money(l.low):`${money(l.low)} to ${money(l.high)}`):'';
      return `${amount?`${amount} for `:''}${item(l).text}${amount?'':' (included in this category amount)'}; selection and final quantity to confirm.`;
    });
    const low=priceKind==='single'?split[i]:Math.round(ranges[i].low),high=priceKind==='single'?split[i]:Math.round(ranges[i].high);
    return {number:String(i+1).padStart(2,'0'),title:clean(name,120),amount:priceKind==='none'?'':priceKind==='single'?money(low):`${money(low)} to ${money(high)}`,low,high,work,allowances};
  });
  // Structured allowances carry their own coverage; each sits in the category it best matches.
  for(const a of (result.allowances||[]) as any[]){
    if(typeof a==='string'||!categories.length)continue;
    const words=new Set(clean(a.description).toLowerCase().split(/\W+/).filter(w=>w.length>3));
    const target=categories.map(c=>({c,score:c.title.toLowerCase().split(/\W+/).filter(w=>words.has(w)).length})).sort((x,y)=>y.score-x.score)[0].c;
    const covers=[['materials',true],['installation',a.installationIncluded],['tax',a.taxIncluded],['delivery',a.deliveryIncluded||a.freightIncluded]].map(([k,v])=>`${k} ${v?'included':'not included'}`).join(', ');
    target.allowances.push(`${a.amount!=null?`${money(a.amount)} for `:''}${clean(a.description)}; ${covers}.`);
  }

  const total=range?{label:priceKind==='single'?(repair?'Your price':'Estimated project total'):'Estimated project range',amount:priceKind==='single'?money(range.low):`${money(range.low)} to ${money(range.high)}`,low:range.low,high:range.high}:null;
  const totalNotes=[
    categories.some(c=>c.allowances.length)?'Includes the allowances listed above. Final selections may change allowance amounts.':'',
    priceKind==='range'&&categories.length>1?'Category ranges are parts of the overall range, not additional charges. The overall range is narrower than the sum of the category ends because every category is unlikely to land at its low or high end at once.':'',
    'All prices are in U.S. dollars. Exclusions and items to confirm follow.',
  ].filter(Boolean);
  const partialNote=status==='partial'?`Partial estimate: ${unpriced.length===1?'one requested item is':`${unpriced.length} requested items are`} not priced yet and ${unpriced.length===1?'is':'are'} not in this ${priceKind==='range'?'range':'total'}. See items to confirm.`:'';

  const finishDef=FINISH[clean(issue.finish,20)]||(issue.finishBasis==='not-applicable'?null:FINISH['mid-range']);
  const finish=repair?{heading:'Finish / repair standard',name:'Standard repair',detail:'Repairs completed to a sound, working condition with materials comparable to what is there now. Repaired areas are finished to blend with the surrounding surfaces; an exact match to existing finishes is not guaranteed.',basis:'Basis: estimating standard for repair work. Tell us if you expect a different result.'}
    :{heading:'Finish level & materials',name:finishDef?.name||'Not applicable',detail:finishDef?.detail||'Finish selections do not apply to this work.',basis:BASIS_TEXT[(issue.finish?issue.finishBasis:'assumed')||'assumed']};

  const toConfirm=[...unpriced.map(u=>`${u}: not priced yet; we will quote it after a site visit.`),...((result.verificationItems||[]) as string[]).map(v=>clean(v)),...((result.instructions?.questions||[]) as string[]).map(v=>clean(v))]
    .filter(Boolean).filter(v=>!/^to confirm:.*not priced in this estimate/i.test(v));
  const assumptions=((result.assumptions||[]) as string[]).map(v=>clean(v)).filter(v=>v&&!/^to confirm:.*not priced in this estimate/i.test(v));
  const sources=(issue.sources||[]).map(s=>clean(s,120)).filter(Boolean);
  const assumptionRows:[string,string[]][]=([
    ['Pricing basis',[`Your online submission${sources.length?` and ${sources.length===1?'the document':'the documents'} you uploaded: ${sources.join('; ')}`:''}.`]],
    ['Assumptions',[...new Set(assumptions)].slice(0,12)],
    ['To confirm',[...new Set(toConfirm)].slice(0,16)],
    ['Timing',[issue.timing?`Requested: ${clean(issue.timing,160)}. Availability is confirmed with your final proposal.`:'Start and completion dates are confirmed with your final proposal.']],
  ] as [string,string[]][]).filter(([,v])=>v.length);

  const tel=brand.phone.replace(/[^\d+]/g,'');const reference=issue.reference||estimateReference(id);
  const subject=encodeURIComponent(`Project review request - estimate ${reference}`);
  return {
    templateVersion:ESTIMATE_TEMPLATE_VERSION,brand:{...brand,endorsed:brand.id!=='p5'},reference,revision:Number(issue.revision)||0,issuedAt,issuedLabel:dateLabel(issuedAt),
    service,title:SERVICE_TITLE[service]||'Project estimate',projectName:clean(issue.projectName,140)||briefLine(String(result.summary||'')),
    customer:{name:clean(issue.contact?.name,120),email:clean(issue.contact?.email,160),phone:clean(issue.contact?.phone,40)},
    location:[clean(issue.address,160),clean(issue.location,160)].filter((v,i,a)=>v&&a.indexOf(v)===i),
        // The template's subtotal, tax/fee and credit rows exist to reconcile adjustments. The engine prices
    // no separate taxes, fees or credits today, so the subtotal would only repeat the total and is hidden.
    finish,priceKind,status,total,categories,subtotal:null,totalNotes,partialNote,
    exclusions:[...new Set(exclusions)],exclusionsNote:exclusions.length?'Not included in this estimate':'No specific exclusions were identified from your submission. Work not described in the scope above is not included.',
    assumptionRows,
    legalLine:clean(input.legalLine,200),
    nextSteps:[['Request a project review','Reply to your estimate email or contact us with your estimate number.'],['Confirm the details',confirmStep(service)],['Receive your final proposal',"You'll receive a written proposal with confirmed scope, pricing and scheduling requirements."]],
    review:{label:'Request a project review',email:brand.email,phone:brand.phone,mailto:`mailto:${brand.email}?subject=${subject}`,tel:`tel:${tel}`,url:`https://${brand.domain}${brand.consultationPath}`},
    notice:PRELIMINARY_NOTICE,
  };
}
/** Build the issue record at submission from the reviewed scope and contact. Pure, so tests pin it. */
export function issueRecord(input:{brandId:string;id:string;revision:number;now:Date;contact:{name:string;email:string;phone?:string};scope:{text?:string;answers:Record<string,unknown>;uncertainFields?:string[];uploads?:{name:string}[];extraction?:{facts?:{field:string}[]}|null}}):EstimateIssue{
  const a=input.scope.answers||{};const finish=clean(a.finish,20);const service=clean(a.service,40);
  const finishBasis:FinishBasis=REPAIR_SERVICES.has(service)?'not-applicable':!finish?'assumed':(input.scope.uncertainFields||[]).includes('finish')?'assumed':(input.scope.extraction?.facts||[]).some(f=>f.field==='finish')?'document':'selected';
  const firstSentence=clean(input.scope.text,600).split(/(?<=[.!?])\s/)[0]||'';
  // The customer's own first sentence names the project; a long one is cut at its first clause, never mid-phrase.
  const sentence=firstSentence.replace(/[.!?]$/,'');
  const clause=sentence.length>90?sentence.slice(0,90).match(/^(.{20,}?)[:;,(]/)?.[1]:'';
  const described=sentence.length<=90?sentence:clause?clause.trim():sentence.slice(0,86).replace(/\s+\S*$/,'')+'...';
  // "Please price the items on this notice" is a request to us, not a project name.
  const request=/^(?:please|can you|could you|would you|i need|we need|i would like|we would like|looking for|need)\b/i.test(sentence)||!sentence;
  const where=clean(a.address,120)||clean(a.location,120);
  const serviceName=(SERVICE_TITLE[service]||'Project estimate').replace(/ estimate$/,'').replace(/^RE-10 repair$/,'RE-10 repairs');
  const projectName=request?`${serviceName}${where?` at ${where}`:''}`:described;
  return {brandId:input.brandId,templateVersion:ESTIMATE_TEMPLATE_VERSION,reference:estimateReference(input.id),revision:input.revision,issuedAt:input.now.toISOString(),service,
    projectName,contact:{name:clean(input.contact.name,120),email:clean(input.contact.email,160),phone:clean(input.contact.phone,40)},
    location:clean(a.location,160),address:clean(a.address,160),finish,finishBasis,timing:[clean(a.schedule,120),a.urgency&&a.urgency!=='standard'?`${clean(a.urgency,20)} timing`:''].filter(Boolean).join('; '),
    sources:(input.scope.uploads||[]).map(u=>clean(u.name,120)).filter(Boolean).slice(0,12)};
}
