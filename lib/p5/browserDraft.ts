import {SCOPE_FIELDS,validateAnswer,type ScopeAnswers,type ScopeExtraction,type ScopeConflict,type ScopeField,type ScopeUpload} from './scope.ts';
export interface BrowserDraft {pendingReply?:{id:string;answer:string};namespace?:string;sourceImageUrl?:string;projectSource?:{id:string;answers:ScopeAnswers;imageUrl?:string};id:string;key:string;revision:number;text:string;answers:ScopeAnswers;extraction:ScopeExtraction|null;contact:{name:string;email:string;phone:string};step:number;updatedAt:number;conflicts?:ScopeConflict[];uploads?:ScopeUpload[];wizard?:{skipped:ScopeField[];resolutions:ScopeAnswers;sourceVersion?:string;instructionAnswers?:import('./clarifications').InstructionAnswer[]} ;analysisWarning?:string;analyzedText?:string;analyzedAnswers?:string;dirty?:boolean;pricedFields?:ScopeField[]}
const storageKey='p5-project-draft-v2';
export function newBrowserDraft(defaultService:string):BrowserDraft {
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  const uuidBytes=crypto.getRandomValues(new Uint8Array(16));uuidBytes[6]=(uuidBytes[6]&15)|64;uuidBytes[8]=(uuidBytes[8]&63)|128;
  const hex=Array.from(uuidBytes,b=>b.toString(16).padStart(2,'0')).join('');
  const uuid=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  return {id:uuid,key:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),revision:0,text:'',answers:defaultService?{service:defaultService}:{},extraction:null,contact:{name:'',email:'',phone:''},step:0,updatedAt:Date.now(),wizard:{skipped:[],resolutions:{}}};
}
export function loadBrowserDraft(defaultService:string,namespace?:string):BrowserDraft {
  try{const d=JSON.parse(localStorage.getItem(namespace?`${storageKey}:${namespace}`:storageKey)||'null');if(d&&typeof d.id==='string'&&/^[a-f0-9-]{36}$/i.test(d.id)&&/^[a-f0-9]{64}$/.test(d.key)&&Number.isInteger(d.revision)&&d.revision>=0&&typeof d.text==='string'&&d.answers&&d.contact&&['name','email','phone'].every(k=>typeof d.contact[k]==='string')&&Object.entries(d.answers).every(([k,v])=>Object.hasOwn(SCOPE_FIELDS,k)&&typeof v==='string'&&!validateAnswer(k as ScopeField,v)))return {...d,step:Math.min(2,Math.max(0,Number(d.step)||0)),wizard:d.wizard||{skipped:[],resolutions:{}}};}catch{}
  return {...newBrowserDraft(defaultService),namespace};
}
export function persistBrowserDraft(draft:BrowserDraft){try{localStorage.setItem(draft.namespace?`${storageKey}:${draft.namespace}`:storageKey,JSON.stringify({...draft,updatedAt:Date.now()}));return true;}catch{return false;}}
export function draftHeaders(draft:BrowserDraft){return {'x-p5-draft-id':draft.id,'x-p5-draft-key':draft.key};}
/** Validate the server receipt before reading its revision or clearing local files. */
export function requireDraftReceipt(data:unknown):{revision:number;answers:ScopeAnswers;extraction:ScopeExtraction|null;uploads:ScopeUpload[];[key:string]:any}{
  const d=(data as any)?.draft;
  if(!d||!Number.isInteger(d.revision)||d.revision<1||!Array.isArray(d.uploads)||!d.answers)throw new Error('Your project save was not confirmed. Your text and files are still here. Please retry.');
  return d;
}
async function fileDb(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('p5-project-files-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
/** Replace the draft's file set in one transaction, including removals. */
export async function cacheFiles(draftId:string,files:File[]){
  // WebKit cannot reliably persist File/Blob backing stores. Store portable bytes.
  const records=await Promise.all(files.map(async file=>({id:`${draftId}:${file.name}:${file.size}:${file.lastModified}`,draftId,name:file.name,type:file.type,lastModified:file.lastModified,bytes:await file.arrayBuffer()})));
  const db=await fileDb();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('files','readwrite');const store=tx.objectStore('files');const cursor=store.openCursor();cursor.onsuccess=()=>{const item=cursor.result;if(item){if(item.value.draftId===draftId)item.delete();item.continue();}else for(const record of records)store.put(record);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function loadCachedFiles(draftId:string):Promise<File[]>{const db=await fileDb();try{return await new Promise<File[]>((resolve,reject)=>{const r=db.transaction('files','readonly').objectStore('files').getAll();r.onsuccess=()=>{try{resolve(r.result.filter(x=>x.draftId===draftId).map(x=>x.bytes instanceof ArrayBuffer?new File([x.bytes],x.name,{type:x.type,lastModified:x.lastModified}):x.file).filter((file):file is File=>file instanceof File));}catch(error){reject(error);}};r.onerror=()=>reject(r.error);});}finally{db.close();}}
export async function clearCachedFiles(draftId:string){await cacheFiles(draftId,[]);}
