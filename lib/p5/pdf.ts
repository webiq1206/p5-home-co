import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument,rgb,type PDFPage,type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ESTIMATOR_BRAND as brand } from "./brand";
type PublicResult={status:string;range:{low:number;high:number}|null;summary:string;includedCategories:string[];categoryRanges?:{category:string;low:number;high:number}[];allowances:unknown[];assumptions:string[];exclusions:string[];factors:string[];nextStep:string;message:string;disclaimer:string};
type Block={title?:string;text?:string;rows?:[string,string][];compact?:boolean};
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,"$1 $2").replaceAll("-"," ").replace(/^./,c=>c.toUpperCase());
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(n);
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
  const asset=(p:string)=>readFile(path.join(process.cwd(),"public",p));
  // Missing brand assets fail delivery and stay in the outbox; no placeholder logos.
  const font=await doc.embedFont(await asset(brand.font),{subset:true});
  const heading=await doc.embedFont(await asset(brand.headingFont),{subset:true});
  const logo=await doc.embedPng(await asset(brand.logo));
  const hex=(h:string)=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
  const ink=hex(brand.ink);const accent=hex(brand.accent);const paper=hex(brand.paper);
  let page:PDFPage;let y=0;
  const newPage=()=>{
    page=doc.addPage([612,792]);page.drawRectangle({x:0,y:680,width:612,height:112,color:ink});
    const scale=Math.min(220/logo.width,40/logo.height);page.drawImage(logo,{x:44,y:727,width:logo.width*scale,height:logo.height*scale});
    page.drawText(kind==="administrative"?"CONFIDENTIAL - INTERNAL ESTIMATE":"PRELIMINARY PROJECT PLANNING",{x:44,y:700,size:10,font,color:paper});
    page.drawRectangle({x:44,y:680,width:524,height:3,color:accent});y=650;
  };
  const ensure=(height:number)=>{if(y-height<65)newPage();};
  const draw=(text:string,size=10.5,isHeading=false)=>{
    const chosen=isHeading?heading:font;
    for(const line of wrap(text,chosen,size,524)){ensure(size*1.35);if(line)page.drawText(line,{x:44,y,size,font:chosen,color:ink});y-=size*1.35;}
  };
  newPage();draw(kind==="administrative"?"Administrative estimate record":"Your project planning summary",23,true);y-=8;
  draw(`Reference ${id} | ${new Date().toISOString().slice(0,10)}`,9);y-=12;
  for(const block of blocks){
    ensure(60);if(block.title){draw(block.title,16,true);y-=6;}
    if(block.text)draw(block.text);
    for(const [name,value]of block.rows||[]){if(block.compact){ensure(22);draw(`${name}: ${value}`);y-=4;}else{ensure(38);draw(name,10.5);draw(value,10.5);y-=6;}}
    y-=10;
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
    {title:"Your project",text:result.summary},
    {title:"Major included categories",text:result.includedCategories.length?result.includedCategories.map(x=>x.replaceAll("-"," ")).join("\n"):"To be confirmed during scope review."},
    ...(result.categoryRanges?.length?[{title:"Planning range by trade",compact:true,rows:result.categoryRanges.map(x=>[x.category,`${money(x.low)} to ${money(x.high)}`] as [string,string])}]:[]),
    ...(result.allowances.length?[{title:"Allowances",text:printable(result.allowances)}]:[]),
    ...(result.exclusions.length?[{title:"Exclusions",text:result.exclusions.join("\n")}]:[]),
    ...(result.assumptions.length?[{title:"Planning assumptions",text:result.assumptions.join("\n")}]:[]),
    ...(result.factors.length?[{title:"Factors that may change the range",text:result.factors.join("\n")}]:[]),
    {title:"Recommended next step",text:`${result.nextStep}\nSchedule a consultation: https://${brand.domain}${brand.consultationPath}\n${brand.phone} | ${brand.email}`},
    {title:"Planning disclaimer",text:result.disclaimer},
  ];return render("customer",id,blocks);
}
export function administrativePdf(id:string,record:Record<string,unknown>){
  const number=(value:unknown)=>typeof value==="number"?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(value):"Not available";
  const percent=(value:unknown)=>typeof value==="number"?`${(value*100).toFixed(2)}%`:"Not available";
  const allocations=record.allocationDollars as Record<string,number>|undefined;
  const range=record.planningRange as {low:number;high:number}|undefined;
  const blocks:Block[]=[{title:"Review status",text:record.publishable===true?"Planning range passed the arithmetic controls. Review all flagged assumptions before a firm proposal.":"Pricing is withheld pending the missing cost, scope or financial review identified below."}];
  if(typeof record.riskAdjustedDirectCost==="number")blocks.push({title:"Price and revenue allocation",compact:true,rows:[
    ["Recommended contract price",number(record.contractPrice)],
    ["Customer planning range",record.publishable===true&&range?`${money(range.low)} to ${money(range.high)}`:"Withheld pending review"],
    ["Direct project cost",number(record.directCost)],
    ["Project contingency",`${number(record.contingency)} (${percent(record.contingencyRate)} of direct cost)`],
    ["Risk-adjusted direct cost",number(record.riskAdjustedDirectCost)],
    ["Nick project allocation",number(allocations?.nick)],
    ["Jared project allocation",number(allocations?.jared)],
    ["Social media allocation",number(allocations?.social)],
    ["Company overhead allocation",number(allocations?.overhead)],
    ["Operating profit after allocations",`${number(record.operatingProfit)} (${percent(record.targetOperatingProfit)} of revenue)`],
    ["Selected pricing divisor",String(record.divisor)],
  ]});
  if(record.directByCategory)blocks.push({title:"Direct project costs by category",compact:true,rows:Object.entries(record.directByCategory as Record<string,number>).map(([key,value])=>[label(key),number(value)])});
  if(record.warnings)blocks.push({title:"Pricing warnings and required review",text:printable(record.warnings)});
  if(record.matrix)blocks.push({title:"Service margin policy and recommended contract method",text:printable(record.matrix)});
  const skip=new Set(["lines","scope","costBookSnapshot","financeSnapshot","warnings","matrix","directByCategory"]);
  blocks.push({title:"Complete calculation trace",text:"Amounts in the summary are displayed to cents. The stored estimate and trace preserve calculation precision.",rows:Object.entries(record).filter(([k])=>!skip.has(k)).map(([k,v])=>[label(k),printable(v)])});
  if(record.lines)blocks.push({title:"Direct-cost lines and source evidence",text:printable(record.lines)});
  if(record.scope)blocks.push({title:"Submitted scope, uploads, extraction and corrections",text:printable(record.scope)});
  if(record.financeSnapshot)blocks.push({title:"Financial policy snapshot",text:printable(record.financeSnapshot)});
  if(record.costBookSnapshot)blocks.push({title:"Cost-book snapshot",text:printable(record.costBookSnapshot)});
  return render("administrative",id,blocks);
}
export function pdfFilename(id:string,kind:"customer"|"administrative"){return `${brand.id}-estimate-${id}-${kind}.pdf`;}
