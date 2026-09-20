import test from 'node:test';
import assert from 'node:assert/strict';
import {planningCatalogFingerprint,verifyCabinetAlternateCatalog} from '../lib/p5/catalogAcceptance.ts';
import {PLANNING_MODEL_VERSION,type PlanningCatalog} from '../lib/p5/planningBooks.ts';

const codes=['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'];
const catalog=(source='Approved owner schedule',authorizedBy='Cabinet owner')=>({
  version:PLANNING_MODEL_VERSION,source,authorizedBy,importedAt:'2026-09-11T00:00:00.000Z',
  rates:codes.map(code=>({code,description:'Approved rate',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Owner schedule',basis:'owner-average-cost'})),
} as PlanningCatalog);

test('alternate-scope preflight labels synthetic scenarios and separates responsibilities',()=>{
  const approved=catalog();
  const report=verifyCabinetAlternateCatalog(approved,new Date(),planningCatalogFingerprint(approved));
  assert.equal(report.synthetic,true);
  assert.deepEqual(report.scenarios.map(s=>s.scenario),['supply-only','labor-only','mixed']);
  assert.ok(report.scenarios[0].categories.includes('materials'));
  assert.ok(!report.scenarios[0].categories.includes('field-labor'));
  assert.ok(report.scenarios[1].categories.includes('field-labor'));
  assert.ok(!report.scenarios[1].categories.includes('materials'));
  assert.ok(report.scenarios[2].categories.includes('materials'));
  assert.ok(report.scenarios[2].categories.includes('field-labor'));
});

test('alternate-scope preflight refuses synthetic or unauthorized catalog identity',()=>{
  const synthetic=catalog('Synthetic fixture','Test only');
  assert.throws(()=>verifyCabinetAlternateCatalog(synthetic,new Date(),planningCatalogFingerprint(synthetic)),/synthetic|test-only/i);
  assert.throws(()=>verifyCabinetAlternateCatalog(catalog()),/production-approved catalog fingerprint/i);
});