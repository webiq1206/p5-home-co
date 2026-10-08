import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newBrowserDraft,loadBrowserDraft,listBrowserDraftRecoveries,persistBrowserDraft} from '../lib/p5/browserDraft.ts';
import {browserTransferProof,incomingTransfer,clearIncomingTransfer,persistOutgoingTransfer,outgoingTransfer,recoverOutgoingTransfer,clearOutgoingTransfer,transferFormTarget,acceptTransferredDraft,persistTransferredDraft,TRANSFER_RECOVERY_KEY,type BrowserTransferProof} from '../lib/p5/intakeTransferBrowser.ts';
const source='12345678-1234-4234-8234-123456789abc',destination='12345678-1234-4234-8234-123456789abd';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const proof=():BrowserTransferProof=>({binding:{transferId:'12345678-1234-4234-8234-123456789abe',projectId:`handyman:${source}`,sourceSite:'handyman',destinationSite:'remodeling',sourceOrigin:'https://boisehandyman.co',sourceDraftId:source,sourceRevision:4,destinationDraftId:destination,destinationKeyHash:hash('a'.repeat(64)),grantHash:hash('b'.repeat(64))},destinationKey:'a'.repeat(64),grant:'b'.repeat(64)});
class MemoryStorage implements Storage {
 data=new Map<string,string>();fail=false;ignore=false;
 get length(){return this.data.size;}clear(){this.data.clear();}key(index:number){return [...this.data.keys()][index]??null;}
 getItem(key:string){return this.data.get(key)??null;}removeItem(key:string){this.data.delete(key);}
 setItem(key:string,value:string){if(this.fail)throw Error('synthetic quota');if(!this.ignore)this.data.set(key,value);}
}
function ready(){const p=proof(),uploads=[{id:'12345678-1234-4234-8234-123456789abf',name:'fictional.txt',size:1,type:'text/plain',sha256:hash('x'),status:'stored'}];return {state:'ready',receipt:{schema:2,state:'ready',binding:p.binding,digest:hash('toy-snapshot'),destinationRevision:1,files:uploads,readyAt:'2099-01-02T12:00:00Z'},draft:{id:destination,brand:'remodeling',revision:1,status:'draft',text:'[QA] Fictional kitchen project.',answers:{service:'kitchen'},contact:{name:'[QA] Fictional',email:'inquiry@example.invalid',phone:''},extraction:null,uploads,intake:{projectId:p.binding.projectId,currentSite:'remodeling',originSite:'handyman',transcript:[{id:'toy-message',role:'user',text:'Keep the fictional floor.',at:1}],supportingServices:['cabinetry']}}};}
test('form target derives only from allowlisted destination and excludes credentials or customer fields',()=>{
 const p=proof();assert.equal(transferFormTarget(p),'https://boiseremodeling.co/api/p5-estimator/intake-transfer/receive');
 for(const bad of [{...p,binding:{...p.binding,destinationSite:'https://attacker.invalid'}},{...p,binding:{...p.binding,sourceOrigin:'https://boisehandyman.co.attacker.invalid'}},{...p,binding:{...p.binding,url:'https://attacker.invalid'}},{...p,grant:'short'}])assert.throws(()=>browserTransferProof(bad));
});
test('each incoming project retains its own recovery proof; completing one never erases another',()=>{
 const storage=new MemoryStorage(),a=proof(),b={...proof(),binding:{...proof().binding,transferId:'12345678-1234-4234-8234-123456789ab1'}};
 storage.setItem(`${TRANSFER_RECOVERY_KEY}:${a.binding.transferId}`,JSON.stringify(a));storage.setItem(`${TRANSFER_RECOVERY_KEY}:${b.binding.transferId}`,JSON.stringify(b));
 assert.equal(incomingTransfer('cabinet',storage),null);assert.equal(incomingTransfer('remodeling',storage)!.binding.transferId,b.binding.transferId);
 clearIncomingTransfer(b,storage);assert.equal(incomingTransfer('remodeling',storage)!.binding.transferId,a.binding.transferId);
});
test('verified destination adopts the full conversation and archives a distinct existing local project',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
 try{const old={...newBrowserDraft('handyman'),text:'[QA] Another retained project.',revision:3};persistBrowserDraft(old);
  const next=acceptTransferredDraft(ready(),proof(),old);persistTransferredDraft(next,old);
  assert.equal(loadBrowserDraft('').id,destination);assert.equal(next.transcript![0].text,'Keep the fictional floor.');assert.equal(next.intake!.originSite,'handyman');assert.equal(next.key,proof().destinationKey);
  assert.equal(listBrowserDraftRecoveries()[0].draft.text,old.text);assert.equal(listBrowserDraftRecoveries()[0].draft.key,old.key);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
test('wrong identity, changed file bytes or missing original files cannot replace a local project',()=>{
 const old=newBrowserDraft('');for(const mutate of [(v:ReturnType<typeof ready>)=>{v.draft.id=source;},(v:ReturnType<typeof ready>)=>{v.draft.intake.projectId=`p5:${source}`;},(v:ReturnType<typeof ready>)=>{v.draft.uploads=[];},(v:ReturnType<typeof ready>)=>{v.draft.uploads=[{...v.draft.uploads[0],sha256:hash('different')}];},(v:ReturnType<typeof ready>)=>{v.receipt.binding={...v.receipt.binding,destinationSite:'cabinet'};}]){const value=structuredClone(ready());mutate(value);assert.throws(()=>acceptTransferredDraft(value,proof(),old),/verified/);}
});
test('quota failures or silent storage failures retain the original active project and incoming recovery',()=>{
 for(const silent of [false,true]){const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const old={...newBrowserDraft(''),text:'[QA] Keep this project',revision:1};persistBrowserDraft(old);storage.setItem(`${TRANSFER_RECOVERY_KEY}:${proof().binding.transferId}`,JSON.stringify(proof()));const saved=storage.getItem('p5-project-draft-v2');
  storage.fail=!silent;storage.ignore=silent;
  assert.throws(()=>persistTransferredDraft(acceptTransferredDraft(ready(),proof(),old),old),/backed up/);assert.equal(storage.getItem('p5-project-draft-v2'),saved);assert.ok(incomingTransfer('remodeling',storage));
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}}
});

test('a stale tab cannot erase separate outgoing credentials; exact server transfer selects its recovery',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const original={...newBrowserDraft(''),id:source,revision:4,text:'[QA] Original source'},p=proof();
  const seed={transferId:p.binding.transferId,destinationDraftId:destination,destinationKey:p.destinationKey,grant:p.grant,revision:4};
  persistOutgoingTransfer({...original,intakeTransfer:{seed,proof:p}},'handyman');persistBrowserDraft({...original,intakeTransfer:{seed,proof:p}});
  persistBrowserDraft({...original,contact:{name:'[QA] Edited in stale tab',email:'',phone:''}});
  assert.equal(loadBrowserDraft('').intakeTransfer,undefined);assert.deepEqual(outgoingTransfer(original,'handyman',p.binding.transferId)!.proof,p);
  const other={...seed,transferId:'12345678-1234-4234-8234-123456789ab1'};persistOutgoingTransfer({...original,intakeTransfer:{seed:other}},'handyman');
  assert.equal(outgoingTransfer(original,'handyman',p.binding.transferId)!.seed.transferId,p.binding.transferId);
  clearOutgoingTransfer(original.id,p.binding.transferId);assert.equal(outgoingTransfer(original,'handyman',p.binding.transferId),null);assert.equal(outgoingTransfer(original,'handyman')!.seed.transferId,other.transferId);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
test('a completed transfer replay retains later files and archives unsaved edits of the same destination draft',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const value=ready();value.draft.uploads=[...value.draft.uploads,{...value.draft.uploads[0],id:source,name:'later-fictional.txt',sha256:hash('later')}];value.draft.revision=2;
  const old={...newBrowserDraft(''),id:destination,key:proof().destinationKey,revision:2,text:'[QA] My unsaved local correction',dirty:true};persistBrowserDraft(old);
  const next=acceptTransferredDraft(value,proof(),old);assert.equal(next.uploads!.length,2);assert.equal(persistTransferredDraft(next,old).archived,true);
  assert.equal(listBrowserDraftRecoveries()[0].draft.text,old.text);assert.equal(listBrowserDraftRecoveries()[0].draft.dirty,true);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});

test('transfer adoption preserves another tab\'s actual active draft as well as the caller\'s memory',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const memory={...newBrowserDraft(''),text:'[QA] First tab project',revision:1};persistBrowserDraft(memory);
  const other={...newBrowserDraft(''),text:'[QA] Newer second tab project',revision:2,dirty:true};persistBrowserDraft(other);
  persistTransferredDraft(acceptTransferredDraft(ready(),proof(),memory),memory);
  const recoveries=listBrowserDraftRecoveries();assert.ok(recoveries.some(r=>r.draft.id===memory.id&&r.draft.text===memory.text));assert.ok(recoveries.some(r=>r.draft.id===other.id&&r.draft.text===other.text));assert.equal(loadBrowserDraft('').id,destination);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});

test('delayed cancellation preserves a newer transfer and never rewrites another tab’s draft',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const p=proof(),original={...newBrowserDraft(''),id:source,revision:4,text:'[QA] Original source'};
  const old={...original,intakeTransfer:{seed:{transferId:p.binding.transferId,destinationDraftId:destination,destinationKey:p.destinationKey,grant:p.grant,revision:4},proof:p}};
  persistOutgoingTransfer(old,'handyman');persistBrowserDraft(old);
  const newer={...old,text:'[QA] Newer preserved project text',intakeTransfer:{seed:{...old.intakeTransfer.seed,transferId:'12345678-1234-4234-8234-123456789ab1',grant:'c'.repeat(64)}}};
  persistOutgoingTransfer(newer,'handyman');persistBrowserDraft(newer);const active=storage.getItem('p5-project-draft-v2');
  clearOutgoingTransfer(source,p.binding.transferId);assert.equal(storage.getItem('p5-project-draft-v2'),active);
  assert.equal(recoverOutgoingTransfer(loadBrowserDraft(''),'handyman')!.seed.transferId,newer.intakeTransfer.seed.transferId);
  assert.equal(outgoingTransfer(original,'handyman',newer.intakeTransfer.seed.transferId)!.seed.grant,'c'.repeat(64));
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
test('a confirmed cancellation suppresses its stale inline marker without rewriting recovery',()=>{
 const storage=new MemoryStorage();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});try{
  const p=proof(),draft={...newBrowserDraft(''),id:source,revision:4,intakeTransfer:{seed:{transferId:p.binding.transferId,destinationDraftId:destination,destinationKey:p.destinationKey,grant:p.grant,revision:4},proof:p}};
  persistOutgoingTransfer(draft,'handyman');persistBrowserDraft(draft);const active=storage.getItem('p5-project-draft-v2');
  storage.ignore=true;assert.throws(()=>clearOutgoingTransfer(source,p.binding.transferId),/cancellation could not/);assert.ok(outgoingTransfer(draft,'handyman'));
  storage.ignore=false;clearOutgoingTransfer(source,p.binding.transferId);assert.equal(recoverOutgoingTransfer(loadBrowserDraft(''),'handyman'),null);assert.equal(storage.getItem('p5-project-draft-v2'),active);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
