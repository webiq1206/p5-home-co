// Drive a real customer journey through the LIVE estimator with real documents.
// Records extraction and pricing wall-clock times, questions asked, the
// resulting range and line items. Uses a designated test contact so the
// submission is identifiable in email and CRM. Not part of prebuild: it
// creates real drafts, provider calls, email and CRM records.
//
// Usage: node scripts/check-p5-live-journey.mjs --base https://boiseremodeling.co --scope "text" [--file path]... [--answer field=value]... [--name N] [--out dir]
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
const opt=(name,fallback)=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:fallback;};
const all=name=>args.flatMap((a,i)=>a==='--'+name?[args[i+1]]:[]);
const base=opt('base','https://boiseremodeling.co');
const route=opt('route','/estimate');
const scope=opt('scope','');
const files=all('file');
const answers=Object.fromEntries(all('answer').map(a=>{const [k,...v]=a.split('=');return [k,v.join('=')];}));
const label=opt('name','journey');
const out=opt('out','p5-verification/live');
const width=Number(opt('width','1280')),height=Number(opt('height','900'));
const contact={name:opt('contact-name','Estimator QA Test'),email:opt('contact-email','info+estimator-test@webiq.co'),phone:opt('contact-phone','')};
await mkdir(out,{recursive:true});
const log=[];const t0=Date.now();const note=(m,extra={})=>{const entry={t:+((Date.now()-t0)/1000).toFixed(1),m,...extra};log.push(entry);console.log(JSON.stringify(entry));};
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width,height},hasTouch:width<768});
const page=await context.newPage();page.setDefaultTimeout(120000);
// Log every estimator API reply whose server message changes, so a stalled
// stage is visible from the outside without server access.
let lastApi='';
page.on('response',async response=>{const url=response.url();if(!url.includes('/api/p5-estimator/'))return;try{const data=await response.json();const p=data.processing||{};const line=JSON.stringify({status:response.status(),pending:data.pending,message:data.message||data.error||'',phase:p.phase,detail:p.message,pages:p.pagesChecked,stage:p.stage});if(line!==lastApi){lastApi=line;note('api '+url.split('/api/p5-estimator/')[1].split('?')[0],JSON.parse(line));}if(Array.isArray(data.delivery)&&data.delivery.length)note('delivery',{delivery:data.delivery});}catch{}});
const shot=async name=>{const file=path.join(out,`${label}-${name}.png`);await page.screenshot({path:file,fullPage:true}).catch(()=>{});return file;};
const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('[data-p5-estimator][aria-busy=true]'),null,{timeout:180000});};
const result={base,route,label,scope,files,answers,contact:{...contact},timings:{},questions:[],errors:[],status:'incomplete'};
try{
  await page.goto(base+route,{waitUntil:'load'});
  const est=page.locator('[data-p5-estimator]').first();await est.waitFor();
  // Always start clean: replace any previous project on this browser profile.
  const input=est.getByLabel('Tell us about your project',{exact:true});await input.waitFor();
  if(scope){await input.fill(scope);note('scope typed',{chars:scope.length});}
  if(files.length){await est.getByLabel('Upload project files',{exact:true}).setInputFiles(files);note('files attached',{files:files.map(f=>path.basename(f))});await page.waitForTimeout(1500);}
  await shot('01-project');
  const analysisStart=Date.now();
  await est.getByRole('button',{name:'Continue',exact:true}).first().click();note('continue clicked');
  // Wait for the analysis to finish: either a question, the review, or an error.
  let phase='';
  for(let i=0;i<400;i++){
    if(await est.getByRole('region',{name:'Project question'}).count()){phase='question';break;}
    if(await est.getByRole('heading',{name:'Review your project',exact:true}).count()){phase='review';break;}
    if(await est.getByRole('button',{name:'Keep going',exact:true}).count()){note('paused card shown; continuing');await est.getByRole('button',{name:'Keep going',exact:true}).click();}
    const alert=est.getByRole('alert');if(await alert.count()&&!(await est.locator('[aria-busy=true]').count())){const text=await alert.innerText();if(text.trim()){result.errors.push(text.trim());note('alert',{text:text.trim().slice(0,200)});await shot('02-alert');phase='error';break;}}
    await page.waitForTimeout(500);
  }
  result.timings.analysisSeconds=+((Date.now()-analysisStart)/1000).toFixed(1);note('analysis finished',{phase,seconds:result.timings.analysisSeconds});
  if(phase==='error')throw new Error('analysis error: '+result.errors.at(-1));
  await shot('03-after-analysis');
  // Answer questions: supplied answer, else first choice, else Not sure yet, else a generic text.
  for(let i=0;i<25&&await est.getByRole('region',{name:'Project question'}).count();i++){
    const q=est.getByRole('region',{name:'Project question'});
    const prompt=(await q.locator('h2').innerText()).trim();const labelText=(await q.locator('p').first().innerText()).trim();
    const choices=await q.getByRole('group',{name:'Suggested answers'}).getByRole('button').allInnerTexts().catch(()=>[]);
    const entry={label:labelText,prompt,choices};result.questions.push(entry);
    const field=Object.keys(answers).find(k=>labelText.toLowerCase()===k.toLowerCase()||prompt.toLowerCase().includes(k.toLowerCase()));
    if(field){const value=answers[field];const choice=choices.find(c=>c.toLowerCase()===value.toLowerCase())||choices.find(c=>c.toLowerCase().includes(value.toLowerCase()));
      if(choice){await q.getByRole('button',{name:choice,exact:true}).click();entry.answered=choice;}
      else{for(const d of await q.locator('details').all())await d.evaluate(el=>{el.open=true;});const textarea=q.locator('textarea');const number=q.locator('input[inputmode=decimal]');const select=q.locator('select');
        if(await textarea.count())await textarea.first().fill(value);else if(await number.count())await number.first().fill(value);else if(await select.count())await select.first().selectOption(value);else{const details=q.locator('details');if(await details.count()){await details.first().locator('summary').click();await q.locator('input,textarea').first().fill(value);}}
        entry.answered=value;}
    }else if(choices.length){await q.getByRole('button',{name:choices[0],exact:true}).click();entry.answered=choices[0]+' (first choice)';}
    else if(await q.getByRole('button',{name:'Not sure yet',exact:true}).count()){await q.getByRole('button',{name:'Not sure yet',exact:true}).click();entry.answered='Not sure yet';await settled();continue;}
    else{const textarea=q.locator('textarea');if(await textarea.count()){await textarea.first().fill('Standard, as described in the project.');entry.answered='generic text';}else{const number=q.locator('input[inputmode=decimal]');if(await number.count()){await number.first().fill('100');entry.answered='100';}}}
    await q.getByRole('button',{name:'Continue',exact:true}).click();await settled();note('question answered',entry);
  }
  await est.getByRole('heading',{name:'Review your project',exact:true}).waitFor();await shot('04-review');
  result.review={summary:await est.locator('dl').first().innerText().catch(()=>''),details:await est.locator('details summary').allInnerTexts().catch(()=>[])};
  await est.getByLabel('Your name',{exact:true}).fill(contact.name);await est.getByLabel('Email',{exact:true}).fill(contact.email);if(contact.phone)await est.getByLabel('Phone (optional)',{exact:true}).fill(contact.phone);
  await est.getByRole('checkbox').check();
  const pricingStart=Date.now();await est.getByRole('button',{name:'Get my estimate',exact:true}).click();note('get my estimate clicked');await page.waitForTimeout(3000);await shot('04b-after-estimate-click');
  let priced='';
  for(let i=0;i<Number(opt('pricing-limit','1800'));i++){
    if(await est.getByRole('heading',{name:'Your project summary',exact:true}).count()){priced='result';break;}
    if(await est.getByRole('button',{name:'Keep going',exact:true}).count()){note('paused card shown during pricing; continuing');await est.getByRole('button',{name:'Keep going',exact:true}).click();}
    if(await est.getByRole('region',{name:'Project question'}).count()){priced='question';break;}
    const alert=est.getByRole('alert');if(await alert.count()&&!(await est.locator('[aria-busy=true]').count())){const text=(await alert.innerText()).trim();if(text){result.errors.push(text);note('alert',{text:text.slice(0,300)});priced='error';break;}}
    await page.waitForTimeout(500);
  }
  result.timings.pricingSeconds=+((Date.now()-pricingStart)/1000).toFixed(1);note('pricing finished',{priced,seconds:result.timings.pricingSeconds});
  await shot('05-result');
  if(priced==='result'){
    const range=(await est.locator('h2').first().innerText()).trim();
    for(const d of await est.locator('details').all()){try{await d.evaluate(el=>{el.open=true;});}catch{}}
    const categories=await est.locator('details').evaluateAll(list=>list.map(d=>({title:d.querySelector('summary')?.innerText.replace(/\s+/g,' ').trim(),items:[...d.querySelectorAll('li')].map(li=>li.innerText.replace(/\s+/g,' ').trim()).slice(0,40)})));
    result.result={range,categories,delivery:(await est.locator('p[role=status]').first().innerText().catch(()=>''))};
    await page.waitForTimeout(30000);result.result.deliveryLater=(await est.locator('p[role=status]').first().innerText().catch(()=>''));note('delivery status after 30s',{text:result.result.deliveryLater});
    result.status='priced';await shot('06-result-expanded');
  }else if(priced==='question'){result.status='needs-more-information';}
  else result.status='error';
}catch(error){result.errors.push(String(error));result.status='error';note('failure',{error:String(error).slice(0,400)});await shot('99-failure');}
finally{await context.close();await browser.close();result.log=log;await writeFile(path.join(out,`${label}.json`),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify({status:result.status,timings:result.timings,range:result.result?.range,questions:result.questions.length,errors:result.errors.slice(0,3)}));}
