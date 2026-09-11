import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument,rgb,type PDFPage,type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ESTIMATOR_BRAND as brand } from "./brand";
type PublicResult={status:string;range:{low:number;high:number}|null;summary:string;includedCategories:string[];categoryRanges?:{category:string;low:number;high:number}[];lineItems?:{id:string;category:string;description:string;quantity:number;unit:string;low:number;high:number;unitLow:number;unitHigh:number}[];allowances:unknown[];assumptions:string[];exclusions:string[];factors:string[];nextStep:string;message:string;disclaimer:string};
type Block={title?:string;text?:string;rows?:[string,string][];bullets?:string[];compact?:boolean};
import {estimateSections,scopeBullets} from './presentation';
import {scopeText} from './scope';
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("-"," ").replace(/^./,c=>c.toUpperCase());
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
const unitMoney=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
function printable(value:unknown):string {
  if(value==null)return "Not supplied";
  if(typeof value==="string")return value;
  if(Array.isArray(value))return value.map(printable).join("\n");
  if(typeof value==="object")return Object.entries(value).map(([k,v])=>`${k}: ${printable(v)}`).join("\n");
  return String(value);
}
function safeText(text:string){return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replace(/[\u2010-\u2015]/g,"-");}
function wrap(text:string,font:PDFFont,size:number,width:number):string[]{
  const lines:string[]=[];
  for(const paragraph of safeText(text).split("\n")){
    let line="";
    for(const word of paragraph.split(/\s+/)){
      if(font.widthOfTextAtSize(word,size)>width){
        if(line){lines.push(line);line="";}
        for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line="";}line+=char;}
      }else if(font.widthOfTextAtSize(line?`${line} ${word}`:word,size)>width){lines.push(line);line=word;}
      else line=line?`${line} ${word}`:word;
    }lines.push(line);
  }return lines;
}
async function render(kind:"customer"|"administrative",id:string,blocks:Block[]){
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const compact=kind==="customer"&&JSON.stringify(blocks).length<3000;
  const asset=(p:string)=>readFile(path.join(process.cwd(),"public",p));
  // Missing brand assets fail delivery and stay in the outbox; no placeholder logos.
  const font=await doc.embedFont(await asset(brand.font),{subset:true});
  const heading=await doc.embedFont(await asset(brand.headingFont),{subset:true});
  const logo=await doc.embedPng(await asset(brand.logo));
  const hex=(h:string)=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
  const ink=hex(brand.ink);const accent=hex(brand.accent);const paper=hex(brand.paper);
  let page!:PDFPage;let y=0;
  const newPage=()=>{
    page=doc.addPage([612,792]);page.drawRectangle({x:0,y:680,width:612,height:112,color:paper});
    const scale=Math.min(260/logo.width,54/logo.height);page.drawImage(logo,{x:44,y:718,width:logo.width*scale,height:logo.height*scale});
    page.drawText(kind==="administrative"?"CONFIDENTIAL - INTERNAL ESTIMATE":"PRELIMINARY PROJECT PLANNING",{x:44,y:697,size:10,font,color:ink});
    page.drawRectangle({x:44,y:680,width:524,height:3,color:accent});y=650;
  };
  const ensure=(height:number)=>{if(y-height<65)newPage();};
  const draw=(text:string,size=10.5,isHeading=false)=>{
    const chosen=isHeading?heading:font;
    const lines=wrap(text,chosen,size,524);
    for(const [index,line] of lines.entries()){ensure(size*1.35*(index===0?Math.min(2,lines.length):lines.length-index===2?2:1));if(line)page.drawText(line,{x:44,y,size,font:chosen,color:ink});y-=size*1.35;}
  };
  newPage();draw(kind==="administrative"?"Administrative estimate record":"Your project planning summary",23,true);y-=8;
  draw(`Reference ${id} | ${new Date().toISOString().slice(0,10)}`,9);y-=12;
  for(const block of blocks){
    const blockHeight=(block.title?wrap(block.title,heading,16,524).length*21.6+6:0)+(block.text?wrap(block.text,font,10.5,524).length*14.175:0)+(block.rows||[]).reduce((n,[name,value])=>n+(block.compact?wrap(`${name}: ${value}`,font,10.5,524).length*14.175+4:(wrap(name,font,10.5,524).length+wrap(value,font,10.5,524).length)*14.175+6),0)+10;
    ensure(compact?42:blockHeight<=180?blockHeight:60);if(block.title){page.drawLine({start:{x:44,y:y+8},end:{x:568,y:y+8},color:accent,thickness:.7});y-=compact?2:8;draw(block.title,compact?13:16,true);y-=compact?3:6;}
    if(block.text){draw(block.text);y-=compact?3:8;}
    for(const bullet of block.bullets||[]){ensure(36);draw(`• ${bullet}`);y-=compact?3:8;}
    for(const [name,value]of block.rows||[]){if(block.compact||(compact&&value.length<160)){ensure(22);draw(`${name}: ${value}`);y-=4;}else{ensure(60);draw(name,11,true);y-=4;const parts=scopeBullets(value);for(const part of parts){draw(parts.length>1?`• ${part}`:part);y-=4;}y-=8;}}
    y-=compact?5:10;
  }
  const pages=doc.getPages();
  pages.forEach((p,index)=>{
    p.drawLine({start:{x:44,y:49},end:{x:568,y:49},color:rgb(.8,.8,.8),thickness:.5});
    p.drawText(`${brand.domain} | ${brand.phone}`,{x:44,y:34,font,size:8,color:ink});
    p.drawText(`${index+1} / ${pages.length}`,{x:524,y:34,font,size:8,color:ink});
    p.drawText(kind==="administrative"?"Confidential P5 information. Do not send this version to the customer.":"Planning information only. Final scope and written agreement required.",{x:44,y:21,font,size:7,color:ink});
  });
  doc.setTitle(`${brand.name} ${kind} estimate ${id}`);doc.setAuthor(brand.name);doc.setSubject("Preliminary planning; not a bid, quote, offer or guaranteed price");
  return Buffer.from(await doc.save());
}
export function customerPdf(id:string,result:PublicResult){
  const blocks:Block[]=[
    {title:result.range?`${money(result.range.low)} to ${money(result.range.high)}`:"Scope received for pricing review",text:result.message},
    ...estimateSections(result),
    {title:"Recommended next step",text:`${result.nextStep}\nSchedule a consultation: https://${brand.domain}${brand.consultationPath}\n${brand.phone} | ${brand.email}`},
    {title:"Planning disclaimer",text:result.disclaimer},
  ];return render("customer",id,blocks);
}
export function administrativePdf(id:string,record:Record<string,unknown>){
  const number=(value:unknown)=>typeof value==="number"?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(value):"Not available";
  const percent=(value:unknown)=>typeof value==="number"?`${(value*100).toFixed(2)}%`:"Not available";
  const allocations=record.allocationDollars as Record<string,number>|undefined;
  const legacyAllocations=Boolean(allocations&&["nick","jared","social"].some(key=>allocations[key]>0));
  const range=record.planningRange as {low:number;high:number}|undefined;
  const blocks:Block[]=[{title:"Review status",text:record.publishable===true?"Planning range passed the arithmetic controls. Review all flagged assumptions before a firm proposal.":"Pricing is withheld pending the missing cost, scope or financial review identified below."}];
  if(typeof record.riskAdjustedDirectCost==="number")blocks.push({title:"Price and revenue allocation",compact:true,rows:[
    ["Recommended contract price",number(record.contractPrice)],
    ["Customer planning range",record.publishable===true&&range?`${money(range.low)} to ${money(range.high)}`:"Withheld pending review"],
    ["Direct project cost",number(record.directCost)],
    ["Project contingency",`${number(record.contingency)} (${percent(record.contingencyRate)} of direct cost)`],
    ["Risk-adjusted direct cost",number(record.riskAdjustedDirectCost)],
    ...(legacyAllocations?[["Historical Nick allocation",number(allocations?.nick)],["Historical Jared allocation",number(allocations?.jared)],["Historical social media allocation",number(allocations?.social)]] as [string,string][]:[]),
    [legacyAllocations?"Historical overhead allocation":"Complete overhead recovery",number(allocations?.overhead)],
    ["Operating profit after overhead",`${number(record.operatingProfit)} (${percent(record.targetOperatingProfit)} of revenue)`],
    ["Selected pricing divisor",String(record.divisor)],
  ]});
  if(!legacyAllocations&&allocations)blocks.push({text:"Overhead includes both owner salaries, payroll burden, advertising, social media and the remaining company budget. These costs are recovered once within the item prices. Additional project labor is counted only when it is outside that overhead-funded payroll."});
  if(record.directByCategory)blocks.push({title:"Direct project costs by category",compact:true,rows:Object.entries(record.directByCategory as Record<string,number>).map(([key,value])=>[label(key),number(value)])});
  if(Array.isArray(record.warnings)&&record.warnings.length)blocks.push({title:"Pricing warnings and required review",bullets:record.warnings.map((w:any)=>`${label(w.severity||"Review")}: ${w.message||printable(w)}`)});
  if(record.matrix)blocks.push({title:"Service margin policy and recommended contract method",text:printable(record.matrix)});
  const skip=new Set(["lines","scope","costBookSnapshot","financeSnapshot","warnings","matrix","directByCategory","scopePricing"]);
  blocks.push({title:"Complete calculation trace",text:"Amounts in the summary are displayed to cents. The stored estimate and trace preserve calculation precision.",rows:Object.entries(record).filter(([k])=>!skip.has(k)).map(([k,v])=>[label(k),printable(v)])});
  if(Array.isArray(record.lines)){
    const categories=[...new Set(record.lines.map((l:any)=>l.trade||label(l.category)))];
    for(const category of categories)blocks.push({title:`Direct costs: ${category}`,rows:record.lines.filter((l:any)=>(l.trade||label(l.category))===category).map((l:any)=>[l.description,`${l.quantity} ${l.unit} at ${number(l.unitCost)} = ${number(l.cost)}\nQuantity: ${l.quantitySource}\nSource: ${printable(l.evidence)}`])});
  }
  if(record.scope){const scope=record.scope as any;blocks.push({title:'Submitted project scope'},...estimateSections({summary:scopeText({...scope,answers:scope.answers||{}})}));}
  if(record.scopePricing){const audit=record.scopePricing as any;blocks.push({title:'Scope coverage audit',bullets:(audit.tasks||[]).map((t:any)=>`${t.description} - ${audit.verification?.coveredTaskIds?.includes(t.id)?'Coverage verified':'Review required'}`)}, {title:'Unresolved pricing issues',bullets:audit.issues||[]});}
  if(record.financeSnapshot)blocks.push({title:"Financial policy snapshot",rows:Object.entries(record.financeSnapshot as object).map(([k,v])=>[label(k),printable(v)])});
  if(record.costBookSnapshot){const book=record.costBookSnapshot as any;blocks.push({title:"Cost-book scope and assumptions",text:book.verifiedScope,bullets:book.assumptions||[]},{title:"Cost-book exclusions",bullets:book.exclusions||[]});}
  return render("administrative",id,blocks);
}
export function pdfFilename(id:string,kind:"customer"|"administrative"){return `${brand.id}-estimate-${id}-${kind}.pdf`;}
