import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5137';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('This test only runs against a local server.');
const output=process.env.P5_TEST_OUTPUT_DIR||'p5-verification/exit';
await mkdir(output,{recursive:true});
const browser=await (process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium).launch();
const results=[];
async function setup(width,mode='saved') {
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600,serviceWorkers:'block'});
 const page=await context.newPage();let requests=[],saved=null;
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(base).origin||url.pathname.startsWith('/api/'))return route.abort();
  return route.continue();
 });
 await context.route('**/api/p5-estimator/draft',async route=>{
  const req=route.request();
  if(req.method()!=='GET'){const input=req.postDataJSON();saved={...input,id:req.headers()['x-p5-draft-id'],revision:(saved?.revision||0)+1,status:'draft',uploads:[],extraction:null};}
  await route.fulfill({json:{draft:saved}});
 });
 await context.route('**/api/recovery/callback',async route=>{
  requests.push(route.request().postDataJSON());
  if(mode==='hang')return;
  if(mode==='failure'&&requests.length===1)return route.fulfill({status:503,json:{ok:false}});
  return route.fulfill({json:{ok:true,notified:mode!=='pending'}});
 });
 await page.goto(base+'/estimate');
 await page.getByRole('button',{name:'Close the estimator. Your progress is saved.',exact:true}).waitFor();
 await page.getByText('Loading your project...', {exact:true}).waitFor({state:'hidden'});
 return {context,page,requests,exit:page.getByRole('button',{name:'Close the estimator. Your progress is saved.',exact:true}),offer:page.getByRole('dialog',{name:'Prefer to talk about your project?'})};
}
try {
 for(const width of [320,390,1440]){
  let f=await setup(width);let {page,offer}=f;
  await f.exit.click();await offer.waitFor();
  assert.equal(await offer.getByRole('link',{name:/^Call /}).getAttribute('href'),'tel:+12084771169');
  assert.equal(await offer.getByRole('button',{name:'Continue form'}).evaluate(el=>document.activeElement===el),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await offer.evaluate(el=>el.contains(document.activeElement)),true);
  await offer.getByRole('button',{name:'Request a callback',exact:true}).click();
  assert.equal(await offer.getByLabel('Your phone number').evaluate(el=>document.activeElement===el),true);assert.equal(f.requests.length,0);
  await page.keyboard.press('Escape');await offer.waitFor({state:'hidden'});
  assert.equal(await f.exit.evaluate(el=>document.activeElement===el),true);
  await f.exit.click();await page.waitForURL(base+'/');assert.equal(f.requests.length,0);await f.context.close();
  results.push({width,scenario:'untouched-escape-repeat-exit-keyboard',passed:true});

  f=await setup(width,'failure');({page,offer}=f);
  const composer=page.getByRole('textbox',{name:'Project description',exact:true});
  // Actual composer labels can vary by stage; use its stable element type for this initial stage.
  const input=await composer.count()?composer:page.locator('[data-p5-estimator] textarea').first();
  await input.fill('Fictional callback test project. No real customer.');
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-exit.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional attachment retained locally.')});
  await page.getByText('synthetic-exit.txt',{exact:true}).first().waitFor();
  await f.exit.click();await offer.waitFor();
  const before=await page.evaluate(()=>localStorage.getItem('p5-project-draft-v2'));
  await offer.getByLabel('Your phone number').fill('2085550100');
  await offer.getByRole('button',{name:'Request a callback',exact:true}).click();
  await offer.getByRole('alert').waitFor();assert.equal(f.requests.length,1);
  assert.equal(await offer.getByLabel('Your phone number').getAttribute('readonly'),'');
  await offer.getByRole('button',{name:'Retry callback request',exact:true}).click();
  await offer.getByRole('status').waitFor();assert.equal(f.requests.length,2);
  assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.requests[0].callbackConsent,true);
  assert.equal(f.requests[0].flow,'p5-exit');assert.doesNotMatch(f.requests[0].note,/Fictional|synthetic-exit/);
  const b=await offer.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);
  await page.screenshot({path:`${output}/${width}-${process.env.P5_TEST_BROWSER||'chromium'}.png`});
  await offer.getByRole('button',{name:'Continue form'}).click();
  const after=await page.evaluate(()=>localStorage.getItem('p5-project-draft-v2'));
  assert.equal(JSON.parse(after).id,JSON.parse(before).id);assert.equal(JSON.parse(after).text,JSON.parse(before).text);
  await page.reload();await f.exit.waitFor();await page.getByText('synthetic-exit.txt',{exact:true}).first().waitFor();
  assert.equal(await input.inputValue(),'Fictional callback test project. No real customer.');
  await f.exit.click();await page.waitForURL(base+'/');assert.equal(f.requests.length,2);await f.context.close();
  results.push({width,scenario:'partial-files-failure-retry-saved-reload',passed:true});
 }
 let f=await setup(1440,'pending');await f.page.getByRole('link',{name:'Back to the homepage',exact:true}).click();await f.offer.waitFor();
 await f.offer.getByLabel('Your phone number').fill('2085550100');await f.offer.getByRole('button',{name:'Request a callback',exact:true}).click();
 await f.offer.getByText(/team notification has not been confirmed/).waitFor();
 await f.offer.getByRole('button',{name:'Leave without finishing'}).click();await f.page.waitForURL(base+'/');assert.equal(f.requests.length,1);await f.context.close();
 results.push({scenario:'home-navigation-pending-notification-leave',passed:true});
 f=await setup(390,'hang');await f.exit.click();await f.offer.waitFor();
 await f.offer.getByLabel('Your phone number').fill('2085550100');await f.offer.getByRole('button',{name:'Request a callback',exact:true}).click();
 await f.offer.getByRole('button',{name:'Saving request…'}).waitFor();
 assert.equal(await f.offer.getByRole('button',{name:'Saving request…'}).isDisabled(),true);
 await f.offer.getByRole('button',{name:'Leave without finishing'}).click();await f.page.waitForURL(base+'/');assert.equal(f.requests.length,1);await f.context.close();
 results.push({scenario:'leave-during-pending-request',passed:true});
 for(const width of [390,1440]){
  f=await setup(width);await f.page.clock.install();
  await f.page.locator('[data-p5-estimator] textarea').first().fill('Fictional exit-intent project');
  await f.page.clock.fastForward(25000);
  await f.page.locator('html').dispatchEvent('mouseleave',{clientY:-1,relatedTarget:null});
  if(width===1440){await f.offer.waitFor();await f.offer.getByRole('button',{name:'Continue form'}).click();}
  else assert.equal(await f.offer.isVisible(),false);
  assert.equal(f.requests.length,0);await f.context.close();
  results.push({width,scenario:'restrained-desktop-intent-no-mobile-intent',passed:true});
 }
 console.log(JSON.stringify(results));
} finally {await browser.close();await writeFile(`${output}/results-${process.env.P5_TEST_BROWSER||'chromium'}.json`,JSON.stringify(results,null,2));}
