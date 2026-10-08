/** Isolated component harness. Synthetic, memory-only store; no production credentials or provider calls.
 * Run with the repository offline network guard and a clean environment. */
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import type {Draft} from '../lib/p5/store.ts';
import type {IntakeContext} from '../lib/p5/intakeContract.ts';
import {intakeStore,type IntakeRow} from '../lib/p5/intakeStore.ts';
import {intakeContact,intakeDetails,intakeUnresolved,intakeScopeReviewed,emptyIntakeDetails,snapshotRouting} from '../lib/p5/intakeContract.ts';
import {SCOPE_FIELDS} from '../lib/p5/scope.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
const output=resolve('outputs/intake-browser-fixture');await mkdir(output,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {P5Estimator} from './components/P5Estimator';createRoot(document.getElementById('app')).render(<P5Estimator layout="page"/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:resolve(output,'app.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},alias:{'@':process.cwd()},loader:{'.woff2':'dataurl','.woff':'dataurl'},logLevel:'silent'});
const db=new PGlite();await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer,brand text,status text);CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));`);
const query=async(statement:string,values:unknown[]=[])=> (await db.query<IntakeRow>(statement,values)).rows;
const store=intakeStore(query,()=> '2099-01-02T12:00:00.000Z');const drafts=new Map<string,Draft & {intake:IntakeContext}>();const keys=new Map<string,string>();
let fault='',scopeCalls=0,pricingCalls=0,submissions=0,saves=0;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url!,'http://127.0.0.1:4188');
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
 const send=(body:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 try{
  if(url.pathname==='/__state'){return send({fixture:true,fault,scopeCalls,pricingCalls,submissions,saves,drafts:[...drafts.values()],work:await query('SELECT work_key,payload FROM p5_estimator_work')});}
  if(url.pathname==='/'){fault=url.searchParams.get('fault')||'';res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="margin:0;font-family:Arial,sans-serif"><div id="app"></div><script src="/app.js"></script></body></html>');return;}
  if(['/app.js','/app.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(resolve(output,url.pathname.slice(1))));return;}
  if(url.pathname==='/api/estimator-session')return send({fixture:true});
  if(!url.pathname.startsWith('/api/p5-estimator/'))return send({error:'Not in isolated fixture'},404);
  const id=String(req.headers['x-p5-draft-id']||''),key=String(req.headers['x-p5-draft-key']||'');
  if(!/^[a-f\d-]{36}$/.test(id)||!/^[a-f\d]{64}$/.test(key))return send({error:'Invalid project credential'},401);
  if(keys.has(id)&&keys.get(id)!==key)return send({error:'Project not found'},404);
  const endpoint=url.pathname.split('/').at(-1),current=drafts.get(id);
  if(req.method==='GET')return endpoint==='intake'?send({receipt:await store.read(id)}):send({draft:current||null});
  const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24*1024*1024)throw Error('Fixture request too large');chunks.push(chunk);}const body=Buffer.concat(chunks);
  if(endpoint==='draft'){
   saves++;const raw=JSON.parse(body.toString());if(fault==='failed-save'){fault='';return send({error:'Synthetic database unavailable. Your local work is retained.'},503);}
   if(raw.revision!==(current?.revision||0))return send({error:'Project changed in another tab.'},409);
   const details=intakeDetails(raw.intake||emptyIntakeDetails());
   const draft={...current,...raw,id,brand:ESTIMATOR_BRAND.id,status:'draft',revision:(current?.revision||0)+1,updatedAt:'2099-01-02T12:00:00Z',uploads:current?.uploads||[],extraction:current?.extraction||null,intake:{...details,projectId:current?.intake?.projectId||`${ESTIMATOR_BRAND.id}:${id}`,originSite:ESTIMATOR_BRAND.id,currentSite:ESTIMATOR_BRAND.id,version:current?.revision||0,contact:intakeContact({...raw.contact,preferredContact:raw.intake?.contact?.preferredContact||'either'},false)}};
   drafts.set(id,draft);keys.set(id,key);await query("INSERT INTO p5_estimator_drafts VALUES($1,$2,$3,'draft') ON CONFLICT(id) DO UPDATE SET revision=$2",[id,draft.revision,draft.brand]);
   if(fault==='delayed-save'){fault='';await new Promise(r=>setTimeout(r,2500));}
   return send({draft,conflicts:[],pricedFields:[]});
  }
  if(!current)return send({error:'Save the draft'},404);
  if(endpoint==='scope'){
   scopeCalls++;const form=await new Response(body,{headers:{'Content-Type':String(req.headers['content-type'])}}).formData();
   if(form.get('analyze')!=='false')return send({error:'Synthetic reader unavailable. Files remain saved for manual review.'},503);
   for(const file of form.getAll('files') as File[]){const bytes=Buffer.from(await file.arrayBuffer()),sha256=createHash('sha256').update(bytes).digest('hex');if(!current.uploads.some(f=>f.sha256===sha256))current.uploads.push({id:randomUUID(),name:file.name,type:file.type,size:file.size,sha256,status:'stored'});}
   return send({draft:current});
  }
  if(endpoint==='submit'){pricingCalls++;return send({error:'Pricing is prohibited in this intake fixture'},409);}
  if(endpoint==='intake'){
   submissions++;const raw=JSON.parse(body.toString());if(raw.revision!==current.revision||raw.confirmed!==true)return send({error:'Review the latest version'},409);
   if(!intakeScopeReviewed(current))return send({error:'Confirm the current whole project type, supporting work and exclusions.'},409);
   const contact=intakeContact({...current.contact,preferredContact:current.intake.contact.preferredContact}),details=intakeDetails(current.intake),routing=snapshotRouting(ESTIMATOR_BRAND.id,current.answers,details);
   if(routing.handoff)return send({error:'Secure specialty transfer required'},409);
   const receipt=await store.save({schema:1,projectId:current.intake.projectId,originSite:current.intake.originSite,currentSite:ESTIMATOR_BRAND.id,draftId:id,revision:current.revision,contextVersion:current.intake.version,contact,details,scope:{text:current.text,answers:current.answers,extraction:current.extraction,uploads:current.uploads},routing,unresolved:intakeUnresolved(current,SCOPE_FIELDS)});
   if(fault==='lost-receipt'){fault='';req.socket.destroy();return;}
   return send(receipt);
  }
  return send({error:'Operation not present in fixture'},404);
 }catch(error){send({error:error instanceof Error?error.message:'Fixture error'},400);}
});
server.listen(4188,'127.0.0.1',()=>console.log('Synthetic intake fixture listening on http://127.0.0.1:4188; memory-only, no providers.'));
