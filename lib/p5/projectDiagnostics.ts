/** Staff-only projections. Never return arbitrary error messages, request
 * headers, environment values or provider response bodies as diagnostics. */
export function projectStageErrorCode(error:unknown):string{
 if(error instanceof Error&&error.cause instanceof Error){
  const causeCode=projectStageErrorCode(error.cause);
  if(causeCode!=='stage-request-failed')return causeCode;
 }
 const value=error instanceof Error?error.message:'';
 const code=error&&typeof error==='object'&&'code'in error?error.code:'';
 if(typeof code==='string'&&/^(?:pricing|model|document|project)-[a-z-]+$/.test(code))return code;
 const incomplete=/^pricing-check-incomplete:([a-z_]+)$/.exec(value);
 if(incomplete)return 'provider-incomplete:'+incomplete[1];
 if(value==='project-workflow-paused')return value;
 return 'stage-request-failed';
}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function projectAttemptReport(row:Record<string,unknown>){
 const work=object(row.payload),requests=object(work.requests),replies=object(work.replies),errors=object(work.errors),result=object(work.result);
 return {
  workKey:row.work_key,updatedAt:row.updated_at,startedAt:work.startedAt,
  draftRevision:work.draftRevision??null,contractHash:work.contractHash??null,phase:work.phase??null,
  status:result.status??'unfinished',problems:result.problems??[],
  stages:Object.entries(requests).sort(([,a],[,b])=>String(object(a).startedAt).localeCompare(String(object(b).startedAt))).map(([requestHash,raw])=>{
   const request=object(raw),input=object(request.input),reply=object(replies[requestHash]);
   const instructions=typeof request.instructions==='string'?request.instructions:'';
   return {requestHash,stage:/^Contract: ([\w-]+)/.exec(instructions)?.[1]??'unknown',startedAt:request.startedAt,
    status:reply.value!==undefined?'saved-response':errors[requestHash]?'failed':'no-saved-response',error:errors[requestHash]??null,
    requestedModel:reply.model??null,returnedModel:reply.responseModel??null,providerRequestIds:reply.providerRequestIds??[],
    // Exact candidates explain bad mappings without mistaking an older accepted
    // record for the candidate the reviewer actually received.
    candidate:input.stage?input.record??null:null,completionPlan:input.stage?input.completionPlan??null:null,
    response:reply.value??null};
  }),
 };
}
