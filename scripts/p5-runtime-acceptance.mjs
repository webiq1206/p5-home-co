#!/usr/bin/env node
import {readFile,stat} from 'node:fs/promises';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const PREPARE_APPROVAL='I_APPROVE_QA_DRAFT_WRITE';
const ANSWER_APPROVAL='I_APPROVE_QA_SCOPE_ANSWER';
const PAID_ANALYSIS_APPROVAL='I_APPROVE_PAID_CLARIFICATION_ANALYSIS';
const REVIEW_APPROVAL='I_CONFIRM_QA_SCOPE_REVIEW';
const PRICING_APPROVAL='I_APPROVE_PAID_PRICING';
const DELIVERY_APPROVAL='I_APPROVE_REAL_DELIVERY';
const QA_NAME_PREFIX='[QA]';

export class UnknownOperationError extends Error {
  constructor(operation,cause){
    super(`${operation} ended without a definitive server response. Do not retry it. Inspect the saved draft before deciding what to do next.`,{cause});
    this.name='UnknownOperationError';
  }
}

function requireValue(value,message){if(!value)throw new Error(message);return value;}
function validId(value){return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);}
function validKey(value){return /^[a-f0-9]{64}$/i.test(value);}
function safeBase(value,allowLoopback=false){
  const url=new URL(value);
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(allowLoopback&&loopback&&url.protocol==='http:'))throw new Error('P5_ACCEPTANCE_BASE_URL must use HTTPS. HTTP loopback requires P5_ACCEPTANCE_ALLOW_HTTP_LOOPBACK=true.');
  return url.origin;
}

export async function loadCredentials(env=process.env){
  let values={id:env.P5_ACCEPTANCE_DRAFT_ID,key:env.P5_ACCEPTANCE_DRAFT_KEY};
  if(env.P5_ACCEPTANCE_CREDENTIAL_FILE){
    const info=await stat(env.P5_ACCEPTANCE_CREDENTIAL_FILE);
    if((info.mode&0o077)!==0)throw new Error('Credential file must be private (chmod 600).');
    const file=JSON.parse(await readFile(env.P5_ACCEPTANCE_CREDENTIAL_FILE,'utf8'));
    values={id:file.id,key:file.key};
  }
  if(!validId(values.id||'')||!validKey(values.key||''))throw new Error('Valid existing P5 draft credentials are required.');
  return values;
}
async function loadPrivateText(path,label){
  const info=await stat(path);
  if((info.mode&0o077)!==0)throw new Error(`${label} file must be private (chmod 600).`);
  const value=(await readFile(path,'utf8')).trim();
  if(!value)throw new Error(`${label} file is empty.`);
  return value;
}

function publicDraft(draft){
  return {
    revision:draft.revision,
    status:draft.status,
    brand:draft.brand,
    extractionSaved:Boolean(draft.extraction),
    reviewed:Boolean(draft.reviewed),
    outstandingSavedClarifications:Array.isArray(draft.extraction?.instructions?.questions)?draft.extraction.instructions.questions.length:0,
    qaLabelled:typeof draft.contact?.name==='string'&&draft.contact.name.startsWith(QA_NAME_PREFIX),
    contactReady:Boolean(draft.contact?.name&&draft.contact?.email),
    uploadCount:Array.isArray(draft.uploads)?draft.uploads.length:0,
    updatedAt:draft.updatedAt,
  };
}

export function createAcceptanceClient({baseUrl,credentials,allowHttpLoopback=false,fetchImpl=fetch}){
  const origin=safeBase(baseUrl,allowHttpLoopback);
  const endpoint=path=>new URL(path,`${origin}/`).href;
  const headers={'x-p5-draft-id':credentials.id,'x-p5-draft-key':credentials.key};
  async function request(path,{method='GET',body,operation='request'}={}){
    let response;
    try{
      response=await fetchImpl(endpoint(path),{method,redirect:'error',referrerPolicy:'no-referrer',headers:{...headers,...(method!=='GET'?{origin}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(method==='GET'?30_000:310_000)});
    }catch(error){
      if(method!=='GET')throw new UnknownOperationError(operation,error);
      throw new Error('The draft could not be inspected. No write was attempted.',{cause:error});
    }
    let text;
    try{text=await response.text();}catch(error){
      if(method!=='GET')throw new UnknownOperationError(operation,error);
      throw new Error('The draft response stream could not be read. No write was attempted.',{cause:error});
    }
    let data;try{data=JSON.parse(text);}catch{
      if(method!=='GET')throw new UnknownOperationError(operation,new Error(`Unreadable HTTP ${response.status} response.`));
      throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
    }
    if(!response.ok){
      if(method!=='GET'&&(response.status>=500||response.status===408||response.status===425))throw new UnknownOperationError(operation,new Error(`HTTP ${response.status}`));
      const error=new Error(`P5 route rejected the request (HTTP ${response.status}). No server detail was printed.`);
      error.status=response.status;throw error;
    }
    return {status:response.status,data};
  }
  return {
    async inspect(){
      const {data}=await request('/api/p5-estimator/draft');
      if(!data.draft)throw new Error('The existing draft was not found.');
      return data.draft;
    },
    async inspectDelivery(id,cookie){
      let response;
      try{
        const url=new URL('/api/admin/p5-estimators',`${origin}/`);url.searchParams.set('id',id);
        response=await fetchImpl(url.href,{method:'GET',redirect:'error',referrerPolicy:'no-referrer',headers:{cookie},signal:AbortSignal.timeout(30_000)});
        const text=await response.text();let data;try{data=JSON.parse(text);}catch{throw new Error('Unreadable admin status response.');}
        if(!response.ok)throw new Error(`Admin delivery status was rejected (HTTP ${response.status}).`);
        if(!Array.isArray(data.deliveries))throw new Error('Admin delivery status response omitted deliveries.');
        return data.deliveries.map(item=>({channel:String(item.destination||'unknown').split(':')[0],status:String(item.status||'unknown'),attempts:Number(item.attempts)||0}));
      }catch(error){
        throw new Error('Delivery status could not be inspected. No write was attempted.',{cause:error});
      }
    },
    async save(draft,{answers=draft.answers,contact=draft.contact,reviewed=Boolean(draft.reviewed),clarification,operation='QA draft write'}={}){
      const response=await request('/api/p5-estimator/draft',{method:'PUT',operation,body:{
        revision:draft.revision,text:draft.text,answers,contact,wizard:draft.wizard||{skipped:[],resolutions:{}},reviewed,...(clarification?{clarification}:{}),
      }});
      if(!response.data?.draft||!Number.isInteger(response.data.draft.revision))throw new UnknownOperationError(operation,new Error('Missing draft write receipt.'));
      return response.data.draft;
    },
    async submit(draft){
      const response=await request('/api/p5-estimator/submit',{method:'POST',operation:'paid pricing and delivery submission',body:{revision:draft.revision}});
      if(response.status!==202&&(typeof response.data?.accepted!=='boolean'||typeof response.data?.duplicate!=='boolean'))throw new UnknownOperationError('paid pricing and delivery submission',new Error('Missing submission receipt.'));
      return response;
    },
  };
}

function assertExistingExtraction(draft){
  if(draft.status!=='draft')throw new Error('This draft is already submitted; no mutation is allowed.');
  if(!draft.extraction)throw new Error('This CLI only resumes a saved extraction. It will not start or rerun document analysis.');
}
function qaContact(env){
  const name=env.P5_ACCEPTANCE_CONTACT_NAME||`${QA_NAME_PREFIX} P5 runtime acceptance`;
  if(!name.startsWith(QA_NAME_PREFIX))throw new Error(`The contact name must start with ${QA_NAME_PREFIX} so the record is clearly QA-labelled.`);
  const email=requireValue(env.P5_ACCEPTANCE_RECIPIENT,'P5_ACCEPTANCE_RECIPIENT is required for a draft write or submission.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('P5_ACCEPTANCE_RECIPIENT must be a valid email address.');
  return {name,email:email.toLowerCase(),phone:env.P5_ACCEPTANCE_PHONE||''};
}

export async function runAcceptance({argv=process.argv.slice(2),env=process.env,fetchImpl=fetch,write=message=>process.stdout.write(`${message}\n`)}={}){
  const command=argv[0]||'inspect';
  if(!['inspect','delivery-status','prepare','answer-field','answer-clarification','confirm-review','submit'].includes(command))throw new Error('Usage: p5-runtime-acceptance.mjs [inspect|delivery-status|prepare|answer-field|answer-clarification|confirm-review|submit]');
  const credentials=await loadCredentials(env);
  const client=createAcceptanceClient({baseUrl:requireValue(env.P5_ACCEPTANCE_BASE_URL,'P5_ACCEPTANCE_BASE_URL is required.'),credentials,allowHttpLoopback:env.P5_ACCEPTANCE_ALLOW_HTTP_LOOPBACK==='true',fetchImpl});
  let draft=await client.inspect();
  if(command==='inspect'){write(JSON.stringify(publicDraft(draft),null,2));return publicDraft(draft);}
  if(command==='delivery-status'){
    if(draft.status!=='submitted')throw new Error('Delivery status exists only for a known submitted draft. No write was attempted.');
    const path=requireValue(env.P5_ACCEPTANCE_ADMIN_COOKIE_FILE,'P5_ACCEPTANCE_ADMIN_COOKIE_FILE is required for authenticated delivery inspection.');
    const delivery=await client.inspectDelivery(draft.id,await loadPrivateText(path,'Admin cookie'));
    const result={submitted:true,delivery};write(JSON.stringify(result,null,2));return result;
  }
  assertExistingExtraction(draft);
  if(command==='prepare'){
    const contact=qaContact(env);
    if(env.P5_ACCEPTANCE_PREPARE_APPROVAL!==PREPARE_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_PREPARE_APPROVAL=${PREPARE_APPROVAL} to authorize one QA draft write.`);
    const unchanged=draft.contact?.name===contact.name&&draft.contact?.email===contact.email&&draft.contact?.phone===contact.phone;
    if(!unchanged)draft=await client.save(draft,{contact,reviewed:Boolean(draft.reviewed)});
    const result={prepared:true,wrote:!unchanged,...publicDraft(draft)};write(JSON.stringify(result,null,2));return result;
  }
  if(command==='answer-field'||command==='answer-clarification'){
    if(env.P5_ACCEPTANCE_ANSWER_APPROVAL!==ANSWER_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_ANSWER_APPROVAL=${ANSWER_APPROVAL} to authorize one saved-scope answer.`);
    if(!draft.contact?.name?.startsWith(QA_NAME_PREFIX))throw new Error('Prepare the QA-labelled contact before answering scope questions.');
    if(command==='answer-field'){
      const field=requireValue(env.P5_ACCEPTANCE_ANSWER_FIELD,'P5_ACCEPTANCE_ANSWER_FIELD is required.');
      const value=requireValue(env.P5_ACCEPTANCE_ANSWER_VALUE,'P5_ACCEPTANCE_ANSWER_VALUE is required.');
      draft=await client.save(draft,{answers:{...draft.answers,[field]:value},reviewed:false,operation:'QA scope answer'});
    }else{
      if(env.P5_ACCEPTANCE_PAID_ANALYSIS_APPROVAL!==PAID_ANALYSIS_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_PAID_ANALYSIS_APPROVAL=${PAID_ANALYSIS_APPROVAL} to separately authorize paid clarification analysis.`);
      const id=requireValue(env.P5_ACCEPTANCE_CLARIFICATION_ID,'P5_ACCEPTANCE_CLARIFICATION_ID is required.');
      const answer=requireValue(env.P5_ACCEPTANCE_CLARIFICATION_ANSWER,'P5_ACCEPTANCE_CLARIFICATION_ANSWER is required.');
      draft=await client.save(draft,{reviewed:false,clarification:{id,answer},operation:'QA clarification answer'});
    }
    const result={answered:true,...publicDraft(draft)};write(JSON.stringify(result,null,2));return result;
  }
  if(command==='confirm-review'){
    if(env.P5_ACCEPTANCE_REVIEW_APPROVAL!==REVIEW_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_REVIEW_APPROVAL=${REVIEW_APPROVAL} to explicitly confirm the saved QA scope.`);
    if(!draft.contact?.name?.startsWith(QA_NAME_PREFIX))throw new Error('Prepare the QA-labelled contact before confirming review.');
    if(!draft.reviewed)draft=await client.save(draft,{reviewed:true,operation:'QA scope review confirmation'});
    if(!draft.reviewed)throw new UnknownOperationError('QA scope review confirmation',new Error('Review was not present in the write receipt.'));
    const result={reviewConfirmed:true,...publicDraft(draft)};write(JSON.stringify(result,null,2));return result;
  }
  if(env.P5_ACCEPTANCE_PRICING_APPROVAL!==PRICING_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_PRICING_APPROVAL=${PRICING_APPROVAL} to authorize paid pricing.`);
  if(env.P5_ACCEPTANCE_DELIVERY_APPROVAL!==DELIVERY_APPROVAL)throw new Error(`Set P5_ACCEPTANCE_DELIVERY_APPROVAL=${DELIVERY_APPROVAL} to separately authorize real delivery.`);
  const contact=qaContact(env);
  if(!draft.reviewed)throw new Error('Run the explicitly approved confirm-review step first.');
  if(draft.contact?.name!==contact.name||draft.contact?.email!==contact.email||draft.contact?.phone!==contact.phone)throw new Error('Saved QA contact does not match the requested recipient. Prepare and inspect the draft first.');
  const response=await client.submit(draft);
  const data=response.data;
  const result=response.status===202
    ?{submitted:false,pending:true,message:'Pricing explicitly reported pending. No automatic continuation or retry was attempted.'}
    :{submitted:Boolean(data.accepted||data.duplicate),accepted:Boolean(data.accepted),duplicate:Boolean(data.duplicate),delivery:Array.isArray(data.delivery)?data.delivery.map(item=>({channel:item.channel,status:item.status})):[]};
  write(JSON.stringify(result,null,2));return result;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
  runAcceptance().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Acceptance command failed.'}\n`);process.exitCode=1;});
}