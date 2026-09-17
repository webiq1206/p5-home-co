import {chromium} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.P5_TEST_ORIGIN||'http://127.0.0.1:5000';const out='p5-mobile-seo-verification';await mkdir(out,{recursive:true});
const browser=await chromium.launch();const results={pages:[],mobile:[],errors:[],scope:'Built production app in Chromium emulation; not physical devices or a claim of live deployment.'};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const page=await ctx.newPage();page.setDefaultTimeout(15000);
const visible=locator=>locator.evaluateAll(els=>els.some(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';}));
try{
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:width<768?844:1000});await page.goto(base,{waitUntil:'domcontentloaded'});await delay(1200);
  const bar=page.locator('[data-mobile-nav-bar]');
  const top=await page.evaluate(()=>({scrollY,overflow:document.documentElement.scrollWidth>innerWidth+1}));
  assert.ok(top.scrollY<=1,`Homepage jumped to ${top.scrollY}`);assert.equal(top.overflow,false,`Horizontal overflow at ${width}px`);
  assert.equal(await visible(bar),false,`Sticky CTA visible over hero at ${width}px`);
  await page.screenshot({path:`${out}/hero-${width}.png`});
  if(width<768){
   let shown=false;
   for(let y=400;y<10000;y+=350){await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await delay(100);if(await visible(bar)){shown=true;break;}}
   assert.ok(shown,`Mobile CTA never appears after the hero at ${width}px`);
   const controls=await bar.locator('a,button').evaluateAll(els=>els.map(e=>({text:e.textContent?.trim(),href:e.getAttribute('href'),height:e.getBoundingClientRect().height})));
   assert.ok(controls.some(c=>c.href?.startsWith('tel:')&&c.text?.includes('Call')),'Missing labeled Call control');
   assert.ok(controls.every(c=>c.height>=44),'Mobile action too small');
   await page.screenshot({path:`${out}/actions-${width}.png`});
   await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await delay(150);assert.equal(await visible(bar),false,'CTA stays visible after returning to hero');
   results.mobile.push({width,hiddenOverHero:true,visibleAfterHero:true,callLabeled:true});
  }
 }
 const requested=new Set();async function sitemap(url){if(requested.has(url))return [];requested.add(url);const r=await page.request.get(url);if(!r.ok())return [];const body=await r.text();const urls=[...body.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].replaceAll('&amp;','&'));if(body.includes('<sitemapindex'))return (await Promise.all(urls.map(u=>sitemap(base+new URL(u).pathname)))).flat();return urls;}
 const paths=[...new Set(['/',...(await sitemap(base+'/sitemap.xml')).map(u=>new URL(u).pathname)].map(p=>p.replace(/\/$/,'')||'/'))];
 for(const route of paths){
  const response=await page.request.get(base+route);if(response.status()!==200){results.errors.push({route,status:response.status()});continue;}
  const html=await response.text();
  const meta=await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');return {title:doc.querySelector('title')?.textContent||'',description:doc.querySelector('meta[name=description]')?.getAttribute('content')||'',canonical:doc.querySelector('link[rel=canonical]')?.getAttribute('href'),images:[...doc.querySelectorAll('meta[property="og:image"]')].map(e=>e.getAttribute('content')),twitter:doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content'),robots:doc.querySelector('meta[name=robots]')?.getAttribute('content')||'',icon:doc.querySelector('link[rel=icon]')?.getAttribute('href')};},html);
  results.pages.push({route,...meta});
  assert.ok(meta.title,`Title missing on ${route}`);assert.ok(meta.description,`Description missing on ${route}`);
  assert.ok(meta.images.some(u=>u?.endsWith('/brand/page-preview.png')),`Approved brand preview missing on ${route}`);
  assert.ok(meta.twitter?.endsWith('/brand/page-preview.png'),`Twitter preview missing on ${route}`);
 }
 for(const field of ['title','description']){const used=new Map();for(const p of results.pages.filter(p=>!p.robots.includes('noindex'))){assert.ok(!used.has(p[field]),`Duplicate ${field}: ${p.route} and ${used.get(p[field])}`);used.set(p[field],p.route);}}
 for(const asset of ['/brand/page-preview.png','/brand/search-icon-96.png','/brand/search-icon-180.png'])assert.equal((await page.request.get(base+asset)).status(),200,`Missing image: ${asset}`);
 results.completed=true;
 console.log(JSON.stringify({pages:results.pages.length,mobile:results.mobile,errors:results.errors}));
}finally{await writeFile(`${out}/verification.json`,JSON.stringify(results,null,2));await browser.close();}
