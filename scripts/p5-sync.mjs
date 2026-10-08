// One estimator engine, five brands.
//
// p5-home-co is the source of truth for the shared estimator: the conversational
// project intake, review and delivery engine was qualified here first. This
// script copies the shared files into a sibling brand repository and writes a
// manifest of their hashes there. `tests/p5-shared-engine.test.ts` fails a
// brand's build when a shared file was edited in that brand only, which is how
// fixes used to land on one site and never reach the others.
//
//   node scripts/p5-sync.mjs --to ../boise-handyman-co [--dry]
//   node scripts/p5-sync.mjs --all [--dry]
//   node scripts/p5-sync.mjs --manifest        (refresh this repo's own manifest)
import {createHash} from 'node:crypto';
import {execSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);const dry=args.includes('--dry');
// Sibling checkouts live next to this repository under their GitHub names;
// older local clones used Title-Case folder names, so both spellings resolve.
const SIBLINGS=['boise-remodeling-co','boise-construction-co','boise-handyman-co','boise-cabinet-co'];
function siblingPath(name){const candidates=[name,name.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('-')].map(dir=>path.resolve(root,'..',dir));return candidates.find(dir=>existsSync(dir))||candidates[0];}

/** Files each brand owns. They are never copied, never listed in the manifest and never retired. */
export const BRAND_OWNED=['lib/p5/brand.ts','lib/p5/deliveryAdapter.ts','lib/p5/intakeDeliveryRuntime.ts','lib/p5/intakeCrmValidation.ts','tests/p5-intake-local-crm.test.ts','lib/p5/database.ts','lib/p5/adminAuth.ts','lib/p5/progress.ts','lib/p5/projectIntent.ts','lib/p5/typedAlternatives.ts','lib/p5/crmRecords.ts','lib/p5/shared-manifest.json',
  // Database preservation tooling and the pricing recovery harness follow each site's own schema and document service.
  'scripts/p5-schema-statements.mjs','scripts/p5-prepare-database.mjs','tests/p5-database-safety.test.mjs','scripts/test-p5-pricing-recovery.mts'];
/** Modules that exist only in p5-home-co: its QA continuation service, the document service and
 * the local lead receiver. They are never copied or listed, and no shared file may import them. */
export const P5_ONLY=['lib/p5/qaContinuation.ts','lib/p5/qaContinuationEndpoint.ts','lib/p5/qaOrigin.ts','lib/p5/qaSavedEstimate.ts','lib/p5/qaSavedEstimateEndpoint.ts','lib/p5/qaSavedReadingEndpoint.ts',
  'components/P5QaContinuation.tsx','components/P5QaSavedEstimate.tsx','components/P5QaSavedReading.tsx',
  'scripts/check-p5-live-pricing-guarded.mts','scripts/check-p5-recovery-request.mjs','scripts/lib/recoveryTransport.mjs','scripts/p5-qa-recovery-browser.mjs','scripts/p5-qa-saved-auth-fixture.mjs','scripts/p5-qa-saved-browser.mjs','scripts/p5-reference-files.mts','scripts/test-p5-qa-paid.mts','scripts/test-p5-recovery-request.mjs','scripts/test-p5-recovery-transport.mjs',
  'tests/p5-document-followups.test.ts','tests/p5-qa-continuation.test.ts','tests/p5-qa-origin.test.ts','tests/p5-qa-saved-estimate.test.ts','tests/p5-qa-saved-reading.test.ts','tests/p5-synthetic-crm.test.ts'];
/** Site modules every brand provides at the same path, so shared files may import them. */
const SITE_MODULES=['lib/googleAdsConversion.ts','lib/brand-page-metadata.ts'];
/** Shared files a brand may be missing on purpose (never deleted, never required). */
const SHARED_ROOTS=[
  {dir:'lib/p5',match:name=>/\.(ts|json)$/.test(name)},
  {dir:'components',match:name=>/^P5[A-Za-z]*\.(tsx|module\.css)$/.test(name),flat:true},
  {dir:'app/api/p5-estimator',match:name=>name==='route.ts'},
  {dir:'app/api/admin/p5-intake',match:name=>name==='route.ts'},
  {dir:'app/admin/p5-estimators',match:name=>name==='page.tsx',flat:true},
  {dir:'tests',match:name=>/^p5-.*\.test\.(ts|mjs)$/.test(name),flat:true},
  {dir:'tests/fixtures',match:name=>/^(p5-|crm)/.test(name),flat:true},
  {dir:'scripts',match:name=>/^(test-p5-|check-p5-|p5-|offline-network-guard)/.test(name)&&!/p5-sync\.mjs$/.test(name)||name==='p5-sync.mjs',flat:true},
  {dir:'scripts/lib',match:name=>/\.(ts|mts|mjs)$/.test(name),flat:true},
];

function walk(dir,match,flat,base=dir){
  const absolute=path.join(root,dir);if(!existsSync(absolute))return [];
  return readdirSync(absolute,{withFileTypes:true}).flatMap(entry=>{
    const relative=path.posix.join(dir,entry.name);
    if(entry.isDirectory())return flat?[]:walk(relative,match,flat,base);
    return match(entry.name)?[relative]:[];
  });
}
export function sharedFiles(){const files=SHARED_ROOTS.flatMap(r=>walk(r.dir,r.match,r.flat)).filter(file=>!BRAND_OWNED.includes(file)&&!P5_ONLY.includes(file)).sort();assertPortable(files);return files;}
const RESOLVE_EXTENSIONS=['','.ts','.tsx','.mts','.mjs','.js','/index.ts','/index.tsx'];
function resolveImport(file,specifier){
  const base=path.resolve(root,path.dirname(file),specifier);
  for(const extension of RESOLVE_EXTENSIONS){const candidate=base+extension;if(existsSync(candidate)&&statSync(candidate).isFile())return path.relative(root,candidate).split(path.sep).join('/');}
  return null;// harness scripts generate their own override modules at run time
}
/** A shared file that reaches into a module other brands do not have would break every
 * sibling's build; such a file belongs in P5_ONLY or BRAND_OWNED instead. */
export function assertPortable(files){
  const allowed=new Set([...files,...BRAND_OWNED,...SITE_MODULES]);const problems=[];
  for(const file of files){
    if(!/\.(ts|tsx|mts|mjs)$/.test(file))continue;
    const source=readFileSync(path.join(root,file),'utf8');
    for(const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)){const target=resolveImport(file,match[1]);if(target&&!allowed.has(target))problems.push(`${file} imports ${target}`);}
  }
  if(problems.length)throw new Error(`Shared files depend on modules other brands do not have. List them in P5_ONLY or BRAND_OWNED:\n  ${problems.join('\n  ')}`);
}
const normalized=file=>readFileSync(file,'utf8').replace(/\r\n/g,'\n');
export const hashOf=file=>createHash('sha256').update(normalized(file)).digest('hex');

function manifest(files){
  let commit='';try{commit=execSync('git rev-parse HEAD',{cwd:root,stdio:['ignore','pipe','ignore']}).toString().trim();}catch{}
  return {source:'p5-home-co',commit,generatedAt:new Date().toISOString(),note:'Shared estimator engine published from p5-home-co. Edit shared files there and run scripts/p5-sync.mjs; hash checks remain mandatory in every brand.',files:Object.fromEntries(files.map(file=>[file,hashOf(path.join(root,file))]))};
}
function writeManifest(target,files){const data=manifest(files);if(!dry)writeFileSync(path.join(target,'lib/p5/shared-manifest.json'),JSON.stringify(data,null,2)+'\n');return data;}

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
  const retired=previous.filter(file=>!files.includes(file)&&!BRAND_OWNED.includes(file)&&existsSync(path.join(target,file)));
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
  // Only the source may publish. A sibling that ran this would overwrite the fleet with its own copy.
  const packageName=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name;
  if(packageName!=='p5-home-co-nextjs')throw new Error(`Run the sync from p5-home-co, the shared engine source (this is ${packageName}).`);
  const targets=args.includes('--all')?SIBLINGS.map(siblingPath):args.flatMap((a,i)=>a==='--to'?[path.resolve(args[i+1])]:[]);
  if(!targets.length){console.error('Usage: node scripts/p5-sync.mjs --to <repo> | --all | --manifest [--dry]');process.exit(1);}
  if(!dry)writeManifest(root,sharedFiles());
  for(const target of targets)syncTo(target);
}
