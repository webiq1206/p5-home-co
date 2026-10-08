import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyIntakeTransferFile,publishTransferStream,TRANSFER_CHUNK_WRITE_SQL,type TransferFileProgress,type TransferFileAdapter} from '../lib/p5/intakeTransferFiles.ts';
import {PGlite} from '@electric-sql/pglite';
import {SCOPE_CHUNK_SIZE,type ScopeUpload} from '../lib/p5/scope.ts';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(size=SCOPE_CHUNK_SIZE*2+7){
 const bytes=Buffer.alloc(size,120),chunks=new Map<string,Buffer>();let progress:TransferFileProgress={chunks:[]},published:Buffer|null=null,registrations=0,interrupt=false,failPublish=false;const offsets:number[]=[];
 const file:ScopeUpload={id:'12345678-1234-4234-8234-123456789abc',name:'[QA] fictional-scope.txt',type:'text/plain',size,sha256:sha(bytes),status:'stored'};
 const adapter:TransferFileAdapter<string>={
  readSource:async offset=>{offsets.push(offset);return (async function*(){for(let at=offset;at<bytes.length;at+=131071){if(interrupt&&at-offset>SCOPE_CHUNK_SIZE+200000){interrupt=false;throw Error('synthetic disconnected source');}yield bytes.subarray(at,at+131071);}})();},
  readChunk:async(index,digest)=>{const b=chunks.get(`${index}:${digest}`);if(!b)throw Error('synthetic missing chunk');return b;},
  writeChunk:async(index,digest,part)=>{chunks.set(`${index}:${digest}`,Buffer.from(part));},
  checkpoint:async next=>{progress=structuredClone(next);},
  publish:async source=>{const parts:Buffer[]=[];for await(const part of source)parts.push(Buffer.from(part));if(failPublish)throw Error('synthetic final storage failure');published=Buffer.concat(parts);return 'private-fictional-location';},
  register:async()=>{registrations++;return {...file,id:'12345678-1234-4234-8234-123456789abd'};},
 };
 return {file,bytes,chunks,adapter,offsets,get progress(){return progress;},get published(){return published;},get registrations(){return registrations;},interrupt:()=>{interrupt=true;},failPublish:()=>{failPublish=true;}};
}
test('multi-segment original survives interrupted transport and resumes at the saved verified offset',async()=>{
 const x=fixture();x.interrupt();await assert.rejects(copyIntakeTransferFile(x.file,x.progress,x.adapter),/disconnected/);
 assert.equal(x.progress.chunks.length,1);assert.equal(x.registrations,0);
 const receipt=await copyIntakeTransferFile(x.file,x.progress,x.adapter);
 assert.deepEqual(x.offsets,[0,SCOPE_CHUNK_SIZE]);assert.deepEqual(x.published,x.bytes);assert.equal(receipt.sha256,x.file.sha256);assert.equal(x.registrations,1);
});
test('missing retained bytes invalidate that checkpoint and are copied again without losing the original',async()=>{
 const x=fixture();x.interrupt();await assert.rejects(copyIntakeTransferFile(x.file,x.progress,x.adapter));x.chunks.clear();
 await copyIntakeTransferFile(x.file,x.progress,x.adapter);assert.deepEqual(x.offsets,[0,0]);assert.deepEqual(x.published,x.bytes);
});
test('full checksum mismatch never publishes or registers and resets resumable bad bytes',async()=>{
 const x=fixture(9),wrong={...x.file,sha256:'0'.repeat(64)};
 await assert.rejects(copyIntakeTransferFile(wrong,x.progress,x.adapter),/checksum/);assert.equal(x.published,null);assert.equal(x.registrations,0);assert.equal(x.progress.chunks.length,0);
});
test('short/overlong source and unconfirmed final storage cannot produce a saved-file receipt',async()=>{
 const short=fixture(9);short.adapter.readSource=async()=> (async function*(){yield short.bytes.subarray(0,8);})();
 await assert.rejects(copyIntakeTransferFile(short.file,short.progress,short.adapter),/interrupted/);assert.equal(short.registrations,0);
 const long=fixture(9);long.adapter.readSource=async()=> (async function*(){yield Buffer.alloc(10);})();
 await assert.rejects(copyIntakeTransferFile(long.file,long.progress,long.adapter),/exceeded/);assert.equal(long.registrations,0);
 const storage=fixture(9);storage.failPublish();await assert.rejects(copyIntakeTransferFile(storage.file,storage.progress,storage.adapter),/storage failure/);assert.equal(storage.registrations,0);
 const unconsumed=fixture(9);unconsumed.adapter.publish=async()=> 'false-receipt';await assert.rejects(copyIntakeTransferFile(unconsumed.file,unconsumed.progress,unconsumed.adapter),/not confirmed/);assert.equal(unconsumed.registrations,0);
});
test('changed checkpoint bytes and false registration metadata never pass complete-file verification',async()=>{
 const x=fixture();x.interrupt();await assert.rejects(copyIntakeTransferFile(x.file,x.progress,x.adapter));
 for(const key of x.chunks.keys())x.chunks.set(key,Buffer.alloc(SCOPE_CHUNK_SIZE,121));
 await copyIntakeTransferFile(x.file,x.progress,x.adapter);assert.deepEqual(x.offsets,[0,0]);assert.deepEqual(x.published,x.bytes);
 const bad=fixture(9);bad.adapter.register=async()=>({...bad.file,size:8});await assert.rejects(copyIntakeTransferFile(bad.file,bad.progress,bad.adapter),/did not match/);
});

test('storage acknowledgement timeout rejects after the source stream has already reached EOF',async()=>{
 let ended=false;const bytes=(async function*(){yield new Uint8Array([1,2]);})();
 await assert.rejects(publishTransferStream(bytes,async stream=>{for await(const part of stream){void part;}ended=true;return await new Promise(()=>{});},20),/confirmation timed out/);
 assert.equal(ended,true);
});
test('the database adapter repairs a corrupt retained chunk under its current lease',async()=>{
 const db=new PGlite(),id='12345678-1234-4234-8234-123456789abc',work='intake-copy-v2:toy',chunk='intake-copy-v2:toy:chunk:0:verified';
 try{
  await db.exec('CREATE TABLE p5_estimator_work(draft_id uuid,work_key text,payload jsonb,lease_token text,lease_until timestamptz,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key))');
  await db.query("INSERT INTO p5_estimator_work(draft_id,work_key,payload,lease_token,lease_until) VALUES($1,$2,'{}','current',now()+interval '1 minute'),($1,$3,'{\"data\":\"corrupt\"}',NULL,NULL)",[id,work,chunk]);
  const write=async(token:string,data:string)=>(await db.query(TRANSFER_CHUNK_WRITE_SQL,[id,chunk,JSON.stringify({data}),work,token])).rows;
  assert.equal((await write('stale','wrong')).length,0);
  assert.equal((await write('current','dmVyaWZpZWQ=')).length,1);
  assert.equal((await db.query<{payload:{data:string}}>('SELECT payload FROM p5_estimator_work WHERE work_key=$1',[chunk])).rows[0].payload.data,'dmVyaWZpZWQ=');
  await db.query("UPDATE p5_estimator_work SET lease_until=now()-interval '1 second' WHERE work_key=$1",[work]);assert.equal((await write('current','expired')).length,0);
  assert.equal((await db.query<{payload:{data:string}}>('SELECT payload FROM p5_estimator_work WHERE work_key=$1',[chunk])).rows[0].payload.data,'dmVyaWZpZWQ=');
 }finally{await db.close();}
});
