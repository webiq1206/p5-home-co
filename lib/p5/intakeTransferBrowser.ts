import {archiveBrowserDraft,newBrowserDraft,persistBrowserDraft,persistedBrowserDraft,requireDraftReceipt,type BrowserDraft} from './browserDraft.ts';
import {intakeSite,INTAKE_SITES,type IntakeSite} from './intakePolicy.ts';
import type {TransferBinding,TransferReadyReceipt,TransferSource} from './intakeTransferStore.ts';

export const TRANSFER_RECOVERY_KEY='p5-intake-transfer-recovery-v2';
export const OUTGOING_TRANSFER_KEY='p5-intake-transfer-outgoing-v2';
export const CANCELLED_TRANSFER_KEY='p5-intake-transfer-cancelled-v2';
export interface BrowserTransferProof {binding:TransferBinding;destinationKey:string;grant:string}
export interface BrowserTransferSeed {transferId:string;destinationDraftId:string;destinationKey:string;grant:string;revision:number}
export interface BrowserSourceTransfer {seed:BrowserTransferSeed;proof?:BrowserTransferProof}
export interface BrowserTransferView {role:'source'|'destination';state:TransferSource['state']|'importing'|'recovering';proof?:BrowserTransferProof;binding?:TransferBinding}
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const hex=/^[a-f\d]{64}$/;
const fields=['transferId','projectId','sourceSite','destinationSite','sourceOrigin','sourceDraftId','sourceRevision','destinationDraftId','destinationKeyHash','grantHash'] as const;
export function sameTransferBinding(a:TransferBinding,b:TransferBinding){return fields.every(key=>a?.[key]===b?.[key]);}
export function browserTransferProof(value:unknown):BrowserTransferProof {
 const p=value as BrowserTransferProof,b=p?.binding,source=intakeSite(b?.sourceSite),destination=intakeSite(b?.destinationSite);
 if(!b||!source||!destination||source===destination||!uuid.test(b.transferId)||!uuid.test(b.sourceDraftId)||!uuid.test(b.destinationDraftId)||b.sourceDraftId===b.destinationDraftId
  ||!Number.isSafeInteger(b.sourceRevision)||b.sourceRevision<1||!hex.test(b.destinationKeyHash)||!hex.test(b.grantHash)||!hex.test(p.destinationKey)||!hex.test(p.grant)
  ||![`https://${INTAKE_SITES[source].domain}`,`https://www.${INTAKE_SITES[source].domain}`].includes(b.sourceOrigin)
  ||typeof b.projectId!=='string'||!/^((p5|construction|remodeling|handyman|cabinet):)[a-f\d-]{36}$/i.test(b.projectId)
  ||Object.keys(b).length!==fields.length)throw new Error('This saved project transfer is incomplete. Return to the original project to resume; its details and files are retained.');
 return {binding:Object.fromEntries(fields.map(key=>[key,b[key]])) as unknown as TransferBinding,destinationKey:p.destinationKey,grant:p.grant};
}
export function newTransferSeed(draft:BrowserDraft):BrowserTransferSeed {
 const destination=newBrowserDraft(''),grant=newBrowserDraft('').key;
 return {transferId:crypto.randomUUID(),destinationDraftId:destination.id,destinationKey:destination.key,grant,revision:draft.revision};
}
function outgoingKey(draftId:string,transferId:string){return `${OUTGOING_TRANSFER_KEY}:${draftId}:${transferId}`;}
/** Kept outside the ordinary draft key: a stale second tab may still autosave
 * that ordinary draft while the server freezes it. It must not erase the grant. */
export function persistOutgoingTransfer(draft:BrowserDraft,site:IntakeSite,storage:Storage=localStorage){
 const transfer=draft.intakeTransfer;if(!transfer)throw new Error('Transfer recovery is missing.');
 const raw=JSON.stringify({sourceDraftId:draft.id,sourceSite:site,sourceKey:draft.key,namespace:draft.namespace,transfer}),key=outgoingKey(draft.id,transfer.seed.transferId);
 storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw new Error('This browser could not save transfer recovery. Keep the original project open and retry.');
}
export function outgoingTransfer(draft:BrowserDraft,site:IntakeSite,transferId?:string,storage:Storage=localStorage):BrowserSourceTransfer|null {
 const prefix=`${OUTGOING_TRANSFER_KEY}:${draft.id}:`;
 const keys=transferId?[outgoingKey(draft.id,transferId)]:Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((key):key is string=>Boolean(key?.startsWith(prefix))).sort();
 for(const key of keys){const raw=storage.getItem(key);if(!raw)continue;const value=JSON.parse(raw),seed=value?.transfer?.seed;
  if(seed?.transferId&&storage.getItem(`${CANCELLED_TRANSFER_KEY}:${draft.id}:${seed.transferId}`)==='confirmed')continue;
  if(value.sourceDraftId!==draft.id||value.sourceSite!==site||value.sourceKey!==draft.key||value.namespace!==draft.namespace||!seed||!uuid.test(seed.transferId)||!uuid.test(seed.destinationDraftId)||!hex.test(seed.destinationKey)||!hex.test(seed.grant)||!Number.isSafeInteger(seed.revision)||seed.revision<1)throw new Error('The saved outgoing transfer could not be verified. Its recovery is retained.');
  if(value.transfer.proof)browserTransferProof(value.transfer.proof);return value.transfer;
 }
 return null;
}
/** Record only the server-confirmed cancellation. Never rewrite a possibly newer
 * ordinary draft from a stale tab, or erase another tab's grant. */
export function clearOutgoingTransfer(draftId:string,transferId:string,storage:Storage=localStorage){
 if(!uuid.test(draftId)||!uuid.test(transferId))throw new Error('The cancelled transfer identity could not be verified.');
 const key=`${CANCELLED_TRANSFER_KEY}:${draftId}:${transferId}`;
 storage.setItem(key,'confirmed');if(storage.getItem(key)!=='confirmed')throw new Error('The cancellation could not be saved on this device. Keep this page open and retry.');
 storage.removeItem(outgoingKey(draftId,transferId));
}
export function recoverOutgoingTransfer(draft:BrowserDraft,site:IntakeSite,storage:Storage=localStorage):BrowserSourceTransfer|null {
 const separate=outgoingTransfer(draft,site,undefined,storage);if(separate)return separate;
 const inline=draft.intakeTransfer;
 return inline&&storage.getItem(`${CANCELLED_TRANSFER_KEY}:${draft.id}:${inline.seed.transferId}`)!=='confirmed'?inline:null;
}
export function incomingTransfer(site:IntakeSite,storage:Storage=localStorage):BrowserTransferProof|null {
 const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>Boolean(k&&(k===TRANSFER_RECOVERY_KEY||k.startsWith(`${TRANSFER_RECOVERY_KEY}:`)))).sort();
 for(const key of keys){const raw=storage.getItem(key);if(!raw)continue;const proof=browserTransferProof(JSON.parse(raw));if(proof.binding.destinationSite===site)return proof;}
 return null;
}
export function clearIncomingTransfer(proof:BrowserTransferProof,storage:Storage=localStorage){
 for(const key of [TRANSFER_RECOVERY_KEY,`${TRANSFER_RECOVERY_KEY}:${proof.binding.transferId}`]){
  const raw=storage.getItem(key);if(!raw)continue;const saved=browserTransferProof(JSON.parse(raw));if(sameTransferBinding(saved.binding,proof.binding))storage.removeItem(key);
 }
}
/** Only exact fixed-domain form POSTs carry the bearer proof. Never put it in a URL. */
export function transferFormTarget(proof:BrowserTransferProof){const p=browserTransferProof(proof);return `https://${INTAKE_SITES[p.binding.destinationSite].domain}/api/p5-estimator/intake-transfer/receive`;}
export function openTransferredProject(proof:BrowserTransferProof){
 const form=document.createElement('form');form.method='POST';form.action=transferFormTarget(proof);form.hidden=true;
 const input=document.createElement('input');input.type='hidden';input.name='transfer';input.value=JSON.stringify(browserTransferProof(proof));form.append(input);document.body.append(form);form.submit();
}
/** Verify the destination's authenticated receipt and file manifest before replacing
 * any local draft. The caller keeps the recovery proof until persistence succeeds. */
export function acceptTransferredDraft(value:unknown,proof:BrowserTransferProof,current:BrowserDraft):BrowserDraft {
 browserTransferProof(proof);const response=value as {receipt?:TransferReadyReceipt;state?:string},receipt=response?.receipt,saved=requireDraftReceipt(value),b=proof.binding;
 if(response.state!=='ready'||!receipt||receipt.schema!==2||receipt.state!=='ready'||!sameTransferBinding(receipt.binding,b)||!hex.test(receipt.digest)
  ||saved.id!==b.destinationDraftId||saved.brand!==b.destinationSite||saved.revision<receipt.destinationRevision||saved.intake?.projectId!==b.projectId
  ||saved.intake?.currentSite!==b.destinationSite||!intakeSite(saved.intake?.originSite)||!Array.isArray(saved.intake?.transcript)
  ||typeof saved.text!=='string'||!saved.contact||!['name','email','phone'].every(k=>typeof saved.contact[k]==='string')
  ||!Array.isArray(receipt.files)||!receipt.files.every(file=>saved.uploads.some(other=>file.sha256===other.sha256&&file.size===other.size&&file.name===other.name&&file.type===other.type)))throw new Error('The complete transferred project could not be verified. Your original project and transfer recovery are retained.');
 return {...saved,id:saved.id,text:saved.text,contact:saved.contact,key:proof.destinationKey,namespace:current.namespace,sourceDetached:true,pendingFiles:[],intakeTransfer:undefined,transcript:saved.intake.transcript,step:2,dirty:false,updatedAt:Date.now()} as BrowserDraft;
}
export function persistTransferredDraft(next:BrowserDraft,current:BrowserDraft){
 const persisted=persistedBrowserDraft(current.namespace);
 const comparable=(draft:BrowserDraft|null)=>draft?JSON.stringify({...draft,updatedAt:0,step:0}):null;
 const preserve=(current.id!==next.id||current.dirty||current.revision>next.revision)&&Boolean(current.revision>0||current.text||current.pendingFiles?.length||current.uploads?.length||current.transcript?.length);
 if(preserve&&!archiveBrowserDraft(current))throw new Error('Your existing project could not be backed up. Both projects are retained; keep this page open and retry.');
 const preservePersisted=Boolean(persisted&&comparable(persisted)!==comparable(next)&&(persisted.revision>0||persisted.text||persisted.pendingFiles?.length||persisted.uploads?.length||persisted.transcript?.length));
 if(preservePersisted&&!archiveBrowserDraft(persisted!))throw new Error('Work saved by another tab could not be backed up. Both projects are retained; keep this page open and retry.');
 if(comparable(persistedBrowserDraft(current.namespace))!==comparable(persisted))throw new Error('Another tab changed the saved project during recovery. Its work is retained; close the other tab and retry.');
 if(!persistBrowserDraft(next))throw new Error('This browser could not save the transferred project. Its recovery is retained; keep this page open and retry.');
 return {archived:preserve||preservePersisted};
}
