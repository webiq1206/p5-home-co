import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,existsSync,lstatSync,cpSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildRenderer} from './p5-renderer-build.mjs';
import {verifyMigrationFiles} from './p5-schema-safety.mjs';
import {migrationDeferred} from './p5-migration-state.mjs';

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

/** Deployment snapshots can contain interrupted next dev output. Next's
 * production type check includes .next/dev/types via tsconfig, so preserve
 * that generated directory outside the build input instead of compiling it.
 * This runs only in the isolated host build; it does not stop a workspace dev
 * server, delete its history, or weaken production type checking. */
export function preserveDevelopmentBuild(cwd=process.cwd()){
 const generated=join(cwd,'.next','dev');
 if(!existsSync(generated))return {preserved:false};
 if(!lstatSync(generated).isDirectory())throw Error('Expected a generated development-build directory.');
 const tracked=execFileSync('git',['ls-files','--','.next/dev'],{cwd,encoding:'utf8'}).trim();
 if(tracked)throw Error('Refusing to move tracked development-build files.');
 const backup=mkdtempSync(join(tmpdir(),'p5-development-build-'));
 // /tmp and the hosting workspace may be different filesystems. Finish the
 // backup before removing the generated input; a copy failure leaves it intact.
 cpSync(generated,join(backup,'dev'),{recursive:true,errorOnExist:true,force:false});
 rmSync(generated,{recursive:true});
 return {preserved:true,backup};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const receipt=prepareReviewedLock();console.log('[p5-build] Reviewed dependency lock',receipt);
 const migration17=readdirSync(resolve('migrations')).filter(name=>/^017(?:_|\.)/.test(name));
 if(migration17.some(name=>!migrationDeferred(name)))throw Error('P5 release permits only the explicitly deferred migration017 source.');
 if(migration17.length)console.log('[p5-build] Migration017 retained as deferred source; startup migrator will not execute or record it.');
 // Retain the non-destructive SQL source gate without npm prebuild's tests.
 // This only reads migration files; it never connects to a database.
 verifyMigrationFiles();
 buildRenderer();
 for(const args of [['ci','--no-audit','--no-fund'],['ci','--prefix','services/document-service','--omit=dev','--no-audit','--no-fund']]){
  const result=spawnSync('npm',args,{stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)process.exit(result.status||1);
 }
 // Deployment compilation only. Normal npm build/prebuild and CI retain
 // their existing checks; P5 functional acceptance runs on the live site.
 console.log('[p5-build] Preserved generated development output',preserveDevelopmentBuild());
 const compiled=spawnSync(process.execPath,[resolve('node_modules/next/dist/bin/next'),'build'],{stdio:'inherit',env:process.env});
 if(compiled.error||compiled.status!==0)process.exit(compiled.status||1);
 const changed=execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim();
 if(changed)throw Error('Build changed reviewed inputs: '+changed);
}
