import {analysisSegments} from './analysisSegments.ts';
import {query} from './database.ts';
import {readDraft,DraftError} from './store.ts';
import {readStoredBytes} from './objectStorage.ts';
import {benchmarkProvider,benchmarkRead,type AnalysisFile} from './extraction.ts';
/**
 * Reader benchmark (owner request 2026-09-21: pages read accurately in under 5 s).
 *
 * Re-reads the first pages of a QA draft's own uploaded PDF with ONE named reader setup and reports,
 * per page, the seconds taken and what was captured (facts, fields, requested items, takeoffs, page
 * status). The production reader functions are used unchanged, so the numbers are what customers would
 * get. One setup per request: an autoscale host gives a request no CPU after it responds.
 *
 * Safety: only the draft's own credentials open it, only a draft whose text carries "[QA]", only
 * whitelisted model names, and at most 8 pages. Nothing is saved, emailed or shown to a customer.
 */
export interface BenchmarkCandidate {kind:'OpenAI'|'Anthropic';model:string;textOnly:boolean}
const MODEL=/^(?:gpt-[\w.-]{1,40}|o\d[\w.-]{0,40}|claude-[\w.-]{1,60})$/;
export async function runReadBenchmark(id:string,key:string,raw:unknown){
  const draft=await readDraft(id,key);
  if(!draft)throw new DraftError('Draft not found.',404);
  if(!/\[QA\]/.test(draft.text||''))throw new DraftError('Reader benchmarks run only on QA drafts.',403);
  const input=(raw||{}) as {candidate?:Partial<BenchmarkCandidate>;maxPages?:number};
  const c=input.candidate||{};
  if((c.kind!=='OpenAI'&&c.kind!=='Anthropic')||typeof c.model!=='string'||!MODEL.test(c.model))throw new DraftError('Name a supported reader model.',422);
  const candidate:BenchmarkCandidate={kind:c.kind,model:c.model,textOnly:c.textOnly===true};
  const maxPages=Math.max(1,Math.min(8,Number(input.maxPages)||6));
  const [row]=await query("SELECT name,mime_type,data_base64,storage_bucket,storage_key FROM p5_estimator_files WHERE draft_id=$1 AND mime_type='application/pdf' ORDER BY created_at LIMIT 1",[id]);
  if(!row)throw new DraftError('Upload a PDF to this QA draft first.',422);
  const bytes=Buffer.from(await readStoredBytes(row));
  // Pages are prepared by the production splitter (analysisSegments): permission-restricted forms are
  // rendered, drawings get their detail tiles, every unit carries its text layer. Exactly what a customer's
  // upload is read from.
  const name=String(row.name);
  const units:AnalysisFile[]=[];
  for await(const unit of analysisSegments({name,type:'application/pdf',data:bytes})){if(new Set([...units,unit].flatMap(u=>(u.pages||[]).map(p=>p.page))).size>maxPages)break;units.push(unit);}
  const total=Math.max(0,...units.flatMap(u=>(u.pages||[]).map(p=>p.page)));
  const provider=benchmarkProvider(candidate.kind,candidate.model);
  if(!provider)return {candidate,error:`${candidate.kind} is not configured on this site.`,pages:[]};
  const started=Date.now();
  const pages=await Promise.all(units.map(async(unit,index)=>{
    const text=unit.text||'';
    if(candidate.textOnly&&!text.trim())return {page:unit.pages?.[0]?.page||index+1,seconds:0,ok:false,textChars:0,error:'no text layer on this page'};
    const file:AnalysisFile=candidate.textOnly?{name:`${unit.name} (text layer)`,type:'text/plain',data:Buffer.from(text,'utf8'),pages:unit.pages}:unit;
    const t0=Date.now();
    try{
      const result=await benchmarkRead(provider,[file],draft.text,120_000);
      const ex=result.extraction;
      return {page:unit.pages?.[0]?.page||index+1,unit:unit.name.slice(-60),seconds:+((Date.now()-t0)/1000).toFixed(1),ok:true,textChars:text.length,
        facts:ex.facts.length,fields:[...new Set(ex.facts.map(f=>f.field))],
        items:(ex.instructions?.inclusions||[]).length,sampleItems:(ex.instructions?.inclusions||[]).slice(0,12).map(s=>s.slice(0,100)),
        takeoffs:(ex.takeoffs||[]).length,status:(ex.documentCoverage?.pages||[]).map(p=>p.status).join(',')||'none',
        questions:(ex.instructions?.questions||[]).length+(ex.clarifications||[]).length};
    }catch(error){return {page:unit.pages?.[0]?.page||index+1,unit:unit.name.slice(-60),seconds:+((Date.now()-t0)/1000).toFixed(1),ok:false,textChars:text.length,error:String(error instanceof Error?error.message:error).slice(0,200)};}
  }));
  const ok=pages.filter(p=>p.ok);
  const secs=ok.map(p=>p.seconds).sort((a,b)=>a-b);
  return {candidate,file:{units:units.length,pages:total},wallSeconds:+((Date.now()-started)/1000).toFixed(1),
    summary:{ok:ok.length,failed:pages.length-ok.length,medianSeconds:secs.length?secs[Math.floor(secs.length/2)]:null,maxSeconds:secs.length?secs[secs.length-1]:null,
      items:ok.reduce((t,p)=>t+(p.items||0),0),facts:ok.reduce((t,p)=>t+(p.facts||0),0),takeoffs:ok.reduce((t,p)=>t+(p.takeoffs||0),0)},pages};
}
