import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedPermitContext} from '../lib/p5/permitContext.ts';
test('dated city permit guidance cannot become a metro-wide exemption or a fee',()=>{
 const now=new Date('2026-09-30');
 const context=verifiedPermitContext({answers:{location:'Boise, Idaho'}},now)!;
 assert.equal(context.jurisdiction,'City of Boise');assert.match(context.source,/cityofboise.org/);
 assert.match(context.guidance,/exposed framing/);assert.match(context.guidance,/window replacement/);
 assert.match(context.limitation,/not a permit determination or price/);
 for(const location of ['Boise metro','Treasure Valley','Meridian','Unincorporated Ada County',''])assert.equal(verifiedPermitContext({answers:{location}},now),null);
 assert.equal(verifiedPermitContext({answers:{location:'Boise'}},new Date('2027-02-01')),null,'stale guidance must be refreshed');
});
