import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeProjectUpload} from '../lib/p5/multipart.ts';
test('multipart preserves binary bytes, filenames and mixed input',async()=>{
  const bytes=new Uint8Array([0,255,13,10,128,34,65]);
  const form=new FormData();form.set('analyze','false');form.set('text','Bathroom 8 × 10');
  form.append('files',new Blob([bytes],{type:'application/pdf'}),'scope.pdf');
  form.append('files',new Blob(['notes'],{type:'text/plain'}),'notes.txt');
  const encoded=await encodeProjectUpload(form);
  const parsed=await new Response(encoded.body,{headers:{'Content-Type':encoded.contentType}}).formData();
  assert.equal(parsed.get('text'),'Bathroom 8 × 10');assert.equal(parsed.get('analyze'),'false');
  const files=parsed.getAll('files') as File[];assert.equal(files.length,2);
  assert.equal(files[0].name,'scope.pdf');assert.deepEqual(new Uint8Array(await files[0].arrayBuffer()),bytes);
  assert.equal(await files[1].text(),'notes');
});
