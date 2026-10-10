import {chromium,webkit} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {applyIntakeIntent} from '../lib/p5/intakeIntent.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
import {routeIntake,intakeSite} from '../lib/p5/intakePolicy.ts';
const base=process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5137';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local synthetic browser test only');
const browser=await (process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium).launch(),results=[];
const output='p5-verification/intent';await mkdir(output,{recursive:true});
try{
 for(const [text,service] of [['I want to build a modern farmhouse 3200 ft.² and I currently owned a lot','new-construction'],['Help with my house','']]){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(15000);let saved=null;const blocked=[];
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==new URL(base).origin||url.pathname.startsWith('/api/')){blocked.push(url.pathname);return route.abort();}return route.continue();});
  await context.route('**/api/p5-estimator/draft',async route=>{
   const req=route.request();if(req.method()!=='GET'){const input=req.postDataJSON(),intent=applyIntakeIntent(input.text,input.answers,saved?.extraction||null,input.wizard?.resolutions);saved={...input,...intent,id:req.headers()['x-p5-draft-id'],revision:(saved?.revision||0)+1,status:'draft',uploads:[]};}
   await route.fulfill({json:{draft:saved}});
  });
  await page.goto(base+'/estimate');await page.getByText('Loading your project...', {exact:true}).waitFor({state:'hidden'});
  await page.locator('[data-p5-estimator] textarea').first().fill(text);
  await page.getByRole('button',{name:'Review with the details I have',exact:true}).click();
  await page.getByRole('heading',{name:'Review your project',exact:true}).waitFor();
  await writeFile(`${output}/review-${service||'unknown'}.html`,await page.content());
  assert.equal(await page.getByRole('combobox',{name:/^What best describes the whole project/}).inputValue(),service);
  assert.equal(await page.getByRole('textbox',{name:/^Your project description/}).inputValue(),text);
  const routing=routeIntake(intakeSite(brand.id)||'p5',service);
  await page.getByRole('button',{name:'Continue to contact details',exact:true}).waitFor();
  assert.equal(blocked.filter(p=>/scope|intake|callback/.test(p)).length,0);
  await page.screenshot({path:`${output}/${service||'unknown'}-${process.env.P5_TEST_BROWSER||'chromium'}.png`});
  results.push({service,site:brand.id,cta:routing.handoff||'current-site',passed:true});await context.close();
 }
 await writeFile(`${output}/results-${process.env.P5_TEST_BROWSER||'chromium'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
