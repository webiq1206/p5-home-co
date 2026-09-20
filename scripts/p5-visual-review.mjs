import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const routes=JSON.parse(await fs.readFile('scripts/p5-visual-routes.json','utf8'));
// Includes the directly served, compressed process photograph.
const out='p5-visual-review';
await fs.mkdir(out,{recursive:true});
const widths=[320,390,430,600,768,1024,1366,1440,1920];
let browser=await chromium.launch();
async function bounded(work, ms, label) {
 let timer;
 try { return await Promise.race([work(), new Promise((_, reject) => { timer=setTimeout(() => reject(new Error(label+' timed out after '+ms+'ms')), ms); })]); }
 finally { clearTimeout(timer); }
}
const records=[];
const links=new Set();
const origin='http://127.0.0.1:5000';
const parent=process.env.P5_PARENT==='1';
const shard=Number(process.env.P5_SHARD||0),shards=Number(process.env.P5_SHARDS||1);
const selected=routes.filter((_,i)=>i%shards===shard);
try {
 for(const width of widths){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<1024});
  const blockedWrites = new Set();
  // Audit reads must never create real inquiries or send messages.
  await context.route('**/api/**',route=>{
   if(['/api/estimator-session','/api/meta-capi'].includes(new URL(route.request().url()).pathname))return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"auditPreview":true}'});
   if(!['GET','HEAD'].includes(route.request().method())){blockedWrites.add(route.request().url());return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Audit preview: submission is disabled.'})});}
   return route.continue();
  });
  for(const route of selected){
   // Isolate each document so a previous route's aborted prefetch cannot leak into its console record.
   const page=await context.newPage();
   page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(45000);
   const errors=[],consoleErrors=[];
   const onError=e=>errors.push(e.message),onConsole=e=>{if(e.type()==='error'&&!(blockedWrites.has(e.location().url)&&e.text().includes('503')))consoleErrors.push(e.text());};
   page.on('pageerror',onError);page.on('console',onConsole);
   const rec={width,route};
   const stage=async(label,work,ms=45000)=>{
    rec.stage=label;console.error(JSON.stringify({width,route,stage:label}));
    await fs.writeFile(`${out}/progress-${shard}.json`,JSON.stringify(rec));
    return bounded(work,ms,label);
   };
   try{
    const response=await stage('navigate',()=>page.goto(origin+route,{waitUntil:'domcontentloaded',timeout:45000}));
    assert(response&&response.status()<400,'HTTP '+response?.status());
    await stage('main',()=>page.locator('main').first().waitFor({state:'visible'}));
    await stage('fonts-and-first-scroll',()=>page.evaluate(async()=>{await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]);for(let y=0;y<Math.min(document.documentElement.scrollHeight,80000);y+=750){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,35));}}));
    // Expand all article bodies so hidden lower sections also receive coverage.
    await stage('expand-article',()=>page.locator('article details:not([open]) > summary').evaluateAll(els=>els.forEach(el=>el.click())));
    await stage('decode-images',()=>page.evaluate(async()=>{const images=[...document.images].filter(i=>i.getClientRects().length);for(const i of images)i.loading='eager';await Promise.race([Promise.allSettled(images.map(i=>i.decode())),new Promise(r=>setTimeout(r,15000))]);}));
    // Expanding article sections moves lower content. Scroll again to reveal it in the merged build.
    await stage('expanded-scroll',()=>page.evaluate(async()=>{for(let y=0;y<Math.min(document.documentElement.scrollHeight,80000);y+=750){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,35));}}));
    await page.waitForTimeout(250);
    const state=await stage('inspect-document',()=>page.evaluate(()=>({
     width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
     images:[...document.images].filter(i=>i.getClientRects().length).map(i=>({src:i.currentSrc,alt:i.alt,ok:i.complete&&i.naturalWidth>0})),
     links:[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')),
     hidden:[...document.querySelectorAll('[data-reveal]')].filter(e=>getComputedStyle(e).opacity==='0').length,
     headings:[...document.querySelectorAll('main h1,main h2,main h3')].map(e=>({text:e.textContent,top:Math.round(e.getBoundingClientRect().top+scrollY)}))
    })));
    state.links.forEach(l=>{if(l.startsWith('/')&&!l.startsWith('//')&&!l.startsWith('/api/')&&!l.startsWith('/admin')&&!l.startsWith('/portal'))links.add(l.split('#')[0]);});delete state.links;
    Object.assign(rec,state,{errors,consoleErrors,blockedWrites:[...blockedWrites]});
    assert(state.scrollWidth<=width+1,'Document overflow '+state.scrollWidth);
    assert(!state.images.some(i=>!i.ok),'Broken visible image');
    assert.equal(errors.length,0,'Page exceptions');
    assert.equal(consoleErrors.length,0,'Console errors');
    await stage('scroll-top',()=>page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})));
    // Every route is captured at every requested width. Capture is distinct from manual approval.
    const file=`${width}-${route.replaceAll('/','_')||'home'}.jpg`;
    await stage('capture',()=>page.screenshot({path:`${out}/${file}`,fullPage:true,type:'jpeg',quality:55,timeout:30000}));
    rec.screenshot=file;rec.ok=true;
    if(route==='/'&&!parent){
     const spacing=await page.locator('h1.ed-display').evaluate(e=>getComputedStyle(e).marginBottom);
     assert.equal(spacing,'32px','Hero margin overridden');
     const facts=page.locator('dl.ed-hero-facts');assert.equal(await facts.count(),1,'One compact hero facts group');
     const menu=page.getByRole('button',{name:'Open navigation menu',exact:true});
     if(width<1440){
      assert(await menu.isVisible(),'Compact header below 1440px');
      await menu.click();
      await page.getByRole('dialog').waitFor({state:'visible'});
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({state:'hidden'});
     }else{
      assert(!(await menu.isVisible()),'Desktop header at 1440px');
      const wrapping=await page.locator('header nav a').evaluateAll(es=>es.filter(e=>e.getClientRects().length&&e.textContent.trim()).map(e=>({text:e.textContent,nowrap:getComputedStyle(e).whiteSpace,height:e.getBoundingClientRect().height})));
      assert(!wrapping.some(e=>e.text.includes('(208)')&&e.height>30),'Phone number wraps');
     }
    }
   }catch(e){rec.ok=false;rec.error=String(e);console.error(JSON.stringify({width,route,failed:rec.stage,error:rec.error}));try{await bounded(()=>page.screenshot({path:`${out}/FAIL-${width}-${route.replaceAll('/','_')}.jpg`,fullPage:true,type:'jpeg',quality:60,timeout:10000}),12000,'failure capture');}catch{}}
   records.push(rec);page.off('pageerror',onError);page.off('console',onConsole);
   await fs.writeFile(`${out}/records-${shard}.json`,JSON.stringify(records));
   await bounded(()=>page.close({runBeforeUnload:false}),5000,'page close').catch(()=>{});
  }
  await bounded(()=>context.close(),5000,'context close').catch(()=>{});
  await bounded(()=>browser.close(),5000,'browser close').catch(()=>{});
  browser=await chromium.launch();
 }
 const context=await browser.newContext();
 const failures=[];
 for(const path of links){try{const r=await context.request.get(origin+path,{timeout:20000});if(r.status()>=400)failures.push({path,status:r.status()});}catch(e){failures.push({path,error:String(e)});}}
 await fs.writeFile(`${out}/links-${shard}.json`,JSON.stringify({checked:links.size,failures},null,2));
 await context.close();
 console.log(JSON.stringify({routes:selected.length,widths,checks:records.length,failed:records.filter(r=>!r.ok).map(({route,width,error})=>({route,width,error})),brokenLinks:failures},null,2));
 if(records.some(r=>!r.ok)||failures.length)process.exitCode=1;
}finally{await bounded(()=>browser.close(),5000,'browser close').catch(()=>{});}
