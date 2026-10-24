import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base='http://127.0.0.1:4188', output='outputs/contact-first';
await mkdir(output,{recursive:true});
const engine=process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium;
const browser=await engine.launch(), results=[];
try {
  for(const [width,height] of [[1180,757],[390,844],[320,568],[844,390]]) {
    const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const requests=[], delivered=new Set();
    await context.route('**/api/recovery/callback',async route=>{
      const body=route.request().postData();requests.push(body);
      delivered.add(JSON.parse(body).sessionId);
      if(requests.length===1)return route.abort('failed'); // A committed request with a lost response.
      return route.fulfill({json:{ok:true,notified:true}});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await page.goto(base+'/?sticky=1');
    const shortcut=page.getByRole('button',{name:'Just contact me',exact:true});
    await shortcut.waitFor();
    const rect=await shortcut.boundingBox();
    assert(rect.y>=64&&rect.y+rect.height<=height,'Contact shortcut is visible below site navigation');
    await shortcut.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Prefer to talk about your project?',exact:true});
    const phone=dialog.getByRole('textbox',{name:'Your phone number',exact:true});
    await phone.waitFor();
    assert(await phone.evaluate(el=>el===document.activeElement),'Explicit contact request focuses phone');
    assert.equal(await dialog.getByRole('textbox').count(),1,'Only phone is required');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    assert(await shortcut.evaluate(el=>el===document.activeElement),'Dismissal restores shortcut focus');
    const text=page.getByRole('textbox',{name:'Tell us about your project',exact:true});
    await text.fill('Synthetic callback test: preserve this repair list.');
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')));
    await shortcut.click(); // Still opens after the one-time automatic offer has been seen.
    await phone.waitFor();
    await phone.fill('123');
    await dialog.getByRole('button',{name:'Request a callback',exact:true}).click();
    assert.equal(requests.length,0,'Invalid phone never submits');
    assert.equal(await phone.getAttribute('aria-invalid'),'true');
    await phone.fill('(208) 555-0100');
    await dialog.getByRole('button',{name:'Request a callback',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'We could not confirm'}).waitFor();
    await dialog.getByRole('button',{name:'Retry callback request',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'Your callback request is saved'}).waitFor();
    assert.equal(requests.length,2);assert.equal(requests[0],requests[1],'Uncertain retry reuses the exact request');
    assert.equal(delivered.size,1,'Retry represents one callback request');
    const sent=JSON.parse(requests[0]);
    assert.equal(sent.phone,'2085550100');assert.equal(sent.callbackConsent,true);
    assert(!JSON.stringify(sent).includes(before.text),'Callback does not transmit project prose');
    await dialog.getByRole('button',{name:'Continue form',exact:true}).click();
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')));
    assert.equal(after.id,before.id);assert.equal(after.text,before.text,'Callback retains the existing project');
    await page.goto(base+'/?embedded=1&sticky=1');
    await page.getByRole('button',{name:'Just contact me',exact:true}).click();
    await phone.waitFor(); // Explicit entry works even when the embedded estimator is collapsed.
    await page.keyboard.press('Escape');
    const state=await (await context.request.get(base+'/__state')).json();
    assert.equal(state.pricingCalls,0);assert.equal(state.scopeCalls,0);assert.equal(state.submissions,0);
    await page.screenshot({path:`${output}/${process.env.P5_TEST_BROWSER||'chromium'}-${width}x${height}.png`});
    results.push({width,height,blankEntry:true,repeatEntry:true,embeddedEntry:true,draftPreserved:true,identicalRetry:true,pricingCalls:0});
    await context.close();
  }
  await writeFile(`${output}/results-${process.env.P5_TEST_BROWSER||'chromium'}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
} finally {await browser.close();}
