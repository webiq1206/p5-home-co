import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

for(const endpoint of ['estimate-lead','re10/analyze','re10/estimate','plans/analyze','plans/estimate']){
  const file=path.resolve(`app/api/${endpoint}/route.ts`);
  if(!existsSync(file))continue;
  test(`retired ${endpoint} cannot issue a price, lead or delivery receipt`,async()=>{
    const {POST}=await import(pathToFileURL(file).href);
    const response=await POST(new Request('https://example.invalid',{method:'POST',body:'{}'}));
    const data=await response.json();
    assert.equal(response.status,410);assert.equal(data.nextStep,'/estimate');assert.equal(data.priceable,false);
    for(const field of ['price','range','estimate','saved','accepted','delivery'])assert.equal(data[field],undefined);
  });
}
const assistant=path.resolve('server/services/assistant/tools.ts');
if(existsSync(assistant))test('legacy assistant tools use the reviewed estimator and expose no starting price',async()=>{
  const {executeAssistantTool}=await import(pathToFileURL(assistant).href);
  for(const name of ['calculate_estimate','price_re10_repairs','submit_lead']){
    const result=JSON.parse(await executeAssistantTool(name,{project:'kitchen',sqft:200,repairs:[]},'https://example.invalid'));
    assert.equal(result.nextStep,'/estimate');assert.equal(result.priceable,false);
    assert.equal(result.low,undefined);assert.equal(result.quotedPrice,undefined);assert.equal(result.saved,undefined);
  }
  const facts=JSON.parse(await executeAssistantTool('get_business_info',{topic:'services'},'https://example.invalid'));
  assert.ok(facts.services.length);assert.ok(facts.services.every((s:Record<string,unknown>)=>s.planningFrom===undefined));
});
