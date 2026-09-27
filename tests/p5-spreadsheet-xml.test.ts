import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {prepareAnalysisFiles,verifyUpload} from '../lib/p5/documents.ts';

test('prefixed spreadsheet XML preserves every sheet, values, formulas and literal markup',async()=>{
 const workbook=new ExcelJS.Workbook();const first=workbook.addWorksheet('Cabinets');
 first.addRow(['Base cabinets',18,'LF']);first.addRow(['Upper cabinets',12,'LF']);first.addRow(['Formula',{formula:'B1+B2',result:30}]);
 const second=workbook.addWorksheet('Responsibilities');second.addRow(['Contractor supplies screws and shims']);second.addRow(['Literal <x:c> & "quoted" text']);
 const plain=Buffer.from(await workbook.xlsx.writeBuffer());const zip=await JSZip.loadAsync(plain);
 for(const [path,entry] of Object.entries(zip.files))if(/^xl\/(?:workbook|sharedStrings|styles|worksheets\/sheet\d+)\.xml$/.test(path)){
  const original=await entry.async('string');
  zip.file(path,original.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g,'<$1x:$2'));
 }
 for(const bytes of [plain,await zip.generateAsync({type:'nodebuffer'})]){
  const result=await prepareAnalysisFiles([verifyUpload('scope.xlsx',bytes)]);assert.deepEqual(result.manualReview,[]);
  const text=result.readable[0].data.toString();assert.match(text,/Worksheet: Cabinets/);assert.match(text,/Worksheet: Responsibilities/);
  assert.match(text,/Base cabinets \| 2: 18/);assert.match(text,/Upper cabinets \| 2: 12/);
  assert.match(text,/formula: B1\+B2; cached result: 30/);assert.match(text,/Literal <x:c> & "quoted" text/);
 }
});
