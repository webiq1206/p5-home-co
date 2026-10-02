import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMinorWorkAllowance} from '../lib/p5/minorWorkAllowance.ts';
import {reconcileMinorWorkAudit} from '../lib/p5/minorWorkAudit.ts';
import type {ScopePriceResolution} from '../lib/p5/costBook.ts';
function fixture(){
 const task={id:'DLV-001',description:'Remove and dispose of old door levers from three interior passage doors',evidence:'Three old levers',researchDescription:'Minor lever removal and disposal',existingLineIds:[] as string[]};
 const other={id:'DLV-002',description:'Install three owner-supplied door levers',evidence:'Three levers',researchDescription:'',existingLineIds:['labor']};
 const resolution:ScopePriceResolution={rules:[],issues:[],assumptions:[]};
 const live=[{id:'labor',quantity:3,unitCost:70}];
 applyMinorWorkAllowance([task],resolution,live,new Date('2026-10-02T00:00:00Z'));
 live.push({id:'minor-work-allowance',quantity:1,unitCost:75});
 return {task,other,resolution,live,audit:{coveredTaskIds:['DLV-002'],issues:[] as string[],notes:[] as string[],resolvedIssues:[] as {issue:string;reason:string;lineIds:string[]}[]}};
}
const findings=[
 'Removal labor (DLV-001) not independently priced in existing lines. Verify whether removal and disposal labor should be included within the installation labor line or separately researched.',
 'Remove and dispose of old door levers from three interior passage doors: Removal labor not matched to existing priced line. Must research removal-and-disposal labor rate or include within DLV-002 installation labor.',
 'DLV-001 (Remove and dispose of old door levers): No independently supported labor price. The minor-work-allowance is cited as covering both removal labor AND consumables, but removal labor is a substantive operation distinct from consumables. Provide explicit evidence that the budget includes measured removal labor.',
];
test('an obsolete material proposal cannot block its replacement by a verified supplies allowance',()=>{
 const f=fixture();f.task.description='Supply contractor installation consumables';
 f.resolution.rules[0].evidence.reference+='\n'+f.task.description;
 Object.assign(f.live[0],{category:'field-labor',description:'Installation labor only; materials priced separately',evidence:{reference:'Book; LABOR-1'}});
 const issue='Task DLV-001: PART-1 has a semantic mismatch and creates a duplicate charge with labor. Replace the material with a supported consumables allowance.';
 f.audit.issues=[issue];f.resolution.issues=[issue];f.resolution.assumptions=['PART-1: nine units proposed','Consumables are included in the labor cost.','Owner supplies the main products.'];
 const decisions=reconcileMinorWorkAudit([f.task,f.other],f.resolution,f.live,f.audit,new Set([issue]),new Map([[f.task.id,new Set(['PART-1'])]]));
 assert.deepEqual(f.audit.issues,[]);assert.deepEqual(f.resolution.issues,[]);assert.equal(decisions.length,1);assert.match(decisions[0].reason,/absent from all positive/);
 assert.deepEqual(f.resolution.assumptions,['Owner supplies the main products.']);
});
for(const variant of ['still priced','never proposed','labor includes supplies','mixed task defect','quantity conflict'])test('obsolete-proposal reconciliation refuses '+variant,()=>{
 const f=fixture();f.task.description='Supply contractor installation consumables';f.resolution.rules[0].evidence.reference+='\n'+f.task.description;
 Object.assign(f.live[0],{category:'field-labor',description:variant==='labor includes supplies'?'Installed package with supplies included':'Labor only; materials priced separately',evidence:{reference:'Book; LABOR-1'}});
 let issue='Task DLV-001: PART-1 has a semantic mismatch and creates a duplicate charge.';
 if(variant==='still priced')f.live.push({id:'part',quantity:1,unitCost:25,...{evidence:{reference:'Book; PART-1'}}});
 if(variant==='mixed task defect')issue+=' DLV-002 also lacks coverage.';
 if(variant==='quantity conflict')issue+=' Quantity conflicts with the scope.';
 f.audit.issues=[issue];
 reconcileMinorWorkAudit([f.task,f.other],f.resolution,f.live,f.audit,new Set(),variant==='never proposed'?new Map():new Map([[f.task.id,new Set(['PART-1'])]]));
 assert.deepEqual(f.audit.issues,[issue]);
});
test('owner policy resolves separate-evidence demands for positively budgeted incidental labor, with an internal decision trail',()=>{
 const f=fixture();f.resolution.issues=[...findings];f.audit.issues=[findings[2]];
 const decisions=reconcileMinorWorkAudit([f.task,f.other],f.resolution,f.live,f.audit,new Set(findings));
 assert.deepEqual(f.resolution.issues,[]);assert.deepEqual(f.audit.issues,[]);assert.ok(f.audit.coveredTaskIds.includes(f.task.id));
 assert.equal(decisions.length,3);assert.ok(decisions.every(d=>d.lineIds[0]==='minor-work-allowance'));assert.equal(f.resolution.rules.length,1);
});
for(const defect of ['DLV-001 is duplicated and has no supported price.','DLV-001 quantity conflicts with scope; no supported price.','DLV-001 and DLV-002 have no supported price.','DLV-001 has excluded work and no supported price.','DLV-001 hazardous disposal needs a separate labor rate.','DLV-001 has an unknown problem.','DLV-001 allowance is insufficient; needs a separate labor rate.','DLV-001 has missing demolition with no supported price.'])test('preserves substantive or unknown audit finding: '+defect,()=>{
 const f=fixture();f.audit.issues=[defect];f.resolution.issues=[defect];reconcileMinorWorkAudit([f.task,f.other],f.resolution,f.live,f.audit,new Set([defect]));
 assert.deepEqual(f.audit.issues,[defect]);assert.deepEqual(f.resolution.issues,[defect]);
});
for(const defect of ['no link','no evidence','no positive allowance','no main price','primary task','removed rule','nonmodel finding'])test('requires verified policy coverage: '+defect,()=>{
 const f=fixture();const issue=findings[0];f.resolution.issues=[issue];f.audit.issues=[issue];
 if(defect==='no link')f.task.existingLineIds=[];
 if(defect==='no evidence')f.resolution.rules[0].evidence.reference='minor-work-v1; no covered-work evidence';
 if(defect==='no positive allowance')f.live[1].unitCost=0;
 if(defect==='no main price')f.live.splice(0,1);
 if(defect==='primary task'){f.task.description='Purchase kitchen cabinets';f.resolution.rules[0].evidence.reference+='\nPurchase kitchen cabinets';}
 if(defect==='removed rule')f.resolution.rules=[];
 reconcileMinorWorkAudit([f.task,f.other],f.resolution,f.live,f.audit,defect==='nonmodel finding'?new Set():new Set([issue]));
 assert.deepEqual(f.resolution.issues,[issue]);
 if(defect!=='nonmodel finding')assert.deepEqual(f.audit.issues,[issue]);
});
