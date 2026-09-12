import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const parent=process.env.P5_PARENT==='1';const browser=await chromium.launch();
const extraRoutes=[];
if(await fs.stat('components/re10/Re10Wizard.tsx').catch(()=>null))extraRoutes.push('/re-10-repairs-boise');
if(await fs.stat('components/plans/PlansWizard.tsx').catch(()=>null))extraRoutes.push('/remodel-plans-boise');
const results=[];await fs.mkdir('p5-verification',{recursive:true});
try{
 for(const width of [320,390,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  await context.route('**/api/estimator-session',r=>r.fulfill({json:{ok:true}}));
  await context.route('**/api/meta-capi',r=>r.fulfill({json:{ok:true}}));
  const page=await context.newPage();
  for(const route of parent?['/quote','/estimate/scope']:['/estimate','/','/estimate/scope',...extraRoutes]){
   await page.goto(`http://127.0.0.1:5000${route}`,{waitUntil:'load'});
   if(route==='/')await page.locator('#calculator').first().scrollIntoViewIfNeeded();
   const estimator=page.locator('[data-p5-estimator]').first();await estimator.waitFor();
   const input=estimator.getByLabel('Tell us about your project',{exact:true});await input.waitFor().catch(async error=>{console.log('Navigation failure',width,route,await page.locator('body').innerText());await page.screenshot({path:'p5-verification/navigation-failure.png',fullPage:true});throw error;});
   assert.equal(await estimator.getByLabel('Upload project files',{exact:true}).count(),1);
   assert.equal(await estimator.getByLabel('Upload estimating instructions',{exact:true}).count(),0);
   assert.equal(await estimator.locator('[data-scope-estimate-option]').count(),0,'A separate scope workflow was reintroduced');
   await input.fill('Synthetic navigation check. '+('LongUnbrokenMaterialSpecification'.repeat(60)));
   const next=estimator.getByRole('button',{name:'Continue',exact:true});await next.scrollIntoViewIfNeeded();
   assert.ok(await next.evaluate(el=>{for(let p=el;p&&p!==document.body;p=p.parentElement)if(['fixed','sticky'].includes(getComputedStyle(p).position))return false;return true;}),'Estimator action is pinned over form content');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
   await page.screenshot({path:`p5-verification/navigation-${width}-${route==='/'?'home':route.replaceAll('/','_')}.png`});results.push({width,route,passed:true});
  }
  await context.close();
 }
}finally{await browser.close();await fs.writeFile('p5-verification/mobile-navigation.json',JSON.stringify(results,null,2));}
