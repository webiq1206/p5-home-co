import {chromium,webkit,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4188';
const browser=await(process.env.P5_TEST_BROWSER==='webkit'?webkit:chromium).launch();
try{
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 let lost=false,gets=0,puts=0;
 await context.route('**/api/p5-estimator/draft',async r=>{
  if(r.request().method()==='GET'){gets++;return r.continue();}
  puts++;
  if(!lost){lost=true;await r.fetch();return r.abort('failed');}
  return r.continue();
 });
 const page=await context.newPage();await page.goto(base);
 await page.getByRole('textbox',{name:'Tell us about your project',exact:true}).fill('[QA] Fictional kitchen cabinet update, existing walls retained.');
 await page.getByRole('button',{name:'Review with the details I have',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')));
 assert.equal(before.revision,0,'The first committed save acknowledgement must be lost');
 const getsBefore=gets;
 await page.reload();
 await page.getByRole('button',{name:'Review with the details I have',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review your project',exact:true})).toBeVisible();
 assert.ok(gets>getsBefore,'Reload must read the server even when local revision is zero');
 const state=await(await context.request.get(base+'/__state')).json();
 assert.equal(state.scopeCalls,0);assert.equal(state.pricingCalls,0);assert.equal(state.submissions,0);
 console.log(JSON.stringify({case:'lost-first-save-acknowledgement',passed:true,gets,puts,scopeCalls:0,pricingCalls:0,submissions:0}));
 await context.close();
 for(const savedStep of [0,1,2]){
 const conflictContext=await browser.newContext({viewport:{width:1180,height:757},serviceWorkers:'block'});
 await conflictContext.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 const conflictPage=await conflictContext.newPage();await conflictPage.goto(base);
 await conflictPage.getByRole('textbox',{name:'Tell us about your project',exact:true}).fill('[QA] Original isolated project.');
 await conflictPage.getByRole('button',{name:'Review with the details I have',exact:true}).click();
 await expect(conflictPage.getByRole('heading',{name:'Review your project',exact:true})).toBeVisible();
 const local=await conflictPage.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')));
 const headers={'x-p5-draft-id':local.id,'x-p5-draft-key':local.key};
 const newer=await(await conflictContext.request.put(base+'/api/p5-estimator/draft',{headers,data:{...local,text:'[QA] Newer saved project from another isolated tab.'}})).json();
 await conflictPage.evaluate(d=>localStorage.setItem('p5-project-draft-v2',JSON.stringify({...d,text:'[QA] Unsaved local edits must survive.',dirty:true,step:d.savedStep})),{...local,savedStep});
 const writesBefore=(await(await conflictContext.request.get(base+'/__state')).json()).saves;
 await conflictPage.reload();
 const openSaved=conflictPage.getByRole('button',{name:'Open saved version and keep my edits',exact:true});
 await expect(openSaved).toBeVisible();
 await conflictPage.waitForTimeout(2100);
 assert.equal((await(await conflictContext.request.get(base+'/__state')).json()).saves,writesBefore,'Conflict must pause autosave');
 await openSaved.click();
 assert.equal(await conflictPage.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).text),newer.draft.text);
 assert.ok((await conflictPage.evaluate(()=>localStorage.getItem('p5-project-draft-v2:recovery-v1'))).includes('Unsaved local edits must survive.'));
 await conflictPage.getByRole('button',{name:'Review with the details I have',exact:true}).click();
 await expect(conflictPage.getByRole('heading',{name:'Review your project',exact:true})).toBeVisible();
 console.log(JSON.stringify({case:'genuine-newer-version-preserves-both',savedStep,passed:true}));
 await conflictContext.close();
 }
 const submitContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await submitContext.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
 let lostSubmit=false;await submitContext.route('**/api/p5-estimator/intake',async r=>{if(r.request().method()==='POST'&&!lostSubmit){lostSubmit=true;await r.fetch();return r.abort('failed');}return r.continue();});
 const submitPage=await submitContext.newPage();await submitPage.goto(base+'/?service='+({p5:'adu',construction:'new-construction',remodeling:'kitchen',handyman:'handyman',cabinet:'cabinet-install'}[process.env.P5_TEST_SITE||'p5']));
 await submitPage.getByRole('textbox',{name:'Tell us about your project',exact:true}).fill('[QA] Isolated synthetic request; no real delivery.');
 await submitPage.getByRole('button',{name:'Review with the details I have',exact:true}).click();
 await submitPage.getByRole('button',{name:'Continue to contact details',exact:true}).click();
 await submitPage.getByRole('textbox',{name:'Your name',exact:true}).fill('[QA] Synthetic Local');
 await submitPage.getByRole('textbox',{name:'Email',exact:true}).fill('test@example.invalid');
 const send=submitPage.getByRole('button',{name:'Send project request',exact:true});
 await send.click();await expect(submitPage.getByRole('alert')).toBeVisible();
 const first=(await(await submitContext.request.get(base+'/__state')).json());
 const draftId=await submitPage.evaluate(()=>JSON.parse(localStorage.getItem('p5-project-draft-v2')).id);
 const firstRevision=first.drafts.find(d=>d.id===draftId).revision;
 await send.click();
 await expect(submitPage.getByRole('alert')).toHaveCount(0);
 const after=(await(await submitContext.request.get(base+'/__state')).json());
 assert.equal(after.drafts.find(d=>d.id===draftId).revision,firstRevision,'An unchanged send retry must reuse the committed request revision');
 assert.equal(after.work.filter(w=>w.work_key.startsWith('intake-delivery-v1:')&&w.payload.projectId.endsWith(draftId)).length,1,'Retry must leave one delivery job');
 assert.equal(after.pricingCalls,0);
 console.log(JSON.stringify({case:'lost-submission-acknowledgement-keeps-one-delivery',passed:true,revision:firstRevision,deliveryJobs:1,pricingCalls:0}));
 await submitPage.reload();
 await expect(submitPage.getByRole('button',{name:'Send project request',exact:true})).toHaveCount(0);
 await submitContext.close();
}finally{await browser.close();}
