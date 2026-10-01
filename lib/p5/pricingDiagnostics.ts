/** Machine-readable diagnostics only. Provider bodies, prompts and credentials
 * must not enter the request trace. The ledger fingerprint links private state. */
export function pricingFailureDetails(error:unknown){
 const causes:{code:string;status:number|null;requestId:string|null}[]=[];
 const seen=new Set<unknown>();
 for(let current=error;current&&typeof current==='object'&&!seen.has(current)&&causes.length<6;current=(current as {cause?:unknown}).cause){
  seen.add(current);
  const item=current as {message?:unknown;name?:unknown;code?:unknown;providerRequestId?:unknown};
  const message=typeof item.message==='string'?item.message:'';
  const status=Number(/^pricing-provider-unavailable:(\d{3})(?::|$)/.exec(message)?.[1])||null;
  const incomplete=/^pricing-check-incomplete:([a-z_]+)$/.exec(message);
  const declared=typeof item.code==='string'&&/^(?:pricing|estimator-model)-[a-z-]+$/.test(item.code)?item.code:null;
  const exact=/^pricing-(?:check-timeout|search-unavailable|research-format-unavailable|invalid-tool-output|provider-unavailable)$/.test(message)?message:null;
  const code=declared||(status?`provider-http-${status}`:incomplete?`provider-incomplete:${incomplete[1]}`:exact)||
   (item.name==='ProcessingDeadlineError'?'deadline':item.name==='AbortError'||item.name==='TimeoutError'?'provider-timeout':item.name==='SyntaxError'?'provider-invalid-json':'request-failed');
  const requestId=typeof item.providerRequestId==='string'&&/^[\w-]{1,160}$/.test(item.providerRequestId)?item.providerRequestId:null;
  causes.push({code,status,requestId});
 }
 return causes.length?causes:[{code:'request-failed',status:null,requestId:null}];
}

export function pricingHttpError(response:Response,detail:string){
 return Object.assign(new Error(`pricing-provider-unavailable:${response.status}:${detail.replace(/\s+/g,' ').slice(0,300)}`),{
  providerRequestId:response.headers.get('request-id')||response.headers.get('x-request-id')||undefined,
 });
}
