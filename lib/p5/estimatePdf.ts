import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,PDFName,PDFString,rgb,type PDFFont,type PDFPage,type RGB} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {EstimateDocument} from './estimateDocument.ts';
/**
 * The approved preliminary online estimate as a US Letter PDF (owner template, 2026-09-21).
 *
 * Native text and layout, never an image of the sample: white page, the brand's logo leading the
 * header with its contacts on the right, one thin accent rule, a pale finish panel, numbered
 * categories with right-aligned amounts, a lightly tinted total, then exclusions, assumptions and
 * items to confirm, the three next steps, the review panel and the preliminary notice. The small
 * original P5 mark and "A P5 Home Co. brand" sit in the footer of every brand except P5 itself.
 * No solid dark bars anywhere; totals stand out by size, weight and a light tint.
 */
const W=612,H=792,L=54,R=558,WIDTH=R-L,TOP=680,BOTTOM=80;
const ASSETS='p5-estimate';
const hex=(h:string):RGB=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
const mix=(h:string,amount:number):RGB=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);return rgb(...(c.map(v=>1-(1-v)*amount) as [number,number,number]));};
const clean=(t:string)=>t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[‐-―]/g,'-');
function wrap(text:string,font:PDFFont,size:number,width:number,firstIndent=0):string[]{
  const lines:string[]=[];let line='';let limit=width-firstIndent;
  const push=()=>{lines.push(line);line='';limit=width;};
  for(const word of clean(text).split(/\s+/).filter(Boolean)){
    const next=line?`${line} ${word}`:word;
    if(font.widthOfTextAtSize(next,size)<=limit){line=next;continue;}
    if(line)push();
    if(font.widthOfTextAtSize(word,size)<=limit){line=word;continue;}
    for(const ch of word){if(font.widthOfTextAtSize(line+ch,size)>limit)push();line+=ch;}
  }
  if(line||!lines.length)lines.push(line);return lines;
}
export async function renderEstimatePdf(doc:EstimateDocument):Promise<Buffer>{
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const asset=(p:string)=>readFile(path.join(process.cwd(),'public',p));
  // Missing brand artwork or fonts fail generation (the delivery stays queued for retry); never a
  // placeholder or another brand's logo.
  const regular=await pdf.embedFont(await asset(`${ASSETS}/estimate-sans-regular.ttf`),{subset:true});
  const bold=await pdf.embedFont(await asset(`${ASSETS}/estimate-sans-bold.ttf`),{subset:true});
  const logoBytes=await asset(doc.brand.logo.replace(/^\//,''));
  const logo=/\.jpe?g$/i.test(doc.brand.logo)?await pdf.embedJpg(logoBytes):await pdf.embedPng(logoBytes);
  const mark=doc.brand.endorsed?await pdf.embedPng(await asset(`${ASSETS}/p5-mark.png`)):null;
  const ink=hex(doc.brand.ink||'#2C302F'),muted=hex('#565D58'),soft=hex('#6F7671'),rule=hex('#D5DAD5'),accent=hex(doc.brand.accent),tint=mix(doc.brand.accent,.12);
  let page!:PDFPage;let y=TOP;const pages:PDFPage[]=[];
  const link=(p:PDFPage,x:number,yy:number,w:number,h:number,uri:string)=>{
    const annot=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,yy,x+w,yy+h],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(uri)}});
    const ref=pdf.context.register(annot);const annots=p.node.lookup(PDFName.of('Annots'));
    if(annots&&'push' in (annots as object))(annots as unknown as {push:(r:unknown)=>void}).push(ref);else p.node.set(PDFName.of('Annots'),pdf.context.obj([ref]));
  };
  const text=(t:string,x:number,yy:number,size:number,font=regular,color=ink)=>page.drawText(clean(t),{x,y:yy,size,font,color});
  const right=(t:string,x:number,yy:number,size:number,font=regular,color=ink)=>text(t,x-font.widthOfTextAtSize(clean(t),size),yy,size,font,color);
  const newPage=()=>{
    page=pdf.addPage([W,H]);pages.push(page);
    const scale=Math.min(250/logo.width,34/logo.height);
    page.drawImage(logo,{x:L,y:H-50-logo.height*scale,width:logo.width*scale,height:logo.height*scale});
    const contacts:[string,string][]= [[doc.brand.phone,doc.review.tel],[doc.brand.email,`mailto:${doc.brand.email}`],[doc.brand.domain,`https://${doc.brand.domain}`]];
    contacts.forEach(([value,uri],i)=>{const yy=H-54-i*13;right(value,R,yy,9.5,regular,ink);link(page,R-regular.widthOfTextAtSize(value,9.5),yy-2,regular.widthOfTextAtSize(value,9.5),12,uri);});
    page.drawLine({start:{x:L,y:H-96},end:{x:R,y:H-96},thickness:.8,color:accent});
    y=TOP;
  };
  const ensure=(h:number)=>{if(y-h<BOTTOM){newPage();return true;}return false;};
  /** Wrapped paragraph; an optional bold lead-in shares the first line. */
  const para=(t:string,size=10.5,opts:{font?:PDFFont;color?:RGB;x?:number;width?:number;lead?:string;gap?:number}={})=>{
    const x=opts.x??L,width=opts.width??(R-x),font=opts.font||regular,lh=size*1.38;
    const leadW=opts.lead?bold.widthOfTextAtSize(opts.lead+' ',size):0;
    const lines=wrap(t,font,size,width,leadW);
    lines.forEach((line,i)=>{ensure(lh);if(i===0&&opts.lead)text(opts.lead,x,y-size,size,bold,opts.color||ink);text(line,x+(i===0?leadW:0),y-size,size,font,opts.color||ink);y-=lh;});
    y-=opts.gap??0;
  };
  const height=(t:string,size:number,width:number,font=regular,lead='')=>wrap(t,font,size,width,lead?bold.widthOfTextAtSize(lead+' ',size):0).length*size*1.38;
  const heading=(t:string,size=14,space=10)=>{ensure(size*1.3+space+30);y-=space;text(t,L,y-size,size,bold);y-=size*1.3+4;};
  const divider=(gap=6)=>{page.drawLine({start:{x:L,y:y-gap/2},end:{x:R,y:y-gap/2},thickness:.5,color:rule});y-=gap;};

  newPage();
  // Letterhead block.
  text('PRELIMINARY ONLINE ESTIMATE',L,y-8.5,8.5,bold,soft);y-=16;
  para(doc.title,24,{font:bold});y-=2;
  if(doc.projectName)para(doc.projectName,12.5,{color:muted,gap:6});else y-=4;
  const colY=y,col2=L+WIDTH/2+8;
  text('PREPARED FOR',L,y-8,8,bold,soft);y-=13;
  for(const v of [doc.customer.name,doc.customer.email,doc.customer.phone].filter(Boolean))para(v,10.5,{width:WIDTH/2-12});
  const leftEnd=y;y=colY;
  text('PROJECT LOCATION',col2,y-8,8,bold,soft);y-=13;
  for(const v of doc.location.length?doc.location:['To be confirmed'])para(v,10.5,{x:col2,width:R-col2});
  y=Math.min(leftEnd,y)-4;
  para(`Estimate ${doc.reference}${doc.issuedLabel?`  |  Prepared ${doc.issuedLabel}`:''}`,9,{color:soft,gap:10});

  // Finish level or repair standard, before any price.
  {const pad=10,inner=WIDTH-pad*2-4;
   const h=pad*2+11+height(doc.finish.name,11.5,inner,bold)+height(doc.finish.detail,10,inner)+height(doc.finish.basis,9,inner)+4;
   ensure(h);page.drawRectangle({x:L,y:y-h,width:WIDTH,height:h,color:tint});page.drawRectangle({x:L,y:y-h,width:2.5,height:h,color:accent});
   y-=pad;text(doc.finish.heading.toUpperCase(),L+pad+4,y-8,8,bold,soft);y-=13;
   para(doc.finish.name,11.5,{font:bold,x:L+pad+4,width:inner});para(doc.finish.detail,10,{x:L+pad+4,width:inner,color:muted});para(doc.finish.basis,9,{x:L+pad+4,width:inner,color:soft});
   y-=pad-2;}

  heading('Scope & pricing',14,12);
  for(const c of doc.categories){
    const head=()=>{text(`${c.number}  ${c.title}`,L,y-11,11,bold);if(c.amount)right(c.amount,R,y-11,11,bold);y-=17;page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.7,color:accent});y-=9;};
    const first=c.work[0]||c.allowances[0]||'';
    ensure(40+(first?height(first,10.5,WIDTH):0));y-=6;
    // The title is sized to leave room for the amount; a long title wraps rather than colliding.
    const titleWidth=WIDTH-(c.amount?bold.widthOfTextAtSize(c.amount,11)+18:0);
    if(bold.widthOfTextAtSize(`${c.number}  ${c.title}`,11)>titleWidth){
      const lines=wrap(`${c.number}  ${c.title}`,bold,11,titleWidth);
      lines.forEach((line,i)=>{text(line,L,y-11,11,bold);if(i===0&&c.amount)right(c.amount,R,y-11,11,bold);y-=15;});
      y-=2;page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.7,color:accent});y-=9;
    }else head();
    const page0=page;
    for(const w of c.work){if(ensure(height(w,10.5,WIDTH))){text(`${c.number}  ${c.title} (continued)`,L,y-10,10,bold,soft);y-=18;}para(w,10.5,{gap:2});}
    for(const a of c.allowances){if(ensure(height(a,10.5,WIDTH,regular,'Allowance included:'))){text(`${c.number}  ${c.title} (continued)`,L,y-10,10,bold,soft);y-=18;}para(a,10.5,{lead:'Allowance included:',gap:2});}
    void page0;y-=4;
  }
  // Totals. A single amount reconciles to its categories; a range explains how it relates to them.
  y-=4;
  if(doc.subtotal){ensure(22);text('Included categories subtotal',L,y-10.5,10.5,regular,muted);right(doc.subtotal,R,y-10.5,10.5,regular,muted);y-=18;divider(4);}
  {const amount=doc.total?.amount||'Pricing pending review';const size=amount.length>18?13.5:15;const h=36;
   ensure(h+24);page.drawRectangle({x:L,y:y-h,width:WIDTH,height:h,color:tint});page.drawLine({start:{x:L,y},end:{x:R,y},thickness:.8,color:accent});
   text(doc.total?.label||'Estimate status',L+12,y-23,14,bold);right(amount,R-12,y-23.5,size,bold);y-=h+8;}
  if(doc.partialNote)para(doc.partialNote,9.5,{font:bold,gap:3});
  for(const n of doc.totalNotes)para(n,9,{color:soft,gap:1});

  // Details and next steps. Start a fresh page when little room is left, as the approved layout does.
  if(y<TOP-80&&y-BOTTOM<230)newPage();else y-=18;
  text('PROJECT DETAILS',L,y-8.5,8.5,bold,soft);y-=20;para('Details & next steps',20,{font:bold,gap:2});
  heading('Exclusions',14,8);
  if(doc.exclusions.length){text(doc.exclusionsNote,L,y-9,9,bold,soft);y-=18;for(const e of doc.exclusions){ensure(height(e,10.5,WIDTH)+8);y-=3;para(e,10.5);divider(7);}}
  else para(doc.exclusionsNote,10,{color:muted,gap:4});
  heading('Assumptions & items to confirm',14,10);
  const labelW=112;
  for(const [label,values] of doc.assumptionRows){
    const items=values.length>1?values.map(v=>`• ${v}`):values;
    ensure(Math.min(80,height(items[0],10.5,WIDTH-labelW)+10));y-=4;
    const start=y;let startPage=page;text(label,L,y-10.5,10.5,regular,muted);
    for(const v of items){if(ensure(height(v,10.5,WIDTH-labelW))){startPage=page;}para(v,10.5,{x:L+labelW,width:WIDTH-labelW,gap:2});}
    void start;void startPage;divider(7);
  }
  ensure(32+doc.nextSteps.reduce((t,[,b])=>t+19+height(b,10.5,WIDTH-32)+6,0)+64+height(doc.notice.text,9.5,WIDTH,regular,doc.notice.lead)+(doc.legalLine?15:0));heading('Next steps',14,10);
  doc.nextSteps.forEach(([title,body],i)=>{ensure(40);y-=4;text(String(i+1).padStart(2,'0'),L,y-17,12,bold);text(title,L+32,y-11,11,bold);y-=15;para(body,10.5,{x:L+32,width:WIDTH-32,gap:6});});
  {const h=48;ensure(h+50);y-=4;page.drawRectangle({x:L,y:y-h,width:WIDTH,height:h,color:tint,borderColor:accent,borderWidth:.8});
   const t=doc.review.label;const tw=bold.widthOfTextAtSize(t,12);text(t,L+(WIDTH-tw)/2,y-19,12,bold);link(page,L+(WIDTH-tw)/2,y-22,tw,15,doc.review.mailto);
   const e=doc.review.email,p=doc.review.phone,sep='   |   ';const total=regular.widthOfTextAtSize(e+sep+p,10);const x0=L+(WIDTH-total)/2;
   text(e+sep+p,x0,y-36,10,regular,muted);link(page,x0,y-39,regular.widthOfTextAtSize(e,10),13,doc.review.mailto);link(page,x0+regular.widthOfTextAtSize(e+sep,10),y-39,regular.widthOfTextAtSize(p,10),13,doc.review.tel);
   y-=h+12;}
  para(doc.notice.text,9.5,{lead:doc.notice.lead,color:muted});
  if(doc.legalLine){y-=4;para(doc.legalLine,8,{color:soft});}

  pages.forEach((p,i)=>{
    p.drawLine({start:{x:L,y:62},end:{x:R,y:62},thickness:.5,color:rule});
    if(mark){p.drawImage(mark,{x:L,y:34,width:20,height:20});p.drawText('A P5 Home Co. brand',{x:L+28,y:40,size:8.5,font:regular,color:soft});}
    else p.drawText(`${doc.brand.name}  |  ${doc.brand.domain}`,{x:L,y:40,size:8.5,font:regular,color:soft});
    const label=`${doc.reference}  |  ${i+1} / ${pages.length}`;p.drawText(label,{x:R-regular.widthOfTextAtSize(label,8.5),y:40,size:8.5,font:regular,color:soft});
  });
  pdf.setTitle(`${doc.brand.name} preliminary online estimate ${doc.reference}`);pdf.setAuthor(doc.brand.name);
  pdf.setSubject('Preliminary estimate, not a contract');pdf.setKeywords([doc.templateVersion,doc.service,`revision ${doc.revision}`]);
  if(doc.issuedAt&&Number.isFinite(Date.parse(doc.issuedAt))){pdf.setCreationDate(new Date(doc.issuedAt));pdf.setModificationDate(new Date(doc.issuedAt));}
  return Buffer.from(await pdf.save());
}
