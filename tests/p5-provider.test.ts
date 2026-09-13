import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {analyzeScope,analyzeBatch,AnalysisBusyError,anthropicExtractionSchema} from '../lib/p5/extraction.ts';
import {validateExtraction} from '../lib/p5/scope.ts';
const variables=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
const extraction={summary:'Fixture scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[]};
test('failed preparation and empty files never reach a paid provider',async()=>{
 let calls=0;const request=async()=>{calls++;throw new Error('Provider must not be called');};
 for(const file of [{name:'empty.pdf',type:'application/pdf',data:Buffer.alloc(0)},{name:'failed.pdf',type:'application/pdf',data:Buffer.from('partial'),preparationError:'PRIVATE renderer error'}]){
  await assert.rejects(analyzeBatch('',[file],{},request),error=>String(error).includes('analysis-file-preparation-failed')&&!String(error).includes('PRIVATE'));
 }
 assert.equal(calls,0);
});
test('the smaller fallback grammar retains strict local vocabulary validation',()=>{
 const schema=anthropicExtractionSchema();assert.equal(schema.properties.facts.items.properties.field.enum,undefined);assert.equal(schema.additionalProperties,false);
 assert.throws(()=>validateExtraction({...extraction,facts:[{field:'unapproved_field',value:'PRIVATE',source:'PRIVATE',evidence:'PRIVATE',confidence:1}]}),error=>/Invalid extracted fact/.test(String(error))&&!String(error).includes('PRIVATE'));
});
test('detail view evidence stays bound to its known original page without clearing unreadability',async()=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';
 try{
  const result=await analyzeBatch('First-floor trim only',[{name:'plans.pdf (original page 5; detail views)',type:'application/pdf',data:Buffer.from('synthetic provider input'),pages:[{source:'plans.pdf',page:5}],detailViews:true}],{},async(_url,options)=>{
   assert.match(String(options?.body),/Internal PDF view numbers are NOT original page numbers/);
   return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...extraction,pages:[{source:'plans.pdf',page:2,sheet:'A005',revision:'1',status:'partial',notes:['A dimension in this crop is unreadable.']}],takeoffs:[{id:'T5',description:'Trim mark T-5',building:'Alpha',floor:'First',component:'trim',quantity:124,unit:'LF',basis:'stated',evidence:'T-5: 124 LF',sources:[{source:'plans.pdf',page:2,sheet:'A005',revision:'1'}],supersedes:[],issues:[]}]})}]}]});
  });
  assert.equal(result.extraction.takeoffs?.[0].sources[0].page,5);assert.equal(result.extraction.documentCoverage?.pages[0].page,5);assert.equal(result.extraction.documentCoverage?.complete,false);assert.equal(result.extraction.documentCoverage?.pages[0].status,'partial');
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('a fallback failure cannot hide the primary provider cooldown',async()=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';process.env.ANTHROPIC_API_KEY='fixture-only';
 try{
  let calls=0;
  await assert.rejects(analyzeBatch('Synthetic trim',[],{},async()=>{calls++;return Response.json({error:{message:'PRIVATE SOURCE MUST NOT ESCAPE'}},{status:calls===1?429:400,headers:calls===1?{'retry-after':'47'}:{}});}),error=>error instanceof AnalysisBusyError&&error.retryAfterMs===47000&&!String(error).includes('PRIVATE'));
  assert.equal(calls,2);
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('missing page reports are incomplete even when all returned pages say read',async()=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';
 try{
  const pdf=await PDFDocument.create();pdf.addPage();pdf.addPage();
  const result=await analyzeBatch('',[{name:'plans.pdf',type:'application/pdf',data:Buffer.from(await pdf.save()),pages:[{source:'plans.pdf',page:1},{source:'plans.pdf',page:2}]}],{},async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...extraction,pages:[{source:'plans.pdf',page:1,sheet:'',revision:'',status:'read',notes:[]}]})}]}]}));
  assert.equal(result.extraction.documentCoverage?.complete,false);assert.equal(result.extraction.documentCoverage?.expectedPages,2);assert.equal(result.extraction.documentCoverage?.pages[1].status,'unreadable');
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('configured OpenAI reads all four scope pages together within its token limit',async()=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';
 try{
  const pdf=await PDFDocument.create();for(let i=0;i<4;i++)pdf.addPage();let calls=0;
  const result=await analyzeScope('',[{name:'scope.pdf',type:'application/pdf',data:Buffer.from(await pdf.save())}],{},async(url,options)=>{
   calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(String(options?.body));assert.ok(body.max_output_tokens<=16384);
   const file=body.input[0].content.find((v:any)=>v.type==='input_file');assert.equal((await PDFDocument.load(Buffer.from(file.file_data.split(',')[1],'base64'))).getPageCount(),4);
   const manifest=JSON.parse(body.input[0].content.find((v:any)=>v.type==='input_text'&&v.text.startsWith('Source filename:')).text.split('Original page manifest: ')[1]);
   return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...extraction,pages:manifest.map((p:any)=>({...p,sheet:'',revision:'',status:'read',notes:['Blank test sheet.']})),takeoffs:[]})}]}]});
  });assert.equal(calls,1);assert.deepEqual(result.extraction.reviewNotes,[]);assert.equal(result.extraction.documentCoverage?.complete,true);assert.equal(result.extraction.documentCoverage?.expectedPages,4);
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
test('provider fallback retains the request and failed provider bodies never escape',async()=>{
 const before=Object.fromEntries(variables.map(k=>[k,process.env[k]]));for(const k of variables)delete process.env[k];process.env.OPENAI_API_KEY='fixture-only';process.env.ANTHROPIC_API_KEY='fixture-only';
 try{
  const urls:string[]=[];const result=await analyzeScope('Retain the selected cabinet doors',[],{cabinetBaseLf:'20'},async(url,options)=>{
   urls.push(String(url));if(url.toString().includes('openai'))return Response.json({error:{message:'PRIVATE DOCUMENT CONTENT'}},{status:503});
   const body=JSON.parse(String(options?.body));assert.match(String(options?.body),/cabinetBaseLf/);assert.equal(body.output_config,undefined);assert.equal(body.tool_choice.name,'record_scope_analysis');assert.equal(body.tools[0].strict,undefined);return Response.json({stop_reason:'tool_use',content:[{type:'tool_use',name:'record_scope_analysis',input:extraction}]});
  });assert.equal(result.provider,'Anthropic');assert.equal(urls.length,2);
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(analyzeScope('scope',[],{},async()=>Response.json({error:{message:'PRIVATE DOCUMENT CONTENT'}},{status:400})),error=>!String(error).includes('PRIVATE DOCUMENT'));
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
