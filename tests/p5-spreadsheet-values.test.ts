import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {spreadsheetValues} from '../lib/p5/spreadsheetValues.ts';
import {prepareAnalysisFiles,verifyUpload} from '../lib/p5/documents.ts';

test('uncached cross-sheet estimate formulas survive upload with calculated totals and source formulas',async()=>{
 const book=new ExcelJS.Workbook(),takeoff=book.addWorksheet('Takeoffs'),estimate=book.addWorksheet('Contractor Estimate');
 takeoff.addRow(['Material',12,280,{formula:'B1*C1'}]);takeoff.addRow(['Material',8,200,{formula:'B2*C2'}]);takeoff.getCell('D3').value={formula:'SUM(D1:D2)'};
 estimate.mergeCells('B7:F7');estimate.mergeCells('B6:F6');estimate.getCell('B6').value='CONTRACTOR ESTIMATE';
 estimate.getCell('F34').value={formula:'Takeoffs!D3'};estimate.getCell('F36').value={formula:'F34*0.1'};estimate.getCell('F37').value={formula:'(F34+F36)*0.08'};estimate.getCell('F42').value={formula:'F34+F36+F37'};
 const result=await prepareAnalysisFiles([verifyUpload('reference.xlsx',Buffer.from(await book.xlsx.writeBuffer()))]);
 assert.deepEqual(result.manualReview,[]);const text=result.readable[0].data.toString();
 assert.match(text,/formula: SUM\(D1:D2\); cached result: not supplied; calculated result: 4960/);
 assert.match(text,/calculated result: 5892\.48/);
 assert.equal(text.match(/CONTRACTOR ESTIMATE/g)!.length,1);
});
test('stale cached totals are disclosed separately, without changing the workbook',()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Rates');sheet.getCell('A1').value=12;sheet.getCell('B1').value={formula:'A1*10',result:99};
 assert.match(spreadsheetValues(book).describe('Rates',sheet.getCell('B1')),/cached result: 99; calculated result: 120; CONFLICT/);
 assert.equal(sheet.getCell('B1').result,99);
});
test('unsupported and circular formulas propagate uncertainty instead of using zero or an old cache',()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('Source');
 s.getCell('A1').value={formula:'WEBSERVICE("https://example.invalid")',result:100};s.getCell('B1').value={formula:'A1+5',result:105};
 s.getCell('C1').value={formula:'D1+1'};s.getCell('D1').value={formula:'C1+1'};
 const values=spreadsheetValues(book);
 assert.equal(values.calculate('Source','B1').status,'unresolved');assert.match(values.describe('Source',s.getCell('A1')),/UNRESOLVED/);
 assert.deepEqual(values.calculate('Source','C1'),{status:'unresolved',reason:'Circular spreadsheet references.'});
});
test('quoted sheet names, range aggregation, rounding and percentages preserve calculation meaning',()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet("Owner's rates"),t=book.addWorksheet('Total');s.addRow([2,3,'caption']);
 t.getCell('A1').value={formula:"SUM('Owner''s rates'!$A$1:C1)*10%"};t.getCell('A2').value={formula:'ROUND(-1.005,2)'};
 t.getCell('A3').value={formula:'ROUNDUP(1.001,2)'};t.getCell('A4').value={formula:'ROUNDDOWN(1.009,2)'};
 const values=spreadsheetValues(book);for(const [cell,value]of [['A1',.5],['A2',-1.01],['A3',1.01],['A4',1]]as const)assert.deepEqual(values.calculate('Total',cell),{status:'calculated',value});
});
test('external links, missing sheets, invalid arithmetic and oversized ranges stay unresolved',()=>{
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('Source');
 for(const [i,formula]of ['[external.xlsx]Sheet1!A1','Missing!A1','1/0','SUM(A1:A30000)','process.exit()'].entries())s.getCell('B'+(i+1)).value={formula};
 const values=spreadsheetValues(book);for(let i=1;i<=5;i++)assert.equal(values.calculate('Source','B'+i).status,'unresolved');
});
