import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync, mkdirSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {ESTIMATOR_BRAND as brand} from '../../lib/p5/brand.ts';

// Node 24 runtime provides SQLite; the app's older @types/node does not yet
// declare it. Keep this isolated CLI boundary typed without changing app deps.
type LedgerDatabase={exec(sql:string):void;close():void;prepare(sql:string):{
  run(...values:unknown[]):unknown;get(...values:unknown[]):unknown;all(...values:unknown[]):unknown[];
}};
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync:new(file:string)=>LedgerDatabase;
};

// Qualification only. Never imported by the application's pricing path.
// All money is integer micro-USD. No default allowance or inferred authorization.
export const DOCUMENT_LIMITS = {short: 1_000_000, plans: 3_000_000} as const;
export const digest = (value:string|Buffer) => createHash('sha256').update(value).digest('hex');
export function pricingSourceIdentity() {
  const sources=(directory:string):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(directory,entry.name);
    return entry.isDirectory()?sources(file):entry.isFile()&&/\.(?:ts|tsx|js|mjs|json)$/.test(file)?[file]:[];
  });
  // Broad dependency closure intentionally invalidates qualification on unrelated
  // shared changes rather than accidentally accepting stale pricing/delivery code.
  const files=[...sources('lib'),...sources('shared'),...sources('server'),
    'package.json','package-lock.json','tsconfig.json',
    'scripts/check-p5-live-pricing.mts','scripts/lib/pricingQualification.ts',
    'scripts/lib/capturedPricingDelivery.ts','scripts/p5-pricing-qualification-ledger.mts',
    'scripts/test-p5-pricing-qualification.mts',
    ...[brand.font,brand.headingFont,brand.logo].map(asset=>path.join('public',asset))].sort();
  return digest(JSON.stringify({runtime:process.version,files:files.map(f=>[f,digest(readFileSync(f))])}));
}
type Rates = {input:number; output:number; cached:number; cacheWrite:number; search:number};
export type PricingAllowance = {
  version:1; id:string; approvedBy:string; approvalEvidence:string; expiresAt:string;
  totalMicros:number; sourceSha256:string; documentIds?:string[];
  accountingBasis?:'exact'|'upper-bound';
  models:Array<{endpoint:string; model:string; rateEvidence:string; rates:Rates;
    maxInputTokens:number; maxOutputTokens:number; maxSearchCalls:number}>;
};
type Context = {documentId:string; kind:keyof typeof DOCUMENT_LIMITS};
const fail = (code:string):never => {throw new Error(`qualification:${code}`);};
const integer = (v:unknown):v is number => Number.isSafeInteger(v) && Number(v)>=0;
const text = (v:unknown):v is string => typeof v==='string' && v.trim().length>0;
const MANAGED_OPENAI_RESPONSES='http://localhost:1106/modelfarm/openai/responses';
function managedOpenAIEndpointAllowed(endpoint:string) {
  if(endpoint!==MANAGED_OPENAI_RESPONSES || !text(process.env.AI_INTEGRATIONS_OPENAI_API_KEY))return false;
  let base:URL;
  try {base=new URL(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL||'');} catch {return false;}
  if(base.username || base.password || base.search || base.hash)return false;
  const normalized=`${base.origin}${base.pathname.replace(/\/+$/,'')}/responses`;
  return normalized===MANAGED_OPENAI_RESPONSES;
}
export function readAllowance(file:string|undefined,allowExpired=false):PricingAllowance {
  if(!file) return fail('documented-allowance-required');
  let a:PricingAllowance;
  try { a=JSON.parse(readFileSync(file,'utf8')); } catch { return fail('allowance-unreadable'); }
  if(a.version!==1 || !text(a.id) || !text(a.approvedBy) || !text(a.approvalEvidence) ||
    !Number.isFinite(Date.parse(a.expiresAt)) || (!allowExpired&&Date.parse(a.expiresAt)<=Date.now()) ||
    !integer(a.totalMicros) || a.totalMicros===0 || !/^[a-f0-9]{64}$/.test(a.sourceSha256) ||
    !Array.isArray(a.models) || !a.models.length) return fail('allowance-invalid-or-expired');
  if(a.documentIds!==undefined && (!Array.isArray(a.documentIds) || !a.documentIds.length ||
    !a.documentIds.every(text) || new Set(a.documentIds).size!==a.documentIds.length))
    return fail('allowance-document-ids-invalid');
  if(a.accountingBasis!==undefined && a.accountingBasis!=='exact' && a.accountingBasis!=='upper-bound')
    return fail('allowance-accounting-basis-invalid');
  for(const m of a.models) {
    let u:URL;try{u=new URL(m.endpoint);}catch{return fail('endpoint-invalid');}
    if((u.protocol!=='https:' && !managedOpenAIEndpointAllowed(m.endpoint)) ||
      u.username || u.password || u.search || u.hash ||
      !text(m.model) || !text(m.rateEvidence) ||
      !m.rates || !['input','output','cached','cacheWrite','search'].every(k=>integer(m.rates[k as keyof Rates])) ||
      !integer(m.maxInputTokens) || !integer(m.maxOutputTokens) || !integer(m.maxSearchCalls) ||
      !m.maxInputTokens || !m.maxOutputTokens) return fail('model-allowance-invalid');
  }
  return a;
}
function cost(r:Rates,input:number,output:number,cached:number,write:number,search:number) {
  const tokens=BigInt(input)*BigInt(r.input)+BigInt(output)*BigInt(r.output)+BigInt(cached)*BigInt(r.cached)+BigInt(write)*BigInt(r.cacheWrite);
  const total=Number((tokens+999_999n)/1_000_000n+BigInt(search)*BigInt(r.search));
  if(!integer(total))return fail('usage-cost-invalid');
  return total;
}
export class PricingQualification {
  private db:LedgerDatabase;
  readonly allowance:PricingAllowance;
  constructor(allowanceFile:string|undefined, ledgerFile:string, sourceSha256:string,private mode:'execute'|'review'='execute') {
    this.allowance=readAllowance(allowanceFile,mode==='review');
    if(mode==='execute'&&this.allowance.sourceSha256!==sourceSha256)fail('source-identity-mismatch');
    if(mode==='review'&&!existsSync(ledgerFile))fail('ledger-not-found');
    mkdirSync(path.dirname(ledgerFile),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(ledgerFile);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS authority (singleton INTEGER PRIMARY KEY CHECK(singleton=1), hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY, document TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT NOT NULL,
        model TEXT NOT NULL, state TEXT NOT NULL, reserved INTEGER NOT NULL, actual INTEGER,
        response_hash TEXT, usage TEXT, evidence TEXT, owner_pid INTEGER NOT NULL, owner_host TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reconciliations (
        id INTEGER PRIMARY KEY, call_id TEXT NOT NULL, actual INTEGER NOT NULL, evidence TEXT NOT NULL, created TEXT NOT NULL);`);
    const hash=digest(JSON.stringify(this.allowance));
    this.db.prepare('INSERT OR IGNORE INTO authority VALUES(1,?)').run(hash);
    if((this.db.prepare('SELECT hash FROM authority').get() as any).hash!==hash) {
      this.db.close();fail('ledger-allowance-mismatch');
    }
  }
  private transaction<T>(fn:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value=fn();this.db.exec('COMMIT');return value; }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  report() {
    return {allowanceId:this.allowance.id,sourceSha256:this.allowance.sourceSha256,
      accountingBasis:this.allowance.accountingBasis??'exact',
      limits:DOCUMENT_LIMITS,calls:this.db.prepare('SELECT * FROM calls ORDER BY created,id').all()};
  }
  assertClear() {
    if(this.db.prepare("SELECT 1 FROM calls WHERE state!='settled' LIMIT 1").get())fail('unknown-charge-frozen');
    const total=Number((this.db.prepare('SELECT COALESCE(SUM(actual),0) AS n FROM calls').get() as any).n);
    if(total>this.allowance.totalMicros)fail('allowance-exceeded');
    for(const row of this.db.prepare('SELECT kind,SUM(actual) AS n FROM calls GROUP BY document,kind').all() as any[])
      if(row.n>DOCUMENT_LIMITS[row.kind as keyof typeof DOCUMENT_LIMITS])fail('document-budget-exceeded');
  }
  // Explicit billing evidence is required; this NEVER retries the original request.
  reconcile(id:string,actualMicros:number,evidence:string) {
    if(!integer(actualMicros)||!text(evidence)||evidence.trim().length<20)fail('billing-evidence-required');
    this.transaction(()=>{
      const row=this.db.prepare('SELECT state,owner_pid,owner_host FROM calls WHERE id=?').get(id) as any;
      if(!row || row.state==='settled')fail('not-an-unresolved-charge');
      if(row.state==='reserved'){
        if(row.owner_host!==hostname())fail('reservation-owner-must-be-proven-stopped');
        try {process.kill(row.owner_pid,0);fail('reservation-owner-still-running');}
        catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
      }
      this.db.prepare('INSERT INTO reconciliations(call_id,actual,evidence,created) VALUES(?,?,?,?)')
        .run(id,actualMicros,evidence,new Date().toISOString());
      this.db.prepare("UPDATE calls SET state='settled',actual=?,evidence=? WHERE id=?").run(actualMicros,evidence,id);
    });
  }
  close(){this.db.close();}
  guardedFetch(context:Context,transport:typeof fetch):typeof fetch {
    return async (input,init) => {
      if(this.mode!=='execute')fail('review-mode-cannot-spend');
      // Deny every unrecognized network destination, including delivery/CRM.
      if(!text(context.documentId)||!(context.kind in DOCUMENT_LIMITS))fail('document-identity-required');
      if(this.allowance.documentIds && !this.allowance.documentIds.includes(context.documentId))
        fail('document-not-approved');
      const endpoint=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      let body:any;
      try {body=JSON.parse(typeof init?.body==='string'?init.body:'');}catch{return fail('json-request-required');}
      const policy=this.allowance.models.find(m=>m.endpoint===endpoint && m.model===body.model);
      if(!policy || init?.method!=='POST' || body.stream || (body.service_tier && body.service_tier!=='default'))fail('unapproved-provider-request');
      const p=policy!;
      const tools=body.tools||[];
      if(!Array.isArray(tools))fail('unbounded-tools');
      let searches=0;
      for(const t of tools){
        if(t.type==='web_search_20250305' && integer(t.max_uses))searches+=t.max_uses;
        else if(t.type==='web_search' && integer(body.max_tool_calls))searches+=body.max_tool_calls;
        // Web fetch and other tools have additional billing dimensions: no guessed rate.
        else fail('unsupported-or-unbounded-tool-billing');
      }
      // Current pricing requests do not bound server-tool-added input tokens.
      // Do not mistake a documented token allowance for a provider-enforced cap.
      if(tools.length)fail('server-tool-input-bound-required');
      const output=body.max_tokens??body.max_output_tokens;
      // UTF-8 bytes conservatively bound text tokens; images/files are not accepted.
      const serialized=JSON.stringify(body);
      if(/"type"\s*:\s*"(?:image|image_url|input_image|document|input_file)"/.test(serialized))fail('unsupported-input-billing');
      const inputBound=Buffer.byteLength(serialized)+1024;
      if(!integer(output)||output===0||output>p.maxOutputTokens||inputBound>p.maxInputTokens||searches>p.maxSearchCalls)
        fail('request-exceeds-approved-bounds');
      const reserved=cost({...p.rates,input:Math.max(p.rates.input,p.rates.cached,p.rates.cacheWrite)},inputBound,output,0,0,searches);
      if(!reserved)fail('positive-reservation-required');
      const id=digest(JSON.stringify({document:context.documentId,kind:context.kind,endpoint,body}));
      this.transaction(()=>{
        if(Date.parse(this.allowance.expiresAt)<=Date.now())fail('allowance-expired');
        this.assertClear();
        if(this.db.prepare('SELECT 1 FROM calls WHERE id=?').get(id))fail('duplicate-provider-call');
        const prior=this.db.prepare('SELECT kind FROM calls WHERE document=? LIMIT 1').get(context.documentId) as any;
        if(prior && prior.kind!==context.kind)fail('document-kind-mismatch');
        const all=Number((this.db.prepare('SELECT COALESCE(SUM(actual),0) n FROM calls').get() as any).n);
        const doc=Number((this.db.prepare('SELECT COALESCE(SUM(actual),0) n FROM calls WHERE document=?').get(context.documentId) as any).n);
        if(all+reserved>this.allowance.totalMicros || doc+reserved>DOCUMENT_LIMITS[context.kind])fail('insufficient-allowance');
        this.db.prepare('INSERT INTO calls(id,document,kind,endpoint,model,state,reserved,owner_pid,owner_host,created) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(id,context.documentId,context.kind,endpoint,p.model,'reserved',reserved,process.pid,hostname(),new Date().toISOString());
      });
      // The reservation is committed before transport. A crash at ANY following
      // instruction leaves an unresolved charge which blocks a restarted process.
      try {
        const response=await transport(input,{...init,redirect:'error'});
        const raw=await response.clone().text();
        const reply=JSON.parse(raw);
        if(!response.ok || reply.model!==p.model || !reply.usage)fail('unknown-charge');
        if(reply.service_tier && reply.service_tier!=='default')fail('unapproved-billing-tier');
        const u=reply.usage;
        const anthropic=Array.isArray(reply.content);
        const inputTokens=u.input_tokens,outputTokens=u.output_tokens;
        const cached=anthropic?(u.cache_read_input_tokens??0):(u.input_tokens_details?.cached_tokens??0);
        const write=anthropic?(u.cache_creation_input_tokens??0):0;
        const search=anthropic?(u.server_tool_use?.web_search_requests??(tools.length?undefined:0)):
          (tools.length?undefined:0); // OpenAI tool count is not authoritative billing usage.
        if(![inputTokens,outputTokens,cached,write,search].every(integer) || (!anthropic&&cached>inputTokens))
          fail('incomplete-billing-usage');
        if(u.cache_creation?.ephemeral_1h_input_tokens || u.server_tool_use?.web_fetch_requests)
          fail('unsupported-usage-billing');
        const actual=cost(p.rates,anthropic?inputTokens:inputTokens-cached,outputTokens,cached,write,search);
        this.db.prepare("UPDATE calls SET state=?,actual=?,response_hash=?,usage=? WHERE id=?")
          .run(actual>reserved?'overrun':'settled',actual,digest(raw),
            JSON.stringify({inputTokens,outputTokens,cached,write,search}),id);
        if(actual>reserved)fail('reservation-overrun');
        return response;
      } catch {
        // Never store/print provider exceptions, headers, request bodies or raw responses.
        this.db.prepare("UPDATE calls SET state='unknown' WHERE id=? AND state='reserved'").run(id);
        return fail('unknown-charge-frozen');
      }
    };
  }
}