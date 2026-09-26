import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {projectReviewHandler,reviewContact} from '../lib/p5/reviewRequest.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

test('human review requires a name and at least one valid contact method',()=>{
  assert.throws(()=>reviewContact({name:'Test'}),/email address or phone/);
  assert.throws(()=>reviewContact({name:'Test',email:'not-an-email'}),/valid email/);
  assert.throws(()=>reviewContact({name:'Test',phone:'123'}),/valid phone/);
  assert.equal(reviewContact({name:'Test',email:'TEST@example.com'}).email,'test@example.com');
  assert.equal(reviewContact({name:'Test',phone:'2085550123'}).phone,'2085550123');
});

test('review request saves its scope and contact once, without duplicate notifications',async()=>{
  const db=new PGlite();let sends=0;
  const id='12345678-1234-4234-8234-123456789abc';const key='a'.repeat(64);
  const draft={id,brand:ESTIMATOR_BRAND.id,revision:3,status:'draft' as const,updatedAt:new Date().toISOString(),text:'Repair two drywall holes',answers:{service:'handyman'},extraction:null,reviewed:null,uploads:[],contact:{name:'Original',email:'',phone:''}};
  const handler=projectReviewHandler({
    readDraft:async(candidate,secret)=>candidate===id&&secret===key?draft:null,
    query:async(sql,values=[])=> (await db.query(sql,values)).rows as Record<string,any>[],
    adminRecipients:async()=>['test-recipient@example.com'],
    sendEmail:async input=>{sends++;assert.match(input.text,/Repair two drywall holes/);return 'test-only-message';},
  });
  const request=()=>new Request('https://'+ESTIMATOR_BRAND.domain+'/api/p5-estimator/review',{method:'POST',headers:{'x-p5-draft-id':id,'x-p5-draft-key':key,'Content-Type':'application/json'},body:JSON.stringify({name:'Audit Test',email:'test@example.com'})});
  try{
    const first=await handler(request());assert.equal(first.status,200);assert.equal((await first.json()).notified,true);
    const repeat=await handler(request());assert.equal(repeat.status,200);assert.equal((await repeat.json()).notified,true);
    assert.equal(sends,1);
    const rows=await db.query('SELECT contact,scope FROM p5_estimator_review_requests');
    assert.equal(rows.rows.length,1);assert.equal((rows.rows[0] as any).contact.email,'test@example.com');
    assert.equal((rows.rows[0] as any).scope.text,draft.text);
    const bad=new Request('https://'+ESTIMATOR_BRAND.domain+'/api/p5-estimator/review',{method:'POST',headers:{'x-p5-draft-id':id,'x-p5-draft-key':'b'.repeat(64)},body:'{}'});
    assert.equal((await handler(bad)).status,404);assert.equal(sends,1);
  }finally{await db.close();}
});

test('notification failure never masquerades as a notified team',async()=>{
  const db=new PGlite();let attempts=0;
  const handler=projectReviewHandler({
    readDraft:async()=>({id:'12345678-1234-4234-8234-123456789abc',brand:ESTIMATOR_BRAND.id,revision:1,status:'draft' as const,updatedAt:'',text:'Test scope',answers:{},extraction:null,reviewed:null,uploads:[],contact:{name:'Test',email:'',phone:''}}),
    query:async(sql,values=[])=> (await db.query(sql,values)).rows as Record<string,any>[],
    adminRecipients:async()=>['test-recipient@example.com'],sendEmail:async()=>{attempts++;throw new Error('Synthetic failure');},
  });
  const request=()=>new Request('https://'+ESTIMATOR_BRAND.domain+'/api/p5-estimator/review',{method:'POST',headers:{'x-p5-draft-id':'12345678-1234-4234-8234-123456789abc','x-p5-draft-key':'a'.repeat(64)},body:JSON.stringify({name:'Test',phone:'2085550123'})});
  try{assert.equal((await (await handler(request())).json()).notified,false);assert.equal((await (await handler(request())).json()).notified,false);assert.equal(attempts,1);}finally{await db.close();}
});
