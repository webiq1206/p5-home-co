import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import ExcelJS from 'exceljs';
const headers=['Cost Code','Division','Section','Line Item','UOM','Cost Type','Allowance','Labor %','NC','RM','HM','CAB','RE-10','Comm TI','Res TI','Finish Sensitive','Builder Grade Direct Cost','Mid-Range Direct Cost','High-End Direct Cost','Luxury Direct Cost','Remodel Premium','Notes'];
const source=['01-01-01','Finishes','Trim','Interior base molding','LF','Labor + Material (Installed)','',.5,'Y','Y','Y','N','N','N','N','Y',10,12,14,16,.1,'Coverage note '.repeat(80)+'Excludes painting.'];
async function fixture(mode:string){
 const dir=await mkdtemp(join(tmpdir(),'p5-import-'));
 try{
  const wb=new ExcelJS.Workbook(),master=wb.addWorksheet('Master');master.addRow(['Synthetic audit fixture']);master.addRow(headers);master.addRow(source);
  const view=wb.addWorksheet('Remodel view');view.addRow(headers);view.addRow(mode==='orphan'?['99-99-99']:source);
  if(mode==='invalid-unit')master.getCell('E3').value='mystery';
  if(mode==='missing-code')master.addRow(['','','','Lost scope']);
  if(mode==='duplicate')master.addRow(source);
  if(mode==='missing-price')master.getCell('Q3').value={formula:'1+2'};
  await mkdir(join(dir,'lib/p5'),{recursive:true});await wb.xlsx.writeFile(join(dir,'source.xlsx'));
  const result=spawnSync(process.execPath,[resolve('scripts/p5-build-price-book.mjs'),join(dir,'source.xlsx')],{cwd:dir,encoding:'utf8'});
  if(mode!=='valid'){assert.notEqual(result.status,0);assert.match(result.stderr,/unsupported|missing|differ|repeats|absent|no price/);return;}
  assert.equal(result.status,0,result.stderr);
  const audit=JSON.parse(await readFile(join(dir,'lib/p5/priceBookImportAudit.json'),'utf8'));
  assert.equal(audit.sourceRows,1);assert.equal(audit.importedRows,1);assert.equal(audit.sheets.length,2);assert.deepEqual(audit.sourceReferences,[{code:'01-01-01',sheet:'Master',row:3}]);
  const generated=await readFile(join(dir,'lib/p5/priceBookData.ts'),'utf8');assert.ok(generated.includes(source.at(-1) as string),'full coverage notes retained');
 }finally{await rm(dir,{recursive:true,force:true});}
}
for(const mode of ['valid','orphan','invalid-unit','missing-code','duplicate','missing-price'])test('price book source import: '+mode,()=>fixture(mode));
