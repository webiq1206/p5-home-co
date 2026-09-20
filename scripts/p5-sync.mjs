// One estimator engine, five brands.
//
// boise-remodeling-co is the source of truth for the shared estimator. This
// script copies the shared files into a sibling brand repository and writes a
// manifest of their hashes there. `tests/p5-shared-engine.test.ts` fails a
// brand's build when a shared file was edited in that brand only, which is how
// fixes used to land on one site and never reach the others.
//
//   node scripts/p5-sync.mjs --to ../Boise-Handyman-Co [--dry]
//   node scripts/p5-sync.mjs --all [--dry]
//   node scripts/p5-sync.mjs --manifest        (refresh this repo's own manifest)
import {createHash} from 'node:crypto';
import {execSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const dry=args.includes('--dry');
const SIBLINGS=['p5-home-co','Boise-Construction-Co','Boise-Handyman-Co','Boise-Cabinet-Co'];

/** Files each brand owns. They are never copied and never listed in the manifest. */
export const BRAND_OWNED=['lib/p5/brand.ts','lib/p5/deliveryAdapter.ts','lib/p5/database.ts','lib/p5/adminAuth.ts','lib/p5/progress.ts','lib/p5/projectIntent.ts','lib/p5/typedAlternatives.ts','lib/p5/crmRecords.ts','lib/p5/shared-manifest.json'];
/** Shared files a brand may be missing on purpose (never deleted, never required). */
const SHARED_ROOTS=[
  {dir:'lib/p5',match:name=>/\.(ts|json)$/.test(name)},
  {dir:'components',match:name=>/^P5[A-Za-z]*\.(tsx|module\.css)$/.test(name),flat:true},
  {dir:'app/api/p5-estimator',match:name=>name==='route.ts'},
  {dir:'app/admin/p5-estimators',match:name=>name==='page.tsx',flat:true},
  {dir:'tests',match:name=>/^p5-.*\.test\.(ts|mjs)$/.test(name),flat:true},
  {dir:'tests/fixtures',match:name=>/^(p5-|crm)/.test(name),flat:true},
  {dir:'scripts',match:name=>/^(test-p5-|check-p5-|p5-|offline-network-guard)/.test(name)&&!/p5-sync\.mjs$/.test(name)||name==='p5-sync.mjs',flat:true},
  {dir:'scripts/lib',match:name=>/p5|livePricing|offline/i.test(name),flat:true},
];

function walk(dir,match,flat,base=dir){
  const absolute=path.join(root,dir);if(!existsSync(absolute))return [];
  return readdirSync(absolute,{withFileTypes:true}).flatMap(entry=>{
    const relative=path.posix.join(dir,entry.name);
    if(entry.isDirectory())return flat?[]:walk(relative,match,flat,base);
    return match(entry.name)?[relative]:[];
  });
}
export function sharedFiles(){return SHARED_ROOTS.flatMap(r=>walk(r.dir,r.match,r.flat)).filter(file=>!BRAND_OWNED.includes(file)).sort();}
const normalized=file=>readFileSync(file,'utf8').replace(/\r\n/g,'\n');
export const hashOf=file=>createHash('sha256').update(normalized(file)).digest('hex');

function manifest(files){
  let commit='';try{commit=execSync('git rev-parse HEAD',{cwd:root,stdio:['ignore','pipe','ignore']}).toString().trim();}catch{}
  return {source:'boise-remodeling-co',commit,generatedAt:new Date().toISOString(),note:'Shared estimator files. Edit them in boise-remodeling-co and run scripts/p5-sync.mjs; never edit them in one brand.',files:Object.fromEntries(files.map(file=>[file,hashOf(path.join(root,file))]))};
}
function writeManifest(target,files){const data=manifest(files);if(!dry)writeFileSync(path.join(target,'lib/p5/shared-manifest.json'),JSON.stringify(data,null,1)+'\n');return data;}

function syncTo(target){
  if(!existsSync(path.join(target,'lib/p5/brand.ts')))throw new Error(`${target} is not an estimator repository`);
  const files=sharedFiles();let copied=0,same=0;
  for(const file of files){
    const from=path.join(root,file),to=path.join(target,file);
    if(existsSync(to)&&normalized(to)===normalized(from)){same++;continue;}
    copied++;if(dry){console.log('  would copy',file);continue;}
    mkdirSync(path.dirname(to),{recursive:true});
    // Keep the target's line-ending convention so Git sees content changes only.
    const crlf=existsSync(to)?readFileSync(to,'utf8').includes('\r\n'):readFileSync(from,'utf8').includes('\r\n');
    writeFileSync(to,crlf?normalized(from).replace(/\n/g,'\r\n'):normalized(from));
  }
  // Retired shared modules must not linger in a brand as unreferenced forks.
  const previous=existsSync(path.join(target,'lib/p5/shared-manifest.json'))?Object.keys(JSON.parse(readFileSync(path.join(target,'lib/p5/shared-manifest.json'),'utf8')).files):[];
  const retired=previous.filter(file=>!files.includes(file)&&existsSync(path.join(target,file)));
  for(const file of retired){console.log('  retired',file);if(!dry)rmSync(path.join(target,file));}
  writeManifest(target,files);
  // A shared file the target's .gitignore hides exists on this disk only: the
  // brand's deploy would then fail the shared-engine check for a missing file.
  let ignored=[];try{ignored=execSync('git check-ignore --stdin',{cwd:target,input:files.join('\n'),stdio:['pipe','pipe','ignore']}).toString().split(/\r?\n/).filter(Boolean);}catch{}
  if(ignored.length){console.error(`${path.basename(target)}: ${ignored.length} shared files are git-ignored there and would never deploy:\n  ${ignored.join('\n  ')}`);process.exitCode=1;}
  console.log(`${path.basename(target)}: ${copied} copied, ${same} already identical, ${retired.length} retired, ${files.length} shared files`);
}

if(args.includes('--manifest')){writeManifest(root,sharedFiles());console.log('manifest refreshed');}
else{
  const targets=args.includes('--all')?SIBLINGS.map(name=>path.resolve(root,'..',name)):args.flatMap((a,i)=>a==='--to'?[path.resolve(args[i+1])]:[]);
  if(!targets.length){console.error('Usage: node scripts/p5-sync.mjs --to <repo> | --all | --manifest [--dry]');process.exit(1);}
  if(!dry)writeManifest(root,sharedFiles());
  for(const target of targets)syncTo(target);
}
