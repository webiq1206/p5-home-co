import {execFileSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,symlink,rm}from'node:fs/promises';import os from'node:os';import path from'node:path';import{packageEvidence}from'../scripts/branding-ci-evidence-bound.mjs';
async function fixture(fn){const root=await mkdtemp(path.join(os.tmpdir(),'brand-evidence-'));try{await mkdir(path.join(root,'reports'));await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('complete small evidence packages',()=>fixture(async root=>{await writeFile(path.join(root,'reports','log.txt'),'passed');assert.match(await packageEvidence({root,inputs:['reports']}),/complete.tar.gz$/);}));
test('oversize fails rather than truncating',()=>fixture(async root=>{await writeFile(path.join(root,'reports','log.txt'),'12345');await assert.rejects(packageEvidence({root,inputs:['reports'],maxBytes:4}),/exceeds/);}));
test('empty fails',()=>fixture(async root=>{await assert.rejects(packageEvidence({root,inputs:['reports']}),/No evidence/);}));
test('symlinks rejected',()=>fixture(async root=>{await symlink('/tmp',path.join(root,'reports','escape'));await assert.rejects(packageEvidence({root,inputs:['reports']}),/Symlink/);}));
test('outside paths rejected',()=>fixture(async root=>{await assert.rejects(packageEvidence({root,inputs:['../other']}),/outside/);}));

test('archive retains all visible files and excludes hidden files like upload-artifact',()=>fixture(async root=>{await writeFile(path.join(root,'reports','first.log'),'one');await writeFile(path.join(root,'reports','second.log'),'two');await writeFile(path.join(root,'reports','.private'),'not published');const archive=await packageEvidence({root,inputs:['reports']});const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n').sort();assert.deepEqual(names,['reports/first.log','reports/second.log']);}));
test('compressed output exceeding the bound is rejected',()=>fixture(async root=>{await writeFile(path.join(root,'reports','tiny.log'),'x');await assert.rejects(packageEvidence({root,inputs:['reports'],maxBytes:2}),/Compressed evidence exceeds/);}));
