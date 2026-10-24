import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareReviewedLock,preserveDevelopmentBuild} from '../scripts/p5-host-build.mjs';
import {rendererBuildCommands,buildRenderer} from '../scripts/p5-renderer-build.mjs';
test('host renderer build pins wheel hashes, keeps installation project-local, and probes before release',()=>{
 const commands=rendererBuildCommands('/project','linux');
 assert.deepEqual(commands[0],['python3',['-m','venv',join('/project','.p5-renderer')]]);
 assert.ok(commands[1][1].includes('--require-hashes'));assert.ok(commands[1][1].includes('--no-deps'));assert.ok(commands[1][1].includes('--only-binary=:all:'));
 assert.equal(commands[2][1].at(-1),'--probe');
 let calls=0;assert.throws(()=>buildRenderer('/project',()=>{calls++;return {status:1} as any;}),/renderer build/);assert.equal(calls,1);
});
test('host build restores bootstrap lock drift but refuses unreviewed source changes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'p5-host-fixture-'));
 try{
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'ignore'});
  git('init');git('config','user.name','Test');git('config','user.email','test@example.test');
  writeFileSync(join(dir,'package.json'),'{}\n');writeFileSync(join(dir,'package-lock.json'),'{"lockfileVersion":3}\n');writeFileSync(join(dir,'source.ts'),'original');git('add','.');git('commit','-m','fixture');
  assert.equal(prepareReviewedLock(dir).restored,false);
  writeFileSync(join(dir,'package-lock.json'),'{"lockfileVersion":3,"changed":true}\n');
  const restored=prepareReviewedLock(dir);assert.equal(restored.restored,true);assert.equal(readFileSync(join(dir,'package-lock.json'),'utf8'),'{"lockfileVersion":3}\n');
  assert.match(readFileSync(join(restored.backup!,'package-lock.json'),'utf8'),/changed/);rmSync(restored.backup!,{recursive:true});
  writeFileSync(join(dir,'source.ts'),'unreviewed');assert.throws(()=>prepareReviewedLock(dir),/committed source/);assert.equal(readFileSync(join(dir,'source.ts'),'utf8'),'unreviewed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('host build preserves interrupted dev validators without removing production types or tracked files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'p5-dev-build-fixture-'));let backup:string|undefined;
 try{
  const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'ignore'});
  git('init');
  assert.equal(preserveDevelopmentBuild(dir).preserved,false);
  mkdirSync(join(dir,'.next','dev','types'),{recursive:true});mkdirSync(join(dir,'.next','types'),{recursive:true});
  const stale='malformed interrupted development validator';
  writeFileSync(join(dir,'.next','dev','types','validator.ts'),stale);
  writeFileSync(join(dir,'.next','types','validator.ts'),'production validator');
  git('add','-f','.next/dev/types/validator.ts');
  assert.throws(()=>preserveDevelopmentBuild(dir),/tracked development-build/);
  assert.equal(readFileSync(join(dir,'.next','dev','types','validator.ts'),'utf8'),stale);
  git('rm','--cached','.next/dev/types/validator.ts');
  const result=preserveDevelopmentBuild(dir);backup=result.backup;
  assert.equal(result.preserved,true);assert.equal(existsSync(join(dir,'.next','dev')),false);
  assert.equal(readFileSync(join(backup!,'dev','types','validator.ts'),'utf8'),stale);
  assert.equal(readFileSync(join(dir,'.next','types','validator.ts'),'utf8'),'production validator');
  assert.equal(preserveDevelopmentBuild(dir).preserved,false);
 }finally{rmSync(dir,{recursive:true,force:true});if(backup)rmSync(backup,{recursive:true,force:true});}
});
