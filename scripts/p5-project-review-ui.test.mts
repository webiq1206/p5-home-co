import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const base=process.env.P5_QA_UI_ORIGIN||'http://127.0.0.1:4173',output=process.env.P5_QA_OUTPUT||'/tmp/p5-project-review-ui';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('These mocked interaction tests are restricted to a local server.');
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
let browser:Browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.P5_QA_BROWSER||undefined,args:['--no-sandbox']});await mkdir(output,{recursive:true});});
after(async()=>{await browser?.close();});
function snapshot(current=true,revision=1){return {draftRevision:revision,current,changes:[],saved:{draftRevision:1,result:{status:'estimated',customer:{range:{low:123,high:456}}},record:{recordHash:'c'.repeat(64),service:'handyman',summary:'Controlled interface fixture. No real estimate.',quantities:[],requirements:[],sources:[],questions:[{id:'count',prompt:'How many levers should we replace?',reason:'The count sets replacement labor.',priority:'blocking',options:['2','3']}]}}};}
async function pageFor(handler:(body:any)=>Promise<{status?:number;body?:unknown;abort?:boolean}>,initial=()=>snapshot()){
 const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage();
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).origin!==base)return route.abort();
  if(new URL(route.request().url()).pathname!=='/api/admin/p5-estimators/project-record')return route.continue();
  if(route.request().method()==='GET')return route.fulfill({status:200,json:initial()});
  const result=await handler(route.request().postDataJSON());if(result.abort)return route.abort('failed');
  return route.fulfill({status:result.status||200,json:result.body});
 });
 await page.goto(base+'/admin/p5-estimators/project-review');
 return {context,page};
}
async function load(page:Page,id=first){await page.getByLabel('Saved project reference').fill(id);await page.getByRole('button',{name:'Load project',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved project loaded.');}
test('stale results hide prior prices and disable generation on desktop and mobile',async()=>{
 const {context,page}=await pageFor(async()=>({body:{}}),()=>snapshot(false));
 try{await load(page);await expect(page.getByRole('heading',{name:'Customer estimate preview'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Generate estimate / resume'})).toBeDisabled();await page.screenshot({path:output+'/stale-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(page.getByRole('button',{name:'Review current scope / resume'})).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await page.screenshot({path:output+'/stale-mobile.png',fullPage:true});}finally{await context.close();}
});
test('lost save acknowledgement retries the exact request and hides obsolete prices after confirmation',async()=>{
 const writes:any[]=[];let state=snapshot();
 const {context,page}=await pageFor(async body=>{writes.push(body);state=snapshot(false,2);return writes.length===1?{abort:true}:{body:{revision:2,reused:true}};},()=>state);
 try{await load(page);await page.getByLabel('How many levers should we replace?').fill('3');await page.getByRole('button',{name:'Save answer',exact:true}).click();await expect(page.getByRole('button',{name:'Retry the same save'})).toBeVisible();await page.getByRole('button',{name:'Retry the same save'}).click();await expect(page.getByRole('status')).toContainText('Response saved');assert.equal(writes.length,2);assert.deepEqual(writes[1],writes[0]);assert.equal(writes[0].response,'3');await expect(page.getByRole('button',{name:'Generate estimate / resume'})).toBeDisabled();await expect(page.getByRole('heading',{name:'Customer estimate preview'})).toHaveCount(0);}finally{await context.close();}
});
test('a definitive stale-revision rejection permits reload without trapping the user in retry',async()=>{
 const {context,page}=await pageFor(async()=>({status:409,body:{error:'The project changed. Reload its current questions.'}}));
 try{await load(page);await page.getByLabel('How many levers should we replace?').fill('4');await page.getByRole('button',{name:'Save answer',exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText('The project changed');await expect(page.getByRole('button',{name:'Retry the same save'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Reload saved result'})).toBeEnabled();await expect(page.getByRole('button',{name:'Generate estimate / resume'})).toBeDisabled();}finally{await context.close();}
});
test('switching projects clears unsaved answers even when question IDs overlap',async()=>{
 const {context,page}=await pageFor(async()=>({body:{}}));
 try{await load(page);await page.getByLabel('How many levers should we replace?').fill('Previous project answer');await load(page,second);await expect(page.getByLabel('How many levers should we replace?')).toHaveValue('');}finally{await context.close();}
});
test('the actual local data endpoint requires administrator authentication',async()=>{
 const response=await fetch(base+'/api/admin/p5-estimators/project-record?id='+first);assert.equal(response.status,403);assert.match((await response.json()).error,/Administrator sign-in/);
});
