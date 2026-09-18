import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceQuoteMatches,validateEvidence} from '../src/core.mjs';
import {requestBody} from '../src/provider.mjs';
import {EVIDENCE_SCHEMA,REVIEW_SCHEMA} from '../src/contracts.mjs';
const native={page:1,kind:'text',textQuality:1,text:'Construction division included scope summary. Install trim. Total project cost $ , .'};
const recovery={x:.1,y:.1,width:.8,height:.8,reason:'Numeric amounts are redacted; verify if any digits are recoverable on closer inspection'};
const record=()=>({page:1,status:'read',notes:[],facts:[{field:'estimatingInstructions',value:'Budget headings',basis:'stated',evidence:'Construction division included scope summary. ... Total project cost $ , .'}],items:[],regions:[recovery]});
test('ordered exact source fragments accept abbreviation while inventions and reordering fail',()=>{
 assert.equal(sourceQuoteMatches(native.text,record().facts[0].evidence),true);
 for(const quote of ['Invented division included scope summary. ... Total project cost $ , .','Total project cost $ , . ... Construction division included scope summary.','Construction ... cost','Construction division included scope summary. ... Invented amounts $500'])assert.equal(sourceQuoteMatches(native.text,quote),false);
 assert.equal(sourceQuoteMatches('Quoted literal ... dots','Quoted literal ... dots'),true);
});
test('explicit blank-number recovery does not call for visual reading or invent values',()=>{
 const r=validateEvidence({pages:[record()]},[native]).pages[0];
 assert.equal(r.status,'read');assert.equal(r.regions.length,0);assert.equal(r.items.length,0);
 assert.match(r.notes.join(' '),/remain missing/);
});
test('scanned, drawing, mixed visual concerns and partial status never get promoted',()=>{
 for(const kind of ['scan','drawing']){const r=validateEvidence({pages:[record()]},[{...native,kind}]).pages[0];assert.equal(r.status,'partial');assert.equal(r.regions.length,1);}
 const mixed=record();mixed.regions=[{...recovery,reason:recovery.reason+'; boundary geometry and material note also unreadable'}];
 assert.equal(validateEvidence({pages:[mixed]},[native]).pages[0].status,'partial');
 const partial=record();partial.status='partial';assert.equal(validateEvidence({pages:[partial]},[native]).pages[0].status,'partial');
 const noBlank={...native,text:'Construction division included scope summary. Install trim. Total project cost $500.'};const no=record();no.facts=[];
 assert.equal(validateEvidence({pages:[no]},[noBlank]).pages[0].regions.length,1);
});
test('Sonnet reading uses medium effort without changing verification, review or other models',()=>{
 assert.equal(requestBody('anthropic','claude-sonnet-5','',{},[],EVIDENCE_SCHEMA,10000,'read').body.output_config.effort,'medium');
 for(const purpose of ['verify','evidence'])assert.equal(requestBody('anthropic','claude-sonnet-5','',{},[],EVIDENCE_SCHEMA,10000,purpose).body.output_config.effort,undefined);
 assert.equal(requestBody('anthropic','claude-sonnet-5','',{},[],REVIEW_SCHEMA,10000,'review').body.output_config,undefined);
 assert.equal(requestBody('anthropic','claude-opus-5','',{},[],EVIDENCE_SCHEMA,10000,'read').body.output_config.effort,undefined);
});
