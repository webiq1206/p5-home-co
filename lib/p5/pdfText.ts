import {pdfjsAssetOptions} from './pdfjsAssets.ts';

/** Extract each page's text layer locally with pdf.js. Scanned pages return an
 * empty string. This never replaces reading the page; it lets a provider that
 * cannot take PDF input read the page, gives every read exact strings, and
 * supplies adjacent-page context without another provider call. */
export async function pdfTextLayers(data:Buffer,expectedPages?:number):Promise<string[]>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(data),...pdfjsAssetOptions(),disableFontFace:true} as any);
  const document=await task.promise;
  try{
    const count=expectedPages||document.numPages;const layers:string[]=[];
    for(let index=1;index<=Math.min(count,document.numPages);index++){
      try{
        const page=await document.getPage(index);
        const content=await page.getTextContent();
        layers.push(pageTextFromItems(content.items as {str?:string;hasEOL?:boolean;transform?:number[]}[]));
        page.cleanup();
      }catch(error){console.error(`[p5-analysis] text layer failed on page ${index}: ${error instanceof Error?error.message:String(error)}`);layers.push('');}
    }
    return layers;
  }finally{await task.destroy();}
}
/** Rebuild lines from positioned text runs so tables keep their row structure. */
export function pageTextFromItems(items:{str?:string;hasEOL?:boolean;transform?:number[]}[]):string{
  const lines:string[]=[];let line='';let lastY:number|null=null;let lastX:number|null=null;
  for(const item of items){
    const text=item.str||'';const y=item.transform?.[5];const x=item.transform?.[4];
    if(lastY!==null&&y!==undefined&&Math.abs(y-lastY)>2){lines.push(line);line='';lastX=null;}
    if(text){
      if(line&&lastX!==null&&x!==undefined&&x-lastX>1&&!line.endsWith(' ')&&!text.startsWith(' '))line+=' ';
      line+=text;
    }
    if(y!==undefined)lastY=y;
    if(x!==undefined)lastX=x+(item.transform?.[0]||0)*text.length*0.5;
    if(item.hasEOL){lines.push(line);line='';lastX=null;}
  }
  if(line)lines.push(line);
  return lines.map(value=>value.replace(/[ \t]+/g,' ').trimEnd()).filter((value,index,all)=>value||all[index-1]).join('\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,60000);
}
