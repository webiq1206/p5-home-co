import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,rgb,type PDFFont,type PDFPage,type RGB} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {buildEstimateDocument,SERVICE_TITLE,estimateReference,type EstimateBrand,type EstimateDocument,type EstimateIssue} from './estimateDocument.ts';
import {ASSETS,clean,hex,mix,wrap} from './estimatePdf.ts';
/**
 * The internal estimate record (owner request, 2026-09-21): the approved template's look, cut down to
 * what an estimator needs to review a job in a minute. Internal numbers only live here, never in a
 * customer channel.
 *
 * What it keeps: who and where, the status, the price build-up from direct cost to contract price,
 * direct cost by trade, one line per priced item with its book code, checks grouped by kind with a
 * count (not one sentence per line), and what the customer was asked to confirm or was not priced.
 * What it drops: the full calculation trace, policy snapshots, evidence prose and repeated warnings.
 * The saved record keeps all of it for the admin screen.
 */
export interface AdminSummary {
  doc:EstimateDocument;status:string;released:boolean;
  build:[string,string][];contractPrice:string;customerPrice:string;
  trades:{trade:string;lines:number;cost:string;share:string}[];
  lines:{item:string;qty:string;unitCost:string;cost:string;basis:string}[];
  checks:string[];notPriced:string[];
}
const money=(n:unknown,cents=false)=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:cents?2:0,maximumFractionDigits:cents?2:0}).format(n):'Not available';
const pct=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?`${(n*100).toFixed(1)}%`:'';
const TRADE_LABEL=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());
/** The book code or source kind of a priced line, in a few characters. */
function basisOf(line:any):string{
  const ref=String(line?.evidence?.reference||'');
  const code=ref.match(/PB-L-[0-9a-f]{6,}|PB-\d\d-\d\d(?:-\d\d)?(?:-[A-Z0-9]+)?/)?.[0];
  if(code)return code.startsWith('PB-L-')?`${code} (learned)`:code;
  const basis=String(line?.estimatingBasis||line?.evidence?.basis||'');
  return ({'sourced-market-average':'Market allowance','regional-planning-average':'Regional allowance','owner-average-cost':'Owner average','owner-estimating-schedule':'Owner schedule','historical-cost-budget':'Historical','written-quote':'Written quote'} as Record<string,string>)[basis]||basis||'Unstated';
}
/** Per-line warnings repeat one message for many lines; group them by kind with a count. */
export function groupedChecks(warnings:unknown):string[]{
  const groups=new Map<string,{severity:string;text:string;count:number}>();
  for(const w of Array.isArray(warnings)?warnings as {code?:string;severity?:string;message?:string}[]:[]){
    const text=clean(String(w?.message||w?.code||'Review')).replace(/^[\w.:-]+:\s+(?=[a-z])/i,'').replace(/\s+/g,' ').trim();
    const key=`${w?.code||text}|${w?.severity||'review'}`;
    const g=groups.get(key);if(g)g.count++;else groups.set(key,{severity:String(w?.severity||'review'),text,count:1});
  }
  return [...groups.values()].sort((a,b)=>(a.severity==='block'?0:1)-(b.severity==='block'?0:1)||b.count-a.count)
    .map(g=>`${g.severity==='block'?'Blocking':'Review'}${g.count>1?` (${g.count} lines)`:''}: ${g.text.length>150?g.text.slice(0,147).replace(/\s+\S*$/,'')+'...':g.text}`);
}
/** The finish basis in the team's words; the customer copy says "selected by you". */
export const adminBasis=(doc:EstimateDocument)=>doc.finish.basis.replace(/^Basis:\s*/,'').replace(/\..*$/,'').replace(/\bby you\b/,'by the customer').replace(/\byou uploaded\b/,'the customer uploaded');
export function buildAdminSummary(input:{id:string;record:any;brand:EstimateBrand;submittedAt?:string|null;legalLine?:string}):AdminSummary{
  const r=input.record||{};
  const issue:Partial<EstimateIssue>=r.customer?.issue||{service:String(r.service||r.scope?.answers?.service||''),contact:r.contact,location:String(r.scope?.answers?.location||''),address:String(r.scope?.answers?.address||'')};
  const doc=buildEstimateDocument({id:input.id,result:r.customer||{range:null},brand:input.brand,issue:{...issue,contact:issue.contact||r.contact},submittedAt:input.submittedAt||null,legalLine:input.legalLine});
  if(!doc.title||doc.title==='Project estimate')doc.title=SERVICE_TITLE[String(r.service||'')]||doc.title;
  const released=r.publishable===true&&Boolean(doc.total);
  const blocking=(Array.isArray(r.warnings)?r.warnings:[]).filter((w:any)=>w?.severity==='block').length;
  const contingencyRate=typeof r.contingencyRate==='number'&&r.contingency>0?` (${pct(r.contingencyRate)})`:'';
  const overhead=r.allocationDollars?.overhead;
  const ohp=typeof r.contractPrice==='number'&&typeof r.riskAdjustedDirectCost==='number'&&r.contractPrice>0?(r.contractPrice-r.riskAdjustedDirectCost)/r.contractPrice:undefined;
  const build:[string,string][]=([
    ['Direct project cost',money(r.directCost)],
    ['Contingency'+contingencyRate,money(r.contingency)],
    ['Overhead recovery',money(overhead)],
    [`Operating profit${typeof r.targetOperatingProfit==='number'?` (${pct(r.targetOperatingProfit)} target)`:''}`,money(r.operatingProfit)],
    ['Overhead and profit share of price',ohp===undefined?'':pct(ohp)],
  ] as [string,string][]).filter(([,v])=>v&&v!=='Not available');
  const lines:any[]=Array.isArray(r.lines)?r.lines:[];
  const byTrade=new Map<string,{lines:number;cost:number}>();
  for(const l of lines){const t=String(l.trade||TRADE_LABEL(String(l.category||'Other')));const g=byTrade.get(t)||{lines:0,cost:0};g.lines++;g.cost+=Number(l.cost)||0;byTrade.set(t,g);}
  const direct=Number(r.directCost)||[...byTrade.values()].reduce((t,g)=>t+g.cost,0);
  const tasks:any[]=r.scopePricing?.tasks||[];const covered=new Set<string>(r.scopePricing?.verification?.coveredTaskIds||[]);
  return {
    doc,released,status:released?'Released to the customer':doc.total?`Customer price saved; ${blocking} blocking check${blocking===1?'':'s'} to clear before a firm proposal`:`Withheld from the customer${blocking?`: ${blocking} blocking check${blocking===1?'':'s'}`:''}`,
    build,contractPrice:money(r.contractPrice),customerPrice:doc.total?.amount||'Not released',
    trades:[...byTrade.entries()].sort((a,b)=>b[1].cost-a[1].cost).map(([trade,g])=>({trade,lines:g.lines,cost:money(g.cost),share:direct>0?`${Math.round(g.cost/direct*100)}%`:''})),
    lines:lines.map(l=>({item:clean(String(l.description||'')).replace(/\s+/g,' ').slice(0,160),qty:`${Number(l.quantity).toLocaleString('en-US')} ${l.unit||''}`.trim(),unitCost:money(l.unitCost,true),cost:money(l.cost,true),basis:basisOf(l)})),
    checks:groupedChecks(r.warnings),
    notPriced:[...tasks.filter(t=>t?.id&&covered.size&&!covered.has(t.id)).map(t=>clean(String(t.description||''))),...(Array.isArray(r.scopePricing?.issues)?r.scopePricing.issues.map((i:unknown)=>clean(String(i))):[])].filter(Boolean).slice(0,12),
  };
}
const W=612,H=792,L=40,R=572,WIDTH=R-L,TOP=680,BOTTOM=70;
export async function renderAdminPdf(s:AdminSummary):Promise<Buffer>{
  const doc=s.doc;const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const asset=(p:string)=>readFile(path.join(process.cwd(),'public',p));
  const regular=await pdf.embedFont(await asset(`${ASSETS}/estimate-sans-regular.ttf`),{subset:true});
  const bold=await pdf.embedFont(await asset(`${ASSETS}/estimate-sans-bold.ttf`),{subset:true});
  const logoBytes=await asset(doc.brand.logo.replace(/^\//,''));
  const logo=/\.jpe?g$/i.test(doc.brand.logo)?await pdf.embedJpg(logoBytes):await pdf.embedPng(logoBytes);
  const ink=hex(doc.brand.ink||'#2C302F'),muted=hex('#565D58'),soft=hex('#6F7671'),rule=hex('#D5DAD5'),accent=hex(doc.brand.accent),tint=mix(doc.brand.accent,.12);
  const alert=rgb(.62,.2,.14),alertTint=rgb(.98,.93,.91);
  let page!:PDFPage;let y=TOP;const pages:PDFPage[]=[];
  const text=(t:string,x:number,yy:number,size:number,font:PDFFont=regular,color:RGB=ink)=>page.drawText(clean(t),{x,y:yy,size,font,color});
  const right=(t:string,x:number,yy:number,size:number,font:PDFFont=regular,color:RGB=ink)=>text(t,x-font.widthOfTextAtSize(clean(t),size),yy,size,font,color);
  const newPage=()=>{page=pdf.addPage([W,H]);pages.push(page);const sc=Math.min(210/logo.width,28/logo.height);page.drawImage(logo,{x:L,y:H-46-logo.height*sc,width:logo.width*sc,height:logo.height*sc});
    right('INTERNAL ESTIMATE RECORD',R,H-40,8.5,bold,alert);right('Confidential. Do not send to the customer.',R,H-52,8,regular,soft);
    page.drawLine({start:{x:L,y:H-86},end:{x:R,y:H-86},thickness:.8,color:accent});y=TOP+12;};
  const ensure=(h:number)=>{if(y-h<BOTTOM){newPage();return true;}return false;};
  const para=(t:string,size=9.5,o:{font?:PDFFont;color?:RGB;x?:number;width?:number}={})=>{const x=o.x??L,w=o.width??(R-x),lh=size*1.35;for(const line of wrap(t,o.font||regular,size,w)){ensure(lh);text(line,x,y-size,size,o.font||regular,o.color||ink);y-=lh;}};
  const heading=(t:string)=>{ensure(40);y-=12;text(t,L,y-12,12,bold);y-=19;page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.6,color:accent});y-=4;};
  const row=(cells:[string,number,'l'|'r',PDFFont?][],size=9,shade=false,onNewPage?:()=>void)=>{
    const wrapped=cells.map(([t,w,,f])=>wrap(t,f||regular,size,w-6));const h=Math.max(...wrapped.map(l=>l.length))*size*1.3+6;
    if(ensure(h))onNewPage?.();if(shade)page.drawRectangle({x:L,y:y-h,width:WIDTH,height:h,color:tint});
    let x=L;cells.forEach(([,w,align,f],i)=>{wrapped[i].forEach((line,j)=>{const yy=y-4-size-j*size*1.3;align==='r'?right(line,x+w-3,yy,size,f||regular):text(line,x+3,yy,size,f||regular);});x+=w;});
    y-=h;page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.4,color:rule});
  };

  newPage();
  text(doc.title,L,y-18,18,bold);y-=24;
  if(doc.projectName)para(doc.projectName,10.5,{color:muted});
  y-=4;const colY=y,col2=L+WIDTH/2;
  text('CUSTOMER',L,y-8,7.5,bold,soft);y-=12;for(const v of [doc.customer.name,doc.customer.email,doc.customer.phone].filter(Boolean))para(v,9.5,{width:WIDTH/2-10});
  const leftEnd=y;y=colY;text('LOCATION',col2,y-8,7.5,bold,soft);y-=12;for(const v of doc.location.length?doc.location:['Not stated'])para(v,9.5,{x:col2});
  y=Math.min(leftEnd,y)-4;para(`Estimate ${doc.reference}${doc.issuedLabel?`  |  ${doc.issuedLabel}`:''}  |  ${doc.finish.name} (${adminBasis(doc)})`,8.5,{color:soft});
  // Status: green-free on purpose; withheld reads in a soft red tint.
  {const h=26;y-=6;ensure(h);page.drawRectangle({x:L,y:y-h,width:WIDTH,height:h,color:s.released?tint:alertTint});text(s.status,L+10,y-17,10,bold,s.released?ink:alert);y-=h+2;}

  heading('Price build-up');
  for(const [k,v] of s.build)row([[k,WIDTH-140,'l'],[v,140,'r']],9.5);
  row([['Contract price',WIDTH-140,'l',bold],[s.contractPrice,140,'r',bold]],10.5,true);
  row([[`Customer ${doc.priceKind==='range'?'range':'price'}${doc.status==='partial'?' (partial)':''}`,WIDTH-160,'l',bold],[s.customerPrice,160,'r',bold]],10.5,true);

  if(s.trades.length){heading('Direct cost by trade');row([['Trade',WIDTH-230,'l',bold],['Lines',60,'r',bold],['Direct cost',110,'r',bold],['Share',60,'r',bold]],8.5);
    for(const t of s.trades)row([[t.trade,WIDTH-230,'l'],[String(t.lines),60,'r'],[t.cost,110,'r'],[t.share,60,'r']],9);}
  if(s.lines.length){heading(`Line items (${s.lines.length})`);
    const head=()=>row([['Item',WIDTH-304,'l',bold],['Qty',62,'r',bold],['Unit cost',70,'r',bold],['Cost',76,'r',bold],['Source',96,'l',bold]],8);head();
    for(const l of s.lines)row([[l.item,WIDTH-304,'l'],[l.qty,62,'r'],[l.unitCost,70,'r'],[l.cost,76,'r'],[l.basis,96,'l']],8,false,head);}
  if(s.checks.length){heading('Checks before a firm proposal');for(const c of s.checks.slice(0,14)){y-=2;para(`• ${c}`,9,{color:/^Blocking/.test(c)?alert:ink});}if(s.checks.length>14)para(`${s.checks.length-14} more in the admin record.`,8.5,{color:soft});}
  const confirm=doc.assumptionRows.find(([k])=>k==='To confirm')?.[1]||[];
  if(confirm.length||s.notPriced.length){heading('Open items');for(const c of confirm.slice(0,10)){y-=2;para(`• Customer to confirm: ${c}`,9);}for(const n of s.notPriced){y-=2;para(`• Not priced: ${n}`,9,{color:alert});}}
  if(doc.exclusions.length){heading('Exclusions shown to the customer');for(const e of doc.exclusions.slice(0,10)){y-=2;para(`• ${e}`,9);}}

  pages.forEach((p,i)=>{p.drawLine({start:{x:L,y:50},end:{x:R,y:50},thickness:.5,color:rule});
    p.drawText(`${doc.brand.name} internal record  |  Confidential`,{x:L,y:36,size:8,font:regular,color:soft});
    const label=`${doc.reference}  |  ${i+1} / ${pages.length}`;p.drawText(label,{x:R-regular.widthOfTextAtSize(label,8),y:36,size:8,font:regular,color:soft});});
  pdf.setTitle(`${doc.brand.name} internal estimate record ${doc.reference}`);pdf.setAuthor(doc.brand.name);pdf.setSubject('Confidential internal estimate record');
  return Buffer.from(await pdf.save());
}
export {estimateReference};
