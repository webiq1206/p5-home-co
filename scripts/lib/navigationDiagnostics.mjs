import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
export const MAX_ENTRY_EVENTS=100;
export function entryRoute(raw){try{const u=new URL(raw);return {path:['/','/estimate','/contact'].includes(u.pathname)?u.pathname:'other',review:u.searchParams.get('review')==='1'};}catch{return {path:'invalid',review:false};}}
export function safeEntryEvent(raw){
 const out={};
 for(const [key,values] of Object.entries({phase:['capture','after-dispatch'],kind:['event','dom-ready','navigation','navigation-request','page-error'],type:['pointerdown','pointerup','click','submit'],ready:['loading','interactive','complete'],fonts:['loading','loaded'],path:['/','/estimate','/contact','other','invalid']}))if(values.includes(raw?.[key]))out[key]=raw[key];
 for(const key of ['review','trusted','expectedLink','reactAttached','centerHitsLink','prevented'])if(typeof raw?.[key]==='boolean')out[key]=raw[key];
 for(const key of ['at','x','y','scrollY'])if(Number.isFinite(raw?.[key]))out[key]=raw[key];
 if(typeof raw?.tag==='string'&&/^[A-Z]{1,16}$/.test(raw.tag))out.tag=raw.tag;
 if(raw?.link)out.link=Object.fromEntries(['x','y','width','height'].filter(k=>Number.isFinite(raw.link[k])).map(k=>[k,raw.link[k]]));
 return out;
}
export async function startNavigationDiagnostics(context,page,{base,width,output,enabled}){
 if(!enabled)return null;
 if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Navigation diagnostics require an isolated local fixture');
 const events=[];const record=e=>{if(events.length<MAX_ENTRY_EVENTS)events.push(safeEntryEvent(e));};
 await page.exposeFunction('__p5EntryRecord',record);
 await page.addInitScript(()=>{
  const send=value=>{void window.__p5EntryRecord(value);};
  const state=()=>{const form=document.querySelector('[data-testid=consultation-wizard]'),a=document.querySelector('main a[href="/contact"]'),r=a?.getBoundingClientRect(),hit=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return {ready:document.readyState,fonts:document.fonts.status,reactAttached:!!form&&Object.keys(form).some(k=>k.startsWith('__reactFiber$')),scrollY,link:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,centerHitsLink:!!a&&!!hit&&(a===hit||a.contains(hit))};};
  for(const type of ['pointerdown','pointerup','click','submit'])document.addEventListener(type,e=>{
   const target=e.target,anchor=target instanceof Element?target.closest('a'):null;
   const sample={kind:'event',type,at:performance.now(),trusted:e.isTrusted,tag:target instanceof Element?target.tagName:'other',expectedLink:anchor?.getAttribute('href')==='/contact',x:Number.isFinite(e.clientX)?e.clientX:null,y:Number.isFinite(e.clientY)?e.clientY:null,...state()};
   send({...sample,phase:'capture',prevented:e.defaultPrevented});
   setTimeout(()=>send({...sample,phase:'after-dispatch',prevented:e.defaultPrevented}),0);
  },true);
  document.addEventListener('DOMContentLoaded',()=>send({kind:'dom-ready',at:performance.now(),...state()}),{once:true});
 });
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())record({kind:'navigation',...entryRoute(frame.url())});});
 page.on('request',request=>{if(request.isNavigationRequest())record({kind:'navigation-request',...entryRoute(request.url())});});
 page.on('pageerror',()=>record({kind:'page-error'}));
 await context.tracing.start({screenshots:true,snapshots:true,sources:false});
 const stem=path.join(output,`entry-webkit-${width}`);
 return {async finish(){
  await mkdir(output,{recursive:true});
  const final={...entryRoute(page.url()),events};
  await writeFile(stem+'.json',JSON.stringify(final,null,2));
  await context.tracing.stop({path:stem+'.zip'});
  return final;
 }};
}
