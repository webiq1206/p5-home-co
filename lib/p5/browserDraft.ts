import {SCOPE_FIELDS,validateAnswer,type ScopeAnswers,type ScopeExtraction,type ScopeConflict,type ScopeField} from "./scope.ts";
export interface BrowserDraft {id:string;key:string;revision:number;text:string;answers:ScopeAnswers;extraction:ScopeExtraction|null;contact:{name:string;email:string;phone:string};step:number;updatedAt:number;conflicts?:ScopeConflict[]}
const storageKey="p5-project-draft-v2";
export function newBrowserDraft(defaultService:string):BrowserDraft {
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return {id:crypto.randomUUID(),key:Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join(""),revision:0,text:"",answers:{service:defaultService},extraction:null,contact:{name:"",email:"",phone:""},step:0,updatedAt:Date.now()};
}
export function loadBrowserDraft(defaultService:string):BrowserDraft {
  try{const d=JSON.parse(localStorage.getItem(storageKey)||"null");if(d&&typeof d.id==="string"&&/^[a-f0-9]{64}$/.test(d.key)&&typeof d.text==="string"&&d.answers&&d.contact&&["name","email","phone"].every(k=>typeof d.contact[k]==="string")&&Object.entries(d.answers).every(([k,v])=>Object.hasOwn(SCOPE_FIELDS,k)&&typeof v==="string"&&!validateAnswer(k as ScopeField,v)))return {...d,step:Math.min(2,Math.max(0,Number(d.step)||0))};}catch{}
  return newBrowserDraft(defaultService);
}
export function persistBrowserDraft(draft:BrowserDraft){try{localStorage.setItem(storageKey,JSON.stringify({...draft,updatedAt:Date.now()}));return true;}catch{return false;}}
export function draftHeaders(draft:BrowserDraft){return {"x-p5-draft-id":draft.id,"x-p5-draft-key":draft.key};}
async function fileDb(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("p5-project-files-v1",1);r.onupgradeneeded=()=>r.result.createObjectStore("files",{keyPath:"id"});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function cacheFiles(draftId:string,files:File[]){const db=await fileDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");for(const file of files)tx.objectStore("files").put({id:`${draftId}:${file.name}:${file.size}:${file.lastModified}`,draftId,file});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}
export async function loadCachedFiles(draftId:string):Promise<File[]>{const db=await fileDb();const files=await new Promise<File[]>((resolve,reject)=>{const r=db.transaction("files","readonly").objectStore("files").getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.draftId===draftId).map(x=>x.file));r.onerror=()=>reject(r.error);});db.close();return files;}
export async function clearCachedFiles(draftId:string){const db=await fileDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");const store=tx.objectStore("files");const r=store.openCursor();r.onsuccess=()=>{const cursor=r.result;if(cursor){if(cursor.value.draftId===draftId)cursor.delete();cursor.continue();}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}
