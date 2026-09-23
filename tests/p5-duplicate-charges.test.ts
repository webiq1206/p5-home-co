import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicateChargeNotes} from '../lib/p5/duplicateCharges.ts';

// The live Handyman estimate P5-EB029A8F priced "Exterior weatherproof receptacle" twice, from two
// different requested repairs that both covered the exterior, and said nothing about it.
const line=(scopeTaskId:string,description:string,floor:string,building='Residence')=>({scopeTaskId,description,floor,building});
test('two different requested items priced against one book line for one place are flagged',()=>{
  const notes=duplicateChargeNotes([
    line('t1','Replace or correct inoperable receptacles at the front exterior and front yard, providing GFCI protection.: Exterior weatherproof receptacle.','Front exterior and front yard'),
    line('t2','Replace or correct receptacles requiring GFCI protection in the exterior, kitchen, and garage areas.: Exterior weatherproof receptacle.','Exterior'),
  ]);
  assert.equal(notes.length,1);
  assert.match(notes[0],/Exterior weatherproof receptacle/);
  assert.match(notes[0],/exterior/);
  assert.match(notes[0],/front exterior and front yard/i,'the customer is told which two items');
  assert.match(notes[0],/not the same item counted twice/);
});
test('ordinary pricing is never flagged as a duplicate',()=>{
  // One requested item priced across several assembly lines: how every estimate is built.
  assert.deepEqual(duplicateChargeNotes([
    line('t1','Restore power to the exterior lighting.: Licensed electrician.','Exterior'),
    line('t1','Restore power to the exterior lighting.: Exterior lighting fixture.','Exterior'),
  ]),[]);
  // One requested item split across the rooms it names: the split is the feature.
  assert.deepEqual(duplicateChargeNotes([
    line('t1','Replace receptacles in the kitchen and garage.: GFCI outlet replacement.','Kitchen'),
    line('t1','Replace receptacles in the kitchen and garage.: GFCI outlet replacement.','Garage'),
  ]),[]);
  // Different requested items, same book line, places that do not overlap.
  assert.deepEqual(duplicateChargeNotes([
    line('t1','Replace the kitchen receptacles.: GFCI outlet replacement.','Kitchen'),
    line('t2','Replace the garage receptacles.: GFCI outlet replacement.','Garage'),
  ]),[]);
  // Different book lines in one place are different work.
  assert.deepEqual(duplicateChargeNotes([
    line('t1','Replace the receptacles.: GFCI outlet replacement.','Kitchen'),
    line('t2','Replace the light switches.: Switch replacement.','Kitchen'),
  ]),[]);
  // A placeholder location is not a shared place, or every unplaced line would flag every other.
  assert.deepEqual(duplicateChargeNotes([
    line('t1','Replace the receptacles.: GFCI outlet replacement.','Floor not specified'),
    line('t2','Replace other receptacles.: GFCI outlet replacement.','Unspecified'),
  ]),[]);
  // The one building is not a location either.
  assert.deepEqual(duplicateChargeNotes([
    {scopeTaskId:'t1',description:'Replace the receptacles.: GFCI outlet replacement.',building:'Residence',floor:''},
    {scopeTaskId:'t2',description:'Replace other receptacles.: GFCI outlet replacement.',building:'Residence',floor:''},
  ]),[]);
});
test('a suspected duplicate is reported once, and nothing is removed from the estimate',()=>{
  const lines=[
    line('t1','Seal the exterior penetrations.: Exterior penetration sealing.','Exterior'),
    line('t2','Weatherproof the exterior vents.: Exterior penetration sealing.','Exterior'),
    line('t3','Weatherproof the exterior vents again.: Exterior penetration sealing.','Exterior'),
  ];
  const notes=duplicateChargeNotes(lines);
  assert.equal(notes.length,3,'each distinct pair is named');
  assert.equal(new Set(notes).size,notes.length,'no note repeats');
  assert.equal(lines.length,3,'flagging never merges or drops a priced line');
});

// Live 2026-09-23, revision 5 of Handyman estimate P5-EB029A8F: the check reported two overlaps
// between named priced lines, the correction did not recognise the word "overlap", so nothing was
// corrected and the customer got no estimate at all.
test('a stated overlap between named priced lines is correctable, like a stated duplicate',async()=>{
  const {correctableDuplicate}=await import('../lib/p5/scopePricing.ts');
  for(const stated of [
    'Exterior penetration weatherproofing overlaps across scope-5 and scope-28, and scope-28 also assigns sealant.',
    'The electrical safe-off, removal, final connection, and testing allowances in scope-33 and scope-34 overlap.',
    'scope-5 and scope-6 are duplicated by planning-1.',
    'The shower tile assembly is priced twice: scope-2 and scope-7.',
    'Overlapping protection and cleanup scope between scope-9 and scope-11.',
  ])assert.equal(correctableDuplicate(stated),true,stated);
});
test('a tentative overlap, or a different defect, still withholds the estimate',async()=>{
  const {correctableDuplicate}=await import('../lib/p5/scopePricing.ts');
  for(const held of [
    'scope-5 and scope-28 may overlap; confirm before pricing.',
    'Verify whether scope-33 and scope-34 overlap.',
    'There is an unresolved overlap between scope-5 and scope-28.',
    'This could be a double-count between scope-1 and scope-2.',
    'scope-7 was not requested and is out of scope.',
    'The quantity does not match the explicit figure the customer confirmed.',
    'Demolition was omitted from the priced lines.',
  ])assert.equal(correctableDuplicate(held),false,held);
});
