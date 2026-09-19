import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctPage9AssemblyDepth} from '../scripts/correct-plans-page9-assembly-depth.mjs';

const native={page:9,kind:'image',text:'',textQuality:0};
const evidence={page:9,sheet:'A4.2',revision:'',status:'read',facts:[],regions:[],inclusions:[],exclusions:[],responsibilities:[],notes:['Existing note'],items:[
 {id:'9-item-1',unit:'',basis:'visual',floor:'Multi-level',building:'Main',evidence:`BUILDING SECTION 2; 1'-6 3/4"`,quantity:null,component:'Building Section',description:`Building Section 2 showing rooms; confirmed dimensions include ceiling/wall heights 20'-9", 1'-6 3/4", 9'-1 1/8", 10'-1 1/8"`},
 {id:'9-item-2',unit:'',basis:'visual',floor:'',building:'Main',evidence:'OTHER DETAIL',quantity:null,component:'Other detail',description:'Unrelated retained detail'},
]};

test('page 9 correction retains the literal dimension only as uncertain assembly depth',()=>{
 const before=structuredClone(evidence),corrected=correctPage9AssemblyDepth(evidence,native),item=corrected.items[0];
 assert.deepEqual(evidence,before,'source evidence is not mutated');
 assert.equal(corrected.status,'partial');assert.equal(item.basis,'uncertain');assert.equal(item.quantity,null);
 assert.match(item.component,/assembly depth/i);assert.ok(item.description.includes(`1'-6 3/4"`));assert.ok(!item.description.includes('confirmed dimensions include ceiling/wall heights'));
 assert.ok(corrected.notes.some(note=>/not a room, wall, or ceiling height/.test(note)));
 assert.deepEqual(corrected.items[1],evidence.items[1],'unrelated evidence is byte-equivalent');
});

test('page 9 correction refuses changed or already-partial evidence',()=>{
 assert.throws(()=>correctPage9AssemblyDepth({...evidence,status:'partial'},native),/differs/);
 const changed=structuredClone(evidence);changed.items[0].description='Different claim';
 assert.throws(()=>correctPage9AssemblyDepth(changed,native),/differs/);
});