import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {analyzeScope} from '../lib/p5/extraction.ts';
const variables=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'];
const extraction={summary:'Fixture scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[]};
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
   assert.match(String(options?.body),/cabinetBaseLf/);return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(extraction)}]});
  });assert.equal(result.provider,'Anthropic');assert.equal(urls.length,2);
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(analyzeScope('scope',[],{},async()=>Response.json({error:{message:'PRIVATE DOCUMENT CONTENT'}},{status:400})),error=>!String(error).includes('PRIVATE DOCUMENT'));
 }finally{for(const k of variables){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
});
