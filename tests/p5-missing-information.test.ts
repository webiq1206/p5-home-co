import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMissingInformation,reconcileReviewNotes,combineScopeExtractions,type ScopeExtraction} from '../lib/p5/scope.ts';

const page=(source:string,page:number,status:'read'|'partial'|'unreadable'='read')=>({source,page,sheet:'',revision:'',status,notes:[]});
const takeoff=(description:string,component:string,quantity:number|null,unit:string)=>({
  id:description,description,building:'',floor:'',component,quantity,unit,basis:'stated' as const,
  evidence:'',sources:[],supersedes:[],issues:[],
});
const base=(over:Partial<ScopeExtraction>={}):ScopeExtraction=>({
  summary:'',facts:[],conflicts:[],reviewNotes:[],missingInformation:[],
  documentCoverage:{expectedPages:2,complete:true,pages:[page('d.pdf',1),page('d.pdf',2)]},
  takeoffs:[takeoff('Rebar for driveway slab','rebar',1580,'LF'),takeoff('Concrete placement/finishing labor','concrete',24,'HRS')],
  ...over,
});

test('a quantified takeoff retires the question its own document answered',()=>{
  const kept=reconcileMissingInformation(base({missingInformation:['Reinforcement (rebar/mesh) not specified']}));
  assert.deepEqual(kept,[]);
});

test('a specification question survives a takeoff that only proves quantity',()=>{
  const notes=['Concrete slab thickness/PSI spec','Concrete finish/thickness specification not stated'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),notes);
});

test('a page-scoped note is dropped only once every page has been read',()=>{
  const notes=['Page 2 of estimate not included in this segment; concrete line items may continue',
               'Driveway dimensions referenced in filename only, not shown on this page'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),[]);
  const unread=base({missingInformation:notes,documentCoverage:{expectedPages:2,complete:false,pages:[page('d.pdf',1),page('d.pdf',2,'unreadable')]}});
  assert.deepEqual(reconcileMissingInformation(unread),notes,'an unread page keeps every page-scoped question');
});

test('a redacted or absent source price is never missing project information',()=>{
  const notes=['Unit costs/pricing (redacted per filename)','Dollar amounts blanked throughout the table'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),[]);
});

test('detail the estimator never requires is not asked for',()=>{
  const notes=['Client and project location not specified','Property address not provided'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),[]);
});

test('a genuine gap with no supporting takeoff is always kept',()=>{
  const notes=['Excavation depth for the rear patio is not stated','Window schedule was not supplied'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),notes);
});

test('a generic word shared with a takeoff does not retire a question',()=>{
  const notes=['Concrete curing and protection requirements are not stated'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),notes);
});

test('an unquantified takeoff cannot retire a question',()=>{
  const extraction=base({missingInformation:['Reinforcement (rebar/mesh) not specified'],
    takeoffs:[takeoff('Rebar for driveway slab','rebar',null,'LF')]});
  assert.deepEqual(reconcileMissingInformation(extraction),['Reinforcement (rebar/mesh) not specified']);
});

test('combining pages applies the same reconciliation',()=>{
  const first=base({missingInformation:['Reinforcement (rebar/mesh) not specified'],takeoffs:[],
    documentCoverage:{expectedPages:2,complete:false,pages:[page('d.pdf',1)]}});
  const second=base({missingInformation:['Concrete slab thickness/PSI spec'],
    takeoffs:[takeoff('Rebar for driveway slab','rebar',1580,'LF')],
    documentCoverage:{expectedPages:2,complete:false,pages:[page('d.pdf',2)]}});
  const merged=combineScopeExtractions([first,second]);
  assert.deepEqual(merged.missingInformation,['Concrete slab thickness/PSI spec'],
    'the second page answers the first page question, and the real specification gap remains');
});

test('a page-scoped review note is dropped once every page is read, but a blocking one never is',()=>{
  const complete=base({reviewNotes:[
    'Demo section header shown but no line items follow on this page (may continue on next page)',
    'plans.pdf: automatic reading could not finish for page 3 (the reader ran out of time).',
  ]});
  assert.deepEqual(reconcileReviewNotes(complete),
    ['plans.pdf: automatic reading could not finish for page 3 (the reader ran out of time).'],
    'the page-local observation goes; the unread page stays and keeps blocking');
  const unread=base({reviewNotes:complete.reviewNotes,
    documentCoverage:{expectedPages:2,complete:false,pages:[page('d.pdf',1),page('d.pdf',2,'unreadable')]}});
  assert.deepEqual(reconcileReviewNotes(unread),complete.reviewNotes,'nothing is dropped while a page is unread');
});

test('a note deferring to a later page is retired once that page has been read',()=>{
  const notes=['Finish level and materials for interior scope (likely on later pages)',
               'Schedule may continue on the following page'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:notes})),[]);
  const genuine=['Conditioned square footage of the addition'];
  assert.deepEqual(reconcileMissingInformation(base({missingInformation:genuine})),genuine);
});
