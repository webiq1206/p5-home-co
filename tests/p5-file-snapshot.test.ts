import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotProjectFile} from '../lib/p5/fileSnapshot.ts';
test('selected files are copied before a picker-backed reference can expire',async()=>{
  const original=new File(['scope bytes'],'scope.pdf',{type:'application/pdf',lastModified:12});
  const copy=await snapshotProjectFile(original);
  assert.notEqual(copy,original);assert.equal(await copy.text(),'scope bytes');
  assert.equal(copy.name,original.name);assert.equal(copy.lastModified,12);assert.equal(copy.type,'application/pdf');
});
test('unreadable and partially read device files fail before upload',async()=>{
  const original=new File(['scope'],'scope.pdf');
  Object.defineProperty(original,'arrayBuffer',{value:async()=>{throw new Error('expired device file');},configurable:true});
  await assert.rejects(snapshotProjectFile(original),/could not be read from your device/);
  Object.defineProperty(original,'arrayBuffer',{value:async()=>new ArrayBuffer(0)});
  await assert.rejects(snapshotProjectFile(original),/not fully read/);
});
