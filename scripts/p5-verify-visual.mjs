import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const out='p5-verification';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const widths=[320,390,430,768,1024,1440,1920];
const parent=process.env.P5_PARENT==='1';
const routes=parent?['/','/quote','/sitemap','/legal/terms','/legal/privacy','/legal/quickbooks-disconnect']:['/','/services','/about','/contact','/testimonials'];
const results=[];
let failed=false;
function check(ok,message){if(!ok)throw new Error(message);}
try {
 for(const width of widths) {
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<768});
  const page=await context.newPage();
  for(const route of routes) {
   const errors=[];const handler=e=>errors.push(e.message);page.on('pageerror',handler);
   try {
    const response=await page.goto('http://127.0.0.1:5000'+route,{waitUntil:'networkidle'});
    check(response.status()<400,route+' status '+response.status());
    await page.evaluate(async()=>{await document.fonts.ready; for(let y=0;y<document.documentElement.scrollHeight;y+=650){window.scrollTo({top:y,behavior:'instant'});await new Promise(r=>setTimeout(r,70));}});
    await page.waitForTimeout(700);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.currentSrc)}));
    check(geometry.scrollWidth<=geometry.width+1,'Horizontal overflow '+JSON.stringify(geometry));
    check(!geometry.broken.length,'Broken images '+geometry.broken.join(','));
    check(!errors.length,'Browser errors '+errors.join(','));
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:`${out}/${width}-${route.replaceAll('/','_')||'home'}.jpg`,fullPage:true,type:'jpeg',quality:70});
    results.push({width,route,ok:true,geometry});
   }catch(e){failed=true;results.push({width,route,ok:false,error:String(e)});}
   page.off('pageerror',handler);
  }
  if(!parent) {
   try {
    await page.goto('http://127.0.0.1:5000/p5-audit-fixture',{waitUntil:'networkidle'});
    const slider=page.getByTestId('handle-before-after'); const container=page.getByTestId('slider-before-after');
    await container.scrollIntoViewIfNeeded();
    await slider.focus();await page.keyboard.press('Home');check(await slider.getAttribute('aria-valuenow')==='0','Home');
    const atStart=await slider.boundingBox(),box=await container.boundingBox();check(atStart.x>=box.x,'Handle clipped at start');
    await page.keyboard.press('End');check(await slider.getAttribute('aria-valuenow')==='100','End');
    const atEnd=await slider.boundingBox();check(atEnd.x+atEnd.width<=box.x+box.width+1,'Handle clipped at end');
    await page.keyboard.press('ArrowLeft');check(await slider.getAttribute('aria-valuenow')==='96','ArrowLeft');
    const y=box.y+box.height/2;
    await page.mouse.move(box.x+box.width*.25,y);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,y,{steps:12});await page.mouse.up();
    check(Math.abs(Number(await slider.getAttribute('aria-valuenow'))-75)<2,'Mouse drag');
    if(width<768){
     const cdp=await context.newCDPSession(page);
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.7,y}]});
     for(let i=0;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(.7-.04*i),y}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     check(Math.abs(Number(await slider.getAttribute('aria-valuenow'))-30)<3,'Touch drag');
    }
    const grid=await page.locator('#four-cards').evaluate(el=>[...el.children].map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})));
    if(width>=1024)check(grid[0].y===grid[1].y&&grid[2].y===grid[3].y&&grid[0].y!==grid[2].y,'Four-card grid is not 2 by 2');
    results.push({width,route:'slider-and-grid',ok:true});
    await page.screenshot({path:`${out}/${width}-slider-grid.jpg`,fullPage:true,type:'jpeg',quality:70});
   }catch(e){failed=true;results.push({width,route:'slider-and-grid',ok:false,error:String(e)});}
  }
  await context.close();
  await fs.writeFile(out+'/results.json',JSON.stringify(results,null,2));
 }
}finally{await browser.close();}
console.log(JSON.stringify(results.map(({width,route,ok,error})=>({width,route,ok,error})),null,2));
if(failed)process.exitCode=1;
