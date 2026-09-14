// Read one PDF with the configured providers and print what each one does.
// Live provider calls; not part of prebuild. Usage:
//   node --experimental-strip-types scripts/check-p5-document-read.mts [file.pdf]
// Without a file, a one-page kitchen estimate is generated so the check needs
// no upload. Provider failures are printed by lib/p5/extraction as they occur.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
const file=process.argv[2];
let data:Buffer;let name:string;
if(file){data=await readFile(file);name=path.basename(file);}
else{
  const doc=await PDFDocument.create();const page=doc.addPage([612,792]);const font=await doc.embedFont(StandardFonts.Helvetica);
  const lines=['Kitchen Renovation Estimate','Prepared for: Sample Homeowner, Boise, ID','','Base cabinets, painted shaker: 20 LF @ $310/LF = $6,200','Wall cabinets, painted shaker: 15 LF @ $240/LF = $3,600','Quartz countertops: 45 SF @ $85/SF = $3,825','Tile backsplash: 30 SF @ $28/SF = $840','Plumbing reconnect: 1 LS = $650','Electrical outlets: 4 EA @ $180 = $720','','Total: $15,835'];
  lines.forEach((line,i)=>page.drawText(line,{x:60,y:720-i*24,size:12,font}));
  data=Buffer.from(await doc.save());name='sample-kitchen-estimate.pdf';
}
const pages=(await PDFDocument.load(data,{ignoreEncryption:true})).getPageCount();
const {analyzeBatch}=await import('../lib/p5/extraction.ts');
const manifest=Array.from({length:pages},(_,i)=>({source:name,page:i+1}));
const started=Date.now();
try{
  const result=await analyzeBatch('Price only the cabinetry and countertops. Exclude plumbing and electrical.',[{name,type:'application/pdf',data,pages:manifest}],{},fetch,120_000,Date.now()+120_000);
  console.log(JSON.stringify({provider:result.provider,model:result.model,seconds:(Date.now()-started)/1000,facts:result.extraction.facts.length,takeoffs:result.extraction.takeoffs?.length||0,pages:result.extraction.documentCoverage?.pages?.length||0,reviewNotes:result.extraction.reviewNotes.slice(0,5)},null,1));
}catch(error){
  console.log(JSON.stringify({failed:error instanceof Error?error.message:String(error),seconds:(Date.now()-started)/1000}));
}
