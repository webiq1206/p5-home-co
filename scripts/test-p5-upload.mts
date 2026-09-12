import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import ExcelJS from 'exceljs';
const root=process.cwd();await mkdir('node_modules/.cache',{recursive:true});const dir=await mkdtemp(path.join(root,'node_modules/.cache/p5-upload-'));
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export let hideRead=false;export function simulateStaleRead(value:boolean){hideRead=value;}export async function query(statement:string,values:unknown[]=[]){const rows=(await database.query(statement,values)).rows as any[];return hideRead&&statement.startsWith('SELECT * FROM p5_estimator_drafts')?[]:rows;}`);
 // Provider boundary is simulated. PDF splitting and Office conversion use real libraries.
 process.env.ANTHROPIC_API_KEY='synthetic-test-only';
 const originalFetch=globalThis.fetch;let fail=false;const calls:any[]=[];
 globalThis.fetch=async(url:any,options:any)=>{assert.equal(String(url),'https://api.anthropic.com/v1/messages');const body=JSON.parse(options.body);const manifest=body.messages[0].content.filter((v:any)=>v.type==='text'&&v.text.startsWith('Source filename:')).flatMap((v:any)=>JSON.parse(v.text.split('Original page manifest: ')[1]));calls.push(body);if(fail)return new Response('fixture outage',{status:503});return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'Synthetic bathroom remodel',facts:[{field:'service',value:'bathroom',confidence:.98,source:'typed scope',evidence:'bathroom remodel'},{field:'sqft',value:'80',confidence:.98,source:'plan.pdf',evidence:'80 square feet'},{field:'materials',value:'Porcelain tile',confidence:.97,source:'scope.xlsx',evidence:'Porcelain tile'},{field:'demolition',value:'Remove old tile and vanity',confidence:.97,source:'typed scope',evidence:'Remove old tile and vanity'}],conflicts:[],reviewNotes:[],missingInformation:[],clarifications:[],pages:manifest.map((p:any)=>({...p,sheet:'',revision:'',status:'read',notes:['Blank synthetic sheet.']})),takeoffs:[]})}]});};
 const module=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const db=await module('database'),store=await module('store'),draftApi=await module('draftEndpoint'),scopeApi=await module('scopeEndpoint');
 const id=randomUUID(),key=randomBytes(32).toString('hex');const headers={'x-p5-draft-id':id,'x-p5-draft-key':key};
 const put=(revision:number,text='Bathroom remodel: remove old tile and vanity',answers:any={})=>draftApi.putDraft(new Request('http://test.local/api/p5-estimator/draft',{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({revision,text,answers,contact:{name:'',email:'',phone:''}})}));
 // Reproduce stale read after INSERT: acknowledged write must still return a usable receipt.
 db.simulateStaleRead(true);let response=await put(0);assert.equal(response.status,200);let body=await response.json();assert.equal(body.draft.revision,1);assert.ok(body.draft.id);db.simulateStaleRead(false);
 const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();const pdfBytes=await pdf.save();
 const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Bathroom').addRows([['Material','Quantity'],['Porcelain tile',80]]);const xlsx=await workbook.xlsx.writeBuffer();
 const upload=async(files:{name:string;type:string;data:Uint8Array|string}[],text='Bathroom remodel: remove old tile and vanity')=>{const form=new FormData();form.set('text',text);for(const f of files)form.append('files',new File([f.data as any],f.name,{type:f.type}));return scopeApi.postScope(new Request('http://test.local/api/p5-estimator/scope',{method:'POST',headers,body:form}));};
 response=await upload([{name:'plan.pdf',type:'application/pdf',data:pdfBytes},{name:'scope.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data:new Uint8Array(xlsx as ArrayBuffer)},{name:'scope.csv',type:'text/csv',data:'Item,Quantity\nTile,80'}]);
 assert.equal(response.status,200);body=await response.json();assert.equal(body.draft.uploads.length,3);assert.equal(body.draft.answers.sqft,'80');assert.equal(body.draft.answers.materials,'Porcelain tile');assert.equal(body.questions.length,0);assert.equal(calls.length,3);assert.ok(calls.some(c=>JSON.stringify(c).includes('Worksheet: Bathroom')));
 const pdfCall=calls.find(c=>c.messages[0].content.some((v:any)=>v.type==='document'));
 const sentPdf=pdfCall.messages[0].content.find((v:any)=>v.type==='document');
 assert.equal((await PDFDocument.load(Buffer.from(sentPdf.source.data,'base64'))).getPageCount(),2,'adjacent scope pages must reach the model together');
 // Reupload is deduplicated, back navigation persists answers and files.
 response=await upload([{name:'plan.pdf',type:'application/pdf',data:pdfBytes}]);body=await response.json();assert.equal(body.draft.uploads.length,3);
 const restored=await store.readDraft(id,key);assert.equal(restored.answers.sqft,'80');assert.equal(restored.uploads.length,3);
 // Failed provider keeps acknowledged uploads, returns a visible warning, and can retry.
 fail=true;response=await upload([{name:'extra.txt',type:'text/plain',data:'Extra fixture details'}]);body=await response.json();assert.equal(response.status,200);assert.ok(body.warning);assert.equal(body.draft.uploads.length,4);assert.equal(body.draft.answers.sqft,'80');assert.ok(body.draft.extraction.reviewNotes.length);
 fail=false;response=await upload([]);body=await response.json();assert.equal(body.warning,'');assert.equal(body.draft.uploads.length,4);assert.deepEqual(body.draft.extraction.reviewNotes,[]);
 // Photo vision transport and actual DOCX text extraction remain in the same draft.
 const docx=Buffer.from('UEsDBBQAAAAIAJSSKl1Rl+gEsQAAABQBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QvQ7CMAyEX6XKilpXDAyo7QKswMALWInbRjQ/StxS3p4UUAcGRvu7O59c3Z6eYjabwcZa9Mx+DxBlTwZj4TzZRFoXDHIaQwce5R07gm1Z7kA6y2Q55yVDNNWRWhwHzk5zWkftbC2SXWSHj245VQv0ftASOWFYKDTVZaIQtKLsioHPaJIKHi4oUE6OJjmL/zGTVT9dc9e2WtLqX9J8cJJi1LYzQ7ESg9puvj3g/YzmBVBLAwQUAAAACACUkipdYXsvQ4kAAADyAAAACwAAAF9yZWxzLy5yZWxzjc87DgIhEAbgqxAOsLNaWBigstnWeAECwyMujwwY9fZSWKzGwnLmn3x/Rpxx1T2W3EKsjT3Smpvkofd6BGgmYNJtKhXzSFyhpPsYyUPV5qo9wn6eD0BbgyuxNdliJafF7ji7PCv+YxfnosFTMbeEuf+o+LoYsiaPXfJ7IQv2vZ4Gy0EJ+HhRvQBQSwMEFAAAAAgAlJIqXduKQhygAAAA3gAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWPQQ7CMAwEv2L1AU3FAaGo9IjEM0LilkqNHRyX0t+TlAOXWa0t7Wr7zQb2a0RS+MSFst2uzVM1WWOyf2J0ueWEVH4jS3RarExmYwlJ2GPOM01xMaeuO5voZmqGfrMPDnvVVCEVOtwpJ/Q6M4FgYlFbdXEeIbjoJgzwdjTr3sJtYZaSC6/VkZYTXDrIxQjCiKhtb2pipRxMB3+t5r9o+AJQSwECFAMUAAAACACUkipdUZfoBLEAAAAUAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAJSSKl1hey9DiQAAAPIAAAALAAAAAAAAAAAAAACAAeIAAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAJSSKl3bikIcoAAAAN4AAAARAAAAAAAAAAAAAACAAZQBAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAABjAgAAAAA=','base64');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=','base64');
 response=await upload([{name:'inspection.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',data:docx},{name:'project-photo.png',type:'image/png',data:png}]);body=await response.json();assert.equal(body.draft.uploads.length,6);assert.ok(calls.some(c=>JSON.stringify(c).includes('Inspection report: replace damaged vanity')));assert.ok(calls.some(c=>c.messages[0].content.some((p:any)=>p.type==='image'&&p.source.media_type==='image/png')));
 // Invalid uploads are rejected before storage; ownership is enforced.
 response=await upload([{name:'bad.pdf',type:'application/pdf',data:'not a PDF'}]);assert.equal(response.status,400);assert.equal((await store.readDraft(id,key)).uploads.length,6);
 response=await scopeApi.postScope(new Request('http://test.local/api/p5-estimator/scope',{method:'POST',headers:{...headers,'x-p5-draft-key':randomBytes(32).toString('hex')},body:new FormData()}));assert.equal(response.status,404);
 globalThis.fetch=originalFetch;delete process.env.ANTHROPIC_API_KEY;await db.database.close();
 console.log('Upload endpoint checks passed: null-read receipt, two-page PDF, XLSX, CSV, mixed input, mapping, deduplication, provider failure/retry, persistence, invalid PDF, ownership. AI provider simulated; real isolated SQL and parsers.');
}finally{await rm(dir,{recursive:true,force:true});}
