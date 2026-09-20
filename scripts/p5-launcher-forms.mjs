import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch(); const results=[];
await fs.mkdir('p5-verification',{recursive:true});
for(const width of [320,390,430,600,768,1024,1366,1440,1920]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});
 await context.route('**/api/assistant/chat',r=>r.fulfill({contentType:'application/json',body:'{"available":true}'}));
 const page=await context.newPage(); page.setDefaultTimeout(10000);
 try{
  if(width<1024){
   await page.goto('http://127.0.0.1:5000/',{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(700);
   if(await page.locator('[data-assistant-launcher]').isVisible())throw new Error('Assistant launcher overlaps mobile hero');
  }
  await page.goto('http://127.0.0.1:5000/contact',{waitUntil:'load'});
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  // An actual form interaction confirms hydration without assuming a chat availability API.
  const addressInfo=page.getByTestId('button-address-info').filter({visible:true}).first();
  await addressInfo.click();
  await page.locator('#address-info').waitFor({state:'visible'});
  await addressInfo.click();
  await page.locator('#address-info').waitFor({state:'hidden'});
  await page.waitForTimeout(700);
  const launcher=page.locator('[data-testid="button-assistant-open"],[data-testid="assistant-launcher"]');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await launcher.waitFor({state:'visible'});
  await launcher.click();
  const dialog=page.getByRole('dialog').filter({visible:true}).first();
  await dialog.waitFor();
  const close=dialog.getByRole('button',{name:/close/i}).first();
  const b=await close.boundingBox();if(!b||b.width<44||b.height<44)throw new Error('Chat close target smaller than 44px');
  await close.click();
  await page.getByTestId('input-name').filter({visible:true}).first().scrollIntoViewIfNeeded();await page.waitForTimeout(250);
  if(await launcher.isVisible())throw new Error('Assistant launcher overlaps visible form');
  await page.screenshot({path:'p5-verification/'+width+'-form-without-chat.jpg'});
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
  await launcher.waitFor({state:'visible'});
  results.push({width,ok:true,checks:['launcher returns below form','chat opens','44px close target','launcher hidden near form']});
 }catch(e){results.push({width,ok:false,error:String(e)});await page.screenshot({path:'p5-verification/'+width+'-launcher-failure.jpg'}).catch(()=>{});}
 await context.close();
}
await browser.close();await fs.writeFile('p5-verification/launcher-results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results));if(results.some(r=>!r.ok))process.exitCode=1;
