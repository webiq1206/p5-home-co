import {SCOPE_FIELDS,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP,type ScopeAnswers,type ScopeExtraction,type ScopeConflict,type ScopeField,type ScopeUpload} from './scope.ts';
/** One turn of the conversation, kept with the draft on this device so a
 * reload shows the same exchange. Never sent to the server. */
export interface TranscriptEntry {id:string;role:'user'|'assistant';text:string;at:number;kind?:'scope'|'ack'|'question'|'answer'|'note';label?:string;caption?:string;files?:string[]}
export interface BrowserDraft {pendingFiles?:Array<{name:string;size:number}>}
export interface BrowserDraft {transcript?:TranscriptEntry[];/** Revision confirmed with reviewed=true; cleared by any later change. */reviewedRevision?:number;pendingReply?:{id:string;answer:string};namespace?:string;sourceImageUrl?:string;/** Set when an explicit replacement must not reattach route-provided design data. */sourceDetached?:boolean;projectSource?:{id:string;answers:ScopeAnswers;imageUrl?:string};id:string;key:string;revision:number;text:string;answers:ScopeAnswers;extraction:ScopeExtraction|null;contact:{name:string;email:string;phone:string};step:number;updatedAt:number;conflicts?:ScopeConflict[];uploads?:ScopeUpload[];wizard?:{skipped:ScopeField[];resolutions:ScopeAnswers;sourceVersion?:string;instructionAnswers?:import('./clarifications.ts').InstructionAnswer[]} ;analysisWarning?:string;analyzedText?:string;analyzedAnswers?:string;analyzedFingerprint?:string;scopeFingerprint?:string;dirty?:boolean;pricedFields?:ScopeField[]}
const storageKey='p5-project-draft-v2';
export const BROWSER_DRAFT_RECOVERY_KEY=`${storageKey}:recovery-v1`;
const draftStorageKey=(namespace?:string)=>namespace?`${storageKey}:${namespace}`:storageKey;

export interface BrowserDraftRecovery {
  key: string;
  archivedAt: number;
  draft: BrowserDraft;
}
export function newBrowserDraft(defaultService:string):BrowserDraft {
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  const uuidBytes=crypto.getRandomValues(new Uint8Array(16));uuidBytes[6]=(uuidBytes[6]&15)|64;uuidBytes[8]=(uuidBytes[8]&63)|128;
  const hex=Array.from(uuidBytes,b=>b.toString(16).padStart(2,'0')).join('');
  const uuid=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  return {id:uuid,key:Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),revision:0,text:'',answers:defaultService?{service:defaultService}:{},extraction:null,contact:{name:'',email:'',phone:''},step:0,updatedAt:Date.now(),wizard:{skipped:[],resolutions:{}},uploads:[]};
}
export function loadBrowserDraft(defaultService:string,namespace?:string):BrowserDraft {
  // A local draft is unfinished input, not an approved submission. A partial
  // numeric edit (e.g. "1,") must not erase its text, files and other answers.
  // Semantic validation still happens when answering/saving/submitting.
  try{
    const storage=browserStorage();if(!storage)return {...newBrowserDraft(defaultService),namespace};
    let raw=storage.getItem(draftStorageKey(namespace));
    // Before source-specific storage existed, design drafts were written to the
    // global key. Move only a draft carrying the same explicit source identity;
    // a generic draft must never be silently combined with a design route.
    if(!raw&&namespace){
      const legacyRaw=storage.getItem(storageKey);
      if(legacyRaw){
        const legacy=JSON.parse(legacyRaw);
        if(legacy?.projectSource?.id===namespace&&(!legacy.namespace||legacy.namespace===namespace)){
          const migrated=JSON.stringify({...legacy,namespace});
          storage.setItem(draftStorageKey(namespace),migrated);
          if(storage.getItem(draftStorageKey(namespace))===migrated)storage.removeItem(storageKey);
          raw=migrated;
        }
      }
    }
    const d=JSON.parse(raw||'null');
    const identityMatches=namespace
      ?(!d?.namespace||d.namespace===namespace)&&(!d?.projectSource?.id||d.projectSource.id===namespace)
      :!d?.namespace&&!d?.projectSource?.id;
    if(identityMatches&&d&&typeof d.id==='string'&&/^[a-f0-9-]{36}$/i.test(d.id)&&/^[a-f0-9]{64}$/.test(d.key)&&Number.isInteger(d.revision)&&d.revision>=0&&typeof d.text==='string'&&d.answers&&!Array.isArray(d.answers)&&d.contact&&['name','email','phone'].every(k=>typeof d.contact[k]==='string')&&Object.entries(d.answers).every(([k,v])=>Object.hasOwn(SCOPE_FIELDS,k)&&typeof v==='string')){
      return {...d,namespace,step:Math.min(2,Math.max(0,Number(d.step)||0)),wizard:d.wizard||{skipped:[],resolutions:{}}};
    }
  }catch{}
  return {...newBrowserDraft(defaultService),namespace};
}
function browserStorage():Storage|null{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
export function persistBrowserDraft(draft:BrowserDraft){try{const storage=browserStorage();if(!storage)return false;storage.setItem(draftStorageKey(draft.namespace),JSON.stringify({...draft,updatedAt:Date.now()}));return true;}catch{return false;}}
export function draftHeaders(draft:BrowserDraft){return {'x-p5-draft-id':draft.id,'x-p5-draft-key':draft.key};}
/** Validate the server receipt before reading its revision or clearing local files. */
export function requireDraftReceipt(data:unknown):{revision:number;answers:ScopeAnswers;extraction:ScopeExtraction|null;uploads:ScopeUpload[];[key:string]:any}{
  const d=(data as any)?.draft;
  if(!d||!Number.isInteger(d.revision)||d.revision<1||!Array.isArray(d.uploads)||!d.answers)throw new Error('Your project save was not confirmed. Your text and files are still here. Please retry.');
  return d;
}
async function fileDb(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('p5-project-files-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
/** Replace the draft's file set in one transaction, including removals. */
/** Resolve with the promise, or reject after `ms` so a stalled browser store never locks the interface; the work itself is left to finish on its own. */
export function withTimeout<T>(promise:Promise<T>,ms:number,message:string):Promise<T>{
  return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(message)),ms);promise.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
}
/** Portable-byte budget for the on-device recovery copy. Upload limits are far
 * larger, but recovery and remove-file callers must not materialize an entire
 * 1 GiB selection in memory. Larger originals stay in the open tab; the draft's
 * pendingFiles list names them so a reload asks for reselection, and server
 * chunk receipts let the reselected originals resume. */
export const DEVICE_CACHE_LIMIT=22*1024*1024;
export function validateCacheSelection(files:ReadonlyArray<{size:number}>){
  if(files.length>SCOPE_FILE_COUNT||files.some(f=>!Number.isInteger(f.size)||f.size<=0||f.size>SCOPE_FILE_LIMIT)||files.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new Error(SCOPE_UPLOAD_HELP);
}
export function missingPendingFiles(draft:Pick<BrowserDraft,'pendingFiles'>,files:ReadonlyArray<{name:string;size:number}>){
  return (draft.pendingFiles||[]).filter(expected=>!files.some(file=>file.name===expected.name&&file.size===expected.size));
}
const cacheQueues=new Map<string,Promise<void>>();
export function cacheFiles(draftId:string,files:File[]):Promise<void>{
  // Serialize timed-out writes and removals so older work cannot resurrect files.
  const task=(cacheQueues.get(draftId)||Promise.resolve()).catch(()=>undefined).then(()=>writeCachedFiles(draftId,files));
  cacheQueues.set(draftId,task);
  void task.finally(()=>{if(cacheQueues.get(draftId)===task)cacheQueues.delete(draftId);}).catch(()=>undefined);
  return task;
}
async function writeCachedFiles(draftId:string,files:File[]){
  validateCacheSelection(files);
  if(files.reduce((bytes,file)=>bytes+file.size,0)>DEVICE_CACHE_LIMIT){
    // Drop any earlier, smaller copy first: a stale subset must never be
    // recovered later as if it were the complete current selection.
    await writeCachedFiles(draftId,[]).catch(()=>undefined);
    throw new Error('Large files stay in this tab. Finish uploading or reselect the original files to resume saved segments.');
  }
  const read=async(file:File)=>{const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size)throw new Error(`${file.name}: not fully read. Select the original file again.`);return bytes;};
  let first=files.length?await read(files[0]):undefined;
  const db=await fileDb(),prefix=`staging:${draftId}:${crypto.randomUUID()}:`;
  const range=(prefix:string)=>IDBKeyRange.bound(prefix,`${prefix}\uffff`);
  const transaction=(work:(store:IDBObjectStore,tx:IDBTransaction)=>void)=>new Promise<void>((resolve,reject)=>{
    const tx=db.transaction('files','readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Device file storage was interrupted.'));
    try{work(tx.objectStore('files'),tx);}catch(error){tx.abort();reject(error);}
  });
  const remove=(store:IDBObjectStore,prefix:string,done?:()=>void)=>{
    const cursor=store.openKeyCursor(range(prefix));cursor.onsuccess=()=>{const item=cursor.result;if(item){store.delete(item.primaryKey);item.continue();}else done?.();};
  };
  try{
    // Portable bytes, one file at a time, not a Promise.all allocation of 1 GiB.
    // Staging is invisible to recovery until the entire selection commits.
    for(let index=0;index<files.length;index++){
      const file=files[index],bytes=index===0?first!:await read(file);first=undefined;
      await transaction(store=>{store.put({id:`${prefix}${index}`,finalId:`${draftId}:${file.name}:${file.size}:${file.lastModified}`,draftId,name:file.name,type:file.type,lastModified:file.lastModified,size:file.size,bytes});});
    }
    await transaction((store,tx)=>{
      remove(store,`${draftId}:`,()=>{
        const cursor=store.openCursor(range(prefix));
        cursor.onsuccess=()=>{try{const item=cursor.result;if(item){const {finalId,...record}=item.value;store.put({...record,id:finalId});item.delete();item.continue();}}catch{tx.abort();}};
      });
    });
  }finally{
    // A quota/error leaves the prior complete cache untouched, not a partial scope.
    await transaction(store=>remove(store,prefix)).catch(()=>undefined);db.close();
  }
}
export async function loadCachedFiles(draftId:string):Promise<File[]>{
  const db=await fileDb();
  try{return await new Promise<File[]>((resolve,reject)=>{
    const tx=db.transaction('files','readonly');
    // Do not deserialize every archived project's potentially gigabyte-sized files.
    const r=tx.objectStore('files').openCursor(IDBKeyRange.bound(`${draftId}:`,`${draftId}:\uffff`));
    let files:File[]=[];let bytes=0;
    r.onsuccess=()=>{try{const item=r.result;if(!item)return;const x=item.value;
      const file=x.bytes instanceof ArrayBuffer?new File([x.bytes],x.name,{type:x.type,lastModified:x.lastModified}):x.file;
      if(x.draftId!==draftId||!(file instanceof File)||!file.size||(x.size!==undefined&&file.size!==x.size))throw new Error('A saved project file could not be fully recovered. Select the original file again before continuing.');
      bytes+=file.size;
      if(bytes>DEVICE_CACHE_LIMIT)throw new Error('This recovery contains large files. Reselect the originals to resume saved upload segments; the recovery has not been removed.');
      files.push(file);item.continue();
    }catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>resolve(files);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });}finally{db.close();}
}
export async function clearCachedFiles(draftId:string){await cacheFiles(draftId,[]);}

/** Save a recoverable copy before starting an explicitly new project. */
export function archiveBrowserDraft(draft:BrowserDraft):BrowserDraftRecovery|null{
  try{
    const storage=browserStorage();if(!storage)return null;
    const previous=JSON.parse(storage.getItem(BROWSER_DRAFT_RECOVERY_KEY)||'[]');
    const records:Array<BrowserDraftRecovery>=Array.isArray(previous)?previous.filter(item=>item&&typeof item.key==='string'&&item.draft):[];
    const snapshot=JSON.stringify(draft);
    const identical=records.find(item=>item.draft.id===draft.id&&JSON.stringify(item.draft)===snapshot);
    if(identical)return identical;
    const key=records.some(item=>item.key===draft.id)?`${draft.id}:${crypto.randomUUID()}`:draft.id;
    const record={key,archivedAt:Date.now(),draft:JSON.parse(snapshot) as BrowserDraft};
    // Never silently evict a visitor's recovery. If storage is full, fail closed.
    const next=[record,...records];
    storage.setItem(BROWSER_DRAFT_RECOVERY_KEY,JSON.stringify(next));
    return record;
  }catch{return null;}
}

export function listBrowserDraftRecoveries(namespace?:string):BrowserDraftRecovery[]{
  try{
    const storage=browserStorage();if(!storage)return [];
    const records=JSON.parse(storage.getItem(BROWSER_DRAFT_RECOVERY_KEY)||'[]');
    if(!Array.isArray(records))return [];
    return records.filter((item):item is BrowserDraftRecovery=>{
      if(!item||typeof item.key!=='string'||!item.draft)return false;
      const draft=item.draft;
      return namespace
        ?(!draft.namespace||draft.namespace===namespace)&&(!draft.projectSource?.id||draft.projectSource.id===namespace)&&Boolean(draft.namespace||draft.projectSource?.id)
        :!draft.namespace&&!draft.projectSource?.id;
    });
  }catch{return [];}
}

/** Read a recovery without changing the active draft or touching cached files. */
export function restoreBrowserDraft(recovery:string|BrowserDraftRecovery):BrowserDraft|null{
  let record=typeof recovery==='string'?undefined:recovery;
  if(typeof recovery==='string')try{
    const records=JSON.parse(browserStorage()?.getItem(BROWSER_DRAFT_RECOVERY_KEY)||'[]');
    if(Array.isArray(records))record=records.find(item=>item?.key===recovery);
  }catch{}
  return record?.draft?JSON.parse(JSON.stringify(record.draft)) as BrowserDraft:null;
}

/**
 * Start a distinct project. The previous local draft remains in localStorage
 * recovery and its IndexedDB files remain under its old id for restoration.
 */
export function replaceBrowserDraft(current:BrowserDraft,defaultService=''): {draft:BrowserDraft;recovery:BrowserDraftRecovery|null}{
  const recovery=archiveBrowserDraft(current);
  if(!recovery)throw new Error('Your original project could not be archived. The new project was not started; your saved project is still here.');
  // A deliberate replacement is a blank project, not a new instance of the
  // current route's defaults. In particular, do not resurrect a bathroom
  // service or a design source when the component mounts again.
  void defaultService;
  return {draft:{...newBrowserDraft(''),namespace:current.namespace,sourceDetached:true},recovery};
}

/** Read a reply that is supposed to be JSON but might not be.
 *
 * Every estimator endpoint answers with JSON, but the request does not always
 * reach the app. During a redeploy, a container restart or a gateway error the
 * host answers with its own plain-text or HTML page, and response.json() then
 * throws "Failed to execute 'json' on 'Response': Unexpected token 'T', "The
 * deploy"... is not valid JSON" - which is exactly what a visitor was shown on
 * p5homeco.com while a deploy was in flight. The saved work is untouched in
 * every one of those cases, so say that instead of showing a parser error. */
export async function readJson(response:Response):Promise<any>{
  const body=await response.text();
  try{return JSON.parse(body);}catch{}
  const hosted=/^\s*</.test(body)||/\bdeploy|unavailable|bad gateway|gateway time|maintenance|starting up|try again\b/i.test(body.slice(0,300));
  throw new Error(hosted
    ?'The site was finishing an update and could not answer just now. Your project is saved. Please try again in a moment.'
    :`The server reply could not be read (HTTP ${response.status}). Your project is saved. Please try again.`);
}
