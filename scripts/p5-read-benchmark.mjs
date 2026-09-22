// Reader benchmark against a LIVE site, on a real document (owner request 2026-09-21).
// Opens the estimator, attaches the file under a "[QA] reader benchmark" note, waits for the upload, then
// asks the server to re-read the first pages with each reader setup (lib/p5/readBenchmark.ts) and prints
// seconds per page and what each captured. Usage:
//   node scripts/p5-read-benchmark.mjs --base https://boisehandyman.co --file doc.pdf [--pages 6] [--out dir]
//     [--candidates "OpenAI:gpt-5.6-sol,OpenAI:gpt-5.6-sol:text,OpenAI:gpt-4.1,OpenAI:gpt-4.1:text,OpenAI:gpt-4.1-mini,OpenAI:gpt-4.1-mini:text,Anthropic:claude-sonnet-5,Anthropic:claude-haiku-4-5"]
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const args=process.argv.slice(2);const opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d;};
const base=opt('base'),file=opt('file'),pages=Number(opt('pages','6')),out=opt('out','p5-verification/read-benchmark'),pause=Number(opt('pause','60'));
const candidates=opt('candidates','OpenAI:gpt-5.6-sol,OpenAI:gpt-5.6-sol:text,OpenAI:gpt-4.1,OpenAI:gpt-4.1:text,OpenAI:gpt-4.1-mini,OpenAI:gpt-4.1-mini:text,Anthropic:claude-sonnet-5,Anthropic:claude-haiku-4-5,Anthropic:claude-haiku-4-5:text')
  .split(',').map(s=>{const [kind,model,mode]=s.split(':');return {kind,model,textOnly:mode==='text'};});
if(!base||!file)throw new Error('--base and --file are required');
await mkdir(out,{recursive:true});
const browser=await chromium.launch();const page=await (await browser.newContext({viewport:{width:1280,height:900}})).newPage();
await page.goto(`${base}/estimate/scope`,{waitUntil:'networkidle',timeout:60000});
const est=page.locator('[data-p5-thread]').first().locator('xpath=ancestor-or-self::*[1]');
await page.getByLabel('Upload project files',{exact:true}).setInputFiles([file]);
await page.locator('textarea').first().fill('[QA] reader benchmark. Please read this document.');
await page.getByRole('button',{name:'Continue',exact:true}).first().click();
// Wait until the draft exists on the server with the upload saved.
let creds=null;
for(let i=0;i<90&&!creds;i++){
  await page.waitForTimeout(2000);
  creds=await page.evaluate(async()=>{const d=Object.keys(localStorage).filter(k=>k.startsWith('p5-project-draft')).map(k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}}).find(x=>x&&x.id&&x.key);if(!d)return null;
    const r=await fetch('/api/p5-estimator/draft',{headers:{'x-p5-draft-id':d.id,'x-p5-draft-key':d.key}});const j=await r.json().catch(()=>null);return j?.draft?.uploads?.length?{id:d.id,key:d.key}:null;});
}
if(!creds)throw new Error('the upload never reached the server');
void est;
const results=[];
for(const [index,candidate] of candidates.entries()){
  // The Replit-managed OpenAI connection rate-limits bursts (429); space the setups out.
  if(index)await page.waitForTimeout(pause*1000);
  const t0=Date.now();
  const r=await page.evaluate(async({creds,candidate,pages})=>{const res=await fetch('/api/p5-estimator/benchmark',{method:'POST',headers:{'content-type':'application/json','x-p5-draft-id':creds.id,'x-p5-draft-key':creds.key},body:JSON.stringify({candidate,maxPages:pages})});return {status:res.status,body:await res.json().catch(()=>null)};},{creds,candidate,pages});
  const s=r.body?.summary;const label=`${candidate.kind}:${candidate.model}${candidate.textOnly?' (text only)':' (page + text)'}`;
  results.push({label,status:r.status,elapsed:Math.round((Date.now()-t0)/1000),...r.body});
  console.log(`${label.padEnd(44)} ${r.status!==200?`HTTP ${r.status} ${JSON.stringify(r.body).slice(0,160)}`:r.body?.error?r.body.error:`ok ${s.ok}/${s.ok+s.failed}  median ${s.medianSeconds}s  max ${s.maxSeconds}s  wall ${r.body.wallSeconds}s  items ${s.items}  facts ${s.facts}  takeoffs ${s.takeoffs}${s.failed?`  errors: ${r.body.pages.filter(p=>!p.ok).map(p=>p.error).join(' | ').slice(0,140)}`:''}`}`);
}
await writeFile(path.join(out,`${path.basename(file).replace(/\W+/g,'_')}-${new URL(base).hostname}.json`),JSON.stringify(results,null,1));
await browser.close();
