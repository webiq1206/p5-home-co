import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('p5-verification',{recursive:true});const browser=await chromium.launch();const results=[];
for(const width of [320,390,430,768,1024,1440,1920]){
 const page=await browser.newPage({viewport:{width,height:900}});const r={kind:'hub',width,passed:false};
 try{await page.goto('http://127.0.0.1:5000/blog/category/treasure-valley-locations');await expect(page).toHaveURL(/\/areas$/);
 await expect(page.locator('body')).not.toContainText('More articles in this topic are publishing soon');
 await expect(page.locator('h1')).toBeVisible();await page.screenshot({path:'p5-verification/hub-'+width+'.jpg',fullPage:true});await page.goto('http://127.0.0.1:5000/p5-audit-fixture');
 const points=page.locator('ul.ed-matrix');await points.scrollIntoViewIfNeeded();await page.waitForTimeout(850);
 const firstTwo=await points.locator(':scope > li').evaluateAll(items=>items.slice(0,2).map(i=>i.getBoundingClientRect().top));if(width>=561)expect(Math.abs(firstTwo[0]-firstTwo[1])).toBeLessThan(1);
 const rect=await points.boundingBox();const last=await points.locator(':scope > li').last().boundingBox();
 if(width>=561&&width<=1100)expect(Math.abs(last.width-(rect.width-1))).toBeLessThan(2);
 await points.screenshot({path:'p5-verification/estimate-points-'+width+'.jpg'});r.passed=true;
 }catch(e){r.error=e.message}results.push(r);await page.close();
}
for(const authenticated of [false,true]){
 const context=await browser.newContext({viewport:{width:390,height:900}});if(authenticated)await context.addCookies([{name:'brc_auth',value:'test',domain:'127.0.0.1',path:'/'}]);
 const page=await context.newPage();let notifications=0;const r={kind:'notifications',authenticated,passed:false};
 await page.route('**/api/auth/user',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(authenticated?{id:'audit-user',role:'admin'}:null)}));
 await page.route('**/api/notifications',route=>{notifications++;return route.fulfill({status:200,contentType:'application/json',body:'[]'})});
 try{await page.goto('http://127.0.0.1:5000/p5-audit-fixture');await expect(page.locator('#notifications-fixture')).toBeAttached();
 if(authenticated){await expect.poll(()=>notifications).toBeGreaterThan(0);await expect(page.locator('#notifications-fixture button')).toBeVisible()}
 else{await page.waitForTimeout(600);expect(notifications).toBe(0);await expect(page.locator('#notifications-fixture button')).toHaveCount(0)}
 r.passed=true;
 }catch(e){r.error=e.message}results.push(r);await context.close();
}
await browser.close();await writeFile('p5-verification/hub-notification-results.json',JSON.stringify(results));if(results.some(r=>!r.passed))process.exitCode=1;
