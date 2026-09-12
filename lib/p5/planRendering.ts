import {PDFDocument} from 'pdf-lib';
import {createCanvas,type Canvas} from '@napi-rs/canvas';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {AnalysisFile} from './extraction';

/** Exact pixel inspection only. Any nonwhite pixel, including a faint mark,
 * keeps the region for AI review. No content-detection threshold or sampling. */
export function entirelyWhite(pixels:Uint8ClampedArray|Uint8Array):boolean {
  if(!pixels.length||pixels.length%4!==0)return false;
  for(let i=0;i<pixels.length;i++)if(pixels[i]!==255)return false;
  return true;
}

/** Inspect every region at 216 DPI. Send every nonblank crop at full detail,
 * without a tiny duplicate overview that can cause false illegibility flags.
 * Blank regions retain explicit pixel-inspection evidence in the manifest. */
export async function* drawingDetails(file:AnalysisFile,pageNumber:number,dataPageNumber=pageNumber):AsyncGenerator<AnalysisFile>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets=path.dirname(createRequire(path.join(process.cwd(),'package.json')).resolve('pdfjs-dist/package.json'));
  const task=getDocument({data:new Uint8Array(file.data),useSystemFonts:true,standardFontDataUrl:path.join(assets,'standard_fonts/'),cMapUrl:path.join(assets,'cmaps/'),cMapPacked:true,wasmUrl:path.join(assets,'wasm/')});
  const document=await task.promise;
  let full:Canvas|null=null;
  try{
    const page=await document.getPage(dataPageNumber),viewport=page.getViewport({scale:3});
    const edge=1500,step=1380;
    full=viewport.width*viewport.height<=48_000_000?createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)):null;
    if(full)await page.render({canvas:full as any,canvasContext:full.getContext('2d') as any,viewport,background:'white'}).promise;
    const columns=Math.max(1,Math.ceil((viewport.width-edge)/step)+1),rows=Math.max(1,Math.ceil((viewport.height-edge)/step)+1),count=columns*rows;
    if(count>500)throw new Error(`Page ${pageNumber} has an unusually large physical size. Confirm its page dimensions before detail rendering.`);
    let part=await PDFDocument.create(),indices:number[]=[],inspected=0;const blankTiles:number[]=[];
    const finish=async(last:boolean):Promise<AnalysisFile>=>{
      if(!part.getPageCount())part.addPage([612,792]);
      const data=Buffer.from(await part.save());
      if(data.length>16*1024*1024)throw new Error(`Page ${pageNumber} detail images exceed the safe analysis request size.`);
      return {name:`${file.name} (original page ${pageNumber}; detail regions ${indices.join(', ')||'none: all regions exactly white'} of ${count}; overlapping regions, do not count twice)`,type:'application/pdf',data,pages:[{source:file.name,page:pageNumber}],detailViews:true,detailRegions:{columns,rows,tiles:[...indices],blankTiles:[...blankTiles],inspectedTiles:inspected},nextPage:last?pageNumber:undefined};
    };
    for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
      const x=column*step,y=row*step,width=Math.ceil(Math.min(edge,viewport.width-x)),height=Math.ceil(Math.min(edge,viewport.height-y));
      const canvas=createCanvas(width,height),context=canvas.getContext('2d');
      if(full)context.drawImage(full,x,y,width,height,0,0,width,height);
      else await page.render({canvas:canvas as any,canvasContext:context as any,viewport,transform:[1,0,0,1,-x,-y],background:'white'}).promise;
      const index=row*columns+column+1;
      if(entirelyWhite(context.getImageData(0,0,width,height).data)){blankTiles.push(index);inspected++;canvas.width=1;continue;}
      // Hold the last batch until trailing blank regions are inspected, so the
      // source page always has a durable final completion checkpoint.
      if(indices.length===6){yield await finish(false);part=await PDFDocument.create();indices=[];}
      const image=await part.embedJpg(canvas.toBuffer('image/jpeg',95));
      part.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
      indices.push(index);inspected++;canvas.width=1;
    }
    yield await finish(true);
    page.cleanup();
  }finally{if(full)full.width=1;await task.destroy();}
}
