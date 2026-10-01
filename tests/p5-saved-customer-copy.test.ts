import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreSavedCustomerCopy} from '../lib/p5/savedCustomerCopy.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';

test('saved scope copy is regenerated without repricing or disclosing internal data',()=>{
 const customer={range:{low:300,high:325},summary:'Contractor provides removal.',issue:{reference:'P5-12345678',issuedAt:'2026-10-01'},lineItems:[{description:'Door levers',low:300,high:325}],assumptions:['Owner supplies parts, and installation.']};
 const internal={scope:{text:'Replace three levers. Contractor provides removal and installation labor only.',answers:{ownerSupplied:'All levers, screws and consumables'},extraction:{instructions:{...emptyInstructions(),responsibilities:['Contractor provides removal and installation labor only.','Owner supplies parts.']}}},assumptions:['Contractor provides installation labor only. Direct cost $200; margin 30%.'],exclusions:['Painting'],directCost:200,margin:.3};
 const before=JSON.stringify({customer,internal});
 const result=restoreSavedCustomerCopy(customer,internal);
 assert.match(result.summary,/removal and installation labor only/);
 assert.match(result.instructions.responsibilities[0],/installation labor only/);
 assert.deepEqual(result.range,customer.range);
 assert.deepEqual(result.lineItems,customer.lineItems);
 assert.deepEqual(result.issue,customer.issue);
 assert.doesNotMatch(JSON.stringify(result),/\$200|margin|directCost/);
 assert.equal(JSON.stringify({customer,internal}),before);
 assert.deepEqual(restoreSavedCustomerCopy(result,internal),result);
 assert.equal(restoreSavedCustomerCopy(customer,{}),customer);
});
