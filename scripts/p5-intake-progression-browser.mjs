import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4188',results=[],output='outputs/intake-progression';
await mkdir(output,{recursive:true});
const engine=process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch();
try{
 for(const [width,height] of [[1180,757],[390,844],[320,568],[844,390]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(15000);
  await context.route('**/api/p5-estimator/scope',async route=>{
   const state=await (await context.request.get(base+'/__state')).json();
   const draft=state.drafts.find(d=>d.id===route.request().headers()['x-p5-draft-id']);
   await route.fulfill({json:{draft:{...draft,answers:{...draft.answers,service:'remodel'}},conflicts:[{field:'service',values:['kitchen','bathroom'],explanation:'Synthetic conflicting project types'}],pricedFields:[]}});
  });
  await page.goto(base);const estimator=page.getByRole('region',{name:'Project estimator'});
  const starter=estimator.locator('[aria-label="Example projects"] button').first();
  await starter.waitFor();await starter.press('Enter');
  const question=estimator.getByRole('region',{name:'Project question'});
  await question.waitFor().catch(async error=>{console.log(await estimator.innerText());throw error;});
  assert.equal(await estimator.getAttribute('data-step'),'1','Starter must advance without Send');
  const heading=question.locator('h2');assert(await heading.evaluate(el=>el===document.activeElement),'Next question gets focus');
  let rect=await heading.boundingBox();assert(rect.y>=0&&rect.y+rect.height<height,'Current question visible');
  const choice=question.locator('[aria-label="Suggested answers"] button').first();
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
  await name.fill('Synthetic UX');await estimator.getByRole('textbox',{name:'Email',exact:true}).fill('ux@example.invalid');
  await page.getByRole('button',{name:/^(Send project request|Continue with Boise)/}).waitFor();
  // Supporting work is intentionally multi-select and never advances or submits.
  const details=estimator.locator('details').filter({has:page.getByText('Supporting work', {exact:false})});
  const checkbox=estimator.locator('input[type=checkbox]').first();
  if(await checkbox.count()) {await checkbox.evaluate(el=>{let p=el.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement;}});await checkbox.check();assert.equal(await estimator.getAttribute('data-step'),'2');}
  await page.screenshot({path:`${output}/${process.env.P5_TEST_BROWSER||'chromium'}-${width}x${height}.png`});
  const state=await (await page.request.get(base+'/__state')).json();assert.equal(state.submissions,0);assert.equal(state.pricingCalls,0);
  await page.goto(base+'/?service=adu');
  await estimator.getByRole('note').filter({hasText:'This page is for ADU'}).waitFor();
  assert((await estimator.innerText()).includes('continuing your saved'),'ADU route identifies existing project');
  const prior=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id);
  page.once('dialog',dialog=>dialog.accept());
  await estimator.getByRole('button',{name:'Start a new ADU request',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).answers.service==='adu');
  assert.notEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id),prior);
  assert(await page.evaluate(prior=>Object.keys(localStorage).some(key=>key.includes('recovery')&&localStorage.getItem(key)?.includes(prior)),prior),'Previous project retained in recovery');
  results.push({width,height,starter:'one-click',choice:'one-click',contact:'staged',submissions:0});await context.close();
 }
 console.log(JSON.stringify(results));
 await writeFile(`${output}/results-${process.env.P5_TEST_BROWSER||'chromium'}.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
