import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import {fileDigest} from '../lib/p5/fileDigest.ts';
import {transferLargeFiles} from '../lib/p5/resumableTransfer.ts';
import {cacheFiles} from '../lib/p5/browserDraft.ts';
import {SCOPE_CHUNK_SIZE,SCOPE_FILE_LIMIT} from '../lib/p5/scope.ts';
import {prepareAnalysisFiles,DOCUMENT_TEXT_LIMIT,checkOfficeArchive} from '../lib/p5/documents.ts';

test('hashes bounded slices, never whole-file reads, and matches SHA-256',async()=>{
  const bytes=Buffer.alloc(SCOPE_CHUNK_SIZE+73,123);
  class BoundedFile extends File{
    reads=0;
    arrayBuffer():Promise<ArrayBuffer>{throw new Error('Whole file read forbidden');}
    slice(start?:number,end?:number,type?:string){this.reads++;assert.ok((end??this.size)-(start??0)<=SCOPE_CHUNK_SIZE);return super.slice(start,end,type);}
  }
  const file=new BoundedFile([bytes],'plan.pdf');
  const expected=createHash('sha256').update(bytes).digest('hex');
  assert.equal(await fileDigest(file),expected);assert.equal(file.reads,2);
  assert.equal(await fileDigest(file),expected);assert.equal(file.reads,2);
});
test('size and cancellation checks run before reading file data',async()=>{
  const fake={size:SCOPE_FILE_LIMIT+1,slice(){throw new Error('Must not read');}} as unknown as Blob;
  await assert.rejects(fileDigest(fake),/250 MiB/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(fileDigest(new Blob(['abc']),controller.signal),{name:'AbortError'});
  await assert.rejects(cacheFiles('synthetic',[fake as File]),/250 MiB each/);
  const budgeted={size:23*1024*1024,slice(){throw new Error('Must not read');},arrayBuffer(){throw new Error('Must not read');}} as unknown as File;
  await assert.rejects(cacheFiles('synthetic',[budgeted]),/Large files stay/);
});
test('resumed transfer skips acknowledged chunks and verifies durable receipt',async()=>{
  const file=new File(['synthetic scope'],'scope.txt');const hash=await fileDigest(file);const actions:string[]=[];
  const request=async(input:any)=>{
    const action=new URL(input,'https://test.invalid').searchParams.get('action');actions.push(action!);
    return Response.json(action==='start'?{chunkSize:SCOPE_CHUNK_SIZE,chunks:{0:hash},complete:false}:{draft:{revision:1,answers:{},uploads:[{sha256:hash,size:file.size}]}});
  };
  await transferLargeFiles([file],{},()=>{},request as typeof fetch);
  assert.deepEqual(actions,['start','finish']);
  await assert.rejects(transferLargeFiles([file],{},()=>{},async(input:any)=>Response.json(String(input).includes('action=start')?{chunkSize:SCOPE_CHUNK_SIZE,chunks:{},complete:true}:{draft:{revision:1,answers:{},uploads:[]}})),/not confirmed/);
});
test('CSV and XLSX keep names, worksheet labels, cached formulas and bounds',async()=>{
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Kitchen');
  sheet.addRow(['Item','Quantity']);sheet.addRow(['Doors',{formula:'2+2',result:4}]);
  const data=Buffer.from(await workbook.xlsx.writeBuffer());
  checkOfficeArchive(data);
  const result=await prepareAnalysisFiles([{name:'scope.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',data},{name:'scope.csv',type:'text/csv',data:Buffer.from('Item,Quantity\nDoors,4')}]);
  assert.equal(result.manualReview.length,0);assert.deepEqual(result.readable.map(f=>f.name),['scope.xlsx','scope.csv']);
  assert.match(result.readable[0].data.toString(),/Worksheet: Kitchen/);assert.match(result.readable[0].data.toString(),/formula: 2\+2; cached result: 4/);
  const oversized=await prepareAnalysisFiles([{name:'large.csv',type:'text/csv',data:Buffer.alloc(DOCUMENT_TEXT_LIMIT+1)}]);
  assert.equal(oversized.readable.length,0);assert.match(oversized.manualReview[0],/2 MiB/);
});
test('legacy XLS stays an explicit manual-review attachment',async()=>{
  const result=await prepareAnalysisFiles([{name:'old.xls',type:'application/vnd.ms-excel',data:Buffer.from('synthetic')}]);
  assert.equal(result.readable.length,0);assert.match(result.manualReview[0],/saved for manual review/);
});
test('false ZIP expansion metadata is rejected before spreadsheet parsing',async()=>{
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Scope').addRow(['X'.repeat(10000)]);
  const data=Buffer.from(await workbook.xlsx.writeBuffer());
  const central=data.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  assert.ok(central>=0);
  data.writeUInt32LE(1,central+24);
  assert.throws(()=>checkOfficeArchive(data));
});