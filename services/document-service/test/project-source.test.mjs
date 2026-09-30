import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectSource} from '../src/project-source.mjs';
import {makeServer} from '../src/server.mjs';
import {signedHeaders,ServiceError} from '../src/core.mjs';

const tenant='p5homeco.com',secret='synthetic-project-source-signing-key-123456789';
function fixture(){
 const text=('Original source dimensions 18 inches by 24 inches.\n').repeat(900);
 const document={id:'source-id',digest:'a'.repeat(64),name:'plan.pdf',state:'complete',page_count:2,updated_at:new Date('2026-09-30T12:00:00Z')};
 const coverage=[{page:1,status:'read',notes:[]},{page:2,status:'partial',notes:['Dimension illegible.']}];
 const calls=[];
 return {text,coverage,calls,store:{nonce:async()=>true,document:async(who,project,id)=>{if(who!==tenant||project!=='my-project'||id!=='source-id')throw new ServiceError('not-found',404);return document;},coverage:async()=>coverage,pages:async(id,numbers)=>{calls.push({id,numbers});return numbers.map(page=>({page,native:{text:page===1?text:'',textQuality:page===1?1:0,kind:page===1?'drawing':'scan',width:1728,height:2592,spans:[{text:'18 inches',x:10,y:20}]},evidence:{page,status:page===1?'read':'partial',notes:page===1?[]:['Dimension illegible.'],items:[{description:'Requested repair',quantity:null}]}}));}}};
}
test('source retrieval retains complete native text and original page observations without certifying unreadable pages',async()=>{
 const f=fixture(),manifest=await projectSource(f.store,tenant,'my-project','source-id');
 assert.equal(manifest.complete,false);assert.equal(manifest.pageCount,2);assert.equal(manifest.pages[1].status,'partial');assert.equal(f.calls.length,0);assert.equal(manifest.revision,'2026-09-30T12:00:00.000Z');
 const page=await projectSource(f.store,tenant,'my-project','source-id',1);
 assert.equal(page.sha256,'a'.repeat(64));assert.equal(page.page.native.text,f.text);assert.equal(page.page.readerObservation.items[0].quantity,null);
 assert.deepEqual(f.calls,[{id:'source-id',numbers:[1]}]);
 const scan=await projectSource(f.store,tenant,'my-project','source-id',2);
 assert.equal(scan.page.native.text,'');assert.equal(scan.page.readerObservation.status,'partial');
 await assert.rejects(projectSource(f.store,tenant,'other-project','source-id',1),/not-found/);
 await assert.rejects(projectSource(f.store,'boiseremodeling.co','my-project','source-id',1),/not-found/);
 for(const number of [0,-1,3,1.5,NaN])await assert.rejects(projectSource(f.store,tenant,'my-project','source-id',number),/invalid-source-page/);
});
test('P5 page endpoint requires the signed project identity and rejects other tenants',async()=>{
 const f=fixture(),server=makeServer(f.store,{}, {tenants:{[tenant]:secret,'boiseremodeling.co':secret}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,path='/v1/projects/my-project/documents/source-id/evidence?page=1';
 try{
  assert.equal((await fetch(origin+path)).status,401);
  const response=await fetch(origin+path,{headers:signedHeaders(secret,'GET',path,tenant)});
  assert.equal(response.status,200);assert.equal((await response.json()).page.native.text,f.text);
  assert.equal((await fetch(origin+path,{headers:signedHeaders(secret,'GET',path,'boiseremodeling.co')})).status,404);
  assert.equal((await fetch(origin+path.replace('my-project','other-project'),{headers:signedHeaders(secret,'GET',path.replace('my-project','other-project'),tenant)})).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
