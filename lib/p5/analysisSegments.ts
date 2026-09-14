import {PDFDocument} from 'pdf-lib';
import {drawingDetails} from './planRendering.ts';
import type {AnalysisFile} from './extraction.ts';

const UNIT_BYTES=16*1024*1024;
export async function* analysisSegments(file:AnalysisFile,startPage=0,render:typeof drawingDetails=drawingDetails):AsyncGenerator<AnalysisFile>{
  if(file.type==='application/pdf'){
    const document=await PDFDocument.load(file.data);const count=document.getPageCount();
    if(!count||count>2000)throw new Error('This PDF needs between 1 and 2,000 pages.');
    // Do not re-open a complete high-resolution plan set for every sheet.
    // Render one isolated source page while retaining its original identity.
    const singlePage=async(index:number)=>{const single=await PDFDocument.create();single.addPage((await single.copyPages(document,[index]))[0]);return Buffer.from(await single.save());};
    const detailPage=async function*(index:number){yield* render({...file,data:await singlePage(index)},index+1,1);};
    // When the host cannot render a drawing's detail tiles, the original page
    // is supplied whole so the sheet is still read; only a page too large for
    // one request is reported as unprepared. The cause is logged for the host.
    const originalPage=async function*(index:number,error:unknown){
      console.error(`[p5-analysis] detail rendering failed for ${file.name} page ${index+1}:`,error instanceof Error?error.stack||error.message:String(error));
      const data=await singlePage(index);
      if(data.length>UNIT_BYTES){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:index+1}],nextPage:index+1,preparationError:`Page ${index+1}: detail rendering failed and the page is too large to send whole. ${error instanceof Error?error.message:'Review the original drawing.'}`};return;}
      yield {...file,name:`${file.name} (original page ${index+1} of ${count}; supplied whole because detail rendering was unavailable)`,pages:[{source:file.name,page:index+1}],data,nextPage:index+1};
    };
    const large=(i:number)=>{const p=document.getPage(i);return p.getWidth()>1200||p.getHeight()>1200;};
    for(let start=startPage;start<count;){
      if(large(start)){
        try{yield* detailPage(start);}catch(error){yield* originalPage(start,error);}
        start++;continue;
      }
      // Adjacent ordinary pages share context and one provider request. Large
      // drawings retain their full-resolution detail path and source identity.
      let end=start+1;
      while(end<count&&end<start+4&&!large(end))end++;
      let part=await PDFDocument.create();
      for(const page of await part.copyPages(document,Array.from({length:end-start},(_,i)=>start+i)))part.addPage(page);
      let data=Buffer.from(await part.save());
      if(data.length>UNIT_BYTES&&end>start+1){end=start+1;part=await PDFDocument.create();part.addPage((await part.copyPages(document,[start]))[0]);data=Buffer.from(await part.save());}
      if(data.length>UNIT_BYTES){try{yield* detailPage(start);}catch(error){yield {...file,data:Buffer.alloc(0),pages:[{source:file.name,page:start+1}],preparationError:`Page ${start+1}: could not prepare its high-resolution content. ${error instanceof Error?error.message:''}`,nextPage:start+1};}}
      else yield {...file,name:`${file.name} (pages ${start+1} to ${end} of ${count})`,pages:Array.from({length:end-start},(_,i)=>({source:file.name,page:start+i+1})),data,nextPage:end};
      start=end;
    }
  }else if(['text/plain','text/csv','application/json'].includes(file.type)){
    const text=file.data.toString('utf8');
    for(let start=0;start<text.length;start+=60000)yield {...file,name:text.length<=60000?file.name:`${file.name} (text section ${Math.floor(start/60000)+1})`,data:Buffer.from(text.slice(start,start+60000))};
  }else{
    if(file.data.length>UNIT_BYTES)throw new Error('This image needs a smaller export before automatic reading. The original is saved.');
    yield file;
  }
}
