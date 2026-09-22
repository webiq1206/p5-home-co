// Drive one real customer journey through a LIVE estimator and record evidence:
// release identity, every question asked (and any repeated), per-phase timing,
// customer-visible copy that is not allowed, the range, and delivery status.
// Not part of prebuild: it creates a real draft, provider calls and email.
// Name the contact "[QA] ..." so CRM delivery is suppressed as synthetic QA.
//
// node scripts/p5-live-journey.mjs --base https://site --scope "text" [--file path]...
//   [--answer "label or prompt text=answer"]... [--fallback first|unsure] [--route /estimate/scope]
//   [--contact-name "[QA] Name"] [--contact-email a@b] [--stop review] [--label name] [--out dir]
//   [--width 430 --height 900] [--browser chromium|webkit] [--limit 900]
import {chromium,webkit} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:fallback;};
const all=name=>args.flatMap((a,i)=>a==='--'+name?[args[i+1]]:[]);
const base=opt('base');if(!base)throw new Error('--base is required');
const route=opt('route','/estimate/scope'),scope=opt('scope',''),files=all('file'),label=opt('label','journey'),out=opt('out','p5-verification/live');
const answers=all('answer').map(a=>{const i=a.indexOf('=');return {match:a.slice(0,i).toLowerCase(),value:a.slice(i+1),used:0};});
const fallback=opt('fallback','unsure'),stopAt=opt('stop',''),limit=Number(opt('limit','900'))*1000;
const width=Number(opt('width','430')),height=Number(opt('height','900'));
const contact={name:opt('contact-name','[QA] Estimator Journey'),email:opt('contact-email','qa@example.invalid')};
// Customer copy the owner has ruled out, plus signs of internal detail leaking.
const BANNED=[/local averages?/i,/researching/i,/missing local rates/i,/pricing-(?:search|provider)[-\w:]*/i,/\b(?:direct|unit)[- ]cost\b/i,/\bmarkup\b/i,/\bmargin\b/i,/\bprovider\b/i,/\btokens?\b/i,/sourced-market-average/i,/\bHTTP \d{3}\b/i,/Too many requests/i];
await mkdir(out,{recursive:true});
const t0=Date.now(),seconds=()=>+((Date.now()-t0)/1000).toFixed(1);
const log=[];const note=(m,extra={})=>{const entry={t:seconds(),m,...extra};log.push(entry);console.log(JSON.stringify(entry).slice(0,600));};
const result={base,route,label,scope,files:files.map(f=>path.basename(f)),contact,startedAt:new Date().toISOString(),release:null,timings:{},questions:[],repeatedQuestions:[],banned:[],errors:[],notices:[],api:[],status:'incomplete'};

try{const r=await fetch(base+'/api/p5-estimator/release');result.release=r.ok?await r.json():{status:r.status};}catch(error){result.release={error:String(error.message||error)};}
note('release',result.release);

const browser=await (opt('browser','chromium')==='webkit'?webkit:chromium).launch();
const context=await browser.newContext({viewport:{width,height},hasTouch:width<768,isMobile:width<768&&opt('browser','chromium')!=='webkit'});
const page=await context.newPage();page.setDefaultTimeout(60000);
let lastApi='';
page.on('response',async response=>{const url=response.url();if(response.status()>=500){const where=new URL(url).pathname.slice(0,120);result.errors.push(`${response.status()} on ${where}`);note('server-error',{status:response.status(),path:where,method:response.request().method()});}if(!url.includes('/api/p5-estimator/'))return;const name=url.split('/api/p5-estimator/')[1].split('?')[0];
  if(response.status()===429){result.errors.push(`429 on ${name}`);note('rate-limited',{name});}
  try{const data=await response.json();const p=data.processing||{};const line=JSON.stringify({name,status:response.status(),pending:data.pending,message:data.message||data.error||data.warning||'',phase:p.phase,stage:p.stage,detail:p.message,title:p.title});
    if(line!==lastApi){lastApi=line;const entry={t:seconds(),...JSON.parse(line)};result.api.push(entry);note('api',entry);}
    if(Array.isArray(data.delivery)&&data.delivery.length)result.delivery=data.delivery;
    if(data.id&&name==='submit')result.draftId=data.id;
    if(name==='submit'&&response.status()>=400&&response.status()!==409){result.submitFailure={status:response.status(),message:String(data.message||data.error||'').slice(0,400),questions:data.questions||data.verificationItems||data.missingFields||null};}
  }catch{}});
page.on('console',m=>{if(m.type()==='error')note('console-error',{text:m.text().slice(0,200)});});
const shot=async name=>{await page.screenshot({path:path.join(out,`${label}-${name}.png`),fullPage:false}).catch(()=>{});};
const est=page.locator('[data-p5-estimator]').first();
const seenText=new Set();
async function scanCopy(where){const text=await est.innerText().catch(()=>'');for(const line of text.split('\n').map(v=>v.trim()).filter(Boolean)){if(seenText.has(line))continue;seenText.add(line);for(const rule of BANNED)if(rule.test(line)){result.banned.push({where,t:seconds(),rule:String(rule),line:line.slice(0,240)});note('BANNED COPY',{where,line:line.slice(0,160)});}}}
const busy=async()=>(await est.getAttribute('aria-busy'))==='true';

async function answerQuestion(){
  const q=est.getByRole('region',{name:'Project question'});if(!await q.count())return false;
  const prompt=(await q.locator('h2').first().innerText().catch(()=>'')).trim();const eyebrow=(await q.locator('p').first().innerText().catch(()=>'')).trim();
  const choices=await q.getByRole('group',{name:'Suggested answers'}).getByRole('button').allInnerTexts().catch(()=>[]);
  const buttons=await q.getByRole('button').allInnerTexts().catch(()=>[]);
  const key=`${eyebrow}|${prompt}`;const previous=result.questions.filter(x=>x.key===key).length;
  const entry={t:seconds(),key,label:eyebrow,prompt,choices,buttons:buttons.filter(b=>!choices.includes(b))};
  if(previous){result.repeatedQuestions.push({key,times:previous+1});note('REPEATED QUESTION',{key,times:previous+1});}
  const rule=answers.find(a=>eyebrow.toLowerCase().includes(a.match)||prompt.toLowerCase().includes(a.match));
  if(previous>=3){entry.answered='(gave up: asked 4 times)';result.questions.push(entry);throw new Error('Question repeated four times: '+key);}
  if(rule){rule.used++;const choice=choices.find(c=>c.toLowerCase()===rule.value.toLowerCase());
    if(choice){await q.getByRole('button',{name:choice,exact:true}).click();entry.answered=choice;}
    else{const box=est.getByLabel('Your answer',{exact:true});await box.fill(rule.value);await est.getByRole('button',{name:'Send answer',exact:true}).click();entry.answered=rule.value;entry.typed=true;}
  }else if(fallback==='first'&&choices.length){await q.getByRole('button',{name:choices[0],exact:true}).click();entry.answered=choices[0]+' (first choice)';}
  else if(await q.getByRole('button',{name:/not sure/i}).count()){await q.getByRole('button',{name:/not sure/i}).first().click();entry.answered='Not sure yet';}
  else if(choices.length){await q.getByRole('button',{name:choices[0],exact:true}).click();entry.answered=choices[0]+' (first choice)';}
  else{await est.getByLabel('Your answer',{exact:true}).fill('Standard, as described.');await est.getByRole('button',{name:'Send answer',exact:true}).click();entry.answered='generic text';entry.typed=true;}
  // A selected choice is sent with the composer's send button when the UI keeps it pending.
  await page.waitForTimeout(400);const send=est.getByRole('button',{name:'Send answer',exact:true});
  if(!entry.typed&&await send.count()&&await send.first().isEnabled().catch(()=>false)&&await q.count()&&(await q.locator('h2').first().innerText().catch(()=>''))===prompt){await send.first().click().catch(()=>{});entry.sent=true;}
  result.questions.push(entry);note('question',entry);await page.waitForTimeout(1500);
  for(let i=0;i<200&&await busy();i++)await page.waitForTimeout(500);
  return true;
}

try{
  await page.goto(base+route,{waitUntil:'load'});await est.waitFor();
  result.page={version:await est.getAttribute('data-version'),release:await est.getAttribute('data-release'),layout:await est.getAttribute('data-layout')};note('loaded',result.page);
  if(files.length){await est.getByLabel('Upload project files',{exact:true}).setInputFiles(files);note('files attached');await page.waitForTimeout(1500);}
  if(scope)await est.getByLabel('Tell us about your project',{exact:true}).fill(scope);
  await shot('01-start');await scanCopy('start');
  const analysisStart=Date.now();await est.getByRole('button',{name:'Continue',exact:true}).first().click();note('sent');
  let firstResponse=0,phase='';
  while(Date.now()-t0<limit){
    await scanCopy('details');
    const step=await est.getAttribute('data-step');
    if(await est.getByRole('button',{name:'Keep going',exact:true}).count()){note('paused card; keep going');await est.getByRole('button',{name:'Keep going',exact:true}).click();await page.waitForTimeout(1500);continue;}
    if(!await busy()){
      if(await est.getByRole('heading',{name:'Review your project',exact:true}).count()||step==='2'){phase='review';break;}
      if(await est.getByRole('region',{name:'Project question'}).count()){if(!firstResponse){firstResponse=Date.now();result.timings.firstQuestionSeconds=+((firstResponse-analysisStart)/1000).toFixed(1);await shot('02-first-question');}await answerQuestion();continue;}
      const alert=est.getByRole('alert');if(await alert.count()){const text=(await alert.first().innerText()).trim();if(text){result.errors.push(text);note('alert',{text:text.slice(0,300)});await shot('02-alert');phase='error';break;}}
    }
    await page.waitForTimeout(600);
  }
  result.timings.detailsSeconds=+((Date.now()-analysisStart)/1000).toFixed(1);note('details finished',{phase,seconds:result.timings.detailsSeconds});
  if(phase!=='review')throw new Error(phase==='error'?'details error: '+result.errors.at(-1):'details did not reach review in time');
  await shot('03-review');await scanCopy('review');
  result.review=(await est.innerText()).slice(0,5000);
  if(stopAt==='review'){result.status='review';}
  else{
    await est.getByLabel(/^Your name/).fill(contact.name);await est.getByLabel(/^Email/).fill(contact.email);
    const check=est.getByRole('checkbox');for(let i=0;i<await check.count();i++)if(!await check.nth(i).isChecked())await check.nth(i).check().catch(()=>{});
    const pricingStart=Date.now();await est.getByRole('button',{name:'Get my estimate',exact:true}).first().click();note('get my estimate clicked');
    let priced='';let resubmitAfterRetry=false;
    while(Date.now()-t0<limit){
      await scanCopy('pricing');
      if(await est.getByRole('button',{name:/Download (?:estimate )?PDF/i}).count()){priced='result';break;}
      if(await est.getByRole('button',{name:'Keep going',exact:true}).count()){await est.getByRole('button',{name:'Keep going',exact:true}).click();await page.waitForTimeout(1500);continue;}
      if(result.submitFailure&&!await busy()&&!await est.getByRole('region',{name:'Project question'}).count()){await page.waitForTimeout(1500);priced='handoff';break;}
      if(!await busy()){
        if(await est.getByRole('region',{name:'Project question'}).count()){result.lateQuestionSeconds=+((Date.now()-pricingStart)/1000).toFixed(1);note('LATE QUESTION after pricing started',{seconds:result.lateQuestionSeconds});await shot('04-late-question');await answerQuestion();
          // After a late question the flow returns to review; submit again.
          await page.waitForTimeout(1500);if(!await busy()&&await est.getByRole('button',{name:'Get my estimate',exact:true}).count()){await est.getByRole('button',{name:'Get my estimate',exact:true}).first().click();note('resubmitted');}continue;}
        const alert=est.getByRole('alert');if(await alert.count()){const text=(await alert.first().innerText()).trim();if(text&&!result.errors.includes(text)){result.errors.push(text);note('alert',{text:text.slice(0,400)});await shot('04-alert');
          const retry=est.getByRole('button',{name:/^Retry/});if(await retry.count()&&result.errors.length<3){await retry.first().click();note('retry clicked');resubmitAfterRetry=true;await page.waitForTimeout(2000);continue;}priced='error';break;}}
        // A retried document read returns to review; a visitor presses "Get my estimate" again, so the run does too.
        const submit=est.getByRole('button',{name:'Get my estimate',exact:true});
        if(resubmitAfterRetry&&await submit.count()&&await submit.first().isEnabled()){resubmitAfterRetry=false;await submit.first().click();note('resubmitted after retry');continue;}
      }
      await page.waitForTimeout(700);
    }
    result.timings.pricingSeconds=+((Date.now()-pricingStart)/1000).toFixed(1);note('pricing finished',{priced,seconds:result.timings.pricingSeconds});
    await shot('05-result');
    if(priced==='result'){
      for(const d of await est.locator('details').all())await d.evaluate(el=>{el.open=true;}).catch(()=>{});
      await scanCopy('result');const text=await est.innerText();result.resultText=text.slice(0,12000);
      // The headline first (a single price for repairs, a range otherwise); the first "$a to $b" on
      // the page can be a category line, which reported a $21,500 RE-10 as $1,326 on 2026-09-21.
      const headline=text.match(/YOUR (?:PRICE|ESTIMATE|RANGE)\s+(\$[\d,]+(?:\.\d+)?(?:\s*(?:to|-|–)\s*\$[\d,]+(?:\.\d+)?)?)/i);
      result.range=headline?headline[1]:(text.match(/\$[\d,]+(?:\.\d+)?\s*(?:to|-|–)\s*\$[\d,]+(?:\.\d+)?/)||[''])[0];
      for(let i=0;i<8&&!(result.delivery||[]).some(d=>d.channel==='customer'&&d.status==='sent');i++)await page.waitForTimeout(6000);
      result.deliveryText=await est.locator('p[role=status]').first().innerText().catch(()=>'');
      result.status=result.range?'priced':'result-without-range';
    }else result.status=priced||'timeout';
  }
  try{const events=await page.evaluate(async()=>{const raw=Object.keys(localStorage).filter(k=>k.startsWith('p5-project-draft')).map(k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}}).find(d=>d&&d.id&&d.key);if(!raw)return null;const r=await fetch('/api/p5-estimator/draft?events=1',{headers:{'x-p5-draft-id':raw.id,'x-p5-draft-key':raw.key}});const j=await r.json();return {id:raw.id,revision:j.draft?.revision??raw.revision,events:j.events||[],answers:j.draft?.answers||raw.answers,extraction:j.draft?.extraction||raw.extraction,text:j.draft?.text||raw.text};});
    if(events){result.draftId=events.id;result.revision=events.revision;result.draft={answers:events.answers,extraction:events.extraction,text:events.text};result.events=events.events.map(e=>({at:e.at,stage:e.stage,outcome:e.outcome,provider:e.provider,model:e.model,code:e.code,ms:e.durationMs,attempt:e.attempt,message:e.message||undefined,meta:e.meta||undefined}));for(const withheld of result.events.filter(e=>e.stage==='no-range'))note('WHY NO RANGE',{code:withheld.code,note:withheld.message});const stopped=result.events.find(e=>e.stage==='job'&&e.outcome==='failed');if(stopped)note('JOB STOPPED',{message:stopped.message});}}catch(error){note('events unavailable',{error:String(error.message||error)});}
}catch(error){result.errors.push(String(error.message||error));if(result.status==='incomplete')result.status='failed';note('failure',{error:String(error.message||error).slice(0,400)});await shot('99-failure');}
finally{result.unusedAnswers=answers.filter(a=>!a.used).map(a=>a.match);result.finishedAt=new Date().toISOString();result.totalSeconds=seconds();result.log=log;
  await writeFile(path.join(out,`${label}.json`),JSON.stringify(result,null,1));await context.close();await browser.close();
  console.log('RESULT '+JSON.stringify({label,status:result.status,release:result.release?.sha?.slice(0,8)||null,range:result.range,timings:result.timings,questions:result.questions.length,repeated:result.repeatedQuestions.length,late:result.lateQuestionSeconds||0,banned:result.banned.length,delivery:result.delivery,errors:result.errors.slice(0,3)}));}
