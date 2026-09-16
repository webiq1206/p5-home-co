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
    // Restore the source byte-for-byte after generating this compatibility input.
    fs.writeFileSync(brandPath,'export const ESTIMATOR_BRAND = '+JSON.stringify(ESTIMATOR_BRAND,null,2)+' as const;\n');
    await import('./integrate-p5-mobile-seo.mjs');
  }finally{fs.writeFileSync(brandPath,original);}
}
const helper='lib/brand-page-metadata.ts';
fs.writeFileSync(helper,fs.readFileSync(helper,'utf8').replace("from './p5/brand';","from './p5/brand.ts';"));
