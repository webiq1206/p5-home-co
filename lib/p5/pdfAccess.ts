import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {pdfjsAssetOptions} from './pdfjsAssets.ts';

/** How a stored PDF can be opened.
 *
 * `native`: pdf-lib can copy its pages, the ordinary path.
 * `rendered`: the file opens without a password but pdf-lib cannot copy its
 *   pages (an owner-password "permissions" dictionary, or object structure
 *   pdf-lib does not resolve). pdf.js opens it the way any viewer does, so
 *   each page is read from its rendered image and text layer. Nothing is
 *   decrypted by ignoring a flag, and the original file is never rewritten.
 * `password-required`: a user password is needed to view the file at all.
 * `damaged`: no parser can open it. */
export type PdfAccess='native'|'rendered'|'password-required'|'damaged';
export type PdfInspection={access:PdfAccess;pages:number;encrypted:boolean;sizes:{width:number;height:number}[];detail?:string;
  /** The parsed document when access is `native`, so a caller does not parse a large plan set twice. */
  native?:PDFDocument};

/** Customer notes. Both keep the wording that marks a file as not read, so an estimate never relies on it. */
export const pdfPasswordNote=(name:string)=>`${name}: could not be read because it needs a password to open. Upload a copy saved without a password and it will be read automatically.`;
export const pdfDamagedNote=(name:string)=>`${name}: could not be read because the file is incomplete or damaged. Upload it again or export a fresh copy.`;
/** Thrown for a PDF no reader may open; `code` separates a password from damage. */
export class PdfAccessError extends Error{
  code:'pdf-password-required'|'pdf-damaged';
  constructor(name:string,access:'password-required'|'damaged'){super(access==='password-required'?pdfPasswordNote(name):pdfDamagedNote(name));this.name='PdfAccessError';this.code=access==='password-required'?'pdf-password-required':'pdf-damaged';}
}
/** Inspect and refuse only what truly cannot be opened. */
export async function openablePdf(name:string,data:Buffer):Promise<PdfInspection>{
  const inspection=await inspectPdf(data);
  if(inspection.access==='password-required'||inspection.access==='damaged')throw new PdfAccessError(name,inspection.access);
  return inspection;
}

async function pdfjs(){
  const library=await import('pdfjs-dist/legacy/build/pdf.mjs');
  return {library,options:{...pdfjsAssetOptions(),disableFontFace:true}};
}
const passwordError=(error:unknown)=>error instanceof Error&&(error.name==='PasswordException'||/password/i.test(error.message));

/** Open the file the way the reader will and report what is possible. */
export async function inspectPdf(data:Buffer):Promise<PdfInspection>{
  const encrypted=/\/Encrypt\b/.test(data.subarray(Math.max(0,data.length-4096)).toString('latin1'))||/\/Encrypt\b/.test(data.subarray(0,Math.min(data.length,1<<20)).toString('latin1'));
  try{
    const document=await PDFDocument.load(data);
    const pages=document.getPageCount();
    return {access:'native',pages,encrypted:false,sizes:document.getPages().map(page=>({width:page.getWidth(),height:page.getHeight()})),native:document};
  }catch(nativeError){
    const {library,options}=await pdfjs();
    const task=library.getDocument({data:new Uint8Array(data),...options});
    try{
      const document=await task.promise;const sizes:{width:number;height:number}[]=[];
      for(let index=1;index<=document.numPages;index++){const page=await document.getPage(index);const view=page.getViewport({scale:1});sizes.push({width:view.width,height:view.height});page.cleanup();}
      return {access:'rendered',pages:document.numPages,encrypted,sizes,detail:nativeError instanceof Error?nativeError.message.slice(0,160):undefined};
    }catch(error){
      if(passwordError(error))return {access:'password-required',pages:0,encrypted:true,sizes:[]};
      return {access:'damaged',pages:0,encrypted,sizes:[],detail:error instanceof Error?error.message.slice(0,160):undefined};
    }finally{await task.destroy().catch(()=>undefined);}
  }
}

/** One page of a viewable PDF as a fresh single-page PDF holding its rendered
 * image at about 200 DPI. Used only when pdf-lib cannot copy the page. */
export async function renderedPagePdf(data:Buffer,pageNumber:number):Promise<Buffer>{
  const {library,options}=await pdfjs();
  const task=library.getDocument({data:new Uint8Array(data),...options});
  try{
    const document=await task.promise;const page=await document.getPage(pageNumber);
    const base=page.getViewport({scale:1});
    // 200 DPI for letter-size forms, reduced for larger sheets to stay inside a safe raster.
    const scale=Math.min(2.8,Math.sqrt(36_000_000/Math.max(1,base.width*base.height)));
    const viewport=page.getViewport({scale});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport,background:'white'}).promise;
    const out=await PDFDocument.create();const image=await out.embedJpg(canvas.toBuffer('image/jpeg',92));
    out.addPage([base.width,base.height]).drawImage(image,{x:0,y:0,width:base.width,height:base.height});
    canvas.width=1;page.cleanup();
    return Buffer.from(await out.save());
  }finally{await task.destroy().catch(()=>undefined);}
}
