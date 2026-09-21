#!/usr/bin/env node
// Phone and tablet layout check of the live estimator on every brand site.
// Usage: node scripts/p5-mobile-matrix.mjs --out <dir> [--engines chromium,webkit]
// Checks, per site and device: no sideways scroll, the estimator is not hidden under the site
// header, the action bar sits inside the screen, and tappable controls are at least 40 px tall.
import {chromium,webkit,devices} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:fallback;};
const out=arg('--out','p5-verification/mobile-matrix');
const engines=arg('--engines','chromium').split(',');
const SITES=['p5homeco.com','boiseremodeling.co','boiseconstruction.co','boisehandyman.co','boisecabinet.co'];
const DEVICES={'iPhone 13':devices['iPhone 13'],'Pixel 7':devices['Pixel 7'],'iPad (gen 7)':devices['iPad (gen 7)']};
await mkdir(out,{recursive:true});
const results=[];
for(const engineName of engines){
  const engine={chromium,webkit}[engineName];
  const browser=await engine.launch();
  for(const [deviceName,device] of Object.entries(DEVICES)){
    const {defaultBrowserType,...profile}=device;
    const context=await browser.newContext(profile);
    for(const site of SITES){
      const page=await context.newPage();const problems=[];
      try{
        await page.goto(`https://${site}/estimate`,{waitUntil:'networkidle',timeout:60000});
        await page.waitForTimeout(1500);
        const m=await page.evaluate(()=>{
          const root=document.querySelector('[data-p5-thread]')?.closest('section,div[class*="root"],main')||document.querySelector('[data-p5-thread]');
          const header=[...document.querySelectorAll('header,[class*="header" i]')].find(el=>{const s=getComputedStyle(el);return (s.position==='fixed'||s.position==='sticky')&&el.getBoundingClientRect().height>0;});
          const composer=document.querySelector('textarea');
          const dock=document.querySelector('[class*="dock"]');
          const small=[...document.querySelectorAll('button,a[class*="primary"],a[class*="secondary"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.height<40;}).map(el=>(el.textContent||el.getAttribute('aria-label')||'').trim().slice(0,30));
          return {sideways:document.documentElement.scrollWidth>innerWidth+1,viewport:[innerWidth,innerHeight],
            headerBottom:header?header.getBoundingClientRect().bottom:0,
            composerTop:composer?composer.getBoundingClientRect().top:null,composerVisible:composer?composer.getBoundingClientRect().bottom<=innerHeight+1:false,
            dockBottom:dock?dock.getBoundingClientRect().bottom:null,small:[...new Set(small)].slice(0,6),rootFound:Boolean(root)};
        });
        if(!m.rootFound)problems.push('estimator not found');
        if(m.sideways)problems.push('sideways scroll');
        if(m.composerTop!==null&&m.composerTop<m.headerBottom-1)problems.push(`composer under header (${Math.round(m.composerTop)} < ${Math.round(m.headerBottom)})`);
        if(!m.composerVisible)problems.push('composer off screen');
        if(m.dockBottom!==null&&m.dockBottom>m.viewport[1]+1)problems.push('action bar below the screen');
        if(m.small.length)problems.push(`small tap targets: ${m.small.join(' | ')}`);
        await page.screenshot({path:`${out}/${engineName}-${deviceName.replace(/\W+/g,'_')}-${site}.png`});
      }catch(error){problems.push(`load failed: ${String(error?.message||error).slice(0,120)}`);}
      results.push({engine:engineName,device:deviceName,site,ok:problems.length===0,problems});
      console.log(`${problems.length?'FAIL':'PASS'} ${engineName} ${deviceName} ${site}${problems.length?': '+problems.join('; '):''}`);
      await page.close();
    }
    await context.close();
  }
  await browser.close();
}
await writeFile(`${out}/results.json`,JSON.stringify(results,null,1));
console.log(`${results.filter(r=>r.ok).length}/${results.length} passed`);
