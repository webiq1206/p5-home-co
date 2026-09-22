import test from 'node:test';
import assert from 'node:assert/strict';
import {findingBlocks} from '../lib/p5/scopePricing.ts';

// Live 2026-09-21 on the routed reader: a Marcliffe RE-10, a typed bathroom and the Neilsen budget
// were each withheld by model remarks about work that WAS priced. Those are items to confirm. What
// still withholds a price is decided by facts: an unpriced task, a stated double charge, a quantity
// conflict or wrong unit, or unrequested work.
const tasks=[{id:'VEN-01',description:'Correct bathroom exhaust venting'},{id:'VEN-02',description:'Seal exterior vent penetrations'},{id:'BATH-VAN-01',description:'Install new vanity'},{id:'CHM-02',description:'Chimney cap repair'}];
const priced=tasks.slice(0,3);
test('remarks about priced work are items to confirm, not reasons to withhold the price',()=>{
  for(const remark of [
    'VEN-01 and VEN-02 have an unresolved overlap: scope-4 prices two terminations while scope-5 separately prices sealing three penetrations.',
    'BATH-VAN-01 is only partially covered. Line scope-3 includes an installed vanity cabinet and top but does not explicitly include the required sink.',
    'Number of plumbing vent boots to replace',
    'Tiled shower wall area (tileSqft) is required to estimate tile labor/materials.',
    'Install new vanity: full pricing coverage has not been verified.',
    'planning-103 may duplicate planning-201; reconcile before procurement.',
  ])assert.equal(findingBlocks(remark,tasks,priced),false,remark);
});
test('facts still withhold the price',()=>{
  for(const defect of [
    'Chimney cap repair: no supported price.',
    'ELE-02 is duplicatively priced: planning-1 and repair-scope-4 charge the same troubleshooting.',
    'Install new vanity: mapped 3 EA does not match the explicit quantity in the reviewed scope.',
    'The patch count disagrees with the description.',
    'Original overlay task omitted from inventory',
    'scope-2 prices a deck stain that was not requested.',
    'Patch drywall: the labor line appears to double count the mobilization already carried.',
  ])assert.equal(findingBlocks(defect,tasks,priced),true,defect);
});
test('an unpriced task already carried out of the total is disclosed, not withheld',()=>{
  assert.equal(findingBlocks('Chimney cap repair: remains unpriced.',tasks,priced,[tasks[3]]),false);
});
