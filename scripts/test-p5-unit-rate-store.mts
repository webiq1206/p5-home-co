// P5 integration only. Executes the real persistence SQL in disposable local SQL.
import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readRegionalRates,saveRegionalRates} from '../lib/p5/regionalRates.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import {planningResolution} from '../lib/p5/scopePricing.ts';
const db=new PGlite();
process.env.DATABASE_URL='postgres://unused-test-only';
globalThis.__p5Pool={query:(text:string,values:unknown[])=>db.query(text,values)} as typeof globalThis.__p5Pool;
try{
 await db.exec('CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,brand text); CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));');
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 for(let i=0;i<ids.length;i++)await db.query('INSERT INTO p5_estimator_drafts VALUES($1,$2)',[ids[i],i?'different-site':ESTIMATOR_BRAND.id]);
 const now=new Date('2026-09-18T00:00:00Z');
 const task={id:'trim',description:'Baseboard material',evidence:'50 LF baseboard',researchDescription:'Standard baseboard material',existingLineIds:[],additions:[],issues:[]};
 const rate=planningResolution({rates:[{taskId:'trim',description:'MDF baseboard',unit:'LF',quantity:50,quantityEvidence:'50 LF requested',basis:'material-purchase',includes:'MDF material',excludes:'Labor and paint',low:2,high:4,confidence:'medium',rationale:'Synthetic test rate only'}],issues:[]},[task],now,0,'Boise').rules[0];
 await saveRegionalRates(ids[0],'Boise',[rate],now);
 await saveRegionalRates(ids[0],'Boise',[rate],now);
 await saveRegionalRates(ids[1],'Boise',[{...rate,description:'Different site rate'}],now);
 const saved=await readRegionalRates('Boise',now);
 assert.equal(saved.length,1);assert.equal(saved[0].quantity.fixed,1);assert.equal(saved[0].unitCost,3);
 assert.equal((await readRegionalRates('Seattle',now)).length,0);
 assert.equal((await readRegionalRates('Boise',new Date('2026-11-01'))).length,0);
 assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM p5_estimator_work')).rows[0].n,2);
 console.log('PASS: persisted unit cost reused, idempotent writes, site/location isolation and expiry.');
}finally{globalThis.__p5Pool=undefined;await db.close();}
