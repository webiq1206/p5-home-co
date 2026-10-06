/** Machine-readable diagnostics only. Provider bodies, prompts and credentials
 * must not enter the request trace. The ledger fingerprint links private state. */
export function pricingFailureDetails(error:unknown){
 const causes:{code:string;status:number|null;requestId:string|null;research?:ResearchDiagnostics}[]=[];
 const seen=new Set<unknown>();
 for(let current=error;current&&typeof current==='object'&&!seen.has(current)&&causes.length<6;current=(current as {cause?:unknown}).cause){
  seen.add(current);
  const item=current as {message?:unknown;name?:unknown;code?:unknown;providerRequestId?:unknown;providerStatus?:unknown;researchDiagnostics?:ResearchDiagnostics};
  const message=typeof item.message==='string'?item.message:'';
  const status=Number(/^pricing-provider-unavailable:(\d{3})(?::|$)/.exec(message)?.[1])||(Number.isInteger(item.providerStatus)?Number(item.providerStatus):null);
  const incomplete=/^pricing-check-incomplete:([a-z_]+)$/.exec(message);
  const incompleteReason=incomplete&&['max_tokens','max_output_tokens','pause_turn','refusal','length','content_filter','incomplete','failed','cancelled','in_progress','queued','unknown'].includes(incomplete[1])?incomplete[1]:'unknown';
  const declared=typeof item.code==='string'&&/^(?:pricing|estimator-model)-[a-z-]+$/.test(item.code)?item.code:null;
  const exact=/^pricing-(?:check-timeout|search-unavailable|research-format-unavailable|invalid-tool-output|provider-unavailable)$/.test(message)?message:null;
  const code=declared||exact||(incomplete?`provider-incomplete:${incompleteReason}`:status?`provider-http-${status}`:null)||
   (item.name==='ProcessingDeadlineError'?'deadline':item.name==='AbortError'||item.name==='TimeoutError'?'provider-timeout':item.name==='SyntaxError'?'provider-invalid-json':'request-failed');
  const requestId=typeof item.providerRequestId==='string'&&/^[\w-]{1,160}$/.test(item.providerRequestId)?item.providerRequestId:null;
  causes.push({code,status,requestId,...(item.researchDiagnostics?{research:item.researchDiagnostics}:{})});
 }
 return causes.length?causes:[{code:'request-failed',status:null,requestId:null}];
}

export function pricingHttpError(response:Response,detail:string){
 return Object.assign(new Error(`pricing-provider-unavailable:${response.status}:${detail.replace(/\s+/g,' ').slice(0,300)}`),{
  providerRequestId:response.headers.get('request-id')||response.headers.get('x-request-id')||undefined,
 });
}

export interface ResearchDiagnostics {
 stopReason:string; blockTypes:string[]; toolErrors:string[];
 searchResults:number; fetchResults:number; textCharacters:number;
}
/** Retain structure and provider error codes, never prompts or report text. */
export function missingResearchSources(content:unknown[],stopReason:unknown,requestId?:string,status=200){
 const token=(v:unknown)=>typeof v==='string'&&/^[a-z_]{1,80}$/.test(v)?v:'unknown';
 const details:ResearchDiagnostics={stopReason:token(stopReason),blockTypes:[],toolErrors:[],searchResults:0,fetchResults:0,textCharacters:0};
 for(const raw of content){
  if(!raw||typeof raw!=='object')continue;
  const block=raw as {type?:unknown;text?:unknown;content?:unknown};
  details.blockTypes.push(token(block.type));
  if(block.type==='text'&&typeof block.text==='string')details.textCharacters+=block.text.length;
  if(block.type!=='web_search_tool_result'&&block.type!=='web_fetch_tool_result')continue;
  for(const entry of Array.isArray(block.content)?block.content:[block.content]){
   if(!entry||typeof entry!=='object')continue;
   if(entry.type==='web_search_result')details.searchResults++;
   if(entry.type==='web_fetch_result')details.fetchResults++;
   if(entry.error_code)details.toolErrors.push(token(entry.error_code));
  }
 }
 details.blockTypes=[...new Set(details.blockTypes)].slice(0,20);
 details.toolErrors=[...new Set(details.toolErrors)].slice(0,20);
 return Object.assign(new Error('pricing-search-unavailable'),{providerRequestId:requestId,providerStatus:status,researchDiagnostics:details});
}
