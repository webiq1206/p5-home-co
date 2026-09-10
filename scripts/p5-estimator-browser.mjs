import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {scopeQuestions,reconcileScope} from '../lib/p5/adaptive.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
const base=process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5000';
await mkdir('p5-verification',{recursive:true});
const browser=await chromium.launch();const results=[];
const service=brand.services.includes('bathroom')?'bathroom':brand.services.includes('handyman')?'handyman':brand.services.includes('cabinet-install')?'cabinet-install':'new-construction';
const fullAnswers={service,taskList:'Complete the specified work. Repair three interior doors.',...(service.startsWith('cabinet-')?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0'}:service==='handyman'?{}:{sqft:'80',materials:'Porcelain tile',demolition:'Remove old finishes'})};
const result={status:'preliminary',range:{low:1000,high:1800},categoryRanges:[{category:'Carpentry',low:1000,high:1800}],lineItems:[{id:'repair',category:'Carpentry',description:'Repair three interior doors',quantity:3,unit:'EA',low:1000,high:1800,unitLow:1000/3,unitHigh:600}],summary:'Synthetic fixture scope.',includedCategories:[],allowances:[],assumptions:[],exclusions:[],factors:[],nextStep:'Schedule a scope review.',message:'Synthetic planning range.',disclaimer:'This is not a bid, quote, offer or guaranteed price.'};
async function mock(context,{interruptions=false,scenario='full'}={}){
 const state={saved:null,nullReceipt:interruptions,failUpload:interruptions,submissions:0,postSubmissionSaves:0,scopeCalls:0};
 await context.addInitScript(()=>{window.SpeechRecognition=class{start(){this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'Repair three interior doors.'}],{isFinal:true})]});this.onend?.();}stop(){this.onend?.();}};});
 await context.route('**/api/p5-estimator/**',async route=>{
  const request=route.request();const endpoint=new URL(request.url()).pathname.split('/').at(-1);
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(endpoint==='draft'){
   if(request.method()==='GET')return send({draft:state.saved});
   if(state.nullReceipt){state.nullReceipt=false;return send({draft:null});}
   if(state.saved?.status==='submitted'){state.postSubmissionSaves++;return send({error:'Already submitted'},409);}
   const input=request.postDataJSON();const old=state.saved;state.saved={...old,...input,revision:(old?.revision||0)+1,status:'draft',extraction:old?.extraction||null,uploads:old?.uploads||[]};
   const conflicts=state.saved.extraction?reconcileScope(state.saved.answers,state.saved.extraction,state.saved.wizard?.resolutions).conflicts:[];
   return send({draft:state.saved,conflicts,pricedFields:[],questions:scopeQuestions(state.saved.answers,state.saved.extraction,conflicts,state.saved.wizard?.skipped)});
  }
  if(endpoint==='scope'){
   state.scopeCalls++;if(state.failUpload){state.failUpload=false;return send({error:'Synthetic upload interruption. Your saved work is intact.'},503);}
   const desired=scenario==='manual'?{service,taskList:state.saved.answers.taskList||'Repair three interior doors',...(service.startsWith('cabinet-')?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0'}:{})}:fullAnswers;
   const extraction={summary:'Synthetic project',facts:Object.entries(desired).map(([field,value])=>({field,value,confidence:.98,source:'scope.txt',evidence:value})),conflicts:scenario==='conflict'?[{field:'taskList',values:['Repair three doors','Replace three doors'],explanation:'The documents disagree. Which work should be included?'}]:[],missingInformation:[],reviewNotes:[],clarifications:[]};
   const merged=reconcileScope(state.saved.answers,extraction,state.saved.wizard?.resolutions||{});
   state.saved={...state.saved,revision:state.saved.revision+1,answers:merged.answers,uploads:scenario==='manual'?[]:[{id:'test-upload',name:'scope.txt',size:30,type:'text/plain',sha256:'test',status:'stored'}],extraction};
   return send({draft:state.saved,analysis:{extraction},conflicts:merged.conflicts,pricedFields:[]});
  }
  if(endpoint==='submit'){
   const duplicate=state.saved?.status==='submitted';if(!duplicate)state.submissions++;
   state.saved={...state.saved,status:'submitted'};return send({accepted:!duplicate,duplicate,result,delivery:[{channel:'customer',status:'retry'},{channel:'admin',status:'sent'},{channel:'crm',status:'needs-review'}]});
  }
  return send({error:'Unknown test endpoint'},404);
 });return state;
}
async function overflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');}
async function capture(page,name){await page.evaluate(async()=>{await document.fonts.ready;document.documentElement.style.scrollBehavior='auto';if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:`p5-verification/${name}.png`,fullPage:true,animations:'disabled'});}
for(const width of [320,390,430,768,1024,1440,1920]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});const state=await mock(context,{interruptions:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/estimate/p5-preview');const estimator=page.locator('[data-p5-estimator]');const description=estimator.getByLabel('Tell us about your project',{exact:true});await description.waitFor();
  await estimator.getByRole('button',{name:'Use microphone',exact:true}).click();assert.match(await description.inputValue(),/three interior doors/);
  await description.fill('Repair three interior doors. '+('LongUnbrokenProjectSpecification'.repeat(90)));
  await estimator.locator('input[type=file]').setInputFiles({name:'scope.txt',mimeType:'text/plain',buffer:Buffer.from('Repair three interior doors.')});
  await estimator.getByRole('button',{name:'Continue',exact:true}).click();await estimator.getByRole('alert').filter({hasText:'Your project save was not confirmed'}).waitFor();
  await estimator.getByRole('button',{name:'Continue',exact:true}).click();await estimator.getByRole('alert').filter({hasText:'Synthetic upload interruption'}).waitFor();
  await page.reload();await estimator.getByRole('button',{name:'Remove scope.txt'}).waitFor();assert.match(await description.inputValue(),/LongUnbrokenProjectSpecification/);await overflow(page);await capture(page,`${width}-scope`);
  await estimator.getByRole('button',{name:'Continue',exact:true}).click();await estimator.getByRole('heading',{name:'Your project is ready to review',exact:true}).waitFor();assert.equal(await estimator.getByRole('region',{name:'Project question'}).count(),0,'Known facts were asked again');
  await estimator.getByLabel('Your name',{exact:true}).fill('Synthetic Test');await estimator.getByLabel('Email',{exact:true}).fill('customer@example.invalid');
  await estimator.getByRole('button',{name:'Back to my project',exact:true}).click();await estimator.getByText('Uploaded',{exact:true}).waitFor();assert.match(await description.inputValue(),/LongUnbroken/);
  const calls=state.scopeCalls;await estimator.getByRole('button',{name:'Continue',exact:true}).click();await estimator.getByLabel('Email',{exact:true}).waitFor();assert.equal(await estimator.getByLabel('Email',{exact:true}).inputValue(),'customer@example.invalid');assert.equal(state.scopeCalls,calls,'Going back unnecessarily repeated analysis');
  await estimator.getByText(/project details saved/).click();await estimator.getByRole('button',{name:'Edit Tasks and quantities',exact:true}).click();const tasks=estimator.getByLabel('Tasks and quantities',{exact:true});await tasks.fill(fullAnswers.taskList+' '+('LongMaterialSpecification'.repeat(80)));await page.setViewportSize({width,height:500});await overflow(page);await page.setViewportSize({width,height:900});await estimator.getByRole('button',{name:'Done',exact:true}).click();
  // A manual text edit is analyzed once before an estimate can be confirmed.
  await estimator.getByRole('checkbox').check();await Promise.all([page.waitForResponse('**/api/p5-estimator/scope'),estimator.getByRole('button',{name:'Get my estimate',exact:true}).click()]);await page.waitForFunction(()=>!document.querySelector('[data-p5-estimator][aria-busy=true]'));assert.ok(state.scopeCalls>calls);
  await overflow(page);await capture(page,`${width}-review`);await estimator.getByRole('checkbox').check();await estimator.getByRole('button',{name:'Get my estimate',exact:true}).click();await estimator.getByText('Schedule a scope review.',{exact:true}).waitFor();
  await estimator.getByText('View items and unit pricing',{exact:true}).click();await estimator.getByText('Repair three interior doors',{exact:true}).waitFor();await overflow(page);
  assert.ok(!/overheadRecovery|operatingProfit|unitCost/.test(await estimator.innerText()));await capture(page,`${width}-result`);
  await page.waitForTimeout(2100);assert.equal(state.postSubmissionSaves,0);await page.reload();await estimator.getByText('Schedule a scope review.',{exact:true}).waitFor();assert.equal(state.submissions,1);assert.deepEqual(errors,[]);
  results.push({width,passed:true,checks:['null receipt preserves files','speech API simulation','typed and uploaded mixed input','failed upload and reload recovery','known facts skipped','back and contact preservation','manual text reanalysis','line-item privacy','single submission','result restoration','overflow']});
 }catch(error){results.push({width,passed:false,error:String(error),pageErrors:errors});await capture(page,`${width}-failure`).catch(()=>{});}await context.close();
}
// Project-specific missing questions and a single conflicting fact.
for(const scenario of ['manual','conflict']){
 const context=await browser.newContext({viewport:{width:390,height:844}});await mock(context,{scenario});const page=await context.newPage();
 try{
  await page.goto(base+'/estimate/p5-preview');const est=page.locator('[data-p5-estimator]');
  if(scenario==='conflict')await est.getByLabel('Tell us about your project',{exact:true}).fill('Two documents disagree about door repairs.');
  await est.getByRole('button',{name:'Continue',exact:true}).click();
  if(scenario==='manual'){
   await est.getByLabel('Project type',{exact:true}).selectOption(service);await est.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-p5-estimator][aria-busy=true]'));
   // Answer only this project's material questions; unknown numeric details remain explicit.
   for(let i=0;i<8&&await est.getByRole('region',{name:'Project question'}).count();i++){
    const q=est.getByRole('region',{name:'Project question'});const text=q.locator('textarea');
    if(await text.count()){await text.fill('Repair three interior doors');await q.getByRole('button',{name:'Continue',exact:true}).click();}
    else if(await q.getByRole('button',{name:'Not sure yet',exact:true}).count())await q.getByRole('button',{name:'Not sure yet',exact:true}).click();
    else throw new Error('Unexpected required section');
    await page.waitForFunction(()=>!document.querySelector('[data-p5-estimator][aria-busy=true]'));
   }
  }else{
   await est.getByText('The documents disagree. Which work should be included?',{exact:true}).waitFor();await est.getByRole('button',{name:'Replace three doors',exact:true}).click();await est.getByRole('button',{name:'Continue',exact:true}).click();
  }
  await est.getByRole('heading',{name:'Your project is ready to review',exact:true}).waitFor();await overflow(page);results.push({scenario,passed:true});
 }catch(error){results.push({scenario,passed:false,error:String(error)});await capture(page,`${scenario}-failure`).catch(()=>{});}await context.close();
}
const paths=brand.id==='p5'?['/estimate','/estimate/scope','/quote',...['kitchen-remodel','bathroom-remodel','home-addition','adu','custom-home','custom-cabinets','handyman'].map(s=>'/quote/'+s)]:['/estimate','/estimate/scope','/#calculator',...(brand.services.includes('re10')?['/re-10-repairs-boise']:[]),...(brand.id==='remodeling'?['/remodel-plans-boise']:[])];
for(const width of [390,768,1440])for(const path of paths){
 const context=await browser.newContext({viewport:{width,height:900}});await mock(context);const page=await context.newPage();
 try{const response=await page.goto(base+path);assert.ok(response?.ok(),`HTTP ${response?.status()}`);const est=page.locator('[data-p5-estimator]').first();if(path.includes('#calculator')){await page.locator('#calculator').first().scrollIntoViewIfNeeded();}await est.getByLabel('Tell us about your project',{exact:true}).waitFor();await overflow(page);assert.ok(!/Continue manually|Upload Scope|Manual Estimate/.test(await est.innerText()));results.push({width,path,passed:true});}
 catch(error){results.push({width,path,passed:false,error:String(error)});await capture(page,`route-${width}-${path.replace(/[^a-z0-9]/gi,'_')}`).catch(()=>{});}await context.close();
}
await browser.close();await writeFile('p5-verification/browser-results.json',JSON.stringify({brand:brand.id,externalServices:'simulated',physicalMicrophone:'not tested',results},null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.passed))process.exitCode=1;
