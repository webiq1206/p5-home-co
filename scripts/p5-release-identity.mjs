import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,readlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

/** Attest actual tracked build inputs, not merely the commit's tree. Content
 * is hashed locally; no source contents or environment values are exposed. */
export function buildReleaseIdentity(cwd=process.cwd()){
 const git=(...args)=>{try{return execFileSync('git',args,{cwd,stdio:['ignore','pipe','ignore']}).toString();}catch{return '';}};
 const paths=git('ls-files','-z').split('\0').filter(Boolean).sort();
 const digest=createHash('sha256');
 const lockfileEvidence=[];
 for(const path of paths){
  digest.update(path+'\0');
  try{const file=join(cwd,path),stat=lstatSync(file);digest.update(stat.isSymbolicLink()?'link\0':(stat.mode&0o111)?'executable\0':'file\0');digest.update(stat.isSymbolicLink()?readlinkSync(file):readFileSync(file));}
  catch{digest.update('missing\0');}
  digest.update('\0');
 }
 // Hosting can rewrite a lockfile in an ephemeral build copy. Retain hashes
 // and changed JSON keys so the published receipt can explain that change
 // after the build copy is gone, without publishing dependency URLs or tokens.
 for(const path of paths.filter(path=>/(^|\/)package-lock\.json$/.test(path))){
  const baseline=git('show',`HEAD:${path}`);let actual='';
  try{actual=readFileSync(join(cwd,path),'utf8');}catch{continue;}
  if(!baseline||baseline===actual)continue;
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const receipt={path,baselineSha256:hash(baseline),buildSha256:hash(actual),changedTopLevelKeys:[],changedPackages:[]};
  try{
   const before=JSON.parse(baseline),after=JSON.parse(actual);
   receipt.changedTopLevelKeys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>key!=='packages'&&JSON.stringify(before[key])!==JSON.stringify(after[key])).sort();
   receipt.changedPackages=[...new Set([...Object.keys(before.packages||{}),...Object.keys(after.packages||{})])].filter(key=>JSON.stringify(before.packages?.[key])!==JSON.stringify(after.packages?.[key])).sort().map(path=>({path,keys:[...new Set([...Object.keys(before.packages?.[path]||{}),...Object.keys(after.packages?.[path]||{})])].filter(key=>JSON.stringify(before.packages?.[path]?.[key])!==JSON.stringify(after.packages?.[path]?.[key])).sort()}));
  }catch{receipt.changedTopLevelKeys=['unparseable'];}
  lockfileEvidence.push(receipt);
 }
 return {sha:git('rev-parse','HEAD').trim(),tree:git('log','-1','--format=%T').trim(),
  dirty:git('status','--porcelain','--untracked-files=no').trim()!=='',
  changedPaths:git('diff','HEAD','--name-only','-z').split('\0').filter(Boolean).sort(),
  sourceDigest:paths.length?digest.digest('hex'):'',trackedFiles:paths.length,lockfileEvidence,builtAt:new Date().toISOString()};
}
