import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildReleaseIdentity} from '../scripts/p5-release-identity.mjs';

test('ephemeral lock changes retain verifiable hashes and changed keys without source values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'p5-build-identity-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 try{
  git('init');git('config','user.email','qa@example.test');git('config','user.name','P5 QA');
  const lock={lockfileVersion:3,packages:{'node_modules/example':{version:'1.0.0',resolved:'https://example.test/private-token',devOptional:true}}};
  writeFileSync(join(dir,'package-lock.json'),JSON.stringify(lock));git('add','.');git('commit','-m','fixture');
  const clean=buildReleaseIdentity(dir);assert.equal(clean.dirty,false);assert.deepEqual(clean.lockfileEvidence,[]);
  delete (lock.packages['node_modules/example'] as any).devOptional;
  writeFileSync(join(dir,'package-lock.json'),JSON.stringify(lock));
  const changed=buildReleaseIdentity(dir);assert.equal(changed.dirty,true);assert.notEqual(changed.sourceDigest,clean.sourceDigest);
  assert.deepEqual(changed.lockfileEvidence[0].changedPackages,[{path:'node_modules/example',keys:['devOptional']}]);
  assert.notEqual(changed.lockfileEvidence[0].buildSha256,changed.lockfileEvidence[0].baselineSha256);
  assert.ok(!JSON.stringify(changed).includes('private-token'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
