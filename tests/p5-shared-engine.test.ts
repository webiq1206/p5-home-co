import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';

// The estimator is one engine shared by five brand sites. Fixes used to land in
// one brand's copy and never reach the others. Shared files are edited only in
// boise-remodeling-co and copied out with `node scripts/p5-sync.mjs --all`,
// which records their hashes here. This test fails a brand's build when a
// shared file was changed in that brand alone.
const manifestUrl=new URL('../lib/p5/shared-manifest.json',import.meta.url);
const hash=(file:URL)=>createHash('sha256').update(readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex');

test('shared estimator files match the synced engine',{skip:existsSync(manifestUrl)?false:'no shared manifest yet'},()=>{
  const manifest=JSON.parse(readFileSync(manifestUrl,'utf8')) as {source:string;commit:string;files:Record<string,string>};
  const changed:string[]=[],missing:string[]=[];
  for(const [file,expected] of Object.entries(manifest.files)){
    const url=new URL('../'+file,import.meta.url);
    if(!existsSync(url)){missing.push(file);continue;}
    if(hash(url)!==expected)changed.push(file);
  }
  assert.deepEqual({changed,missing},{changed:[],missing:[]},`Shared estimator files differ from ${manifest.source}@${manifest.commit.slice(0,8)}. Make the change in boise-remodeling-co, then run: node scripts/p5-sync.mjs --all`);
});

test('brand-owned files stay out of the shared manifest',{skip:existsSync(manifestUrl)?false:'no shared manifest yet'},()=>{
  const manifest=JSON.parse(readFileSync(manifestUrl,'utf8')) as {files:Record<string,string>};
  for(const owned of ['lib/p5/brand.ts','lib/p5/deliveryAdapter.ts','lib/p5/database.ts','lib/p5/adminAuth.ts','lib/p5/progress.ts'])assert.equal(owned in manifest.files,false,owned);
});
