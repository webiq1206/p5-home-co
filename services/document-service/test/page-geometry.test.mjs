import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,degrees} from 'pdf-lib';
import {parsePdf} from '../src/parser.mjs';
import {SPAN_COORDINATES,textAnchorRegions} from '../src/page-geometry.mjs';
import {Pipeline} from '../src/pipeline.mjs';

for(const rotation of [0,90,180,270])test('real PDF text positions account for a shifted crop box and rotation '+rotation,async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([600,400]);page.setCropBox(200,100,300,200);page.setRotation(degrees(rotation));page.drawText('ANCHOR-7',{x:220,y:160,size:10});
 let native;await parsePdf(Buffer.from(await pdf.save()),{onPage:p=>{native=p;}});
 const span=native.spans.find(s=>s.text==='ANCHOR-7');assert.ok(span);assert.equal(native.spanCoordinates,SPAN_COORDINATES);
 assert.ok(span.x>=0&&span.y>=0&&span.x+span.width<=native.width&&span.y+span.height<=native.height);
 if(rotation===0){assert.ok(Math.abs(span.x-20)<.001);assert.ok(Math.abs(span.y-130)<.001);}
 if(rotation===90){assert.ok(Math.abs(span.x-60)<.001);assert.ok(Math.abs(span.y-20)<.001);}
 const regions=textAnchorRegions({facts:[],items:[{basis:'uncertain',evidence:'ANCHOR-7'}]},native);
 assert.equal(regions.length,1);const r=regions[0],cx=(span.x+span.width/2)/native.width,cy=(span.y+span.height/2)/native.height;
 assert.ok(cx>=r.x&&cx<=r.x+r.width&&cy>=r.y&&cy<=r.y+r.height);
});
test('negative PDF origin maps the actual label into displayed-page coordinates',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage([600,400]);page.setMediaBox(-300,-200,600,400);page.drawText('2646 C',{x:-120,y:-50,size:10});
 let native;await parsePdf(Buffer.from(await pdf.save()),{onPage:p=>{native=p;}});
 const span=native.spans.find(s=>s.text==='2646 C');assert.ok(Math.abs(span.x-180)<.001);assert.ok(Math.abs(span.y-240)<.001);
});
test('anchor crops refuse legacy coordinates, ambiguous repeats, short labels and exhausted crop capacity',()=>{
 const record={facts:[],items:[{basis:'uncertain',evidence:'2646 C'}]},native={width:600,height:400,spanCoordinates:SPAN_COORDINATES,spans:[{text:'2646 C',x:200,y:100,width:30,height:10}]};
 assert.equal(textAnchorRegions(record,native).length,1);
 assert.equal(textAnchorRegions(record,{...native,spanCoordinates:undefined}).length,0);
 assert.equal(textAnchorRegions(record,{...native,spans:[...native.spans,...native.spans]}).length,0);
 assert.equal(textAnchorRegions(record,native,0).length,0);
 assert.equal(textAnchorRegions({facts:[],items:[{basis:'stated',evidence:'2646 C'}]},native).length,0);
});
test('verification refreshes only legacy positional metadata and supplies an anchored crop without altering the saved read',async()=>{
 const native={page:1,width:600,height:400,kind:'drawing',textQuality:1,text:'2646 C',spans:[{text:'2646 C',x:-120,y:450,width:30,height:10}]},correctSpans=[{text:'2646 C',x:180,y:240,width:30,height:10}];
 const value={pages:[{page:1,sheet:'',revision:'',status:'partial',notes:[],facts:[],items:[{id:'WIN',description:'Window association unresolved',component:'Window',building:'Main',floor:'Upper',quantity:null,unit:'count',evidence:'2646 C',basis:'uncertain'}],regions:[{x:.1,y:.1,width:.1,height:.1,reason:'Original model crop'}],inclusions:[],exclusions:[],responsibilities:[]}]};
 const original=structuredClone(native),job={id:'job',kind:'read',document_id:'doc',payload:{pages:[1]}};let verifiedInput,verifiedImages,committed;const parsed=[];
 const store={pages:async()=>[{page:1,native,image:Buffer.from('overview')}],document:async()=>({bytes:Buffer.from('original-pdf')}),checkpoint:async(j,result)=>{j.result=structuredClone(result);},complete:async(j,result,write)=>write({query:async(sql,args)=>{if(sql.includes('UPDATE p5ds_pages'))committed=JSON.parse(args[2]);return {rowCount:1,rows:[]};}}),checkStorage:async()=>{},finalize:async()=>{}};
 const reader={call:async(j,system,input,images,schema,signal,verify)=>{
  if(!verify)return structuredClone(value);verifiedInput=input;verifiedImages=images;return structuredClone(value);
 }};
 const parser=async(bytes,options)=>{assert.equal(bytes.toString(),'original-pdf');parsed.push(options.crop.region);await options.onPage({...native,spans:correctSpans,spanCoordinates:SPAN_COORDINATES,image:Buffer.from('crop')});};
 await new Pipeline(store,reader,{provider:'anthropic',model:'claude-sonnet-5',verifyModel:'claude-sonnet-5'},parser).read(job,new AbortController().signal);
 assert.deepEqual(native,original);assert.deepEqual(job.result.evidenceCheckpoint.raw,value);
 assert.deepEqual(verifiedInput.pages[0].spans,correctSpans);assert.equal(verifiedInput.pages[0].spanCoordinates,SPAN_COORDINATES);
 assert.equal(parsed.length,2);assert.equal(verifiedImages.length,3);assert.equal(committed.status,'partial');assert.equal(committed.items[0].quantity,null);
});
