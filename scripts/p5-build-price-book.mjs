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
const items=[];const problems=[];
ws.eachRow({includeEmpty:false},(row,n)=>{
  if(n<3)return;
  const get=name=>val(row.getCell(at[name]).value);
  const code=String(get('Cost Code')??'').trim();
  if(!/^\d\d-\d\d-\d\d$/.test(code))return;
  const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
  const tiers=['Builder Grade Direct Cost','Mid-Range Direct Cost','High-End Direct Cost','Luxury Direct Cost'].map(name=>num(get(name)));
  if(tiers.some(t=>t==null||t<0))problems.push(`${code}: a finish tier has no price`);
  const flags=FLAGS.reduce((bits,flag,i)=>String(get(flag)??'').trim().toUpperCase()==='Y'?bits|(1<<i):bits,0);
  const text=v=>String(v??'').replace(/\s+/g,' ').trim();
  items.push([code,text(get('Division')),text(get('Section')),text(get('Line Item')),text(get('UOM')),text(get('Cost Type')),text(get('Allowance')),num(get('Labor %')),flags,
    text(get('Finish Sensitive')).toUpperCase()==='Y'?1:0,...tiers,num(get('Remodel Premium'))??0,text(get('Notes')).slice(0,180)]);
});
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
console.log(`wrote lib/p5/priceBookData.ts with ${items.length} line items from ${path.basename(file)}`);
