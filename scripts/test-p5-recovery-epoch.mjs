import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {canonical,sha,provisionRecoveryEpoch,RecoveryEpochLedger} from './lib/recoveryEpoch.mjs';

// This fixture is deliberately unconnected to any provider or real authorization.
const hash=sha('SYNTHETIC OFFLINE TEST ONLY');
function fixture(t,mutate=()=>{}) {
 const dir=mkdtempSync(path.join(tmpdir(),'p5-epoch-test-'));
 const opened=[];
 t.after(()=>{for(const ledger of opened)ledger.close();rmSync(dir,{recursive:true,force:true});});
 const file=path.join(dir,'ledger.sqlite');
 const attestation={version:1,epochId:'offline-only',umbrellaId:'synthetic',authorizationEvidence:'TEST ONLY; authorizes no real spending',
  umbrellaMicros:12_000_000,crmEnabled:false,ledgerPath:file,expiresAt:new Date(Date.now()+3600000).toISOString(),
  historicalLiability:{mode:'attested-carryforward',evidenceSha256:hash,description:'SYNTHETIC evidence only; no real spending authority',unknownHoldMicros:390_000},historicalUpperBoundMicros:3_250_000,oldWorkers:{state:'stopped',evidenceSha256:hash,upperBoundMicros:0},
  epochCeilingMicros:6_400_000,bindings:{source:hash,dependencies:hash,runtime:hash,documents:hash,models:hash},
  cases:[{id:'plans',documentSha256:hash,priorUpperBoundMicros:1_000_000,ceilingMicros:7_500_000,
   stages:['read','review','pricing'].map(id=>({id,envelopeMicros:2_000_000,maxCalls:2,requestPolicySha256:hash,
    endpoint:'https://example.invalid/responses',model:'synthetic-model',billingBoundEvidenceSha256:hash}))}]};
 mutate(attestation);
 const args={file,attestation,expectedSha256:sha(canonical(attestation)),bindings:attestation.bindings};
 const context={caseId:'plans',stageId:'read',documentSha256:hash,endpoint:'https://example.invalid/responses',model:'synthetic-model',
  requestPolicySha256:hash,requestSha256:sha('request1'),upperBoundMicros:1_500_000};
 const open=()=>{const ledger=new RecoveryEpochLedger(args);opened.push(ledger);return ledger;};
 return {dir,args,context,open,provision:()=>provisionRecoveryEpoch(args)};
}
const receipt={actualMicros:500_000,response:Buffer.from('{"result":"synthetic"}'),usageEvidenceSha256:hash};

test('missing authority, changed binding and reset all fail closed',t=>{
 const f=fixture(t);assert.throws(f.open,/ENOENT/);f.provision();
 assert.throws(f.provision,/EEXIST/);
 assert.throws(()=>new RecoveryEpochLedger({...f.args,bindings:{source:sha('changed')}}),/bindings-changed/);
 assert.throws(()=>new RecoveryEpochLedger({...f.args,expectedSha256:sha('wrong')}),/attestation-identity/);
 unlinkSync(f.args.file);assert.throws(f.open,/ENOENT/);assert.throws(f.provision,/EEXIST/);
});
test('invalid authority cannot provision any ledger',t=>{
 for(const mutate of [a=>a.oldWorkers.state='unbounded',a=>a.oldWorkers.upperBoundMicros=1,a=>a.historicalUpperBoundMicros=6_000_000,
  a=>a.crmEnabled=true,a=>a.expiresAt='2000-01-01',a=>a.cases[0].stages.pop(),a=>a.cases[0].ceilingMicros=1,
  a=>a.cases[0].stages[0].envelopeMicros=NaN,a=>a.cases[0].stages[0].endpoint='https://user:secret@example.invalid',
  a=>a.epochCeilingMicros=5_000_000,a=>a.ledgerPath=undefined,a=>delete a.bindings.models,a=>delete a.historicalLiability,
  a=>a.historicalLiability.unknownHoldMicros=3_250_001,a=>a.historicalLiability.mode='original-ledger']) {
  const f=fixture(t,mutate);assert.throws(f.provision,/recovery-epoch:/);
 }
});
test('receipt replay, request identity, stage and case envelopes',t=>{
 const f=fixture(t);f.provision();const q=f.open();const id=q.reserve(f.context);
 assert.equal(q.settle(id,receipt),'settled');assert.deepEqual(q.replay(f.context).response,receipt.response);
 assert.throws(()=>q.reserve(f.context),/duplicate/);
 assert.throws(()=>q.reserve({...f.context,requestSha256:sha('2'),upperBoundMicros:1_500_001}),/envelope-exhausted/);
 const next={...f.context,requestSha256:sha('2')};q.settle(q.reserve(next),receipt);
 assert.throws(()=>q.reserve({...f.context,requestSha256:sha('3'),upperBoundMicros:1}),/envelope-exhausted/);
 const pricing={...f.context,stageId:'pricing'};q.settle(q.reserve(pricing),receipt);
 assert.equal(q.report().aggregateUpperBoundMicros,4_750_000);assert.equal(q.report().frozen,false);
});
test('all semantic execution bindings are immutable',t=>{
 const f=fixture(t);f.provision();const q=f.open();
 for(const key of ['caseId','stageId','documentSha256','endpoint','model','requestPolicySha256'])
  assert.throws(()=>q.reserve({...f.context,[key]:'changed'}),/binding-mismatch/);
 f.args.attestation.cases[0].stages[0].model='changed';
 assert.throws(()=>q.attestation.cases[0].stages[0].model='changed',TypeError);
 assert.throws(()=>q.reserve({...f.context,model:'changed'}),/binding-mismatch/);
 assert.equal(q.report().attempts.length,0);
});
test('two connections serialize; other owner cannot settle; unknown retains hold; late receipt releases',t=>{
 const f=fixture(t);f.provision();const one=f.open(),two=f.open();const id=one.reserve(f.context);
 assert.throws(()=>two.reserve({...f.context,stageId:'pricing'}),/unresolved/);
 assert.throws(()=>two.settle(id,receipt),/fenced/);one.unknown(id);
 assert.equal(two.report().newLiabilityMicros,1_500_000);
 assert.throws(()=>two.reserve({...f.context,stageId:'review'}),/unresolved/);
 assert.equal(one.settle(id,receipt),'settled');assert.equal(two.report().frozen,false);
 assert.throws(()=>one.settle(id,receipt),/fenced/);
});
test('process death preserves full reservation and blocks every stage',t=>{
 const f=fixture(t);f.provision();
 const result=spawnSync(process.execPath,['--input-type=module','-e',
  `import {RecoveryEpochLedger} from ${JSON.stringify(new URL('./lib/recoveryEpoch.mjs',import.meta.url).href)};
   const q=new RecoveryEpochLedger(${JSON.stringify(f.args)});q.reserve(${JSON.stringify(f.context)});process.exit(17);`],{encoding:'utf8'});
 assert.equal(result.status,17,result.stderr);const q=f.open();
 assert.equal(q.report().newLiabilityMicros,1_500_000);assert.equal(q.report().frozen,true);
 assert.throws(()=>q.reserve({...f.context,stageId:'pricing'}),/unresolved/);
 assert.throws(()=>q.replay(f.context),/receipt-unavailable/);
});
test('overrun is recorded conservatively and freezes subsequent admission',t=>{
 const f=fixture(t);f.provision();const q=f.open();
 assert.equal(q.settle(q.reserve(f.context),{...receipt,actualMicros:2_100_000}),'overrun');
 assert.equal(q.report().newLiabilityMicros,2_100_000);
 assert.throws(()=>q.reserve({...f.context,stageId:'review'}),/unresolved/);
});
test('expired authority permits settlement but no new spending',t=>{
 const f=fixture(t);f.provision();const q=f.open(),id=q.reserve(f.context),now=Date.now;
 try{Date.now=()=>now()+7200000;assert.equal(q.settle(id,receipt),'settled');
  assert.throws(()=>q.reserve({...f.context,stageId:'pricing'}),/expired/);
 }finally{Date.now=now;}
});
test('tampered persisted response or authority cannot be replayed',t=>{
 const f=fixture(t);f.provision();const q=f.open(),id=q.reserve(f.context);q.settle(id,receipt);
 const db=new DatabaseSync(f.args.file);try{db.prepare('UPDATE attempts SET response=? WHERE id=?').run(Buffer.from('changed'),id);
  assert.throws(()=>q.replay(f.context),/receipt-unavailable/);
  db.exec("UPDATE authority SET digest='changed'");assert.throws(f.open,/authority-mismatch/);
 }finally{db.close();}
 assert.equal(readFileSync(f.args.file+'.epoch','utf8'),f.args.expectedSha256);
});
