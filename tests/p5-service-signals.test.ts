import test from 'node:test';
import assert from 'node:assert/strict';
import {impliedRepairService,serviceEvidenceSupports,signalledService} from '../lib/p5/serviceSignals.ts';
import {reconcileScope,scopeQuestions} from '../lib/p5/adaptive.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';

const flooring='Supply and install about 200 square feet of luxury vinyl plank flooring in one bedroom in Boise. Remove the existing carpet and pad and haul it away.';
test('an RE-10, rush or change-order type needs the customer to have said so',()=>{
  assert.equal(serviceEvidenceSupports('re10',flooring),false);
  assert.equal(serviceEvidenceSupports('re10','Repairs from the buyer inspection report, RE-10 items 1 to 8.'),true);
  assert.equal(serviceEvidenceSupports('rush',flooring),false);
  assert.equal(serviceEvidenceSupports('rush','We need this done as soon as possible, before closing next week.'),true);
  assert.equal(serviceEvidenceSupports('change-order',flooring),false);
  assert.equal(serviceEvidenceSupports('change-order','Change order to our existing contract: add a pantry.'),true);
  for(const ordinary of ['handyman','bathroom','kitchen','adu','cabinet-install',''])assert.equal(serviceEvidenceSupports(ordinary,flooring),true,ordinary);
  assert.equal(signalledService(flooring),null);
});
test('the reader cannot state a flooring job as an RE-10 (live P5 Home Co, 2026-09-25)',()=>{
  const extraction:ScopeExtraction={summary:'',facts:[{field:'service',value:'re10',confidence:1,source:'typed scope',basis:'stated',evidence:flooring},{field:'flooringSqft',value:'200',confidence:1,source:'typed scope',basis:'stated',evidence:'about 200 square feet of luxury vinyl plank flooring'}],conflicts:[],reviewNotes:[],missingInformation:[]};
  const merged=reconcileScope({},extraction);
  assert.equal(merged.answers.service,undefined,'the unsupported type is not accepted');
  assert.equal(merged.answers.flooringSqft,'200','other facts are unaffected');
  assert.equal(scopeQuestions(merged.answers,extraction,merged.conflicts)[0]?.field,'service','the type is asked instead');
  const uncertain={...extraction,facts:[{...extraction.facts[0],confidence:.6}]};
  assert.ok(!scopeQuestions({},uncertain,[]).some(q=>/we found re10/i.test(q.reason)),'nor offered back as a "we found re10" confirmation');
  const supported={...extraction,facts:[{...extraction.facts[0],evidence:'Please price the items on the attached RE-10 inspection repair addendum.'}]};
  assert.equal(reconcileScope({},supported).answers.service,'re10','an RE-10 the customer named is still accepted');
});
test('a repair-only site defaults a plain repair request to home repairs; signals and multi-trade menus still ask',()=>{
  const repairMenu=['handyman','re10','change-order','rush'];
  assert.equal(impliedRepairService('Install 100 linear feet of owner-supplied baseboard in the living room.',repairMenu),'handyman');
  assert.equal(impliedRepairService('Repairs from the buyer inspection, RE-10 attached.',repairMenu),null);
  assert.equal(impliedRepairService('Urgent: the water heater is leaking, we need it fixed today.',repairMenu),null);
  assert.equal(impliedRepairService('Install 100 linear feet of baseboard.',['handyman','re10','kitchen','bathroom']),null,'a multi-trade menu asks');
  assert.equal(impliedRepairService('Install 100 linear feet of baseboard.',['re10','change-order','rush']),null,'no home-repairs service to default to');
});
test('the estimator\'s own revision note is not a change-order signal (live Handyman revision, 2026-09-25)',()=>{
  const revised='Install 100 linear feet of owner-supplied baseboard. Requested change for revision 5: Remove the caulk. Only price the baseboard installation labor; the homeowner will caulk and paint.';
  assert.equal(serviceEvidenceSupports('change-order',revised),false,'no change order was requested');
  assert.equal(signalledService(revised),null);
  assert.equal(impliedRepairService(revised,['handyman','re10','change-order','rush']),'handyman','a revised repair stays home repairs');
  assert.equal(serviceEvidenceSupports('change-order','Change order to our signed contract: add a pantry.'),true,'a real change order still counts');
});
