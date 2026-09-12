import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
const root=process.cwd();await mkdir('node_modules/.cache',{recursive:true});const dir=await mkdtemp(path.join(root,'node_modules/.cache/p5-resume-'));
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(statement:string,values:unknown[]=[]){return (await database.query(statement,values)).rows as any[];}`);
 await writeFile(path.join(dir,'storageFixture.ts'),`export const objects=new Map<string,Buffer>();export let writes=0;export class Client{async uploadFromBytes(k:string,b:Buffer){objects.set(k,Buffer.from(b));writes++;return {ok:true,value:null};}async downloadAsBytes(k:string){return objects.has(k)?{ok:true,value:[objects.get(k)]}:{ok:false};}async uploadFromStream(k:string,s:any){const parts=[];for await(const part of s)parts.push(part);objects.set(k,Buffer.concat(parts));}async delete(k:string){objects.delete(k);return {ok:true};}}`);
 for(const name of ['objectStorage','resumableUpload','analysisWork']){const p=path.join(dir,name+'.ts');await writeFile(p,(await readFile(p,'utf8')).replace(/from ['"]@replit\/object-storage['"]/g,"from './storageFixture'"));}
 const mod=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const store=await mod('store'),db=await mod('database'),api=await mod('resumableUpload'),work=await mod('analysisWork'),fixture=await mod('storageFixture'),intent=await mod('projectIntent');
 process.env.P5_OBJECT_STORAGE_ENABLED='true';process.env.ANTHROPIC_API_KEY='synthetic';
 const id=randomUUID(),key=randomBytes(32).toString('hex'),headers={'x-p5-draft-id':id,'x-p5-draft-key':key};
 await store.saveDraft(id,key,'synthetic',{text:'Bathroom remodel',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const pdf=await PDFDocument.create();for(let i=0;i<256;i++){const page=pdf.addPage();page.drawText(`SHEET ${i+1} OF 256${i===255?' FINAL REVISION: INCLUDE TRIM PACKAGE':''}`,{x:40,y:700,size:12});}
 const bytes=Buffer.concat([Buffer.from(await pdf.save()),Buffer.alloc(25*1024*1024,32)]),digest=createHash('sha256').update(bytes).digest('hex');
 const call=(action:string,body:BodyInit,extra='',h=headers)=>api.postUpload(new Request(`https://test.local/api/p5-estimator/upload?action=${action}&sha256=${digest}${extra}`,{method:'POST',headers:h,body}));
 let res=await call('start',JSON.stringify({name:'large-plan.pdf',size:bytes.length}));assert.equal(res.status,200);let result=await res.json();const chunkSize=result.chunkSize;
 assert.equal((await call('start',JSON.stringify({name:'large-plan.pdf',size:bytes.length}),'',{...headers,'x-p5-draft-key':randomBytes(32).toString('hex')})).status,404);
 for(let offset=0,i=0;offset<bytes.length;offset+=chunkSize,i++){
   const part=bytes.subarray(offset,offset+chunkSize),hash=createHash('sha256').update(part).digest('hex');
   if(i===0){assert.equal((await call('part',new Uint8Array(part),`&part=0&checksum=${'a'.repeat(64)}`)).status,422);assert.equal((await call('finish','')).status,409);}
   res=await call('part',new Uint8Array(part),`&part=${i}&checksum=${hash}`);assert.equal(res.status,200);assert.equal((await res.json()).checksum,hash);
   if(i===1){const before=fixture.writes;await call('part',new Uint8Array(part),`&part=${i}&checksum=${hash}`);assert.equal(fixture.writes,before,'retry must not reupload confirmed segments');const status=await (await call('start',JSON.stringify({name:'large-plan.pdf',size:bytes.length}))).json();assert.equal(Object.keys(status.chunks).length,2);}
 }
 res=await call('finish','');assert.equal(res.status,200);result=await res.json();assert.equal(result.draft.uploads[0].sha256,digest);assert.equal(result.draft.uploads[0].size,bytes.length);
 assert.equal((await store.readUploads(id,key))[0].data.equals(bytes),true);assert.equal([...fixture.objects.keys()].some((k:string)=>k.startsWith('transfers/')),false);
 assert.equal((await call('finish','')).status,200);assert.equal((await store.readDraft(id,key)).uploads.length,1);
 let active=0,peak=0;const counts=new Map<string,number>();const provider=async(_url:any,options:any)=>{
   const payload=JSON.parse(options.body),name=payload.messages[0].content[0].text;
   const manifest=JSON.parse(name.split('Original page manifest: ')[1]);
   const submitted=await PDFDocument.load(Buffer.from(payload.messages[0].content[1].source.data,'base64'));
   assert.equal(submitted.getPageCount(),manifest.length,'every manifest page must actually reach the provider');
   counts.set(name,(counts.get(name)||0)+1);active++;peak=Math.max(peak,active);
   try{
     await new Promise(r=>setTimeout(r,15));
     if(name.includes('page 9 of')&&counts.get(name)===1)return new Response('temporary failure',{status:503});
     return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'One bathroom',facts:[{field:'sqft',value:'80',confidence:.99,source:'large-plan.pdf',evidence:'80 square feet',basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],pages:manifest.map((p:any)=>({...p,sheet:`A${p.page}`,revision:p.page===256?'FINAL':'',status:'read',notes:[]})),takeoffs:[]})}]});
   }finally{active--;}
 };
 const draft=await store.readDraft(id,key);let step:any;let n=0;
 do{step=await work.advanceAnalysis(draft,'Bathroom remodel',{},provider);assert.ok(++n<80);}while(step.pending);
 assert.equal(step.analysis.extraction.facts[0].value,'80');assert.equal(counts.size,256,'all 256 pages must be processed');assert.equal([...counts.values()].filter(n=>n===2).length,1,'only the failed section is retried');assert.ok([...counts.values()].every(n=>n===1||n===2));
 assert.equal(step.analysis.extraction.documentCoverage.complete,true);assert.equal(step.analysis.extraction.documentCoverage.expectedPages,256);
 assert.deepEqual(step.analysis.extraction.documentCoverage.pages.map((p:any)=>p.page),Array.from({length:256},(_,i)=>i+1));
 assert.equal(step.analysis.extraction.documentCoverage.pages[255].revision,'FINAL');assert.equal(peak,6,'independent sections use bounded parallel processing');
 const calls=[...counts.values()].reduce((a,b)=>a+b,0);await work.advanceAnalysis(draft,'Bathroom remodel',{},provider);assert.equal([...counts.values()].reduce((a,b)=>a+b,0),calls,'completed analysis survives another request');
 assert.equal(intent.cabinetIntent('Supply and install one bathroom vanity cabinet',['cabinet-install','cabinet-product']),'cabinet-install');
 assert.equal(intent.cabinetIntent('Supply only vanity cabinet, no installation',['cabinet-install','cabinet-product']),'cabinet-product');
 assert.equal(intent.cabinetIntent('Supply and install cabinet, or supply only',['cabinet-install','cabinet-product']),undefined,'ambiguous instructions still require confirmation');
 const fixed=intent.applyCabinetIntent('Supply and install one vanity cabinet',['cabinet-install','cabinet-product'],{service:'cabinet-product'},{summary:'',facts:[],conflicts:[{field:'service',values:['cabinet-product','cabinet-install'],explanation:'Old default'}],missingInformation:[],reviewNotes:[]});assert.equal(fixed.answers.service,'cabinet-install');assert.equal(fixed.extraction.conflicts.length,0);
 const scopeApi=await mod('scopeEndpoint');const nativeFetch=globalThis.fetch;
 let middleFails=true;const sectionCalls=new Map<string,number>();
 globalThis.fetch=async(url:any,options:any)=>{
   const payload=JSON.parse(options.body),name=payload.messages[0].content[0].text;
   sectionCalls.set(name,(sectionCalls.get(name)||0)+1);
   if(middleFails&&name.includes('page 9 of'))return new Response('fixture outage',{status:503});
   return provider(url,options);
 };
 const form=new FormData();form.set('text','Partial section retry fixture');form.set('resumable','true');
 const analyze=async()=>{const response=await scopeApi.postScope(new Request('https://test.local/api/p5-estimator/scope',{method:'POST',headers,body:form}));assert.equal(response.status,200);return response.json();};
 let response:any;let turns=0;do{response=await analyze();assert.ok(++turns<80);}while(response.pending);
 assert.match(response.warning,/automatic reading could not finish/,'failed sections must expose the retry control');
 assert.ok(response.draft.extraction.reviewNotes.some((note:string)=>note.includes('page 9 of')));
 const completedBefore=[...sectionCalls].filter(([name])=>!name.includes('page 9 of'));
 middleFails=false;form.set('retry','true');response=await analyze();form.set('retry','false');
 turns=0;while(response.pending){response=await analyze();assert.ok(++turns<80);}
 assert.equal(response.warning,'');assert.deepEqual(response.draft.extraction.reviewNotes,[]);
 for(const [name,count] of completedBefore)assert.equal(sectionCalls.get(name),count,'completed sections must not be billed again');
 globalThis.fetch=nativeFetch;
 await db.database.close();console.log('Passed: 25 MB resumable upload, corrupted-segment rejection, retry deduplication, authorization, full byte comparison, cleanup, all 256 pages and final revision, six concurrent readers, failed-section retry, Cabinet intent. Real isolated SQL/PDF; storage and AI simulated, not an OCR accuracy benchmark.');
}finally{delete process.env.P5_OBJECT_STORAGE_ENABLED;delete process.env.ANTHROPIC_API_KEY;await rm(dir,{recursive:true,force:true});}
