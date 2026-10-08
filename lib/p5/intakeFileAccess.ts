import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {IntakeSnapshot} from './intakeContract.ts';
import {INTAKE_RECIPIENTS,INTAKE_SITES,type IntakeSite} from './intakePolicy.ts';
import {snapshotKey,type IntakeQuery} from './intakeStore.ts';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from './objectStorage.ts';
import type {ScopeUpload} from './scope.ts';

export const INTAKE_FILE_LINK_DAYS=14;
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const signature=(secret:string,site:string,id:string,revision:number,fileId:string,expires:number,recipient:string)=>createHmac('sha256',secret).update(JSON.stringify(['intake-original-v1',site,id,revision,fileId,expires,recipient])).digest('base64url');
/** Reuses the established server-only link secret. Grants one submitted original,
 * not draft editing, other revisions, other files or staff access. Never log URLs. */
export function intakeFileLink(s:IntakeSnapshot,file:ScopeUpload,channel:'customer'|'team',secret:string,now=Date.now()){
 if(!secret||!s.scope.uploads.some(f=>f.id===file.id))throw Error('file-delivery-unavailable');
 const recipient=hash(channel==='customer'?s.contact.email.toLowerCase():INTAKE_RECIPIENTS[s.currentSite]);
 const expires=Math.floor(now/1000)+INTAKE_FILE_LINK_DAYS*86400;
 const url=new URL(`https://${INTAKE_SITES[s.currentSite].domain}/api/p5-estimator/intake-file`);
 url.search=new URLSearchParams({draftId:s.draftId,revision:String(s.revision),fileId:file.id,expires:String(expires),recipient,signature:signature(secret,s.currentSite,s.draftId,s.revision,file.id,expires,recipient)}).toString();
 return url.href;
}
type Dependencies={query:IntakeQuery;readBytes:(row:Record<string,unknown>)=>Promise<Uint8Array>};
export async function verifiedIntakeFile(s:IntakeSnapshot,file:ScopeUpload,deps:Dependencies){
 const [row]=await deps.query('SELECT id,name,mime_type,size_bytes,sha256,data_base64,storage_bucket,storage_key FROM p5_estimator_files WHERE id=$1 AND draft_id=$2',[file.id,s.draftId]);
 if(!row||row.name!==file.name||row.mime_type!==file.type||Number(row.size_bytes)!==file.size||row.sha256!==file.sha256||!file.sha256)throw Error('file-delivery-unavailable');
 const domain=INTAKE_SITES[s.currentSite].domain,prefix=uploadObjectKey(domain,s.draftId,file.sha256);
 if((row.storage_bucket||row.storage_key)&&(row.storage_bucket!==ESTIMATOR_BUCKETS[domain]||typeof row.storage_key!=='string'||!(row.storage_key===prefix||row.storage_key.startsWith(prefix+'/'))))throw Error('file-delivery-unavailable');
 let bytes:Uint8Array;try{bytes=await deps.readBytes(row);}catch{throw Error('file-delivery-unavailable');}
 if(bytes.byteLength!==file.size||hash(bytes)!==file.sha256)throw Error('file-delivery-unavailable');
 return bytes;
}
export function intakeFileHandler(deps:Dependencies&{site:IntakeSite;secret:()=>string;now?:()=>number}){
 return async(request:Request)=>{
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'};
  try{
   const p=new URL(request.url).searchParams,id=p.get('draftId')||'',fileId=p.get('fileId')||'',revision=Number(p.get('revision')),expires=Number(p.get('expires')),recipient=p.get('recipient')||'',supplied=p.get('signature')||'',now=Math.floor((deps.now?.()??Date.now())/1000);
   if(!uuid.test(id)||!uuid.test(fileId)||!Number.isSafeInteger(revision)||revision<1||!Number.isSafeInteger(expires)||expires<=now||expires>now+INTAKE_FILE_LINK_DAYS*86400||!/^[a-f\d]{64}$/.test(recipient)||!/^[A-Za-z0-9_-]{43}$/.test(supplied))throw Error('invalid');
   const expected=signature(deps.secret(),deps.site,id,revision,fileId,expires,recipient);
   if(!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))throw Error('invalid');
   const [row]=await deps.query("SELECT w.payload->'snapshot' AS snapshot FROM p5_estimator_work w JOIN p5_estimator_drafts d ON d.id=w.draft_id WHERE w.draft_id=$1 AND w.work_key=$2 AND d.brand=$3",[id,snapshotKey(revision),deps.site]);
   const s=row?.snapshot as IntakeSnapshot|undefined;
   if(!s||s.draftId!==id||s.revision!==revision||s.currentSite!==deps.site||![s.contact.email.toLowerCase(),INTAKE_RECIPIENTS[deps.site]].some(email=>hash(email)===recipient))throw Error('invalid');
   const file=s.scope.uploads.find(f=>f.id===fileId);if(!file)throw Error('invalid');
   const bytes=await verifiedIntakeFile(s,file,deps);
   return new Response(bytes as BodyInit,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(bytes.byteLength),'Content-Disposition':`attachment; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`}});
  }catch{return new Response('This private file link is unavailable or expired. Contact the project team for help.',{status:404,headers});}
 };
}
