// Narrow reviewed-file synchronization. Never a full engine sync.
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const normalized=file=>readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const hash=file=>createHash('sha256').update(normalized(file)).digest('hex');
const RUNTIME_ALLOWLIST=new Set(['components/P5MobileActions.tsx','lib/p5/estimatorRoutes.ts','tests/p5-estimator-chrome.test.ts','tests/p5-mobile-action-policy.test.ts']);
const allowed=file=>RUNTIME_ALLOWLIST.has(file)||/^(?:scripts\/(?:p5-[\w-]+|lib\/[\w-]+)\.mjs|tests\/p5-[\w-]+\.test\.mjs)$/.test(file);
function noSymlinks(root,absolute){
 for(let p=absolute;p!==root;p=path.dirname(p)){
  let stat;try{stat=lstatSync(p);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(stat.isSymbolicLink())throw Error(`Symlink is not a synchronization target: ${absolute}`);
 }
}
function safe(root,file){
 if(!allowed(file))throw Error(`Not an allowed selected file: ${file}`);
 const absolute=path.resolve(root,file);if(!absolute.startsWith(root+path.sep))throw Error('Path escapes repository');
 noSymlinks(root,absolute);
 return absolute;
}
export function syncSelected({source,target,files,commit,dry=false}){
 source=realpathSync(source);target=realpathSync(target);
 if(source===target)throw Error('Source and target must differ');
 if(JSON.parse(readFileSync(path.join(source,'package.json'))).name!=='p5-home-co-nextjs')throw Error('Canonical P5 source required');
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Exact source commit required');
 if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length)throw Error('Explicit unique file list required');
 const manifestPath=path.join(target,'lib/p5/shared-manifest.json');
 noSymlinks(target,manifestPath);
 noSymlinks(source,path.join(source,'lib/p5/shared-manifest.json'));
 noSymlinks(source,path.join(source,'package.json'));
 const original=JSON.parse(readFileSync(manifestPath,'utf8'));
 const canonical=JSON.parse(readFileSync(path.join(source,'lib/p5/shared-manifest.json'),'utf8'));
 const selected=new Set(files);
 const plan=files.map(file=>{
  const from=safe(source,file),to=safe(target,file);
  if(!canonical.files[file]||hash(from)!==canonical.files[file])throw Error(`Source is not manifest-qualified: ${file}`);
  const before=existsSync(to)?hash(to):null;
  if(before!==null&&before!==original.files[file])throw Error(`Unreconciled target change: ${file}`);
  if(before===null&&original.files[file])throw Error(`Tracked target is missing: ${file}`);
  for(const match of normalized(from).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
   const dependency=path.resolve(path.dirname(to),match[1]);
   const relative=path.relative(target,dependency).split(path.sep).join('/');
   if(!dependency.startsWith(target+path.sep))throw Error(`Dependency escapes target: ${file}`);
   if(!existsSync(dependency)&&!selected.has(relative))throw Error(`Missing target dependency ${relative} for ${file}`);
  }
  return {file,from,to,before,after:canonical.files[file]};
 });
 if(dry)return plan.map(({file,before,after})=>({file,before,after}));
 const next=structuredClone(original);
 for(const item of plan){
  const crlf=existsSync(item.to)&&readFileSync(item.to,'utf8').includes('\r\n');
  mkdirSync(path.dirname(item.to),{recursive:true});
  writeFileSync(item.to,crlf?normalized(item.from).replace(/\n/g,'\r\n'):normalized(item.from));
  next.files[item.file]=item.after;
 }
 const key=files.some(file=>RUNTIME_ALLOWLIST.has(file))?'selectiveSourceBatches':'selectiveVerificationBatches';
 next[key]=[...(original[key]||[]),{source:'p5-home-co',commit,files:plan.map(({file,before,after})=>({file,before,after})),note:'Only explicitly listed files synchronized; other files and provenance retained. Runtime scope is restricted to mobile-action and route-presentation compatibility.'}];
 writeFileSync(manifestPath,JSON.stringify(next,null,2)+'\n');
 return plan.map(({file,before,after})=>({file,before,after}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const args=process.argv.slice(2),index=args.indexOf('--to');
 if(index<0||!args[index+1])throw Error('Usage: node scripts/p5-sync-selected.mjs --to <repo> --file <path> [--file <path>] [--dry]');
 const files=args.flatMap((a,i)=>a==='--file'?[args[i+1]]:[]);
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 for(const file of files){safe(source,file);const committed=execFileSync('git',['show',`${commit}:${file}`],{cwd:source,encoding:'utf8'}).replace(/\r\n/g,'\n');if(committed!==normalized(path.join(source,file)))throw Error(`Uncommitted canonical file: ${file}`);}
 console.log(JSON.stringify(syncSelected({source,target:args[index+1],files,commit,dry:args.includes('--dry')}),null,2));
}
