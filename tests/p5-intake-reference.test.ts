import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './fixtures/p5-pglite.ts';
import {newIntakeReference,reserveIntakeReference} from '../lib/p5/intakeReferenceStore.ts';
import {intakeReference} from '../lib/p5/intakeContract.ts';
import type {IntakeRow} from '../lib/p5/intakeStore.ts';
import type {IntakeSite} from '../lib/p5/intakePolicy.ts';
async function fixture(){
 const db=await isolatedDatabase();
 await db.exec('CREATE TABLE p5_project_references(project_id text PRIMARY KEY,reference text NOT NULL UNIQUE); CREATE TABLE p5_estimator_work(work_key text,payload jsonb);');
 const query=async(s:string,v:unknown[]=[]) => (await db.query<IntakeRow>(s,v)).rows;
 return {db,query};
}
test('every site has its own short reference namespace',()=>{
 const prefixes={p5:'P',construction:'C',remodeling:'R',handyman:'H',cabinet:'B'};
 for(const [site,prefix] of Object.entries(prefixes))for(let n=0;n<100;n++)assert.match(newIntakeReference(site as IntakeSite),new RegExp(`^P5-${prefix}-[2-9A-HJ-NP-Z]{8}$`));
});
test('database uniqueness resolves concurrent project reservations and retains retries',async()=>{
 const {db,query}=await fixture();try{
  const refs=await Promise.all(Array.from({length:12},()=>reserveIntakeReference(query,'fictional-project','handyman')));
  assert.equal(new Set(refs).size,1);
  assert.equal(await reserveIntakeReference(query,'fictional-project','handyman',()=>{throw Error('must not mint');}),refs[0]);
  assert.equal((await query('SELECT * FROM p5_project_references')).length,1);
 }finally{await db.close();}
});
test('a random collision retries without changing the other project',async()=>{
 const {db,query}=await fixture();try{
  await reserveIntakeReference(query,'first','p5',()=> 'P5-P-AAAAAAAA');
  let attempts=0;
  assert.equal(await reserveIntakeReference(query,'second','p5',()=> ++attempts===1?'P5-P-AAAAAAAA':'P5-P-BBBBBBBB'),'P5-P-BBBBBBBB');
  assert.equal(attempts,2);
  assert.equal(await reserveIntakeReference(query,'first','p5'),'P5-P-AAAAAAAA');
 }finally{await db.close();}
});
test('historical references are retained and historical collisions fail closed',async()=>{
 const {db,query}=await fixture();try{
  const projectId='p5:12345678-1234-4234-8234-123456789abc';
  await query("INSERT INTO p5_estimator_work VALUES('intake-submission-v1',$1)",[JSON.stringify({snapshot:{projectId}})]);
  const ref=intakeReference(projectId);
  assert.equal(await reserveIntakeReference(query,projectId,'p5'),ref);
  await query('DELETE FROM p5_project_references');
  await query('INSERT INTO p5_project_references VALUES($1,$2)',['other',ref]);
  await assert.rejects(reserveIntakeReference(query,projectId,'p5'),/request-reference-conflict/);
  assert.equal((await query('SELECT * FROM p5_project_references')).length,1);
 }finally{await db.close();}
});
test('collision exhaustion and invalid candidates cannot create a reservation',async()=>{
 const {db,query}=await fixture();try{
  await reserveIntakeReference(query,'first','p5',()=> 'P5-P-AAAAAAAA');
  let attempts=0;
  await assert.rejects(reserveIntakeReference(query,'second','p5',()=>{attempts++;return 'P5-P-AAAAAAAA';}),/request-reference-unavailable/);
  assert.equal(attempts,8);
  await assert.rejects(reserveIntakeReference(query,'third','p5',()=> 'invalid'),/request-reference-invalid/);
  assert.equal((await query('SELECT * FROM p5_project_references')).length,1);
 }finally{await db.close();}
});
