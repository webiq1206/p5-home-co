import {chromium,webkit} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import assert from 'node:assert/strict';
import {scopeQuestions,reconcileScope} from '../lib/p5/adaptive.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';
const base=process.env.P5_TEST_BASE_URL||'http://127.0.0.1:5000';
const output=process.env.P5_TEST_OUTPUT_DIR||'p5-verification';
const progressOnly=process.env.P5_TEST_SCENARIO==='live-progress';
if(process.env.P5_TEST_SCENARIO&&!progressOnly)throw new Error('Unsupported P5_TEST_SCENARIO');
await mkdir(output,{recursive:true});
const browser=await (process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium).launch({
 ...(process.env.P5_TEST_BROWSER!=='webkit'&&process.env.P5_TEST_CHROMIUM_PATH?{executablePath:process.env.P5_TEST_CHROMIUM_PATH}:{}),
});const results=[];
const fixturePdf=await PDFDocument.create();fixturePdf.addPage().drawText('Synthetic estimate PDF download.');
const pdfBytes=Buffer.from(await fixturePdf.save());
// Brands ask their own extra questions before review (finish level for cabinets, trim length when trim is priced).
// A choice is answered with its first option; an unknown quantity stays explicit with Not sure yet.
const answerBrandQuestions=async(page,est,then)=>{for(let i=0;i<8;i++){const q=est.locator('section[aria-label="Project question"]');await then.or(q).first().waitFor();if(await then.count())return;const chips=q.locator('[aria-label="Suggested answers"] button');const unsure=q.getByRole('button',{name:'Not sure yet',exact:true});if(await chips.count()){await chips.first().click();await est.getByRole('button',{name:'Send answer',exact:true}).click();}else if(await unsure.count())await unsure.click();else throw new Error('Unexpected brand question: '+(await q.innerText()).slice(0,120));await settled(page);}await then.waitFor();};

const service=brand.services.includes('bathroom')?'bathroom':brand.services.includes('handyman')?'handyman':brand.services.includes('cabinet-install')?'cabinet-install':'new-construction';
const serviceLabel=service==='handyman'?'Home repairs':service==='cabinet-install'?'Cabinet installation':service==='new-construction'?'New home':'Bathroom remodel';
const fullAnswers={service,taskList:'Complete the specified work. Repair three interior doors.',...(service.startsWith('cabinet-')?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0',finish:'mid-range'}:service==='handyman'?{}:{sqft:'80',materials:'Porcelain tile',demolition:'Remove old finishes',...(service==='new-construction'?{garageIncluded:'no'}:{})})};
const result={status:'preliminary',range:{low:1000,high:1800},categoryRanges:[{category:'Carpentry',low:1000,high:1800}],lineItems:[{id:'repair',category:'Carpentry',description:'Repair three interior doors',quantity:3,unit:'EA',low:1000,high:1800,unitLow:1000/3,unitHigh:600,pricingStatus:'owner-planning-rate'}],scopeTasks:[{description:'Repair three interior doors',category:'Carpentry'}],summary:'Synthetic fixture scope.',includedCategories:['Carpentry'],allowances:[],assumptions:['Doors are standard interior slabs.'],exclusions:['Painting is excluded.'],factors:[],nextStep:'Schedule a scope review.',message:'Synthetic planning range.',disclaimer:'This is not a bid, quote, offer or guaranteed price.'};
async function mock(context,{interruptions=false,scenario='full'}={}){
 // This qualification harness must never reach real business APIs or analytics.
 // Specific synthetic routes below take precedence over this fail-closed guard.
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==new URL(base).origin||url.pathname.startsWith('/api/'))return route.abort('blockedbyclient');
  return route.continue();
 });
 // Keep synthetic estimator sessions out of production analytics and isolate third-party network failures.
 await context.route(/^https:\/\/([a-z0-9-]+\.)*clarity\.ms\//, route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
 await context.route('**/api/estimator-session',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const state={saved:null,nullReceipt:interruptions,failUpload:interruptions,submissions:0,postSubmissionSaves:0,scopeCalls:0,pricingPolls:0,readStage:1,finishReading:false,pricingStage:'mapping',failClarification:scenario==='instructions',holdPricing:scenario==='missing',invalidPdf:false,pdfRequests:0};
 await context.addInitScript(()=>{window.SpeechRecognition=class{start(){this.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'Repair three interior doors.'}],{isFinal:true})]});this.onend?.();}stop(){this.onend?.();}};});
 await context.route('**/api/p5-estimator/**',async route=>{
  const request=route.request();const endpoint=new URL(request.url()).pathname.split('/').at(-1);
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(endpoint==='pdf'){
   state.pdfRequests++;
   if(state.invalidPdf){state.invalidPdf=false;return send({error:'Synthetic invalid PDF response'});}
   return route.fulfill({status:200,contentType:'application/pdf',body:pdfBytes});
  }
  if(endpoint==='draft'){
   if(request.method()==='GET')return send({draft:state.saved});
   if(state.nullReceipt){state.nullReceipt=false;return send({draft:null});}
   if(state.saved?.status==='submitted'){state.postSubmissionSaves++;return send({error:'Already submitted'},409);}
   const input=request.postDataJSON();const old=state.saved;
   if(input.clarification){
    if(state.failClarification){state.failClarification=false;return send({error:'Temporary answer-save interruption. Please retry.'},503);}
    const prompt=instructionPrompts(old.extraction,old.answers).find(q=>q.id===input.clarification.id);
    old.extraction={...old.extraction,instructions:{...old.extraction.instructions,questions:old.extraction.instructions.questions.filter(q=>q!==(prompt.detail||prompt.question))}};
   }state.saved={...old,...input,revision:(old?.revision||0)+1,status:'draft',extraction:old?.extraction||null,uploads:old?.uploads||[]};
   const conflicts=state.saved.extraction?reconcileScope(state.saved.answers,state.saved.extraction,state.saved.wizard?.resolutions).conflicts:[];
   return send({draft:state.saved,conflicts,pricedFields:[],questions:scopeQuestions(state.saved.answers,state.saved.extraction,conflicts,state.saved.wizard?.skipped)});
  }
  if(endpoint==='scope'){
   state.scopeCalls++;if(state.failUpload){state.failUpload=false;return send({error:'Synthetic upload interruption. Your saved work is intact.'},503);}
   const form=await new Response(request.postDataBuffer(),{headers:{'Content-Type':request.headers()['content-type']}}).formData();
   if(form.get('analyze')==='false'){
    const files=await Promise.all(form.getAll('files').map(async file=>({id:'test-upload',name:file.name,size:file.size,type:file.type,sha256:createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),status:'stored'})));
    state.saved={...state.saved,uploads:files};return send({draft:state.saved,analysis:null});
   }
   if(scenario==='progress'&&!state.finishReading)return send({pending:true,progress:'Reading original plan pages',processing:{phase:'reading',message:'Reading the next eight original pages.',readPages:state.readStage*8,totalPages:250,readSections:state.readStage,totalSections:32,currentItems:['Plans.pdf (pages '+(state.readStage*8+1)+' to '+(state.readStage*8+8)+')'],updatedAt:new Date().toISOString()}});
   const desired=scenario==='unavailable'?{}:scenario==='manual'?{service,taskList:state.saved.answers.taskList||'Repair three interior doors',...(service.startsWith('cabinet-')?{cabinetRoom:'kitchen',cabinetBaseLf:'20',cabinetUpperLf:'0'}:{})}:fullAnswers;
   const extraction={summary:'Synthetic project',facts:Object.entries(desired).map(([field,value])=>({field,value,confidence:.98,source:'scope.txt',evidence:value})),conflicts:scenario==='conflict'?[{field:'taskList',values:['Repair three doors','Replace three doors'],explanation:'The documents disagree. Which work should be included?'}]:[],missingInformation:[],reviewNotes:[],clarifications:[]};
   if(scenario==='instructions')extraction.instructions={...emptyInstructions(),questions:['Labor only or materials only?','Should we include or exclude painting?']};
   const merged=reconcileScope(state.saved.answers,extraction,state.saved.wizard?.resolutions||{});
   state.saved={...state.saved,revision:state.saved.revision+1,answers:merged.answers,uploads:scenario==='manual'?[]:[{id:'test-upload',name:'scope.txt',size:30,type:'text/plain',sha256:'test',status:'stored'}],extraction};
   return send({draft:state.saved,analysis:{extraction},conflicts:merged.conflicts,pricedFields:[],warning:scenario==='unavailable'?'Your files are saved, but automatic reading could not finish. Retry or add the key details.':''});
  }
  if(endpoint==='submit'){
   state.pricingPolls++;
   if(scenario==='progress'&&state.pricingStage!=='done'){const phase=state.pricingStage;return send({pending:true,message:'Checking the requested scope.',processing:{phase,message:phase==='mapping'?'Matching the trim package to established rates.':'Checking published cost evidence for the trim package.',currentItems:['First-floor trim package'],updatedAt:new Date().toISOString()},retryAfterMs:2000},202);}
   if(state.holdPricing&&!state.saved?.answers?.trimLf){return send({pricingReviewRequired:true,missingFields:[{field:'trimLf',label:'Trim or baseboard length in feet'}],error:'Your project is saved and remains editable. Please confirm: Trim or baseboard length in feet. A complete price range is required before the estimate can be finalized and emailed.'},422);}
   const duplicate=state.saved?.status==='submitted';if(!duplicate)state.submissions++;
   state.saved={...state.saved,status:'submitted'};return send({accepted:!duplicate,duplicate,result,delivery:[...(state.saved.contact.email?[{channel:'customer',status:'retry'}]:[]),{channel:'admin',status:'sent'}]});
  }
  return send({error:'Unknown test endpoint'},404);
 });return state;
}
async function overflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow');}
async function usableAction(action){await action.scrollIntoViewIfNeeded();assert.ok(await action.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&el.contains(document.elementFromPoint(x,y));}),'The current estimator action must be visible and unobstructed');}
async function capture(page,name){await page.evaluate(async()=>{await document.fonts.ready;document.documentElement.style.scrollBehavior='auto';if(document.activeElement instanceof HTMLElement)document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:`${output}/${name}.png`,fullPage:true,animations:'disabled'});}
async function settled(page){await page.waitForFunction(()=>!document.querySelector('[data-p5-estimator][aria-busy=true]'));}
for(const width of progressOnly?[]:[320,390,430,768,1024,1440,1920]){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});const state=await mock(context,{interruptions:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/estimate/p5-preview');const estimator=page.locator('[data-p5-estimator]');const description=estimator.getByLabel('Tell us about your project',{exact:true});await description.waitFor();
  assert.equal(await estimator.locator('input[type=file]').count(),1);assert.equal(await estimator.locator('textarea').count(),1);
  // Talk to text appends the final transcript; typing remains available.
  await estimator.getByRole('button',{name:'Talk instead',exact:true}).click();assert.match(await description.inputValue(),/Repair three interior doors\./);
  await description.fill('Repair three interior doors. '+('LongUnbrokenProjectSpecification'.repeat(90)));
  await estimator.getByLabel('Upload project files',{exact:true}).setInputFiles({name:'scope.txt',mimeType:'text/plain',buffer:Buffer.from('Repair three interior doors.')});
  await estimator.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});await estimator.getByRole('alert').filter({hasText:'Your project save was not confirmed'}).waitFor();
  await estimator.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});await estimator.getByRole('alert').filter({hasText:'Synthetic upload interruption'}).waitFor();
  await page.reload();await estimator.getByRole('button',{name:'Remove scope.txt'}).waitFor();assert.match(await description.inputValue(),/LongUnbrokenProjectSpecification/);await overflow(page);await capture(page,`${width}-scope`);
  await estimator.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});await answerBrandQuestions(page,estimator,estimator.getByRole('heading',{name:'Review your project',exact:true}));assert.equal(await estimator.getByRole('region',{name:'Project question'}).count(),0,'Known facts were asked again');
  // The approved bottom action remains reachable while the details scroll.
  // The first width runs against a cold server; the contact form is given a full minute to render after review.
  await estimator.getByLabel('Your name',{exact:true}).waitFor({timeout:60000});await estimator.getByLabel('Your name',{exact:true}).fill('Synthetic Test');await estimator.getByLabel(/^Email/).fill('customer@example.invalid');
  const action=estimator.getByRole('button',{name:'Get my estimate',exact:true});
  await usableAction(action);
  // Reproduce an older saved question step after all its questions become known.
  await page.evaluate(()=>{const key='p5-project-draft-v2';const draft=JSON.parse(localStorage.getItem(key));draft.step=1;localStorage.setItem(key,JSON.stringify(draft));});
  await page.reload();await estimator.getByRole('button',{name:'Get my estimate',exact:true}).waitFor();await estimator.getByRole('checkbox').waitFor();
  assert.equal(await estimator.getByRole('region',{name:'Project question'}).count(),0,'Restored known facts were asked again');
  await estimator.getByLabel('Your name',{exact:true}).fill('Synthetic Test');await estimator.getByLabel(/^Email/).fill('customer@example.invalid');
  await estimator.getByRole('button',{name:'Back to the previous step',exact:true}).click();await page.waitForTimeout(400);/* Back lands on the previous step, which on a brand with its own questions is the last question, not the description; what must survive is the saved project text. */assert.match(await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')||'{}').text||''),/LongUnbroken/,'the project description survives going back');
  const calls=state.scopeCalls;const resume=estimator.getByRole('button',{name:'Continue',exact:true});if(await resume.count())await resume.click({timeout:120000});else await answerBrandQuestions(page,estimator,estimator.getByLabel(/^Email/));await estimator.getByLabel(/^Email/).waitFor();assert.equal(await estimator.getByLabel(/^Email/).inputValue(),'customer@example.invalid');assert.equal(state.scopeCalls,calls,'Going back unnecessarily repeated analysis');
  // Details are grouped in accordions; editing one detail re-reads the scope before pricing.
  const details=estimator.locator('details',{hasText:'Additional scope details'}).first();if(!(await details.evaluate(el=>el.open)))await details.locator('summary').first().click();
  await estimator.getByRole('button',{name:'Edit Tasks and quantities',exact:true}).click();const tasks=estimator.getByLabel('Tasks and quantities',{exact:true});await tasks.fill(fullAnswers.taskList+' '+('LongMaterialSpecification'.repeat(80)));await page.setViewportSize({width,height:500});await overflow(page);await page.setViewportSize({width,height:900});await estimator.getByRole('button',{name:'Done',exact:true}).click();
  await estimator.getByRole('checkbox').check();await Promise.all([page.waitForResponse('**/api/p5-estimator/scope'),estimator.getByRole('button',{name:'Get my estimate',exact:true}).click()]);await settled(page);assert.ok(state.scopeCalls>calls);
  await overflow(page);await capture(page,`${width}-review`);await estimator.getByRole('checkbox').check();await estimator.getByRole('button',{name:'Get my estimate',exact:true}).click();await estimator.getByText('Synthetic planning range.',{exact:true}).waitFor();
  // The result is organized into category accordions with subtotals and labeled exclusions.
  const carpentry=estimator.locator('details',{has:page.locator('summary',{hasText:'Carpentry'})}).first();await carpentry.waitFor();assert.match(await carpentry.locator('summary').innerText(),/\$1,000 to \$1,800/);
  if(!(await carpentry.evaluate(el=>el.open)))await carpentry.locator('summary').click();await estimator.getByText('Repair three interior doors',{exact:true}).first().waitFor();
  const exclusions=estimator.locator('details[data-kind="excluded"]');await exclusions.waitFor();assert.equal(await exclusions.count(),1);assert.match(await exclusions.locator('summary').innerText(),/excluded/i);
  if([390,1440].includes(width)){
   state.invalidPdf=true;
   const attachment=estimator.getByRole('button',{name:'Download estimate PDF',exact:true});
   await attachment.click();await estimator.getByRole('alert').filter({hasText:'The PDF is not ready. Your estimate is saved; please retry.'}).waitFor();
   const downloaded=page.waitForEvent('download');await attachment.click();const file=await downloaded;
   assert.equal(file.suggestedFilename(),brand.id+'-estimate.pdf');
   assert.equal(await file.failure(),null);const bytes=await readFile(await file.path());
   assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);assert.deepEqual(bytes,pdfBytes);
   await settled(page);assert.equal(state.pdfRequests,2);assert.equal(state.submissions,1,'Download retry must not resubmit the estimate');
  }
  await overflow(page);assert.ok(!/overheadRecovery|operatingProfit|unitCost/.test(await estimator.innerText()));await capture(page,`${width}-result`);
  await page.waitForTimeout(2100);assert.equal(state.postSubmissionSaves,0);await page.reload();await estimator.getByText('Synthetic planning range.',{exact:true}).waitFor();assert.equal(state.submissions,1);assert.deepEqual(errors,[]);
  results.push({width,passed:true,checks:['null receipt preserves files','talk to text','typed and uploaded mixed input','failed upload and reload recovery','known facts skipped','visible unobstructed bottom action','back and contact preservation','manual text reanalysis','category accordions','line-item privacy','single submission','result restoration','overflow']});
 }catch(error){const state=await page.evaluate(()=>{const r=document.querySelector('[data-p5-estimator]');if(!r)return {missingEstimator:true,url:location.href,body:document.body.innerText.slice(0,400)};const vis=e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0;};return {labels:[...r.querySelectorAll('label')].map(e=>e.innerText.trim().slice(0,40)+(vis(e)?'':' [hidden]')),headings:[...r.querySelectorAll('h1,h2,h3')].map(e=>e.innerText.trim().slice(0,50)),buttons:[...r.querySelectorAll('button')].map(e=>(e.getAttribute('aria-label')||e.innerText).trim().slice(0,40)),text:r.innerText.slice(0,400),url:location.href};}).catch(e=>({captureFailed:String(e).slice(0,200),url:page.url()}));results.push({width,passed:false,error:String(error),pageErrors:errors,state});await capture(page,`${width}-failure`).catch(()=>{});}await context.close();
}
// Reproduce two clarification questions, a failed save, same-answer retry and reload.
for(const width of progressOnly?[]:[390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const state=await mock(context,{scenario:'instructions'});const page=await context.newPage();
 try{
  await page.goto(base+'/estimate/p5-preview');const est=page.locator('[data-p5-estimator]');
  await est.getByLabel('Tell us about your project',{exact:true}).fill('Price the trim package.');await est.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});
  const question=est.getByRole('region',{name:'Project question'});await question.getByText('Labor only or materials only?',{exact:true}).waitFor();
  assert.equal(await est.getByText('Should we include or exclude painting?',{exact:true}).count(),0,'Only one question is rendered');
  await question.getByRole('button',{name:'Please include labor only',exact:true}).click();
  await est.getByRole('button',{name:'Send answer',exact:true}).click();
  await est.getByRole('alert').filter({hasText:'Temporary answer-save interruption'}).waitFor();assert.equal(await est.getByLabel('Your answer',{exact:true}).inputValue(),'Please include labor only');
  await est.getByRole('button',{name:'Send answer',exact:true}).click({timeout:120000});await question.getByText('Should we include or exclude painting?',{exact:true}).waitFor();
  assert.equal(await est.getByLabel('Your answer',{exact:true}).inputValue(),'','The next question starts with a fresh answer');
  await page.reload();await question.getByText('Should we include or exclude painting?',{exact:true}).waitFor();
  await capture(page,`${width}-clarification`);await question.getByRole('button',{name:'Please leave it out',exact:true}).click();await est.getByRole('button',{name:'Send answer',exact:true}).click();
  await answerBrandQuestions(page,est,est.getByLabel('Your name',{exact:true}));assert.equal(state.scopeCalls,1,'Clarification answers never reread documents');await overflow(page);
  results.push({scenario:'sequential-instructions',width,passed:true});
 }catch(error){results.push({scenario:'sequential-instructions',width,passed:false,error:String(error)});await capture(page,`${width}-instructions-failure`).catch(()=>{});}await context.close();
}
// Project-specific missing questions and a single conflicting fact.
for(const scenario of progressOnly?[]:['manual','conflict','unavailable']){
 const context=await browser.newContext({viewport:{width:390,height:844}});await mock(context,{scenario});const page=await context.newPage();
 try{
  await page.goto(base+'/estimate/p5-preview');const est=page.locator('[data-p5-estimator]');
  if(scenario==='conflict')await est.getByLabel('Tell us about your project',{exact:true}).fill('Two documents disagree about door repairs.');
  else await est.getByLabel('Tell us about your project',{exact:true}).fill('Repair three interior doors.');
  await est.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});
  if(scenario!=='conflict'){
   await settled(page);
   // Answer the service choice if asked, then only this project material questions; unknown numeric details remain explicit.
   for(let i=0;i<10&&await est.locator('section[aria-label="Project question"]').count();i++){
    const q=est.locator('section[aria-label="Project question"]');const text=q.locator('textarea');const choice=q.getByRole('button',{name:serviceLabel,exact:true});
    // Every question now shares the composer: chips answer a choice, unknown numeric details stay explicit via Not sure yet, and only free-text questions are typed.
    if(await choice.count()){await choice.click();await est.getByRole('button',{name:'Send answer',exact:true}).click();}
    else if(await q.getByRole('button',{name:'Not sure yet',exact:true}).count())await q.getByRole('button',{name:'Not sure yet',exact:true}).click();
    else if(await est.getByLabel('Your answer',{exact:true}).count()){await est.getByLabel('Your answer',{exact:true}).fill('Repair three interior doors');await est.getByRole('button',{name:'Send answer',exact:true}).click({timeout:120000});}
    else throw new Error('Unexpected required section');
    await settled(page);
   }
  }else{
   await est.getByText('The documents disagree. Which work should be included?',{exact:true}).waitFor();await est.getByRole('button',{name:'Replace three doors',exact:true}).click();await est.getByRole('button',{name:'Send answer',exact:true}).click();
  }
  await answerBrandQuestions(page,est,est.getByRole('heading',{name:'Review your project',exact:true}));await overflow(page);results.push({scenario,passed:true});
 }catch(error){results.push({scenario,passed:false,error:String(error)});await capture(page,`${scenario}-failure`).catch(()=>{});}await context.close();
}
// Missing information after Get my estimate links straight to the missing field, keeps progress, and completes.
for(const width of progressOnly?[]:[390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const state=await mock(context,{scenario:'missing'});const page=await context.newPage();
 try{
  await page.goto(base+'/estimate/p5-preview');const est=page.locator('[data-p5-estimator]');
  await est.getByLabel('Tell us about your project',{exact:true}).fill('Install new baseboard trim.');await est.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});
  // Brands that price trim ask for its length before review; the others discover the gap at submission and ask then.
  const trimQuestion=est.getByText('About how many linear feet of trim or baseboard are included?',{exact:true});const review=est.getByRole('heading',{name:'Review your project',exact:true});
  await answerBrandQuestions(page,est,review.or(trimQuestion));const askedUpFront=(await trimQuestion.count())>0;
  if(askedUpFront){await est.getByLabel('Your answer',{exact:true}).fill('120');await est.getByRole('button',{name:'Send answer',exact:true}).click({timeout:120000});await settled(page);await answerBrandQuestions(page,est,review);}
  await est.getByLabel('Your name',{exact:true}).fill('Synthetic Test');await est.getByLabel(/^Email/).fill('customer@example.invalid');await est.getByRole('checkbox').check();
  await est.getByRole('button',{name:'Get my estimate',exact:true}).click();
  if(!askedUpFront){
   const alert=est.getByRole('alert');await alert.getByText('A few more details are needed',{exact:true}).waitFor();
   await alert.getByRole('button',{name:/Trim or baseboard length in feet/}).click();
   const question=est.getByRole('region',{name:'Project question'});await question.getByText('About how many linear feet of trim or baseboard are included?',{exact:true}).waitFor();
   await est.getByLabel('Your answer',{exact:true}).fill('120');await est.getByRole('button',{name:'Send answer',exact:true}).click({timeout:120000});await settled(page);
   await answerBrandQuestions(page,est,review);
   assert.equal(await est.getByLabel(/^Email/).inputValue(),'customer@example.invalid','Contact details survive the detour');
   await est.getByRole('checkbox').check();await est.getByRole('button',{name:'Get my estimate',exact:true}).click();
  }
  await est.getByText('Synthetic planning range.',{exact:true}).waitFor();
  assert.equal(state.submissions,1);await capture(page,`${width}-missing-recovered`);
  results.push({scenario:'missing-information',width,passed:true});
 }catch(error){results.push({scenario:'missing-information',width,passed:false,error:String(error)});await capture(page,`${width}-missing-failure`).catch(()=>{});}await context.close();
}
for(const width of [320,390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});const progressState=await mock(context,{scenario:'progress'});const page=await context.newPage();
 try{
  await page.goto(base+'/estimate/p5-preview');const est=page.locator('[data-p5-estimator]');
  await est.getByLabel('Tell us about your project',{exact:true}).fill('Synthetic progress test: repair three interior doors.');
  // Page progress only applies when this project actually has an attachment.
  await est.getByLabel('Upload project files',{exact:true}).setInputFiles({name:'Plans.pdf',mimeType:'application/pdf',buffer:pdfBytes});
  // Allow bounded preparation to finish before Continue enables on a loaded runner.
  await est.getByRole('button',{name:'Continue',exact:true}).click({timeout:120000});
  await page.getByText('8 of 250 pages checked',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'Original pages checked'}).getAttribute('value'),'8');
  await page.getByRole('heading',{name:'Reviewing your documents',exact:true}).waitFor();await page.getByTestId('p5-eta').waitFor();await overflow(page);await capture(page,`${width}-live-reading`);
  progressState.readStage=2;
  await page.getByText('16 of 250 pages checked',{exact:true}).waitFor();
  progressState.finishReading=true;
  await answerBrandQuestions(page,est,est.getByLabel('Your name',{exact:true}));
  assert.equal(await est.getByRole('button',{name:'Download your project summary',exact:true}).count(),0,'No PDF before contact capture');
  assert.equal(await est.getByText('Synthetic planning range.',{exact:true}).count(),0,'No estimate result before contact capture');
  // The action remains visible and validates the required name before starting pricing.
  await est.getByRole('checkbox').check();await est.getByRole('button',{name:'Get my estimate',exact:true}).click();
  assert.equal(await est.getByLabel('Your name',{exact:true}).getAttribute('required'),'');
  assert.equal(progressState.pricingPolls,0);assert.equal(progressState.submissions,0,'Contact is required before an estimate can be revealed');
  await est.getByLabel('Your name',{exact:true}).fill('Synthetic Test');await est.getByLabel(/^Email/).fill(width===390?'':'customer@example.invalid');
  await est.getByRole('checkbox').check();
  assert.equal(await est.getByLabel('Your name',{exact:true}).inputValue(),'Synthetic Test','Contact name must survive adjacent field edits');
  assert.equal(await est.getByLabel(/^Email/).inputValue(),width===390?'':'customer@example.invalid','Optional contact email must survive adjacent field edits');
  await est.getByRole('button',{name:'Get my estimate',exact:true}).click();
  await page.getByRole('heading',{name:'Applying pricing',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'Original pages checked'}).count(),0,'Document progress must not become a fabricated pricing percentage');
  progressState.pricingStage='research';
  await page.getByRole('heading',{name:'Applying pricing',exact:true}).waitFor();await page.getByText('Checking published cost evidence for the trim package.',{exact:true}).waitFor();await page.getByTestId('p5-wait-choice').getByRole('button',{name:'Stay here',exact:true}).click();await overflow(page);await capture(page,`${width}-live-pricing`);
  progressState.pricingStage='done';
  await est.getByText('Synthetic planning range.',{exact:true}).waitFor();if(width===390){await est.getByText('Your estimate is saved here. You can download your PDF below.',{exact:true}).waitFor();assert.equal(await est.getByText('Not requested',{exact:true}).count(),1);}results.push({width,scenario:'live-progress',passed:true});
 }catch(error){results.push({width,scenario:'live-progress',passed:false,error:String(error)});await capture(page,`${width}-progress-failure`).catch(()=>{});}await context.close();
}
const paths=brand.id==='p5'?['/estimate','/estimate/scope','/quote',...['kitchen-remodel','bathroom-remodel','home-addition','adu','custom-home','custom-cabinets','handyman'].map(s=>'/quote/'+s)]:['/estimate','/estimate/scope','/#calculator',...(brand.services.includes('re10')?['/re-10-repairs-boise']:[]),...(brand.id==='remodeling'?['/remodel-plans-boise']:[])];
for(const width of progressOnly?[]:[390,768,1440])for(const path of paths){
 const context=await browser.newContext({viewport:{width,height:900}});await mock(context);const page=await context.newPage();
 try{const response=await page.goto(base+path);assert.ok(response?.ok(),`HTTP ${response?.status()}`);const est=page.locator('[data-p5-estimator]').first();if(path.includes('#calculator')){await page.locator('#calculator').first().scrollIntoViewIfNeeded();}await est.getByLabel('Tell us about your project',{exact:true}).waitFor();await overflow(page);assert.ok(!/Continue manually|Upload Scope|Manual Estimate/.test(await est.innerText()));results.push({width,path,passed:true});}
 catch(error){results.push({width,path,passed:false,error:String(error)});await capture(page,`route-${width}-${path.replace(/[^a-z0-9]/gi,'_')}`).catch(()=>{});}await context.close();
}
await browser.close();await writeFile(`${output}/browser-results.json`,JSON.stringify({brand:brand.id,externalServices:'simulated',physicalMicrophone:'not tested',results},null,2));console.log(JSON.stringify(results));if(results.some(r=>!r.passed))process.exitCode=1;
