import test from 'node:test';
import assert from 'node:assert/strict';
import {withTimeout} from '../lib/p5/browserDraft.ts';
test('withTimeout resolves a prompt promise and rejects a stalled one without holding the interface',async()=>{
 assert.equal(await withTimeout(Promise.resolve('ok'),50,'stalled'),'ok');
 await assert.rejects(withTimeout(new Promise(()=>{}),20,'Device storage did not respond.'),/did not respond/);
 await assert.rejects(withTimeout(Promise.reject(new Error('own failure')),50,'stalled'),/own failure/);
});
