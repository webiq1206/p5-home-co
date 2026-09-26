import {ESTIMATOR_MODEL,assertEstimatorModel,EstimatorModelError} from './modelPolicy.ts';
/**
 * Full-book shortlist (owner request 2026-09-22: "the scope matching logic to the line items in the
 * cost book needs to be improved greatly").
 *
 * The mapping stage is shown a slice of the price book chosen by shared words (catalogSelection.ts).
 * Scopes are written by homeowners, inspectors and architects in their own words, so a task and the
 * right book line often share no word at all: "construct one new residence" and "New home
 * construction, complete" did not, and a 2,400 SF house went unpriced. Here a fast model reads a
 * compact index of the WHOLE book (code, line name, unit; about 1,500 lines) against the task list
 * and names the closest lines for each task. Those codes are always offered to the mapping stage,
 * alongside the word matches, and passed as a per-task shortlist.
 *
 * It never prices anything and never removes a line from consideration: a failure or timeout
 * returns an empty shortlist and mapping receives the complete book.
 */
export interface ShortlistTask {id:string;description:string;evidence?:string}
export interface ShortlistRate {code:string;description:string;unit?:string;type?:string}
export const SHORTLIST_PER_TASK=8;
const lineName=(description:string)=>{const cut=description.indexOf(' (');return (cut>0?description.slice(0,cut):description);};
const costKind=(type?:string)=>type==='Material'?'material':type==='Labor'?'labor':type==='Other'?'fee':'installed';
/** One line per book entry: code | name | unit | installed/material/labor/fee. */
export function bookIndex(rates:readonly ShortlistRate[]):string{
  return rates.map(r=>`${r.code}|${lineName(r.description)}|${r.unit||''}|${costKind(r.type)}`).join('\n');
}
export const SHORTLIST_INSTRUCTIONS=`You match construction scope tasks to lines in a contractor's price book.
bookIndex lists every line as code|name|unit|kind (installed = labor and material together).
For EACH task, return up to ${SHORTLIST_PER_TASK} book codes that describe the same kind of work, best first, judged by meaning, not wording: a homeowner's "can lights" is the book's "recessed light", "residence" is "home", "tub surround re-caulk" is "caulk tub / shower".
Prefer a complete installed line or a complete assembly when the task is the whole job (a whole new house, a whole kitchen remodel). When a task bundles several repairs, include a line for each repair. Include a demolition or removal line when the task replaces something.
Use ONLY codes that appear in bookIndex. Return an empty list for a task only when nothing in the book is the same kind of work.
Return JSON only: {"tasks":[{"id":"...","codes":["PB-..."]}]}`;
const schema={type:'object',additionalProperties:false,required:['tasks'],properties:{tasks:{type:'array',items:{type:'object',additionalProperties:false,required:['id','codes'],properties:{id:{type:'string'},codes:{type:'array',items:{type:'string'}}}}}}};
/** Keep only known task ids and known codes, at most SHORTLIST_PER_TASK each, in the model's order. */
export function parseShortlist(raw:unknown,tasks:readonly ShortlistTask[],rates:readonly ShortlistRate[]):Map<string,string[]>{
  const known=new Set(rates.map(r=>r.code)),ids=new Set(tasks.map(t=>t.id));
  const result=new Map<string,string[]>();
  const rows=(raw&&typeof raw==='object'&&Array.isArray((raw as {tasks?:unknown}).tasks))?(raw as {tasks:unknown[]}).tasks:[];
  for(const row of rows){
    if(!row||typeof row!=='object')continue;
    const id=String((row as {id?:unknown}).id||'');if(!ids.has(id))continue;
    const codes=Array.isArray((row as {codes?:unknown}).codes)?(row as {codes:unknown[]}).codes.map(String).filter(c=>known.has(c)):[];
    result.set(id,[...new Set([...(result.get(id)||[]),...codes])].slice(0,SHORTLIST_PER_TASK));
  }
  return result;
}
type Fetch=typeof fetch;
/** The whole-book shortlist, or an empty map when no OpenAI connection is configured or the call fails. */
export async function shortlistBook(tasks:readonly ShortlistTask[],rates:readonly ShortlistRate[],request:Fetch=fetch,timeoutMs=Number(process.env.P5_SHORTLIST_TIMEOUT_MS||30000)):Promise<Map<string,string[]>>{
  if(!tasks.length||!rates.length||(process.env.P5_BOOK_SHORTLIST||'').toLowerCase()==='off')return new Map();
  const integrated=Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY&&process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
  const key=integrated?process.env.AI_INTEGRATIONS_OPENAI_API_KEY:process.env.OPENAI_API_KEY;
  const endpoint=(integrated?process.env.AI_INTEGRATIONS_OPENAI_BASE_URL:(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1'))?.replace(/\/+$/,'');
  if(!key||!endpoint)return new Map();
  const started=Date.now();
  try{
    const input={tasks:tasks.map(t=>({id:t.id,task:`${t.description}${t.evidence&&t.evidence!==t.description?` (${String(t.evidence).slice(0,300)})`:''}`})),bookIndex:bookIndex(rates)};
    const body={model:ESTIMATOR_MODEL,instructions:SHORTLIST_INSTRUCTIONS,input:'Return JSON only.\n'+JSON.stringify(input),max_output_tokens:6000,store:false,text:{format:{type:'json_schema',name:'book_shortlist',strict:true,schema}}};
    const response=await request(`${endpoint}/responses`,{method:'POST',signal:AbortSignal.timeout(timeoutMs),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(body)});
    if(!response.ok){console.error(`[p5-pricing] book shortlist unavailable (${response.status}); retaining the complete book for mapping.`);return new Map();}
    const reply=await response.json() as {model?:string;output?:{content?:{type?:string;text?:string}[]}[]};
    const responseModel=assertEstimatorModel(reply.model);
    console.error(JSON.stringify({event:'p5-model',stage:'book-shortlist',requestedModel:ESTIMATOR_MODEL,responseModel}));
    const text=(reply.output||[]).flatMap(o=>o.content||[]).filter(p=>p.type==='output_text').map(p=>p.text||'').join('');
    const shortlist=parseShortlist(JSON.parse(text),tasks,rates);
    console.error(`[p5-pricing] book shortlist: ${shortlist.size}/${tasks.length} tasks matched in ${((Date.now()-started)/1000).toFixed(1)}s`);
    return shortlist;
  }catch(error){
    if(error instanceof EstimatorModelError)throw error;
    console.error(`[p5-pricing] book shortlist failed; retaining the complete book for mapping: ${error instanceof Error?error.message.slice(0,160):String(error).slice(0,160)}`);
    return new Map();
  }
}
