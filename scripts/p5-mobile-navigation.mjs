import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const parent=process.env.P5_PARENT==='1';
const browser=await chromium.launch();
const results=[];await fs.mkdir('p5-verification',{recursive:true});
try {
 for(const width of [320,390,768,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  const page=await context.newPage();
  await context.route('**/api/estimator-session',r=>r.fulfill({json:{ok:true}}));
  await context.route('**/api/meta-capi',r=>r.fulfill({json:{ok:true}}));
  for(const route of parent?['/quote']:['/estimate','/']){
   await page.goto(`http://127.0.0.1:5000${route}`,{waitUntil:'networkidle'});
   const option=page.locator('[data-scope-estimate-option]').first();
   await option.waitFor();await option.scrollIntoViewIfNeeded();
   assert.equal(await option.locator('a').getAttribute('href'),'/estimate/scope');
   if(width<1024&&!parent){
    const states=await page.locator('[data-testid="wizard-action-bar"], [data-wizard-action-bar], [data-testid="wizard-sticky-nav"], [data-testid="wizard-mobile-bar"], [data-testid="app-frame-footer"]').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>({position:getComputedStyle(e).position,transform:getComputedStyle(e).transform})));
    assert.ok(states.length,'Expected estimator navigation');
    assert.ok(states.every(s=>!['sticky','fixed'].includes(s.position)&&s.transform==='none'),JSON.stringify(states));
    // A long step must move the footer with its scroll container, not leave it pinned.
    const frame=page.locator('[data-testid="estimate-app-frame"], [data-testid="guided-flow-fit"]').first();
    if(await frame.count()){
     const motion=await frame.evaluate(el=>{
      const footer=el.querySelector('[data-testid="app-frame-footer"], [data-testid="wizard-mobile-bar"]');
      const body=el.querySelector('[data-testid="app-frame-body"], [data-guided-step-body]');
      if(!footer||!body)return null;
      const spacer=document.createElement('div');spacer.style.height='1400px';spacer.style.flexShrink='0';body.append(spacer);
      el.scrollTop=0;const before=footer.getBoundingClientRect().top;
      el.scrollTop=300;const moved=el.scrollTop;const after=footer.getBoundingClientRect().top;
      spacer.remove();el.scrollTop=0;
      return {before,after,moved};
     });
     assert.ok(motion&&motion.moved>=290&&Math.abs(motion.before-motion.after-motion.moved)<3,JSON.stringify(motion));
    }
   }
   await option.scrollIntoViewIfNeeded();
   await page.screenshot({path:`p5-verification/navigation-${width}-${route==='/'?'home':'estimate'}.png`});
   await option.locator('a').click();await page.waitForURL('**/estimate/scope');
   await page.locator('#p5-files').waitFor();
   assert.ok(await page.locator('textarea').count());
   results.push({width,route,passed:true});
  }
  await context.close();
 }
}finally{await browser.close();await fs.writeFile('p5-verification/mobile-navigation.json',JSON.stringify(results,null,2));}
