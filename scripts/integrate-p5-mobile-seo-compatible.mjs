import fs from 'node:fs';
import ts from 'typescript';
const brandPath='lib/p5/brand.ts';
const original=fs.readFileSync(brandPath,'utf8');
const js=ts.transpileModule(original,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {ESTIMATOR_BRAND}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const nav=ESTIMATOR_BRAND.id==='p5'?'components/MobileActionBar.tsx':'components/Navigation.tsx';
if(fs.readFileSync(nav,'utf8').includes('data-mobile-actions-version="2026-09-16.2"')){
  fs.mkdirSync('p5-mobile-seo-verification',{recursive:true});
  fs.writeFileSync('p5-mobile-seo-verification/implementation.json',JSON.stringify({brand:ESTIMATOR_BRAND.id,changed:[],wrapped:[],generatedImages:[],alreadyIntegrated:true},null,2));
}else{
  try{
    fs.writeFileSync(brandPath,'export const ESTIMATOR_BRAND = '+JSON.stringify(ESTIMATOR_BRAND,null,2)+' as const;\n');
    await import('./integrate-p5-mobile-seo.mjs');
  }finally{fs.writeFileSync(brandPath,original);}
}
const helper='lib/brand-page-metadata.ts';
fs.writeFileSync(helper,fs.readFileSync(helper,'utf8').replace("from './p5/brand';","from './p5/brand.ts';"));
const uiPath='components/P5Estimator.tsx';let ui=fs.readFileSync(uiPath,'utf8');
if(!ui.includes('active.handoff')){
  const detail='{active.detail&&<details className={styles.context}><summary className={styles.hint}>Why we ask</summary><p className={styles.hint}>{active.detail}</p></details>}';
  if(!ui.includes(detail))throw Error('Inspect changed handoff question markup');
  ui=ui.replace(detail,'{active.detail&&(active.handoff?<p className={styles.hint}>{active.detail}</p>:<details className={styles.context}><summary className={styles.hint}>Why we ask</summary><p className={styles.hint}>{active.detail}</p></details>)}{active.handoff&&<div className={styles.actions}><a className={styles.primary} href={active.handoff.url}>{active.handoff.label}</a></div>}');
  ui=ui.replace(/<div className=\{styles\.questionActions\}>[\s\S]*?<\/div>/,match=>'{!active.handoff&&'+match+'}');
  const dock='    :stage===2?<>';
  if(!ui.includes(dock))throw Error('Inspect changed estimator dock before handoff integration');
  ui=ui.replace(dock,'    :stage===1&&active?.handoff?<div className={styles.dockBar}><a className={styles.primary} href={active.handoff.url}>{active.handoff.label}</a></div>\n'+dock);
  ui=ui.replace("async function advance({skip=false,clarification}:{skip?:boolean;clarification?:string}={}){", "async function advance({skip=false,clarification}:{skip?:boolean;clarification?:string}={}){\n    if(active?.handoff)return;");
  fs.writeFileSync(uiPath,ui);
}
const versionPath='lib/p5/version.ts';fs.writeFileSync(versionPath,"/** Deployed estimator UI and metadata release marker. */\nexport const ESTIMATOR_VERSION='2026-09-16.2-mobile-seo';\n");
const manifestPath='p5-mobile-seo-verification/implementation.json';const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));manifest.changed=[...new Set([...manifest.changed,uiPath,versionPath])];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
