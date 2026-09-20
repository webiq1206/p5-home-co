/** Durable estimate identity is separate from customer email identity. */
export function crmIdentity(record:any,key:string,source:string,allowlist=process.env.SYNTHETIC_QA_EMAIL_ALLOWLIST||'') {
  const qa=/^\[QA\](?:\s|$)/i.test(record.contact?.name||'');
  const email=String(record.contact?.email||'').trim().toLowerCase();
  if(qa&&!email.endsWith('@example.invalid')&&!allowlist.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean).includes(email))
    throw new Error('QA CRM delivery requires the configured authorized test mailbox; no campaign was started');
  return {source,externalLeadId:qa?`qa-${key}`:key,deliveryMode:qa?'synthetic_qa':'live'};
}

async function readJson(response:Response) {
  if(!response.body)throw new Error('CRM acknowledgement is empty');
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;
      if(bytes>65536){await reader.cancel();throw new Error('CRM acknowledgement exceeds the response limit');}
      chunks.push(next.value);
    }
  } finally {reader.releaseLock();}
  let value:any;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('CRM acknowledgement is not valid JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('CRM acknowledgement is invalid');
  return value;
}

function matching(body:any,payload:any) {
  return body.source===payload.source&&body.externalLeadId===payload.externalLeadId
    &&body.acceptanceMode===payload.deliveryMode&&typeof body.leadId==='string'
    &&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.leadId);
}

/** A lost POST receipt is reconciled with one authenticated read, never replayed. */
export async function deliverKeyedCrm(payload:any,key:string,token:string,url:string,fetchImpl:typeof fetch=fetch) {
  if(!token)throw new Error('CRM synchronization is not configured');
  let destination:URL;try{destination=new URL(url);}catch{throw new Error('CRM destination must be a credential-free HTTPS endpoint');}
  if(destination.protocol!=='https:'||destination.username||destination.password||destination.search||destination.hash)
    throw new Error('CRM destination must be a credential-free HTTPS endpoint');
  const headers={Authorization:`Bearer ${token}`,'Idempotency-Key':key};
  const reconcile=async()=>{
    const lookup=new URL(destination.href.replace(/\/$/,'')+'/reconcile');
    lookup.searchParams.set('source',payload.source);lookup.searchParams.set('externalLeadId',payload.externalLeadId);
    let response:Response;
    try{response=await fetchImpl(lookup,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch{throw new Error('CRM delivery remains unconfirmed after reconciliation transport failure; inspect the saved estimate before retrying');}
    if(!response.ok)throw new Error(`CRM delivery unconfirmed (reconciliation HTTP ${response.status}); inspect the saved estimate before retrying`);
    const body=await readJson(response);
    if(body.found!==true||body.status!=='accepted'||!matching(body,payload)
      ||(payload.deliveryMode==='synthetic_qa'&&body.downstreamStatus!=='suppressed'))
      throw new Error('CRM reconciliation did not prove this estimate and its delivery mode');
    return body.leadId as string;
  };
  let response:Response;
  try {response=await fetchImpl(destination,{method:'POST',headers:{...headers,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify(payload)});}
  catch {return reconcile();}
  if(!response.ok){
    if(response.status>=500)return reconcile();
    throw new Error(`CRM rejected this estimate (HTTP ${response.status}); no automatic resubmission was attempted`);
  }
  let body:any;try{body=await readJson(response);}catch{return reconcile();}
  if(body.success!==true||!matching(body,payload))return reconcile();
  if(payload.deliveryMode==='synthetic_qa'){
    const id=await reconcile();if(id!==body.leadId)throw new Error('CRM acceptance and reconciliation identifiers disagree');
  }
  return body.leadId as string;
}
