import {chromium,webkit} from '@playwright/test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Synthetic component test only. All requests are intercepted; no administrator
// login, live database, provider, analytics or customer record is accessed.
const entry=`import {createRoot} from 'react-dom/client';import Recovery from './components/P5QaSavedReading';createRoot(document.getElementById('root')).render(<Recovery/>);`;
const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'qa-fixture.js',format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const code=built.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=built.outputFiles.find(file=>file.path.endsWith('.css'))?.text||'';
assert.doesNotMatch(code,/p5ds_qa_|qa-paid-|p5-acceptance-20261004|pg_is_in_recovery|DATABASE_URL/,'Server recovery code must not enter the client bundle.');
if(process.env.P5_QA_BUNDLE_ONLY==='1'){console.log('PASS: QA view bundles without server identities, SQL or provider code.');process.exit(0);}
await mkdir('p5-verification',{recursive:true});
const engine=process.env.P5_TEST_BROWSER==='webkit'?'webkit':'chromium';
const browser=await (engine==='webkit'?webkit:chromium).launch();
const results=[];
for(const width of [320,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();
  const requests=[],flowRequests=[],errors=[];let applied=false,fail=false,flowStage='pricing',captured=false;
  page.on('pageerror',error=>errors.push(error.message));
  const fixture=name=>({case:name,label:name==='remodel'?'Remodel':'Kitchen',id:'11111111-1111-4111-8111-111111111111',revision:applied?6:5,checkedAt:'2026-10-06T14:00:00Z',eligible:!applied,applied,reason:null,operation:'a'.repeat(64),changedFields:['trimLf'],retainedFacts:4});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    assert.equal(url.origin,'http://qa-fixture.test','Unexpected external request');
    if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial}*{box-sizing:border-box;min-width:0}button,select{max-width:100%}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'});
    if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
    if(url.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:code});
    if(url.pathname==='/api/admin/p5-estimators/qa-continuation'){
      flowRequests.push(request.method());let name=url.searchParams.get('case');
      if(request.method()==='POST'){
        const body=request.postDataJSON();name=body.case;
        assert.deepEqual(Object.keys(body).sort(),['action','case','token']);assert.equal(body.token,'b'.repeat(64));
        if(body.action==='prepare'){assert.equal(captured,false);captured=true;}
        else if(body.action==='approve'){assert.equal(captured,true);captured=false;flowStage='saved';}
        else assert.fail('Unexpected continuation action');
      }else assert.equal(request.method(),'GET');
      return route.fulfill({contentType:'application/json',body:JSON.stringify({case:name,label:name,revision:6,token:'b'.repeat(64),stage:flowStage,blocked:null,checkedAt:'2026-10-06T14:00:00Z',qaAllowance:2000000,qaLiability:captured?0:150,overallCap:20000000,fields:[],pdf:flowStage==='saved',...(captured?{intent:{requestHash:'c'.repeat(64),tenant:'synthetic.test',project:'synthetic-case',boundary:'site:synthetic-pricing',model:'synthetic-model',maximum:280000,status:'captured'}}:{})})});
    }
    if(url.pathname!=='/api/admin/p5-estimators/qa-recovery')return route.abort('blockedbyclient');
    requests.push(request.method());
    let name=url.searchParams.get('case');
    if(request.method()==='POST'){
      const body=request.postDataJSON();name=body.case;
      assert.deepEqual(Object.keys(body).sort(),['case','operation','revision']);assert.equal(body.revision,5);
      if(fail)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'The saved-reading evidence changed. Inspect it again.'})});
      applied=true;
    }else assert.equal(request.method(),'GET');
    return route.fulfill({contentType:'application/json',body:JSON.stringify(fixture(name))});
  });
  try{
    await page.goto('http://qa-fixture.test/');
    const button=page.getByRole('button',{name:'Apply verified saved reading',exact:true});await button.waitFor();
    await page.getByRole('button',{name:'Prepare next pricing stage ($0)',exact:true}).waitFor();
    assert.deepEqual(requests,['GET']);assert.deepEqual(flowRequests,['GET']);
    await page.reload();await button.waitFor();assert.deepEqual(requests,['GET','GET'],'Reload must only inspect');assert.ok(flowRequests.every(method=>method==='GET'));
    await page.getByLabel('Synthetic case').selectOption('kitchen');await page.getByRole('heading',{name:'Kitchen',exact:true}).waitFor();assert.ok(requests.every(method=>method==='GET'));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'QA page overflows');
    await button.focus();await page.keyboard.press('Enter');await page.getByText('Saved reading applied. Pricing has not been started.',{exact:true}).waitFor();
    assert.equal(requests.filter(method=>method==='POST').length,1);assert.equal(await button.count(),0);
    await page.reload();await page.getByText('Saved reading applied. Pricing has not been started.',{exact:true}).waitFor();assert.equal(requests.filter(method=>method==='POST').length,1);
    applied=false;fail=true;await page.getByRole('button',{name:'Inspect again',exact:true}).click();await button.waitFor();await button.click();await page.getByRole('alert').waitFor();
    assert.equal(await button.count(),0,'A failed action must require a fresh inspection');assert.equal(requests.filter(method=>method==='POST').length,2);
    assert.ok(flowRequests.every(method=>method==='GET'),'Inspection and saved-reading recovery cannot admit continuation');
    const prepare=page.getByRole('button',{name:'Prepare next pricing stage ($0)',exact:true});await prepare.click();
    const approve=page.getByRole('button',{name:'Approve up to $0.28 and continue',exact:true});await approve.waitFor();
    await page.getByText('Stage identity: site:synthetic-pricing',{exact:true}).waitFor();
    assert.equal(flowRequests.filter(method=>method==='POST').length,1);
    await page.reload();await approve.waitFor();assert.equal(flowRequests.filter(method=>method==='POST').length,1,'Reload of a captured request must not approve it');
    await approve.focus();await page.keyboard.press('Enter');await page.getByRole('link',{name:'Download saved QA estimate PDF',exact:true}).waitFor();
    assert.equal(flowRequests.filter(method=>method==='POST').length,2);
    await page.reload();await page.getByRole('link',{name:'Download saved QA estimate PDF',exact:true}).waitFor();
    assert.equal(flowRequests.filter(method=>method==='POST').length,2,'Reload of a saved estimate must remain read-only');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:`p5-verification/${engine}-${width}-qa-recovery.png`,fullPage:true});results.push({width,passed:true,requests,flowRequests});
  }catch(error){results.push({width,passed:false,error:String(error),requests,flowRequests,errors});}
  await context.close();
}
await browser.close();
await writeFile(`p5-verification/${engine}-qa-recovery-results.json`,JSON.stringify({scope:'Synthetic admin recovery and guarded continuation components; all network intercepted.',results},null,2));
console.log(JSON.stringify(results));if(results.some(result=>!result.passed))process.exitCode=1;
