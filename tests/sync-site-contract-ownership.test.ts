import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('shared transport neither overwrites nor retires site-owned conversion and privacy tests',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'p5-site-contracts-'));
 const source=path.join(dir,'source'),target=path.join(dir,'brand');
 const contracts=['tests/p5-estimator-conversion-acceptance.test.ts','tests/p5-privacy-ads-disclosure.test.ts','tests/p5-privacy-section-5.test.ts'];
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
 const write=(root:string,file:string,value:string)=>{mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),value);};
 try{
  write(source,'package.json',JSON.stringify({name:'p5-home-co-nextjs'}));
  write(target,'package.json',JSON.stringify({name:'brand-fixture'}));
  write(source,'scripts/p5-sync.mjs',readFileSync(new URL('../scripts/p5-sync.mjs',import.meta.url),'utf8'));
  write(source,'lib/p5/brand.ts','export const brand="P5";\n');
  write(target,'lib/p5/brand.ts','export const brand="Local brand";\n');
  write(source,'lib/p5/shared.ts','export const shared="current";\n');
  write(target,'lib/p5/shared.ts','export const shared="previous";\n');
  for(const file of contracts){write(source,file,'// P5-specific accepted-conversion and legal-route contract.\n');write(target,file,'// Existing local conversion and privacy contract.\n');}
  write(target,'keep.txt','Unrelated work remains intact.');
  write(target,'lib/p5/shared-manifest.json',JSON.stringify({files:Object.fromEntries([...contracts.map(file=>[file,hash('// Existing local conversion and privacy contract.\n')]),['lib/p5/shared.ts',hash('export const shared="previous";\n')]])}));
  const result=spawnSync(process.execPath,[path.join(source,'scripts/p5-sync.mjs'),'--to',target],{cwd:source,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(readFileSync(path.join(target,'lib/p5/shared-manifest.json'),'utf8'));
  for(const file of contracts){
   assert.match(readFileSync(path.join(source,file),'utf8'),/P5-specific/,'P5 keeps its active tests');
   assert.equal(readFileSync(path.join(target,file),'utf8'),'// Existing local conversion and privacy contract.\n',file);
   assert.equal(Object.hasOwn(manifest.files,file),false,file);
  }
  assert.equal(readFileSync(path.join(target,'lib/p5/shared.ts'),'utf8'),'export const shared="current";\n');
  assert.equal(readFileSync(path.join(target,'keep.txt'),'utf8'),'Unrelated work remains intact.');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
