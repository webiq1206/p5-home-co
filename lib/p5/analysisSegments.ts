import {PDFDocument} from 'pdf-lib';
import {drawingDetails} from './planRendering.ts';
import {pdfTextLayers} from './pdfText.ts';
import type {AnalysisFile} from './extraction.ts';

const UNIT_BYTES=16*1024*1024;
/** Characters of neighbouring-page text supplied as context to a page read. */
const CONTEXT_CHARS=2500;
/** Split a document into independent read units.
 *
 * Ordinary pages become one unit each, so a document is read in parallel and
 * progress advances page by page instead of one long call for four pages.
 * Every page unit carries the page's own text layer (extracted locally, so a
 * provider that cannot accept PDF input still reads the page) and a short
 * excerpt of the adjacent pages for continuity. Large drawings keep their
 * full-resolution detail path and source identity. */
export async function* analysisSegments(file:AnalysisFile,startPage=0,render:typeof drawingDetails=drawingDetails):AsyncGenerator<AnalysisFile>{
  if(file.type==='application/pdf'){
    const document=await PDFDocument.load(file.data);const count=document.getPageCount();
    if(!count||count>2000)throw new Error('This PDF needs between 1 and 2,000 pages.');
    // Text layers are read once per generator run; a failure leaves the layer
    // absent and the page is still read from its PDF bytes.
    const layers=await pdfTextLayers(file.data,count).catch(error=>{console.error(`[p5-analysis] text layer unavailable for ${file.name}: ${error instanceof Error?error.message:String(error)}`);return [] as string[];});
    const layer=(index:number)=>(layers[index]||'').trim();
    const context=(index:number)=>{
      const parts:string[]=[];
      if(index>0&&layer(index-1))parts.push(`[Preceding page ${index} excerpt] ${layer(index-1).slice(-CONTEXT_CHARS)}`);
      if(index+1<count&&layer(index+1))parts.push(`[Following page ${index+2} excerpt] ${layer(index+1).slice(0,CONTEXT_CHARS)}`);
      return parts.join('\n');
    };
    // Do not re-open a complete high-resolution plan set for every sheet.
    // Render one isolated source page while retaining its original identity.
    const singlePage=async(index:number)=>{const single=await PDFDocument.create();single.addPage((await single.copyPages(document,[index]))[0]);return Buffer.from(await single.save());};
    const detailPage=async function*(index:number){for await(const unit of render({...file,data:await singlePage(index)},index+1,1))yield {...unit,text:layer(index)||undefined};};
    // When the host cannot render a drawing's detail tiles, the original page
    // is supplied whole so the sheet is still read; only a page too large for
    // one request is reported as unprepared. The cause is logged for the host.
    const originalPage=async function*(index:number,error:unknown){
      console.error(`[p5-analysis] detail rendering failed for ${file.name} page ${index+1}:`,error instanceof Error?error.stack||error.message:String(error));
      const data=await singlePage(index);
      if(data.length>UNIT_BYTES){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:index+1}],nextPage:index+1,preparationError:`Page ${index+1}: detail rendering failed and the page is too large to send whole. ${error instanceof Error?error.message:'Review the original drawing.'}`};return;}
      yield {...file,name:`${file.name} (original page ${index+1} of ${count}; supplied whole because detail rendering was unavailable)`,pages:[{source:file.name,page:index+1}],data,text:layer(index)||undefined,context:context(index)||undefined,nextPage:index+1};
    };
    const large=(i:number)=>{const p=document.getPage(i);return p.getWidth()>1200||p.getHeight()>1200;};
    for(let index=startPage;index<count;index++){
      if(large(index)){
        try{yield* detailPage(index);}catch(error){yield* originalPage(index,error);}
        continue;
      }
      const data=await singlePage(index);
      if(data.length>UNIT_BYTES){try{yield* detailPage(index);}catch(error){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:index+1}],preparationError:`Page ${index+1}: could not prepare its high-resolution content. ${error instanceof Error?error.message:''}`,nextPage:index+1};}}
      else yield {...file,name:count===1?file.name:`${file.name} (page ${index+1} of ${count})`,pages:[{source:file.name,page:index+1}],data,text:layer(index)||undefined,context:context(index)||undefined,nextPage:index+1};
    }
  }else if(['text/plain','text/csv','application/json'].includes(file.type)){
    const text=file.data.toString('utf8');
    for(let start=0;start<text.length;start+=60000)yield {...file,name:text.length<=60000?file.name:`${file.name} (text section ${Math.floor(start/60000)+1})`,data:Buffer.from(text.slice(start,start+60000))};
  }else{
    if(file.data.length>UNIT_BYTES)throw new Error('This image needs a smaller export before automatic reading. The original is saved.');
    yield file;
  }
}
