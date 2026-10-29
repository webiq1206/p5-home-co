import test from 'node:test';import assert from 'node:assert/strict';import {intakeCopyForSite} from '../lib/p5/intakePolicy.ts';
test('Handyman keeps the latest human-reviewed list request copy',()=>{const c=intakeCopyForSite('handyman');assert.equal(c.heading,'Send your list and photos');assert.match(c.introduction,/written quote before work starts, not an on-screen price/);assert.match(c.next,/A site visit may be needed/);});
test('Handyman copy does not replace another brand intake',()=>{for(const site of ['p5','construction','remodeling','cabinet','unknown'])assert.equal(intakeCopyForSite(site).heading,'Tell us about your project in just a few minutes');});

test("Handyman intake does not promise an unconfirmed response deadline",()=>assert.doesNotMatch(intakeCopyForSite("handyman").next,/within one business day|same.day|within the week/i));
