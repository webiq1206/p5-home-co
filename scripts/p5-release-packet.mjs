#!/usr/bin/env node
// Release packet for the five P5 estimators: what is live, exactly, and how to roll it back.
// Reads each site's public release endpoint (counts and versions only, never rates or customers)
// and writes a Markdown packet. Usage:
//   node scripts/p5-release-packet.mjs --out ../P5-Release-Packet.md [--tests "brc=563/0,..."] [--runs runs.json]
import {writeFile} from 'node:fs/promises';

const SITES=[
  {name:'P5 Home Co',host:'p5homeco.com',repo:'p5-home-co',replId:'2d29af42-b4a0-47ed-be90-6bb8bfc2c140'},
  {name:'Boise Remodeling Co',host:'boiseremodeling.co',repo:'boise-remodeling-co',replId:'01a121fb-0516-4a6b-91c7-6b8c72963385'},
  {name:'Boise Construction Co',host:'boiseconstruction.co',repo:'Boise-Construction-Co',replId:'722a9d7a-e272-45fc-82f8-945b4079b6da'},
  {name:'Boise Handyman Co',host:'boisehandyman.co',repo:'Boise-Handyman-Co',replId:'a0fb1e7d-5474-405a-83e5-8f238b365516'},
  {name:'Boise Cabinet Co',host:'boisecabinet.co',repo:'Boise-Cabinet-Co',replId:'39cb504b-0293-417f-8843-95c74cd68fe8'},
];
const arg=(name)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const out=arg('--out')||'P5-Release-Packet.md';
const tests=Object.fromEntries((arg('--tests')||'').split(',').filter(Boolean).map(pair=>pair.split('=')));
const runs=arg('--runs')?JSON.parse(await (await import('node:fs/promises')).readFile(arg('--runs'),'utf8')):[];

async function release(host){
  try{const r=await fetch(`https://${host}/api/p5-estimator/release`,{signal:AbortSignal.timeout(20000)});return r.ok?await r.json():{error:`HTTP ${r.status}`};}
  catch(error){return {error:String(error?.message||error)};}
}
const rows=[];
for(const site of SITES)rows.push({...site,live:await release(site.host)});
const cell=(v)=>v===undefined||v===null||v===''?'n/a':String(v).replace(/\|/g,'/');
const lines=[];
lines.push('# P5 estimators: release packet','',`Generated ${new Date().toISOString()} from each site's public release endpoint.`,'');
lines.push('## What is live','','| Site | Live commit | Built | Price book | Book lines | Saved catalog rates | Scope reader | Tests (pass/fail) |','| --- | --- | --- | --- | --- | --- | --- | --- |');
for(const r of rows){
  const l=r.live||{};
  lines.push(`| ${r.name} | ${cell(String(l.sha||'').slice(0,8)||l.error)} | ${cell(l.builtAt)} | ${cell(l.priceBook?.version)} | ${cell(l.priceBook?.lines)} | ${cell(l.policy?.planningRates)} | ${cell(l.scopeReader?.model)} (${cell(l.scopeReader?.source)}) | ${cell(tests[r.repo])} |`);
}
const ignored=rows.filter(r=>r.live?.scopeReader?.ignored);
if(ignored.length)lines.push('',...ignored.map(r=>`- ${r.name}: scope reader setting ignored: ${r.live.scopeReader.ignored}`));
if(runs.length){
  lines.push('','## Live acceptance runs','','| When | Site | Scenario | Result | Range | Pricing time | Delivery |','| --- | --- | --- | --- | --- | --- | --- |');
  for(const run of runs)lines.push(`| ${cell(run.when)} | ${cell(run.site)} | ${cell(run.scenario)} | ${cell(run.status)} | ${cell(run.range)} | ${cell(run.pricingSeconds)}s | ${cell(run.delivery)} |`);
}
lines.push('','## Data this release reads and writes','',
  '- `p5_estimator_drafts`: one row per project (scope, answers, contact, internal and customer estimates). The internal estimate carries `scopePricing.catalog` (catalog version, import date, rate count) so every estimate traces to the exact prices used.',
  '- `p5_estimator_events`: timings and outcomes per stage (`analysis/*`, `pricing/price-<phase>`), no document content. Query p50/p95 by `stage` and `duration_ms`.',
  '- `p5_estimator_policy`: `current` (saved owner catalog and finance policy), `price-cache:<fingerprint>` (reusable priced results), `handoff:<sha256>` (single-use sister-site continuations, 30 minutes).',
  '- `p5_estimator_work`: resumable analysis and pricing jobs and saved regional rates.',
  '- No schema change in this release: every new record type is a row in an existing table.',
  '','## Price source','',
  '- The owner\'s `P5 Cost Database 2026.xlsx` (Master sheet), compiled into `lib/p5/priceBookData.ts` by `scripts/p5-build-price-book.mjs`. Every line is offered to every service; the book\'s applicability flags only decide which of two equal matches comes first.',
  '- Finish tiers: Builder, Mid-Range (default), High-End, Luxury. Remodel premium applies to kitchen, bathroom, whole-home and RE-10 work. Percentage lines (11) are not unit prices and are not offered.',
  '- Amounts are direct cost. Overhead, profit and contingency are applied once by the engine.',
  '','## Limits (as enforced in code)','',
  '- Upload: 50 files, 250 MiB each, 1 GiB total; up to 250 PDF pages per project.',
  '- What is analysed per request: 24 MiB request body, 4 MiB upload chunks, 16 MiB analysis segments, 22 MiB per reader call. Large drawing sets are read page by page.',
  '','## Rollback','',
  'For any site: open its Replit workspace Shell and run `git fetch origin && git reset --hard <previous commit> && git log --oneline -1`, confirm the commit, then republish (the Replit Publishing panel or the publish tool). Confirm with `curl https://<site>/api/p5-estimator/release` that `sha` is the previous commit. Never use the Replit Agent box, and cancel any publish that proposes dropping a table.',
  '','## Owner decisions still open','',
  '- Commercial percentages (FIN-01): unchanged; the owner decides.',
  '- Whole-home new builds use the itemized planning model, not the book\'s per-square-foot assemblies; switching reprices every new-home quote.',
  '- Physical-device checks (iPhone Safari, Android Chrome) and confirmation that the five labelled QA emails arrived in the QA inbox.',
);
await writeFile(out,lines.join('\n')+'\n');
console.log(`wrote ${out}`);
