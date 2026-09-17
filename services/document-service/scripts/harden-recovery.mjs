import fs from 'node:fs';
const root=new URL('../',import.meta.url);
function change(file,from,to){const url=new URL(file,root),text=fs.readFileSync(url,'utf8');if(text.includes(to))return;if(!text.includes(from))throw new Error('Recovery integration point changed: '+file);fs.writeFileSync(url,text.replace(from,to));}
change('src/store.mjs',"UPDATE p5ds_documents SET state='parsing',updated_at=now() WHERE id=$1","UPDATE p5ds_documents SET state=CASE WHEN state='failed' THEN state ELSE 'parsing' END,updated_at=now() WHERE id=$1");
change('src/pipeline.mjs',
 "  const stored=await this.store.pages(job.document_id,job.payload.pages,true);\n  if(stored.length!==job.payload.pages.length)throw new ServiceError('missing-prepared-page',503);\n  if(stored.every(p=>p.evidence)){await this.store.complete(job,{cached:true});await this.finalize(job.document_id);return;}",
 "  const requested=await this.store.pages(job.document_id,job.payload.pages,true);\n  if(requested.length!==job.payload.pages.length)throw new ServiceError('missing-prepared-page',503);\n  const stored=requested.filter(p=>!p.evidence);\n  if(!stored.length){await this.store.complete(job,{cached:true});await this.finalize(job.document_id);return;}");
change('src/pipeline.mjs','UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2','UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2 AND evidence IS NULL');
const tests=new URL('test/integration.test.mjs',root);let text=fs.readFileSync(tests,'utf8');
if(!text.includes('a parser checkpoint cannot erase a terminal reader failure')){
 text+=`
test('a parser checkpoint cannot erase a terminal reader failure',{skip:!available},async()=>{
 const id=hash('failure-preservation'),bytes=Buffer.from('%PDF-test-only');
 await pool.query("INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes,state,error_code) VALUES($1,$2,'failure-preservation',$3,'test.pdf',$4,$5,'failed','reader-failed')",[id,tenant,hash(bytes),bytes,bytes.length]);
 await store.enqueue(pool,{id:jobId(tenant,'failure-preservation','test',{}),tenant,project:'failure-preservation',documentId:id,kind:'fault-test',payload:{}});
 const lease=await store.claim(['fault-test']);
 await store.putPage(lease,{page:1,text:'Room 101 SF',image:Buffer.from('test-image')});
 assert.equal((await store.document(tenant,'failure-preservation',id)).state,'failed');
 await store.complete(lease,{});
});
test('a recovered reader never sends completed pages to the provider again',async()=>{
 const native=n=>({page:n,text:'Room '+(100+n)+' SF',textQuality:1,kind:'text'});
 const sent=[],queries=[];let completed=false;
 const fakeStore={pages:async()=>[{page:1,native:native(1),image:Buffer.alloc(0),evidence:fakePage(native(1))},{page:2,native:native(2),image:Buffer.alloc(0),evidence:null}],pool:{query:async(q)=>{queries.push(q);return {rows:[]};}},complete:async(job,result,extra)=>{completed=true;if(extra)await extra(fakeStore.pool);}};
 const reader={call:async(job,system,input)=>{sent.push(...input.pages.map(p=>p.page));return {pages:input.pages.map(fakePage)};}};
 const pipeline=new Pipeline(fakeStore,reader,config);
 await pipeline.read({document_id:'d',payload:{pages:[1,2]}},new AbortController().signal);
 assert.deepEqual(sent,[2]);assert.ok(completed);assert.ok(queries.some(q=>q.includes('AND evidence IS NULL')));
});
`;
 fs.writeFileSync(tests,text);
}
console.log('Recovery preserves terminal failures and already verified page evidence.');
