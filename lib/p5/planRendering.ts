import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {AnalysisFile} from './extraction';

/** Render every region of a large drawing at 216 DPI, using bounded canvases.
 * Detail tiles overlap so edge labels remain legible. They are observations of
 * ONE original page, never additional physical quantities or extra plan pages.
 */
export async function* drawingDetails(file:AnalysisFile,pageNumber:number):AsyncGenerator<AnalysisFile>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets=path.dirname(createRequire(path.join(process.cwd(),'package.json')).resolve('pdfjs-dist/package.json'));
  const task=getDocument({data:new Uint8Array(file.data),useSystemFonts:true,standardFontDataUrl:path.join(assets,'standard_fonts/'),cMapUrl:path.join(assets,'cmaps/'),cMapPacked:true,wasmUrl:path.join(assets,'wasm/')});
  const document=await task.promise;
  try{
    const page=await document.getPage(pageNumber),viewport=page.getViewport({scale:3});
    const edge=1500,step=1380;
    // Decode and render ordinary architectural sheets once. Re-rendering the
    // entire PDF image for every crop is needlessly slow for scanned plans.
    // Extremely large sheets retain the bounded tile-by-tile fallback.
    const full=viewport.width*viewport.height<=48_000_000?createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)):null;
    if(full)await page.render({canvas:full as any,canvasContext:full.getContext('2d') as any,viewport,background:'white'}).promise;
    const columns=Math.max(1,Math.ceil((viewport.width-edge)/step)+1),rows=Math.max(1,Math.ceil((viewport.height-edge)/step)+1);
    // Each group includes a whole-sheet context view so schedules, room labels
    // and callouts remain locatable when a long drawing spans detail groups.
    let overview:Buffer|undefined;
    if(full){const small=createCanvas(1296,Math.max(1,Math.round(1296*viewport.height/viewport.width)));small.getContext('2d').drawImage(full,0,0,small.width,small.height);overview=small.toBuffer('image/jpeg',90);}
    const newPart=async()=>{const pdf=await PDFDocument.create();if(overview){const image=await pdf.embedJpg(overview);pdf.addPage([image.width,image.height]).drawImage(image,{x:0,y:0,width:image.width,height:image.height});}return pdf;};
    let part=await newPart(),tiles=0,first=1;
    const count=columns*rows;
    if(count>500)throw new Error(`Page ${pageNumber} has an unusually large physical size. Confirm its page dimensions before detail rendering.`);
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const x=column*step,y=row*step,width=Math.ceil(Math.min(edge,viewport.width-x)),height=Math.ceil(Math.min(edge,viewport.height-y));
      const canvas=createCanvas(width,height);
      if(full)canvas.getContext('2d').drawImage(full,x,y,width,height,0,0,width,height);
      else await page.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport,transform:[1,0,0,1,-x,-y],background:'white'}).promise;
      const image=await part.embedJpg(canvas.toBuffer('image/jpeg',95));
      const sheet=part.addPage([width,height]);sheet.drawImage(image,{x:0,y:0,width,height});
      tiles++;
      if(tiles%6===0||tiles===count){
        const data=Buffer.from(await part.save());
        if(data.length>16*1024*1024)throw new Error(`Page ${pageNumber} detail images exceed the safe analysis request size.`);
        yield {name:`${file.name} (original page ${pageNumber}; ${overview?'whole-sheet context first, then ':''}detail tiles ${first} to ${tiles} of ${count}, row-major ${columns} columns; overlapping regions, do not count twice)`,type:'application/pdf',data,pages:[{source:file.name,page:pageNumber}],nextPage:tiles===count?pageNumber:undefined};
        part=await newPart();first=tiles+1;
      }
    }
    page.cleanup();
  }finally{await task.destroy();}
}
