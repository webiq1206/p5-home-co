import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {analysisSegments} from '../lib/p5/analysisSegments.ts';
import {analyzeBatch,textLayerFiles} from '../lib/p5/extraction.ts';
import {pageTextFromItems} from '../lib/p5/pdfText.ts';
import {unreadNotes,pageRanges,MAX_READ_ATTEMPTS} from '../lib/p5/analysisWork.ts';
import {ANALYSIS_PASS_MS,READ_ALLOWANCE_MS,READ_START_MARGIN_MS,SERVER_BUDGET_MS} from '../lib/p5/processingBudget.ts';
import {describeError,sanitizeEventMessage} from '../lib/p5/events.ts';

const variables=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_SCOPE_PROVIDER'];
const withProviders=async(env:Record<string,string>,run:()=>Promise<void>)=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];Object.assign(process.env,env);
 try{await run();}finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
};
const extraction={summary:'Fixture scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[]};
const openAiReply=(manifest:{source:string;page:number}[])=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...extraction,pages:manifest.map(p=>({...p,sheet:'',revision:'',status:'read',notes:[]})),takeoffs:[]})}]}]});
async function budgetPdf(){
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
 const lines=[['PRELIMINARY CONSTRUCTION BUDGET','Structural Framing: floor, wall and roof framing; trusses'],['Roofing and Gutters: architectural shingles','Plumbing: complete rough and finish plumbing'],['Allowance: septic system, permit, tank','Cabinetry is paint-grade Shaker style']];
 for(const page of lines){const p=pdf.addPage([612,792]);page.forEach((line,i)=>p.drawText(line,{x:40,y:740-i*20,size:11,font}));}
 return Buffer.from(await pdf.save());
}

test('reading budgets let one dense page finish inside a pass and never cut a read at the old 54 second request budget',()=>{
 assert.ok(READ_ALLOWANCE_MS>SERVER_BUDGET_MS);
 assert.ok(ANALYSIS_PASS_MS>=READ_ALLOWANCE_MS+READ_START_MARGIN_MS/2);
 assert.ok(READ_START_MARGIN_MS<=READ_ALLOWANCE_MS);
 assert.ok(MAX_READ_ATTEMPTS>=3);
});

test('a text PDF is split into one unit per page, each carrying its own text layer and adjacent-page context',async()=>{
 const units=[];for await(const unit of analysisSegments({name:'budget.pdf',type:'application/pdf',data:await budgetPdf()}))units.push(unit);
 assert.equal(units.length,3);
 assert.deepEqual(units.map(u=>u.pages?.[0].page),[1,2,3]);
 assert.match(units[0].text||'',/Structural Framing/);
 assert.match(units[0].text||'',/PRELIMINARY CONSTRUCTION BUDGET/);
 assert.match(units[1].text||'',/Roofing and Gutters/);
 assert.match(units[1].context||'',/Following page 3 excerpt/);
 assert.match(units[1].context||'',/Preceding page 1 excerpt/);
 assert.ok(!units[0].context?.includes('Preceding'));
 for(const unit of units)assert.equal((await PDFDocument.load(unit.data)).getPageCount(),1);
 const layered=textLayerFiles(units);
 assert.equal(layered[2].type,'text/plain');assert.match(layered[2].data.toString('utf8'),/Cabinetry is paint-grade Shaker/);
});

test('page text keeps row structure from positioned runs',()=>{
 const text=pageTextFromItems([{str:'Code',transform:[10,0,0,10,40,700]},{str:'Amount',transform:[10,0,0,10,300,700]},{str:'Framing',transform:[10,0,0,10,40,680]},{str:'$ ,',transform:[10,0,0,10,300,680],hasEOL:true}]);
 assert.equal(text,'Code Amount\nFraming $ ,');
});

test('the text layer and context travel to the provider and a page read keeps its whole allowance',async()=>{
 await withProviders({OPENAI_API_KEY:'fixture-only',ANTHROPIC_API_KEY:'fixture-only',P5_SCOPE_PROVIDER:'openai'},async()=>{
  const calls:string[]=[];
  const result=await analyzeBatch('Price this build',[{name:'budget.pdf (page 2 of 3)',type:'application/pdf',data:Buffer.from('%PDF-synthetic'),pages:[{source:'budget.pdf',page:2}],text:'Roofing and Gutters: architectural shingles',context:'[Following page 3 excerpt] Allowance: septic system'}],{},async(url,options)=>{
   calls.push(String(url));const body=JSON.parse(String(options?.body));
   const texts=body.input[0].content.filter((v:any)=>v.type==='input_text').map((v:any)=>v.text);
   assert.ok(texts.some((t:string)=>/Text layer extracted/.test(t)&&/architectural shingles/.test(t)),'text layer is supplied');
   assert.ok(texts.some((t:string)=>/Adjacent-page context/.test(t)&&/septic/.test(t)),'adjacent context is supplied');
   assert.ok(body.input[0].content.some((v:any)=>v.type==='input_file'),'the page itself is still supplied');
   await new Promise(r=>setTimeout(r,60));
   return openAiReply([{source:'budget.pdf',page:2}]);
  },60_000,Date.now()+60_000);
  assert.equal(calls.length,1);
  assert.equal(result.extraction.documentCoverage?.complete,true);
 });
});

test('a provider that refuses the page bytes reads the same page from its text layer before the fallback provider runs',async()=>{
 await withProviders({OPENAI_API_KEY:'fixture-only',ANTHROPIC_API_KEY:'fixture-only',P5_SCOPE_PROVIDER:'openai'},async()=>{
  const calls:{url:string;hasFile:boolean;textLayer:boolean}[]=[];
  const result=await analyzeBatch('Price this build',[{name:'budget.pdf (page 1 of 3)',type:'application/pdf',data:Buffer.from('%PDF-synthetic'),pages:[{source:'budget.pdf',page:1}],text:'PRELIMINARY CONSTRUCTION BUDGET Structural Framing'}],{},async(url,options)=>{
   const body=JSON.parse(String(options?.body));const content=body.input[0].content;
   const hasFile=content.some((v:any)=>v.type==='input_file');
   calls.push({url:String(url),hasFile,textLayer:content.some((v:any)=>v.type==='input_text'&&/Structural Framing/.test(v.text))});
   if(hasFile)return Response.json({error:{message:'PRIVATE: input_file is not supported by this endpoint'}},{status:400});
   return openAiReply([{source:'budget.pdf',page:1}]);
  },60_000,Date.now()+60_000);
  assert.equal(calls.length,2);
  assert.ok(calls[0].hasFile&&!calls[1].hasFile,'the retry sends the text layer instead of the bytes');
  assert.ok(calls[1].textLayer);
  assert.ok(calls.every(c=>c.url.includes('openai')),'the same provider is retried before falling back');
  assert.equal(result.extraction.documentCoverage?.complete,true);
 });
});

test('unread sections are reported once per document with page ranges and a plain reason',()=>{
 assert.equal(pageRanges([4,1,2,3,7,9,10]),'1-4, 7, 9-10');
 const notes=unreadNotes([
  {name:'budget.pdf (page 1 of 4)',type:'application/pdf',object:'o1',pages:[{source:'budget.pdf',page:1}],lastCode:'provider-timeout'},
  {name:'budget.pdf (page 2 of 4)',type:'application/pdf',object:'o2',pages:[{source:'budget.pdf',page:2}],lastCode:'provider-timeout'},
  {name:'budget.pdf (page 3 of 4)',type:'application/pdf',object:'o3',pages:[{source:'budget.pdf',page:3}],result:{extraction:extraction as any,provider:'OpenAI',model:'m',analyzedAt:''}},
  {name:'budget.pdf (page 4 of 4)',type:'application/pdf',object:'o4',pages:[{source:'budget.pdf',page:4}],lastCode:'provider-500'},
 ]);
 assert.equal(notes.length,1);
 assert.match(notes[0],/^budget\.pdf: automatic reading could not finish for pages 1-2, 4 \(the reader ran out of time\)/);
});

test('event descriptions classify failures and redact credentials',()=>{
 assert.equal(describeError(Object.assign(new Error('x'),{name:'ProcessingDeadlineError'})).code,'deadline');
 assert.equal(describeError(new Error('analysis-provider-failed:Anthropic (400): Document analysis service rejected the request')).code,'provider-400');
 assert.equal(describeError(new Error('analysis-busy')).status,429);
 assert.equal(sanitizeEventMessage('failed with key sk-ant-abcdefghijklmnop and more'),'failed with [redacted] and more');
});
