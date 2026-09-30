import {PDFDocument,StandardFonts} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {pdfjsAssetOptions} from './pdfjsAssets.ts';

export type FormControlRegion={x:number;y:number;width:number;height:number};
type PositionedText={str?:string;transform?:number[];width?:number;height?:number};
/** These are candidates for magnification, never selected/unselected decisions.
 * Symbol fonts can map a checkbox outline to a registered sign or diaeresis.
 * A false candidate only adds a view; it cannot add or remove project scope. */
export function formControlRegions(items:PositionedText[]):FormControlRegion[]{
 return items.flatMap(item=>{
  const t=item.transform;
  if(!/^[☐☑☒□■¨®]$/.test(item.str?.trim()||'')||!t||t.length!==6||t.some(v=>!Number.isFinite(v))||Math.abs(t[1])>0.01||Math.abs(t[2])>0.01)return [];
  const width=item.width||0,height=item.height||Math.abs(t[3]);
  if(width<3||width>40||height<5||height>40)return [];
  return [{x:t[4],y:t[5],width,height}];
 });
}

/** Keep the source page intact and append contact sheets with a close-up of
 * each candidate control and the same row of the source beside it. Selection
 * remains a visual model decision, including handwritten marks and strikeouts.
 * No form name, clause keyword, customer address or expected answer is used. */
export async function withFormControlViews(data:Buffer,original?:{data:Buffer;page:number}):Promise<{data:Buffer;formViews?:number}>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(original?.data||data),...pdfjsAssetOptions()});
 try{
  const pdf=await task.promise;
  if(!original&&pdf.numPages!==1)return {data};
  const page=await pdf.getPage(original?.page||1),content=await page.getTextContent();
  const regions=formControlRegions(content.items as PositionedText[]);
  // Include native form widgets too; the rendered appearance, not the stored
  // field value, is what the reader will inspect.
  for(const annotation of await page.getAnnotations()){
   if(annotation.subtype!=='Widget'||!annotation.checkBox||!Array.isArray(annotation.rect)||annotation.rect.length!==4)continue;
   const [x,y,right,top]=annotation.rect as number[];
   if([x,y,right,top].every(Number.isFinite)&&right>x&&top>y)regions.push({x,y,width:right-x,height:top-y});
  }
  if(!regions.length)return {data};
  const base=page.getViewport({scale:1});
  // Large drawings already have a separate complete detail-rendering path.
  if(base.width>1200||base.height>1200)return {data};
  const scale=4,viewport=page.getViewport({scale});
  const full=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  try{
   await page.render({canvas:full as unknown as HTMLCanvasElement,canvasContext:full.getContext('2d') as unknown as CanvasRenderingContext2D,viewport,background:'white'}).promise;
   const out=await PDFDocument.load(data),font=await out.embedFont(StandardFonts.Helvetica);
   let sheet:ReturnType<typeof out.addPage>|undefined;
   let index=0;
   for(const region of regions){
    const points=[...viewport.convertToViewportPoint(region.x,region.y),...viewport.convertToViewportPoint(region.x+region.width,region.y+region.height)];
    const left=Math.min(points[0],points[2]),top=Math.min(points[1],points[3]),right=Math.max(points[0],points[2]),bottom=Math.max(points[1],points[3]);
    const crop=async(x:number,y:number,width:number,height:number)=>{
     const x0=Math.max(0,Math.floor(x)),y0=Math.max(0,Math.floor(y));
     const w=Math.min(full.width-x0,Math.ceil(width)),h=Math.min(full.height-y0,Math.ceil(height));
     if(w<=0||h<=0)throw new Error('A form control is outside its page.');
     const canvas=createCanvas(w,h);canvas.getContext('2d').drawImage(full,x0,y0,w,h,0,0,w,h);
     const image=await out.embedPng(canvas.toBuffer('image/png'));canvas.width=1;return image;
    };
    const close=await crop(left-scale,top-scale,right-left+2*scale,bottom-top+2*scale);
    const row=await crop(0,top-scale,full.width,bottom-top+3*scale);
    const slot=index%6;
    if(slot===0){const height=100+Math.min(6,regions.length-index)*115;sheet=out.addPage([612,height]);sheet.drawText('FORM CONTROL DETAIL VIEWS - SAME ORIGINAL PAGE',{x:20,y:height-24,size:11,font});sheet.drawText('Enlarged control at left; original row at right. Inspect marks and labels together.',{x:20,y:height-43,size:9,font});}
    const y=sheet!.getHeight()-68-slot*115;
    sheet!.drawText(`Control ${index+1} - source page position x=${region.x.toFixed(1)}, y=${region.y.toFixed(1)} pt`,{x:20,y,size:8,font});
    const closeScale=Math.min(66/close.width,66/close.height),rowScale=Math.min(490/row.width,68/row.height);
    sheet!.drawImage(close,{x:20,y:y-8-close.height*closeScale,width:close.width*closeScale,height:close.height*closeScale});
    sheet!.drawImage(row,{x:102,y:y-8-row.height*rowScale,width:row.width*rowScale,height:row.height*rowScale});
    index++;
   }
   return {data:Buffer.from(await out.save()),formViews:index};
  }finally{full.width=1;page.cleanup();}
 }finally{await task.destroy();}
}
