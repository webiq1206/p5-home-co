import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRenderer} from './p5-renderer-build.mjs';

/** Hosting may run npm install before our build command. Restore only the
 * committed lock, retaining the bootstrap copy for diagnostics. Uncommitted
 * source or package manifest edits are never silently overwritten. */
export function prepareReviewedLock(cwd=process.cwd()){
 const git=(...args)=>execFileSync('git',args,{cwd,stdio:['ignore','pipe','pipe']}).toString();
 const paths=git('diff','--name-only','HEAD','-z').split('\0').filter(Boolean);
 if(paths.some(path=>path!=='package-lock.json'))throw Error('Build requires committed source; review and commit changed tracked files first.');
 const manifest=git('show','HEAD:package.json');
 if(readFileSync(join(cwd,'package.json'),'utf8')!==manifest)throw Error('Package manifest differs from reviewed commit.');
 const reviewed=git('show','HEAD:package-lock.json');
 const current=readFileSync(join(cwd,'package-lock.json'),'utf8');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(current!==reviewed){
  const backup=mkdtempSync(join(tmpdir(),'p5-bootstrap-lock-'));
  writeFileSync(join(backup,'package-lock.json'),current,{mode:0o600});
  writeFileSync(join(cwd,'package-lock.json'),reviewed);
  return {restored:true,reviewedHash:hash(reviewed),bootstrapHash:hash(current),backup};
 }
 return {restored:false,reviewedHash:hash(reviewed)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const receipt=prepareReviewedLock();console.log('[p5-build] Reviewed dependency lock',receipt);
 buildRenderer();
 for(const args of [['ci','--no-audit','--no-fund'],['ci','--prefix','services/document-service','--omit=dev','--no-audit','--no-fund'],['run','build']]){
  const result=spawnSync('npm',args,{stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)process.exit(result.status||1);
 }
 const changed=execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim();
 if(changed)throw Error('Build changed reviewed inputs: '+changed);
}
