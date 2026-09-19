import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pricingMappingChecks} from '../scripts/pricing-mapping-checks.mjs';
const line=()=>({category:'field-labor',description:'Baseboard installation',unit:'LF',quantity:100,unitCost:3,cost:300,evidence:{basis:'owner-estimating-schedule'},building:'Building Alpha',floor:'First floor'});
const passes=lines=>pricingMappingChecks({internal:{lines}}).every(c=>c.pass);
test('fixed mapping acceptance checks exact quantity, responsibility, approved basis and arithmetic',()=>assert.equal(passes([line()]),true));
for(const [name,patch] of [['wrong quantity',{quantity:200,cost:600}],['owner material charge',{category:'materials'}],['excluded work',{description:'Electrical installation'}],['invented rate',{evidence:{basis:'regional-planning-average'}}],['wrong building',{building:'Building Beta'}],['wrong floor',{floor:'Second floor'}],['bad arithmetic',{cost:400}],['wrong unit',{unit:'hour'}]])test('positive totals cannot hide '+name,()=>assert.equal(passes([{...line(),...patch}]),false));
test('duplicate full-length charges and an empty estimate fail',()=>{assert.equal(passes([line(),line()]),false);assert.equal(passes([]),false);});
