import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('p5-verification',{recursive:true});
const browser=await chromium.launch();const results=[];
const base=process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5000';
// These tests exercise the rendered browser interface. External services are
// simulated; test-p5-workflow.mts separately checks real SQL and queue behavior.
for(const width of [320,390,430,768,1024,1440,1920]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});
 await context.addInitScript(()=>{
  window.SpeechRecognition=class{start(){this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'Repair three interior doors.'}],{isFinal:true})]});this.onend?.();}stop(){this.onend?.();}};
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let saved=null;let failUpload=true;let submissionCount=0;
 await context.route('**/api/p5-estimator/**',async route=>{
  const request=route.request();const endpoint=new URL(request.url()).pathname.split('/').at(-1);
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(endpoint==='draft'){
   if(request.method()==='GET')return send({draft:saved});
   const input=request.postDataJSON();saved={...input,revision:(saved?.revision||0)+1,status:'draft',uploads:saved?.uploads||[]};return send({draft:saved});
  }
  if(endpoint==='scope'){
   if(failUpload){failUpload=false;return send({error:'Synthetic upload interruption. Your saved work is intact.'},503);}
   const service=saved.answers.service||'handyman';
   const extraction={summary:'Three doors need repair.',facts:[{field:'taskList',value:'Repair three interior doors',confidence:.98,source:'scope.txt',evidence:'Three doors'}],conflicts:[],missingInformation:[],reviewNotes:[]};
   saved={...saved,revision:saved.revision+1,uploads:[{id:'test-upload',name:'scope.txt',size:30,type:'text/plain',sha256:'test',status:'stored'}],extraction};return send({draft:saved,analysis:{extraction}});
  }
  if(endpoint==='submit'){
   const duplicate=saved?.status==='submitted';if(!duplicate)submissionCount++;
   saved={...saved,status:'submitted'};
   return send({accepted:!duplicate,duplicate,result:{status:'review-required',range:null,summary:'Repair three interior doors.',includedCategories:[],allowances:[],assumptions:[],exclusions:[],factors:[],nextStep:'Schedule a scope review.',message:'A specialist will confirm the scope and current costs.',disclaimer:'This is not a bid, quote, offer or guaranteed price.'},delivery:[{channel:'customer',status:'retry'},{channel:'admin',status:'sent'},{channel:'crm',status:'needs-review'}]});
  }
  return send({error:'Unknown test endpoint'},404);
 });
 try{
  await page.goto(base+'/estimate/p5-preview',{waitUntil:'networkidle'});
  const estimator=page.locator('[data-p5-estimator]');await estimator.getByLabel('Describe your project',{exact:true}).waitFor();
  await estimator.getByRole('button',{name:'Describe it by voice',exact:true}).click();
  assert.match(await page.locator('#p5-scope').inputValue(),/three interior doors/);
  await page.locator('#p5-scope').fill('Repair three interior doors. '+('A-long-project-note-with-no-spaces'.repeat(100)));
  await page.locator('#p5-files').setInputFiles({name:'scope.txt',mimeType:'text/plain',buffer:Buffer.from('Repair three interior doors.')});
  await estimator.getByRole('button',{name:'Review my scope',exact:true}).click();
  await estimator.getByRole('alert').filter({hasText:'Synthetic upload interruption'}).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await estimator.getByRole('button',{name:'Remove scope.txt'}).waitFor();
  assert.match(await page.locator('#p5-scope').inputValue(),/long-project-note/);
  await estimator.screenshot({path:`p5-verification/${width}-scope.png`});
  await estimator.getByRole('button',{name:'Review my scope',exact:true}).click();
  await estimator.getByRole('heading',{name:'Review your project details',exact:true}).waitFor();
  const service=estimator.getByLabel('Project type',{exact:true});
  if(!await service.inputValue()){const value=await service.locator('option').evaluateAll(options=>options.map(o=>o.value).find(Boolean));await service.selectOption(value);}
  const location=estimator.getByLabel('City, ZIP code, county or general location',{exact:true});
  await location.fill('');
  const task=estimator.getByLabel('Tasks and quantities',{exact:true});assert.match(await task.inputValue(),/three interior doors/);
  await task.fill('Repair three interior doors. '+('Long-unbroken-material-specification'.repeat(90)));
  await task.focus();await page.setViewportSize({width,height:500});
  assert.match(await task.inputValue(),/three interior doors/);await page.setViewportSize({width,height:900});
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,width:innerWidth}));assert.ok(overflow.page<=overflow.width+1,JSON.stringify(overflow));
  await estimator.screenshot({path:`p5-verification/${width}-review.png`});
  await estimator.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('#p5-contact-name').fill('Synthetic Test');await page.locator('#p5-contact-email').fill('customer@example.invalid');
  await estimator.getByRole('button',{name:'Back and edit',exact:true}).click();assert.match(await task.inputValue(),/Long-unbroken/);
  await estimator.getByRole('button',{name:'Continue',exact:true}).click();assert.equal(await page.locator('#p5-contact-email').inputValue(),'customer@example.invalid');
  await estimator.getByRole('checkbox').check();await estimator.getByRole('button',{name:'Get my project summary',exact:true}).click();
  await estimator.getByText('Schedule a scope review.',{exact:true}).waitFor();
  await page.reload({waitUntil:'networkidle'});await estimator.getByText('Schedule a scope review.',{exact:true}).waitFor();
  assert.equal(submissionCount,1);assert.equal(errors.length,0,errors.join('; '));
  await estimator.screenshot({path:`p5-verification/${width}-result.png`});
  results.push({width,passed:true,checks:['speech API simulation','typed scope','upload failure and IndexedDB recovery','extraction review','optional location','long mobile content','viewport resizing','back navigation','contact preservation','submission restoration','single submission','no page errors']});
 }catch(error){results.push({width,passed:false,error:String(error),pageErrors:errors});await page.screenshot({path:`p5-verification/${width}-failure.png`,fullPage:true}).catch(()=>{});}
 await context.close();
}
await browser.close();await writeFile('p5-verification/browser-results.json',JSON.stringify({externalServices:'simulated',results},null,2));console.log(JSON.stringify(results));
if(results.some(result=>!result.passed))process.exitCode=1;
