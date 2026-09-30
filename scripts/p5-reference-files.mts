import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parsePdf} from '../services/document-service/src/parser.mjs';
import {prepareAnalysisFiles,verifyUpload} from '../lib/p5/documents.ts';

// Local, read-only attachment qualification. No model, network, database,
// production submission or customer delivery. The output may be private.
const [inputDirectory,outputDirectory]=process.argv.slice(2);
if(!inputDirectory||!outputDirectory)throw new Error('Provide the source directory and a private results directory.');
await mkdir(outputDirectory,{recursive:true,mode:0o700});
const manifest:unknown[]=[];
for(const name of (await readdir(inputDirectory)).sort()){
 if(!/\.(pdf|xlsx)$/i.test(name))continue;
 const bytes=await readFile(path.join(inputDirectory,name)),sha256=createHash('sha256').update(bytes).digest('hex');
 const entry:{name:string;sha256:string;bytes:number;pages?:number;pageResults?:unknown[];formulaResults?:number;unresolvedFormulas?:number;error?:string}={name,sha256,bytes:bytes.length};
 try{
  if(/\.pdf$/i.test(name)){
   const pages:any[]=[];let expected=0;
   await parsePdf(bytes,{maxPages:250,timeoutMs:90000,onManifest:(count:number)=>{expected=count;},onPage:async(page:any)=>{
    const {image,...native}=page;pages.push(native);
    await writeFile(path.join(outputDirectory,sha256+'-page-'+page.page+'.png'),image,{mode:0o600});
   }});
   if(pages.length!==expected||pages.some((p,i)=>p.page!==i+1))throw new Error('Page inventory mismatch.');
   entry.pages=expected;entry.pageResults=pages.map(p=>({page:p.page,characters:p.text.length,spans:p.spans.length,kind:p.kind,textQuality:p.textQuality,render:p.render}));
   await writeFile(path.join(outputDirectory,sha256+'-pages.json'),JSON.stringify(pages),{mode:0o600});
  }else{
   const result=await prepareAnalysisFiles([verifyUpload(name,bytes)]);
   if(result.manualReview.length)throw new Error(result.manualReview.join('\n'));
   const text=result.readable[0].data.toString();entry.formulaResults=text.match(/calculated result:/g)?.length||0;entry.unresolvedFormulas=text.match(/UNRESOLVED/g)?.length||0;
   await writeFile(path.join(outputDirectory,sha256+'-text.txt'),text,{mode:0o600});
  }
 }catch(error){entry.error=error instanceof Error?error.message:String(error);}
 manifest.push(entry);await writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
 console.log(JSON.stringify({name,pages:entry.pages,formulaResults:entry.formulaResults,unresolvedFormulas:entry.unresolvedFormulas,error:entry.error}));
}
if(manifest.some(entry=>(entry as {error?:string}).error))process.exitCode=1;
