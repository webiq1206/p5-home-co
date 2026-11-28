import {isHandyman,verifyHandymanHomeEntry,isCabinet,isRemodeling,verifyCabinetEntry,verifyRemodelingEntry,verifyRemodelingRe10Handoff} from './lib/shortBrandEntry.mjs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {verifyQuoteEntry,isConstruction,verifyConstructionEntry,verifyConstructionRe10Handoff} from './lib/quoteEntry.mjs';
import {enterEstimator} from './lib/navigationEntry.mjs';
const brand=JSON.parse(await fs.readFile('package.json','utf8')).name;
const parent=process.env.P5_PARENT==='1';const browser=await chromium.launch({
 ...(process.env.P5_TEST_CHROMIUM_PATH?{executablePath:process.env.P5_TEST_CHROMIUM_PATH}:{}),
});
const extraRoutes=[];
if(await fs.stat('components/re10/Re10Wizard.tsx').catch(()=>null))extraRoutes.push('/re-10-repairs-boise');
if(await fs.stat('components/plans/PlansWizard.tsx').catch(()=>null))extraRoutes.push('/remodel-plans-boise');
const results=[];await fs.mkdir('p5-verification',{recursive:true});
try{
 for(const width of [320,390,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  // Navigation/layout qualification never calls business APIs or third parties.
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==new URL(process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5000').origin||url.pathname.startsWith('/api/'))return route.abort('blockedbyclient');
   return route.continue();
  });
  await context.route('**/api/estimator-session',r=>r.fulfill({json:{ok:true}}));
  await context.route('**/api/meta-capi',r=>r.fulfill({json:{ok:true}}));
  for(const route of parent?['/quote','/estimate/scope']:['/estimate','/','/estimate/scope',...extraRoutes]){
   const page=await context.newPage();
   await page.goto(`${process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5000'}${route}`,{waitUntil:'load'});
   if(parent&&route==='/quote'){await verifyQuoteEntry(page,route);await page.screenshot({path:`p5-verification/navigation-${width}-quote.png`});results.push({width,route,passed:true});await page.close();continue;}
   if(isConstruction(brand)&&['/','/estimate'].includes(route)){await verifyConstructionEntry(page,route);await page.screenshot({path:`p5-verification/navigation-${width}-construction-${route==='/'?'home':'estimate'}.png`});results.push({width,route,passed:true});await page.close();continue;}
   if(isConstruction(brand)&&route==='/re-10-repairs-boise'){await verifyConstructionRe10Handoff(page);await page.screenshot({path:`p5-verification/navigation-${width}-construction-re10.png`});results.push({width,route,passed:true});await page.close();continue;}
   if(isCabinet(brand)&&['/','/estimate'].includes(route)){await verifyCabinetEntry(page,route);results.push({width,route,passed:true});await page.close();continue;}
   if(isRemodeling(brand)&&['/','/estimate'].includes(route)){await verifyRemodelingEntry(page,route);results.push({width,route,passed:true});await page.close();continue;}
   if(isRemodeling(brand)&&route==='/re-10-repairs-boise'){await verifyRemodelingRe10Handoff(page);results.push({width,route,passed:true});await page.close();continue;}
   if(isHandyman(brand)&&route==='/'){await verifyHandymanHomeEntry(page);results.push({width,route,passed:true});await page.close();continue;}
   const isHandymanRe10=isHandyman(brand)&&route==='/re-10-repairs-boise';
   const re10=page.locator('#re10-wizard');
   if(isHandymanRe10){
    await re10.getByRole('heading',{name:'How do you want to price your RE-10?',exact:true}).waitFor({state:'visible'});
    await re10.getByTestId('re10-choose-price').click();
    await re10.getByRole('heading',{name:'Tap the repairs on your RE-10',exact:true}).waitFor({state:'visible'});
    const frame=re10.locator('iframe[src]');
    await frame.waitFor({state:'visible'});
    const destination=new URL(await frame.getAttribute('src'));
    assert.equal(destination.origin,'https://p5homeco.com');
    assert.equal(destination.pathname,'/estimator/embed');
    assert.equal(destination.searchParams.get('brand'),'handyman');
    assert.equal(destination.searchParams.get('project'),'handyman');
    // Cross-origin content is blocked by the navigation test. Verify the handoff, not live pricing.
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'RE-10 guided handoff has horizontal overflow');
    await page.screenshot({path:`p5-verification/navigation-${width}-handyman-re10-guided.png`});
    await re10.getByRole('button',{name:'Back to the first step',exact:true}).click();
    await re10.getByTestId('re10-choose-send').click();
    await re10.getByRole('heading',{name:'Upload your RE-10',exact:true}).first().waitFor({state:'visible'});
   }else{
    await enterEstimator(page,{route,brand,parent});
   }
   const estimator=(isHandymanRe10?re10:page).locator('[data-p5-estimator]').first();await estimator.waitFor();
   const input=estimator.getByLabel('Tell us about your project',{exact:true});await input.waitFor().catch(async error=>{console.log('Navigation failure',width,route,await page.locator('body').innerText());await page.screenshot({path:'p5-verification/navigation-failure.png',fullPage:true});throw error;});
   assert.equal(await estimator.getByLabel('Upload project files',{exact:true}).count(),1);
   assert.equal(await estimator.getByLabel('Upload estimating instructions',{exact:true}).count(),0);
   assert.equal(await estimator.locator('[data-scope-estimate-option]').count(),0,'A separate scope workflow was reintroduced');
   await input.fill('Synthetic navigation check. '+('LongUnbrokenMaterialSpecification'.repeat(60)));
   const next=estimator.getByRole('button',{name:'Send message',exact:true});await next.scrollIntoViewIfNeeded();
   assert.ok(await next.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'Estimator action must be visible and unobstructed');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow');
   await page.screenshot({path:`p5-verification/navigation-${width}-${route==='/'?'home':route.replaceAll('/','_')}.png`});results.push({width,route,passed:true,...(isHandymanRe10?{branches:['guided-frame-handoff','document-entry']}: {})});await page.close();
  }
  await context.close();
 }
}finally{await browser.close();await fs.writeFile('p5-verification/mobile-navigation.json',JSON.stringify(results,null,2));}
