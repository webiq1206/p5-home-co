import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffForService} from '../lib/p5/adaptive.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';

// Cabinet and Handyman used to have no route out: a remodel or a new build typed there ended at a
// question listing only their own services. Every site now routes work it does not do.
const ALL=['new-construction','kitchen','bathroom','whole-home','addition','adu','cabinet-product','cabinet-install','handyman','re10'];
test('every service this site does not offer routes to the sister company that estimates it',()=>{
  const offered=new Set<string>(ESTIMATOR_BRAND.services as readonly string[]);
  for(const service of ALL){
    const route=handoffForService(service);
    if(offered.has(service))continue;
    assert.ok(route,`${ESTIMATOR_BRAND.name} routes ${service}`);
    assert.match(route.url,/^https:\/\/boise(?:construction|remodeling|cabinet|handyman)\.co\/estimate$/);
    assert.ok(!route.url.includes(ESTIMATOR_BRAND.domain),'never routes a visitor back to the same site');
  }
});
test('the routing table sends each kind of work to one company',()=>{
  const owner=(service:string)=>handoffForService(service)?.url;
  if(ESTIMATOR_BRAND.id!=='construction')assert.equal(owner('new-construction'),'https://boiseconstruction.co/estimate');
  if(ESTIMATOR_BRAND.id!=='remodeling')assert.equal(owner('kitchen'),'https://boiseremodeling.co/estimate');
  if(ESTIMATOR_BRAND.id!=='cabinet')assert.equal(owner('cabinet-install'),'https://boisecabinet.co/estimate');
  if(ESTIMATOR_BRAND.id!=='handyman')assert.equal(owner('handyman'),'https://boisehandyman.co/estimate');
});
test('a carried project crosses as plain text and short answers only, under an opaque link',async()=>{
  const {cleanContinuation,sendContinuation}=await import('../lib/p5/handoff.ts');
  const clean=cleanContinuation({text:'Kitchen remodel, 12 x 14',answers:{service:'kitchen',finish:'high-end','bad key':'x',nested:{a:1},empty:' '},from:'boisecabinet.co',contact:{email:'someone@example.com'}});
  assert.deepEqual(clean?.answers,{service:'kitchen',finish:'high-end'},'only short string answers under plain keys cross');
  assert.ok(!JSON.stringify(clean).includes('someone@example.com'),'contact details never cross');
  assert.equal(cleanContinuation({text:' ',answers:{}}),null);
  const service=['kitchen','new-construction','handyman'].find(s=>handoffForService(s))!;
  const posted:{url:string;body:any}[]=[];
  const fetcher=(async(url:string,init:RequestInit)=>{posted.push({url,body:JSON.parse(String(init.body))});return new Response(JSON.stringify({code:'A'.repeat(32)}),{status:200});}) as unknown as typeof fetch;
  const sent=await sendContinuation(service,{text:'Project text',answers:{service}},fetcher);
  assert.ok(sent?.carried);assert.match(sent!.url,/\?continue=A{32}$/,'the link carries only the opaque code');
  assert.equal(posted[0].body.action,'create');assert.ok(posted[0].url.endsWith('/api/p5-estimator/handoff'));
  assert.ok(!sent!.url.includes('Project'),'no scope text in the URL');
  const failing=(async()=>{throw new Error('offline');}) as unknown as typeof fetch;
  const fallback=await sendContinuation(service,{text:'Project text',answers:{}},failing);
  assert.equal(fallback?.carried,false);assert.ok(fallback?.url.endsWith('/estimate'),'a failed transfer still opens the right estimator');
});
