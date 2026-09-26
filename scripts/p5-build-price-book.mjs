// Generate lib/p5/priceBookData.ts from the owner's master price book workbook.
//
//   node scripts/p5-build-price-book.mjs ["path/to/P5 Cost Database 2026.xlsx"]
//
// The workbook is the source of truth and stays outside the repositories; only the generated
// module is committed. It is read from the Master sheet, where every line item lives once: the
// other tabs are live views of it. Nothing is priced here. Finish tier, remodel premium and
// applicability are resolved per project by lib/p5/priceBook.ts.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const file=process.argv[2]||path.join('..','P5 Cost Database 2026.xlsx');
const val=v=>v&&typeof v==='object'?('result' in v?v.result:'richText' in v?v.richText.map(t=>t.text).join(''):'text' in v?v.text:null):v;
const wb=new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws=wb.getWorksheet('Master');
if(!ws)throw new Error('The workbook has no Master sheet.');
const header=ws.getRow(2).values.slice(1).map(v=>String(val(v)??'').trim());
const column=name=>{const i=header.indexOf(name);if(i<0)throw new Error(`The Master sheet has no "${name}" column.`);return i+1;};
const need=['Cost Code','Division','Section','Line Item','UOM','Cost Type','Allowance','Labor %','NC','RM','HM','CAB','RE-10','Comm TI','Res TI','Finish Sensitive','Builder Grade Direct Cost','Mid-Range Direct Cost','High-End Direct Cost','Luxury Direct Cost','Remodel Premium','Notes'];
const at=Object.fromEntries(need.map(name=>[name,column(name)]));
// Applicability flags, in a fixed bit order that priceBook.ts reads back.
const FLAGS=['NC','RM','HM','CAB','RE-10','Comm TI','Res TI'];
const items=[];const problems=[];let sourceRows=0;const sourceReferences=[];
ws.eachRow({includeEmpty:false},(row,n)=>{
  if(n<3)return;
  const get=name=>val(row.getCell(at[name]).value);
  const code=String(get('Cost Code')??'').trim();
  const hasScope=Boolean(get('Line Item'));
  if(!code&&!hasScope)return;
  sourceRows++;
  if(!/^\d\d-\d\d-\d\d$/.test(code)){problems.push(`Master row ${n}: invalid or missing cost code`);return;}
  sourceReferences.push({code,sheet:ws.name,row:n});
  const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  const tiers=['Builder Grade Direct Cost','Mid-Range Direct Cost','High-End Direct Cost','Luxury Direct Cost'].map(name=>num(get(name)));
  if(tiers.some(t=>t==null||t<0))problems.push(`${code}: a finish tier has no price`);
  const units=new Set(['HR','SF','EA','MO','LF','DAY','TON','SQ','RL','W','AC','CY']);
  const types=new Set(['Fee / Professional Service','Labor Only','Service Fee','Equipment / Service','Labor + Material (Installed)','Labor + Equipment','Labor + Disposal','Labor + Minor Materials','Material Only']);
  const unit=String(get('UOM')??'').trim(),kind=String(get('Cost Type')??'').trim();
  if(!(units.has(unit)&&types.has(kind))&&!(kind==='Percentage'&&['% of const.','% of cost'].includes(unit)))problems.push(`${code}: unsupported unit/cost type ${unit}/${kind}`);
  if(!hasScope)problems.push(`${code}: missing line item description`);
  for(const field of [...FLAGS,'Finish Sensitive'])if(!['Y','N',''].includes(String(get(field)??'').trim().toUpperCase()))problems.push(`${code}: ambiguous ${field} flag`);
  for(const field of ['Labor %','Remodel Premium']){const raw=get(field);if(raw!==null&&raw!==undefined&&raw!==''&&(num(raw)===null||raw<0||raw>1))problems.push(`${code}: invalid ${field}`);}
  const flags=FLAGS.reduce((bits,flag,i)=>String(get(flag)??'').trim().toUpperCase()==='Y'?bits|(1<<i):bits,0);
  const text=v=>String(v??'').replace(/\s+/g,' ').trim();
  items.push([code,text(get('Division')),text(get('Section')),text(get('Line Item')),text(get('UOM')),text(get('Cost Type')),text(get('Allowance')),num(get('Labor %')),flags,
    text(get('Finish Sensitive')).toUpperCase()==='Y'?1:0,...tiers,num(get('Remodel Premium'))??0,text(get('Notes'))]);
});
// Every additional worksheet is inventoried. An independently maintained table cannot disappear.
const sheets=[];
wb.eachSheet(sheet=>{
 let codedRows=0;const unknownCodes=[];
 sheet.eachRow((row,n)=>{
  const values=row.values.slice(1).map(v=>String(val(v)??'').trim());
  for(const value of values)if(/^\d\d-\d\d-\d\d$/.test(value)){
   codedRows++;if(!items.some(item=>item[0]===value))unknownCodes.push({row:n,code:value});
  }
 });
 sheets.push({name:sheet.name,rows:sheet.rowCount,codedRows,unknownCodes});
 if(unknownCodes.length)problems.push(`${sheet.name}: ${unknownCodes.length} cost codes are absent from Master`);
});
if(sourceRows!==items.length)problems.push(`Master source rows ${sourceRows} differ from imported rows ${items.length}`);
if(!items.length)problems.push('The Master sheet contains no importable cost rows.');
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
if(new Set(items.map(i=>i[0])).size!==items.length){console.error('The Master sheet repeats a cost code.');process.exit(1);}
const body=`// Generated from the owner's master price book by scripts/p5-build-price-book.mjs. Do not edit by hand.
// Every amount is a DIRECT COST in USD: no overhead, profit or contingency. The estimator applies
// the owner's margin policy once, after direct costs.
/** [code, division, section, lineItem, uom, costType, allowance, laborShare, flags(NC,RM,HM,CAB,RE-10,CommTI,ResTI as bits), finishSensitive, builder, mid, high, luxury, remodelPremium, notes] */
export type PriceBookRow=[string,string,string,string,string,string,string,number|null,number,0|1,number,number,number,number,number,string];
export const PRICE_BOOK_SOURCE=${JSON.stringify(`${path.basename(file)} (Master sheet)`)};
export const PRICE_BOOK:PriceBookRow[]=${JSON.stringify(items)};
`;
await writeFile('lib/p5/priceBookData.ts',body);
await writeFile('lib/p5/priceBookImportAudit.json',JSON.stringify({source:path.basename(file),sourceRows,importedRows:items.length,sheets,sourceReferences},null,2)+'\n');
console.log(`wrote lib/p5/priceBookData.ts with ${items.length} line items from ${path.basename(file)}`);
