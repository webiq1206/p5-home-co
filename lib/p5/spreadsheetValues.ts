import type ExcelJS from 'exceljs';

type Value=number|string|boolean|null;
type Result={status:'calculated';value:number}|{status:'unresolved';reason:string};
type Token={kind:'number'|'ref'|'word'|'symbol';text:string};
class FormulaError extends Error {}
const reject=(reason:string):never=>{throw new FormulaError(reason);};

/** Read-only, bounded arithmetic. Never evaluates JavaScript, external links,
 * macros or arbitrary spreadsheet functions. Original formula/cache survive. */
export function spreadsheetValues(workbook:ExcelJS.Workbook){
 const cache=new Map<string,Result>(),active=new Set<string>();let visits=0;
 const numeric=(value:Value):number=>typeof value==='number'?value:value===null?0:reject('A numeric input contains text, a date or a logical value.');
 const finite=(value:number)=>Number.isFinite(value)?value:reject('The calculation produced a non-finite number.');
 const read=(sheetName:string,address:string,depth:number):Value=>{
  if(depth>128||++visits>100000)reject('Spreadsheet calculation limit reached.');
  const sheet=workbook.worksheets.find(s=>s.name.toLowerCase()===sheetName.toLowerCase());
  if(!sheet)reject('A referenced worksheet is missing.');
  const cell=sheet!.getCell(address.replaceAll('$',''));
  if(cell.isMerged&&cell.master.address!==cell.address)return null;
  if(cell.formula){const result=calculate(sheet!.name,cell.address,depth+1);if(result.status==='unresolved')return reject(result.reason);return result.value;}
  const value=cell.value;
  if(value===null||value===undefined)return null;
  if(typeof value==='number'||typeof value==='string'||typeof value==='boolean')return value;
  if(value instanceof Date)reject('Date arithmetic needs workbook confirmation.');
  if('error'in value)reject('A referenced cell contains a spreadsheet error.');
  return cell.text;
 };
 const calculate=(sheetName:string,address:string,depth=0):Result=>{
  const key=sheetName.toLowerCase()+'!'+address.replaceAll('$','').toUpperCase();
  if(cache.has(key))return cache.get(key)!;
  if(active.has(key))return {status:'unresolved',reason:'Circular spreadsheet references.'};
  active.add(key);
  let result:Result;
  try{
   const cell=workbook.getWorksheet(sheetName)!.getCell(address),formula=cell.formula;
   if(!formula)reject('No formula to calculate.');
   if(formula.length>8192)reject('Formula is too long for automatic calculation.');
   const tokens:Token[]=[];let source=formula.replace(/^=/,'');
   while(source.trim()){
    source=source.trimStart();let match:RegExpMatchArray|null;
    if((match=source.match(/^(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Za-z]{1,3}\$?[1-9][0-9]*(?![A-Za-z0-9_])/)))tokens.push({kind:'ref',text:match[0]});
    else if((match=source.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)))tokens.push({kind:'number',text:match[0]});
    else if((match=source.match(/^[A-Za-z_][A-Za-z0-9_.]*/)))tokens.push({kind:'word',text:match[0]});
    else if((match=source.match(/^[+*/^(),:%-]/)))tokens.push({kind:'symbol',text:match[0]});
    else reject('Unsupported formula syntax or external reference; confirm this value.');
    source=source.slice(match![0].length);
   }
   let pos=0,nesting=0;
   const peek=()=>tokens[pos]?.text;
   const take=(text:string)=>peek()===text?(pos++,true):false;
   const expect=(text:string)=>{if(!take(text))reject('Incomplete or unsupported formula.');};
   const ref=(token:string,defaultSheet=sheetName)=>{
    const separator=token.lastIndexOf('!');
    return {sheet:separator<0?defaultSheet:token.slice(0,separator).replace(/^'|'$/g,'').replaceAll("''","'"),address:token.slice(separator+1).replaceAll('$','').toUpperCase()};
   };
   const rangeValues=(start:string,end:string):Value[]=>{
    const a=ref(start),b=ref(end,a.sheet);if(a.sheet.toLowerCase()!==b.sheet.toLowerCase())reject('Ranges across different sheets need confirmation.');
    const split=(address:string)=>{const m=address.match(/^([A-Z]+)(\d+)$/)!;return {col:[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),row:Number(m[2])};};
    const aa=split(a.address),bb=split(b.address),values:Value[]=[];
    if((Math.abs(bb.col-aa.col)+1)*(Math.abs(bb.row-aa.row)+1)>20000)reject('Formula range exceeds the calculation limit.');
    const column=(n:number):string=>n>26?column(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):String.fromCharCode(64+n);
    for(let row=Math.min(aa.row,bb.row);row<=Math.max(aa.row,bb.row);row++)for(let col=Math.min(aa.col,bb.col);col<=Math.max(aa.col,bb.col);col++)values.push(read(a.sheet,column(col)+row,depth+1));
    return values;
   };
   const primary=():Value=>{
    if(++nesting>128)reject('Formula nesting limit reached.');
    try{
     if(take('(')){const value=expression();expect(')');return value;}
     const token=tokens[pos++];if(!token)reject('Incomplete formula.');
     if(token.kind==='number')return finite(Number(token.text));
     if(token.kind==='ref'){const r=ref(token.text);return read(r.sheet,r.address,depth+1);}
     if(token.kind!=='word')return reject('Unsupported formula.');
     const name=token.text.toUpperCase();
     if(!['SUM','MIN','MAX','AVERAGE','COUNT','ROUND','ROUNDUP','ROUNDDOWN','ABS'].includes(name))reject('Unsupported function '+name+'; confirm this value.');
     expect('(');const args:Value[]=[];
     if(!take(')')){do{
      if(tokens[pos]?.kind==='ref'&&tokens[pos+1]?.text===':'){
       const start=tokens[pos++].text;pos++;const end=tokens[pos++];if(end?.kind!=='ref')reject('Unsupported formula range.');args.push(...rangeValues(start,end.text));
      }else args.push(expression());
     }while(take(','));expect(')');}
     const numbers=args.filter((v):v is number=>typeof v==='number');
     if(name==='SUM')return finite(numbers.reduce((a,b)=>a+b,0));
     if(name==='COUNT')return numbers.length;
     if(name==='AVERAGE')return numbers.length?finite(numbers.reduce((a,b)=>a+b,0)/numbers.length):reject('Average has no numeric values.');
     if(name==='MIN')return numbers.length?Math.min(...numbers):0;
     if(name==='MAX')return numbers.length?Math.max(...numbers):0;
     if(name==='ABS'){if(args.length!==1)reject('ABS needs one argument.');return Math.abs(numeric(args[0]));}
     if(args.length!==2)reject('Rounding needs two arguments.');
     const value=numeric(args[0]),digits=numeric(args[1]);
     if(!Number.isInteger(digits)||Math.abs(digits)>15)reject('Unsupported rounding precision.');
     const shift=(n:number,places:number)=>{const [mantissa,exponent='0']=String(n).split('e');return finite(Number(mantissa+'e'+(Number(exponent)+places)));};
     const magnitude=shift(Math.abs(value),digits);
     const rounded=name==='ROUNDUP'?Math.ceil(magnitude):name==='ROUNDDOWN'?Math.floor(magnitude):Math.round(magnitude);
     return finite(Math.sign(value)*shift(rounded,-digits));
    }finally{nesting--;}
   };
   // Excel evaluates negation before exponentiation and exponent chains left to right.
   const unary=():Value=>{if(take('+'))return numeric(primary());if(take('-'))return -numeric(primary());return primary();};
   const percent=():Value=>{let value=unary();while(take('%'))value=numeric(value)/100;return value;};
   const power=():Value=>{let value=percent();while(take('^'))value=finite(numeric(value)**numeric(percent()));return value;};
   const product=():Value=>{let value=power();while(peek()==='*'||peek()==='/'){const op=tokens[pos++].text,right=numeric(power());if(op==='/'&&right===0)reject('Division by zero.');value=finite(op==='*'?numeric(value)*right:numeric(value)/right);}return value;};
   const expression=():Value=>{let value=product();while(peek()==='+'||peek()==='-'){const op=tokens[pos++].text,right=numeric(product());value=finite(op==='+'?numeric(value)+right:numeric(value)-right);}return value;};
   const value=finite(numeric(expression()));if(pos!==tokens.length)reject('Unsupported remaining formula content.');
   result={status:'calculated',value};
  }catch(error){result={status:'unresolved',reason:error instanceof FormulaError?error.message:'The formula could not be safely calculated.'};}
  finally{active.delete(key);}
  cache.set(key,result);return result;
 };
 return {calculate,describe(sheet:string,cell:ExcelJS.Cell){
  if(cell.value===null||cell.value===undefined||cell.isMerged&&cell.master.address!==cell.address)return '';
  if(!cell.formula)return cell.text;
  const result=calculate(sheet,cell.address),cached=cell.result;
  const prefix=`${cell.text} [formula: ${cell.formula}; cached result: ${String(cached??'not supplied')}; `;
  if(result.status==='unresolved')return prefix+`UNRESOLVED: ${result.reason} A cached result is unverified, not zero.]`;
  const discrepancy=typeof cached==='number'&&Math.abs(cached-result.value)>1e-8*Math.max(1,Math.abs(result.value));
  return prefix+`calculated result: ${result.value}${discrepancy?'; CONFLICT: saved result differs from current inputs, confirm intended value':''}]`;
 }};
}
