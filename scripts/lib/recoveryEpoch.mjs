import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,closeSync,lstatSync} from 'node:fs';
import path from 'node:path';

// Offline qualification boundary. No network, credential, CRM or production DB imports.
export const UMBRELLA_MICROS=12_000_000;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error('recovery-epoch:'+code);};
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const immutable=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;};
function validate(a,expected,file){
 if(!digest(expected)||sha(canonical(a))!==expected)fail('attestation-identity');
 if(a.version!==1||!text(a.epochId)||!text(a.umbrellaId)||!text(a.authorizationEvidence)||
  a.umbrellaMicros!==UMBRELLA_MICROS||a.crmEnabled!==false||!text(a.ledgerPath)||path.resolve(a.ledgerPath)!==path.resolve(file)||
  !Number.isFinite(Date.parse(a.expiresAt))||!integer(a.historicalUpperBoundMicros)||
  !a.oldWorkers||!['stopped','bounded'].includes(a.oldWorkers.state)||!digest(a.oldWorkers.evidenceSha256)||
  !integer(a.oldWorkers.upperBoundMicros)||(a.oldWorkers.state==='stopped'&&a.oldWorkers.upperBoundMicros!==0)||
  !integer(a.epochCeilingMicros)||!a.epochCeilingMicros||!a.bindings||!Object.keys(a.bindings).length||
  !['source','dependencies','runtime','documents','models'].every(key=>digest(a.bindings[key]))||
  !Object.values(a.bindings).every(digest)||!Array.isArray(a.cases)||!a.cases.length)fail('attestation-invalid');
 const liability=a.historicalLiability;
 if(!liability||!['original-ledger','attested-carryforward'].includes(liability.mode)||!digest(liability.evidenceSha256)||
  !text(liability.description)||!integer(liability.unknownHoldMicros)||liability.unknownHoldMicros>a.historicalUpperBoundMicros||
  (liability.mode==='original-ledger'&&!digest(liability.ledgerSha256)))fail('historical-liability-evidence-required');
 if(a.historicalUpperBoundMicros+a.oldWorkers.upperBoundMicros+a.epochCeilingMicros>UMBRELLA_MICROS)fail('umbrella-exceeded');
 let allocations=0,prior=0;const cases=new Set();
 for(const c of a.cases){
  if(!text(c.id)||cases.has(c.id)||!digest(c.documentSha256)||!integer(c.priorUpperBoundMicros)||!integer(c.ceilingMicros)||!Array.isArray(c.stages)||!c.stages.length)fail('case-invalid');
  cases.add(c.id);prior+=c.priorUpperBoundMicros;let assigned=0;const stages=new Set();
  for(const s of c.stages){
   if(!text(s.id)||stages.has(s.id)||!integer(s.envelopeMicros)||!s.envelopeMicros||!integer(s.maxCalls)||!s.maxCalls||
    !digest(s.requestPolicySha256)||!text(s.endpoint)||!text(s.model)||!digest(s.billingBoundEvidenceSha256))fail('stage-invalid');
   const url=new URL(s.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)fail('endpoint-invalid');
   stages.add(s.id);assigned+=s.envelopeMicros;
  }
  if(c.priorUpperBoundMicros+assigned>c.ceilingMicros)fail('case-envelope-exceeded');
  // Completion funding must be protected before extraction can begin.
  if(!stages.has('pricing')||!stages.has('review'))fail('completion-envelope-required');
  allocations+=assigned;
 }
 if(prior>a.historicalUpperBoundMicros+a.oldWorkers.upperBoundMicros||allocations>a.epochCeilingMicros)fail('allocation-invalid');
 return a;
}

/** Explicit one-time provisioning AFTER the parent verifies historical liability.
 * The constructor never creates/reconstructs a missing ledger. The permanent
 * marker makes accidental deletion/reset fail closed, including a provisioning crash.
 * This is not a defense against a privileged actor rolling back trusted storage.
 */
export function provisionRecoveryEpoch({file,attestation,expectedSha256}){
 validate(attestation,expectedSha256,file);
 if(Date.parse(attestation.expiresAt)<=Date.now())fail('attestation-expired');
 const marker=file+'.epoch';
 writeFileSync(marker,expectedSha256,{flag:'wx',mode:0o600});
 closeSync(openSync(file,'wx',0o600));
 const db=new DatabaseSync(file);
 try{
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
   CREATE TABLE authority(singleton INTEGER PRIMARY KEY CHECK(singleton=1),digest TEXT NOT NULL,attestation TEXT NOT NULL);
   CREATE TABLE attempts(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,stage_id TEXT NOT NULL,request_hash TEXT NOT NULL,
    state TEXT NOT NULL,reserved INTEGER NOT NULL,actual INTEGER,owner TEXT NOT NULL,response BLOB,response_hash TEXT,
    usage_evidence TEXT,created TEXT NOT NULL);
   CREATE TABLE events(sequence INTEGER PRIMARY KEY,attempt_id TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL);`);
  db.prepare('INSERT INTO authority VALUES(1,?,?)').run(expectedSha256,canonical(attestation));
 }finally{db.close();}
}

export class RecoveryEpochLedger{
 constructor({file,attestation,expectedSha256,bindings}){
  this.attestation=immutable(JSON.parse(canonical(validate(attestation,expectedSha256,file))));this.owner=randomUUID();
  if(canonical(bindings)!==canonical(attestation.bindings))fail('execution-bindings-changed');
  if(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||readFileSync(file+'.epoch','utf8')!==expectedSha256)fail('ledger-missing-or-replaced');
  this.db=new DatabaseSync(file);
  try{
   this.db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000');
   const row=this.db.prepare('SELECT * FROM authority WHERE singleton=1').get();
   if(row?.digest!==expectedSha256||row.attestation!==canonical(attestation))fail('ledger-authority-mismatch');
  }catch(error){this.db.close();throw error;}
 }
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 stage(context){
  const c=this.attestation.cases.find(c=>c.id===context.caseId),s=c?.stages.find(s=>s.id===context.stageId);
  if(!s||c.documentSha256!==context.documentSha256||s.endpoint!==context.endpoint||s.model!==context.model||s.requestPolicySha256!==context.requestPolicySha256)fail('request-binding-mismatch');
  return {c,s};
 }
 identity(context){return sha(canonical({epoch:this.attestation.epochId,case:context.caseId,stage:context.stageId,request:context.requestSha256}));}
 reserve(context){
  const {s}=this.stage(context);
  if(!digest(context.requestSha256)||!integer(context.upperBoundMicros)||!context.upperBoundMicros)fail('finite-positive-request-bound-required');
  return this.transaction(()=>{
   if(Date.parse(this.attestation.expiresAt)<=Date.now())fail('attestation-expired');
   if(this.db.prepare("SELECT 1 FROM attempts WHERE state!='settled' LIMIT 1").get())fail('unresolved-charge-held');
   const id=this.identity(context);if(this.db.prepare('SELECT 1 FROM attempts WHERE id=?').get(id))fail('duplicate-request-use-receipt');
   const total=this.db.prepare('SELECT count(*) n,coalesce(sum(actual),0) charged FROM attempts WHERE case_id=? AND stage_id=?').get(context.caseId,context.stageId);
   if(total.n>=s.maxCalls||total.charged+context.upperBoundMicros>s.envelopeMicros)fail('protected-stage-envelope-exhausted');
   this.db.prepare("INSERT INTO attempts(id,case_id,stage_id,request_hash,state,reserved,owner,created) VALUES(?,?,?,?,'reserved',?,?,?)")
    .run(id,context.caseId,context.stageId,context.requestSha256,context.upperBoundMicros,this.owner,new Date().toISOString());
   this.db.prepare('INSERT INTO events(attempt_id,state,created) VALUES(?,?,?)').run(id,'reserved',new Date().toISOString());
   return id;
  });
 }
 settle(id,{actualMicros,response,usageEvidenceSha256,stop=false}){
  if(!integer(actualMicros)||!digest(usageEvidenceSha256)||!(response instanceof Uint8Array)||!response.length||response.length>16*1024*1024)fail('complete-receipt-required');
  const bytes=Buffer.from(response);
  return this.transaction(()=>{
   const row=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id);
   if(!row||row.owner!==this.owner||!['reserved','unknown'].includes(row.state))fail('settlement-fenced');
   const state=actualMicros>row.reserved?'overrun':stop?'stopped':'settled';
   this.db.prepare('UPDATE attempts SET state=?,actual=?,response=?,response_hash=?,usage_evidence=? WHERE id=?')
    .run(state,actualMicros,bytes,sha(bytes),usageEvidenceSha256,id);
   this.db.prepare('INSERT INTO events(attempt_id,state,created) VALUES(?,?,?)').run(id,state,new Date().toISOString());
   return state;
  });
 }
 unknown(id){
  this.transaction(()=>{const result=this.db.prepare("UPDATE attempts SET state='unknown' WHERE id=? AND owner=? AND state='reserved'").run(id,this.owner);if(result.changes!==1)fail('settlement-fenced');this.db.prepare('INSERT INTO events(attempt_id,state,created) VALUES(?,?,?)').run(id,'unknown',new Date().toISOString());});
 }
 stop(id){this.transaction(()=>{const result=this.db.prepare("UPDATE attempts SET state='stopped' WHERE id=? AND owner=? AND state='settled'").run(id,this.owner);if(result.changes!==1)fail('settlement-fenced');this.db.prepare('INSERT INTO events(attempt_id,state,created) VALUES(?,?,?)').run(id,'stopped',new Date().toISOString());});}
 replay(context){
  this.stage(context);const row=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(this.identity(context));
  if(!row)return null;
  if(row.state!=='settled'||!row.response||sha(row.response)!==row.response_hash)fail('receipt-unavailable');
  return {response:Buffer.from(row.response),actualMicros:row.actual,responseSha256:row.response_hash,usageEvidenceSha256:row.usage_evidence};
 }
 report(){
  const attempts=this.db.prepare('SELECT id,case_id,stage_id,state,reserved,actual,response_hash,usage_evidence FROM attempts ORDER BY created,id').all();
  const liability=attempts.reduce((n,a)=>n+(a.state==='settled'?a.actual:Math.max(a.reserved,a.actual||0)),0);
  return {epochId:this.attestation.epochId,umbrellaMicros:UMBRELLA_MICROS,historicalUpperBoundMicros:this.attestation.historicalUpperBoundMicros,historicalLiability:this.attestation.historicalLiability,
   oldWorkerUpperBoundMicros:this.attestation.oldWorkers.upperBoundMicros,newLiabilityMicros:liability,
   aggregateUpperBoundMicros:this.attestation.historicalUpperBoundMicros+this.attestation.oldWorkers.upperBoundMicros+liability,
   frozen:attempts.some(a=>a.state!=='settled'),attempts};
 }
 close(){this.db.close();}
}
