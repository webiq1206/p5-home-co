import test from 'node:test';
import assert from 'node:assert/strict';
import {activePricingSource,pricingSourceParts} from '../lib/p5/pricingSources.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
import {validateExtraction} from '../lib/p5/scope.ts';

test('retained alternatives stay recoverable but are not another pricing source',()=>{
  const history={originalTakeoffs:[{component:'Unselected quartz top',quantity:5,unit:'hour'}]};
  const extraction={
    summary:'Selected painted MDF/wood bench top',
    facts:[{field:'laborHours',value:'14',source:'visitor clarification',evidence:'2 + 8 + 4 = 14',confidence:1}],
    takeoffs:[{component:'Selected painted MDF/wood top fabrication/install',quantity:4,unit:'hour'}],
    pages:[{source:'cabinet-scope.pdf',page:1,status:'read'}],
    documentCoverage:{complete:true,expectedPages:2},
    sourceHistory:history,
    clarificationProvenance:history,
  };
  const scope={text:'Price the selected cabinet scope.',answers:{laborHours:'14',materials:'Painted MDF/wood'},
    extraction,uploads:[],uncertainFields:[],corrections:[],reviewedAt:'2026-09-12T00:00:00.000Z'} as unknown as ReviewedScope;
  const before=JSON.stringify(scope);
  const projected=activePricingSource(scope);
  assert.equal(projected.answers.laborHours,'14');
  assert.deepEqual(projected.extraction?.takeoffs,extraction.takeoffs);
  assert.deepEqual((projected.extraction as any)?.pages,(extraction as any).pages);
  assert.deepEqual(projected.extraction?.documentCoverage,extraction.documentCoverage);
  assert.ok(!JSON.stringify(pricingSourceParts(scope)).includes('Unselected quartz top'));
  assert.equal(JSON.stringify(scope),before,'projection must not mutate retained evidence');
  assert.strictEqual((scope.extraction as unknown as typeof extraction).sourceHistory,history);
});

test('labor summaries and original page coverage survive an unmodified saved JSON roundtrip',()=>{
  const page={source:'scope.pdf',page:1,sheet:'A1',revision:'1',status:'read',notes:[]};
  const components=[{id:'assembly',description:'Assembly',hours:2},
    {id:'install',description:'Cabinet installation',hours:8},
    {id:'top',description:'Selected MDF/wood top',hours:4}];
  const extraction={
    summary:'Selected cabinet work',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],
    documentCoverage:{pages:[page],expectedPages:2,complete:false},
    takeoffs:components.map(c=>({id:c.id,description:c.description,component:c.description,
      quantity:c.hours,unit:'HR',building:'Home',floor:'First',basis:'stated',
      evidence:`Clarified ${c.hours} hours`,sources:[page],issues:[],supersedes:[]})),
    laborCoverage:{totalHours:14,components,nonAdditiveSummary:true,basis:'retained-document-clarification'},
  };
  const restored=validateExtraction(JSON.parse(JSON.stringify(extraction)));
  assert.deepEqual(restored.laborCoverage,extraction.laborCoverage);
  assert.deepEqual(restored.documentCoverage,extraction.documentCoverage);
  assert.equal(restored.documentCoverage?.complete,false,'a missing page cannot become complete on reload');
  assert.throws(()=>validateExtraction({...extraction,laborCoverage:{...extraction.laborCoverage,totalHours:28}}),/labor coverage/i);
  assert.throws(()=>validateExtraction({...extraction,takeoffs:extraction.takeoffs.slice(1)}),/active component takeoffs/i);
});