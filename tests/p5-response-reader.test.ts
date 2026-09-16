import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../lib/p5/browserDraft.ts';

const reply=(body:string,status=200)=>new Response(body,{status});

test('valid JSON is returned unchanged',async()=>{
  assert.deepEqual(await readJson(reply('{"draft":{"revision":3}}')),{draft:{revision:3}});
});
test("the host's deploy page becomes a human message, not a parser error",async()=>{
  // The exact shape a visitor hit on p5homeco.com mid-deploy.
  await assert.rejects(()=>readJson(reply('The deployment is being updated. Please try again shortly.',503)),
    (e:Error)=>{
      assert.ok(!/Unexpected token|Failed to execute/.test(e.message),`leaked a parser error: ${e.message}`);
      assert.match(e.message,/finishing an update/);
      assert.match(e.message,/saved/);
      return true;
    });
});
test('an HTML gateway page is recognised too',async()=>{
  await assert.rejects(()=>readJson(reply('<html><body>502 Bad Gateway</body></html>',502)),/finishing an update/);
});
test('an unrecognised non-JSON body still names the status and reassures',async()=>{
  await assert.rejects(()=>readJson(reply('???',500)),(e:Error)=>{
    assert.match(e.message,/HTTP 500/);assert.match(e.message,/saved/);
    assert.ok(!/Unexpected token/.test(e.message));return true;});
});
