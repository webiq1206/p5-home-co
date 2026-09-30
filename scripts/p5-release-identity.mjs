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
 for(const path of paths){
  digest.update(path+'\0');
  try{const file=join(cwd,path),stat=lstatSync(file);digest.update(stat.isSymbolicLink()?'link\0':(stat.mode&0o111)?'executable\0':'file\0');digest.update(stat.isSymbolicLink()?readlinkSync(file):readFileSync(file));}
  catch{digest.update('missing\0');}
  digest.update('\0');
 }
 return {sha:git('rev-parse','HEAD').trim(),tree:git('log','-1','--format=%T').trim(),
  dirty:git('status','--porcelain','--untracked-files=no').trim()!=='',
  changedPaths:git('diff','HEAD','--name-only','-z').split('\0').filter(Boolean).sort(),
  sourceDigest:paths.length?digest.digest('hex'):'',trackedFiles:paths.length,builtAt:new Date().toISOString()};
}
