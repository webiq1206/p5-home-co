import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4188',results=[],output='outputs/intake-progression';
await mkdir(output,{recursive:true});
const engine=process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch();
try{
 for(const [width,height] of [[1180,757],[390,844],[320,568],[844,390],[768,1024],[1024,768]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width!==1180,isMobile:width!==1180,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await context.route('**/api/p5-estimator/scope',async route=>{
   const state=await (await context.request.get(base+'/__state')).json();
   const draft=state.drafts.find(d=>d.id===route.request().headers()['x-p5-draft-id']);
   await route.fulfill({json:{draft:{...draft,answers:{...draft.answers,service:'remodel'}},conflicts:[{field:'service',values:['kitchen','bathroom'],explanation:'Synthetic conflicting project types'}],pricedFields:[]}});
  });
  await page.goto(base+'/?sticky=1');const estimator=page.getByRole('region',{name:'Project estimator'});
  const starter=estimator.locator('[aria-label="Example projects"] button').first();
  await starter.waitFor();await starter.press('Enter');
  const question=estimator.getByRole('region',{name:'Project question'});
  await question.waitFor().catch(async error=>{console.log(await estimator.innerText());throw error;});
  assert.equal(await estimator.getAttribute('data-step'),'1','Starter must advance without Send');
  const heading=question.locator('h2');assert(await heading.evaluate(el=>el===document.activeElement),'Next question gets focus');
  let rect=await heading.boundingBox();assert(rect.y>=64&&rect.y+rect.height<height,'Current question clears sticky header');
  const choice=question.locator('[aria-label="Suggested answers"] button').first();
  assert(await choice.count()>0,'Fixture exercises a suggested answer');
  if(await choice.count()){
   const previous=await heading.innerText();
   const answer=estimator.locator('textarea').last();
   await answer.fill('Please preserve my custom detail.');await choice.click();
   assert.equal(await heading.innerText(),previous,'Custom text requires confirmation');
   assert((await answer.inputValue()).includes('Please preserve my custom detail.'),'Custom detail retained');
   await answer.fill('');await choice.click();
   await page.waitForFunction(previous=>document.querySelector('[aria-label="Project question"] h2')?.textContent!==previous,previous);
   assert.equal(await estimator.getAttribute('data-step'),'1');
  }
  await estimator.getByRole('button',{name:'Review with the details I have',exact:true}).click();
  await estimator.getByRole('heading',{name:'Review your project',exact:true}).waitFor();
  const contactAction=estimator.getByRole('button',{name:'Continue to contact details',exact:true});await contactAction.waitFor();
  rect=await contactAction.boundingBox();assert(rect.y>=0&&rect.y+rect.height<=height,'Next action visible');
  assert.equal(await estimator.getByRole('button',{name:'Send project request',exact:true}).count(),0);
  await contactAction.click();const name=estimator.getByRole('textbox',{name:'Your name',exact:true});
  assert(await name.evaluate(el=>el===document.activeElement),'First missing contact gets focus');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const thread=estimator.locator('[data-p5-thread]');
  let nameRect=await name.boundingBox(),threadRect=await thread.boundingBox();
  assert(nameRect.y>=threadRect.y&&nameRect.y+nameRect.height<=threadRect.y+threadRect.height,'Focused invalid contact stays visible');
  await name.fill('Synthetic UX');await page.keyboard.press('Tab');
  const email=estimator.getByRole('textbox',{name:'Email',exact:true});assert(await email.evaluate(el=>el===document.activeElement),'Tab reaches email');
  await email.fill('invalid');await contactAction.click();assert.equal(await email.getAttribute('aria-invalid'),'true');
  assert(await email.evaluate(el=>el===document.activeElement),'Invalid email gets focus');
  await email.fill('ux@example.invalid');
  await page.getByRole('button',{name:/^(Send project request|Continue with Boise)/}).waitFor();
  // Supporting work is intentionally multi-select and never advances or submits.
  const checkbox=estimator.locator('input[type=checkbox]').first();
  assert(await checkbox.count()>0,'Fixture exercises a supporting-work checkbox');
  if(await checkbox.count()) {await checkbox.evaluate(el=>{let p=el.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}});await checkbox.check();assert.equal(await estimator.getAttribute('data-step'),'2');}
  await page.screenshot({path:`${output}/${process.env.P5_TEST_BROWSER||'chromium'}-${width}x${height}.png`});
  const state=await (await page.request.get(base+'/__state')).json();assert.equal(state.submissions,0);assert.equal(state.pricingCalls,0);
  const savedText=await estimator.getByRole('textbox',{name:'Your project description',exact:true}).inputValue();
  await estimator.getByRole('button',{name:'Back to project description',exact:true}).click();
  assert.equal(await estimator.getByLabel('Tell us about your project',{exact:true}).inputValue(),savedText,'Back preserves project text');
  await page.goto(base+'/?service=adu&embedded=1&sticky=1');
  await estimator.getByRole('note').filter({hasText:'This page is for ADU'}).waitFor();
  assert((await estimator.innerText()).includes('continuing your saved'),'Embedded ADU landing identifies existing project before Continue');
  const prior=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id);
  page.once('dialog',dialog=>dialog.accept());
  await estimator.getByRole('button',{name:'Start a new ADU request',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).answers.service==='adu');
  assert.notEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id),prior);
  assert(await page.evaluate(prior=>Object.keys(localStorage).some(key=>key.includes('recovery')&&localStorage.getItem(key)?.includes(prior)),prior),'Previous project retained in recovery');
  await estimator.locator('summary').filter({hasText:'Saved project recovery'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await estimator.getByRole('button',{name:'Restore '+savedText.slice(0,65),exact:true}).click();
  await page.waitForFunction(prior=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id===prior,prior);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).text),savedText,'Archived project restores its text');
  results.push({width,height,touch:width!==1180,layout:'page and embedded resume',starter:'Enter activation',choice:'one-click and custom-text confirmation',contact:'staged and invalid-email focus',stickyHeader:'synthetic 64px',keyboard:'starter Enter and name-to-email Tab',back:'description retains text',recovery:'archive and restore',serviceContext:'embedded ADU mismatch before Continue',submissions:0});await context.close();
 }
 console.log(JSON.stringify(results));
 await writeFile(`${output}/results-${process.env.P5_TEST_BROWSER||'chromium'}.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
