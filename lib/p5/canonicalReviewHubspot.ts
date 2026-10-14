import {canonicalJson} from './canonicalJson.ts';
import {createHash} from 'node:crypto';
import {projectReviewLinks,type ProjectReview} from './projectReviewContract.ts';
import {INTAKE_SITES} from './intakePolicy.ts';
import {type ReviewProvider} from './canonicalReviewReceiver.ts';
/** Deal-only projection: retains submitted contact data and staff-only file references.
 * Never guesses, merges or overwrites a person's existing HubSpot contact record. */
export function canonicalDealProperties(p:ProjectReview,ownerId:string){
 const digest=createHash('sha256').update(canonicalJson(p)).digest('hex');
 const description=canonicalJson({operation:'project_review_v1',snapshotDigest:p.snapshotDigest,bodyDigest:digest,source:p.source,originSite:p.request.originSite,revision:p.request.revision,contact:p.request.contact,scope:p.request.scope.text,answers:p.request.scope.answers,details:p.request.details,routing:p.request.routing,unresolved:p.request.unresolved,staff:projectReviewLinks(p)});
 // HubSpot's bounded text fields cannot carry an arbitrarily large transcript.
 // Do not truncate or claim a full receipt if this projection cannot be retained.
 if(description.length>60000)throw new Error('projection-too-large');
 return {dealname:`${p.deliveryMode==='synthetic_qa'?'[QA] ':''}${INTAKE_SITES[p.request.routing.primaryTeam].name} project request`,description,p5_brand:INTAKE_SITES[p.request.routing.primaryTeam].name,p5_external_lead_id:p.externalLeadId,p5_original_form:p.deliveryMode==='synthetic_qa'?'p5-canonical-synthetic-qa':'p5-canonical-project-review',hubspot_owner_id:ownerId};
}
export function canonicalHubspotProvider(token:string,fetchImpl:typeof fetch=fetch):ReviewProvider {
 async function call(path:string,init:RequestInit={}){
  if(!token)throw new Error('provider-unconfigured');
  const response=await fetchImpl('https://api.hubapi.com'+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('provider-rejected');
  return response.json();
 }
 async function search(p:ProjectReview){return call('/crm/v3/objects/deals/search',{method:'POST',body:JSON.stringify({filterGroups:[{filters:[{propertyName:'p5_external_lead_id',operator:'EQ',value:p.externalLeadId}]}],limit:2})});}
 async function verify(p:ProjectReview,owner:string,id:string){
  const expected=canonicalDealProperties(p,owner);
  const result=await call('/crm/v3/objects/deals/'+encodeURIComponent(id)+'?properties='+encodeURIComponent(Object.keys(expected).join(',')));
  return result.id===id&&!result.archived&&Object.entries(expected).every(([key,value])=>result.properties?.[key]===value);
 }
 return {
  async portal(){const r=await call('/account-info/v3/details');return r.portalId;},
  async write(p,owner,previous,previousReview){
   if(previous){if(!previousReview||!await verify(previousReview,owner,previous))throw new Error('remote-record-changed');}
   else {const found=await search(p);if(found.total!==0)throw new Error('existing-record-review');}
   const properties=canonicalDealProperties(p,owner);
   // No transport retry, even for 429/500. The durable reservation prevents a
   // second create when a remote write completed but its response was lost.
   const result=await call('/crm/v3/objects/deals'+(previous?'/'+encodeURIComponent(previous):''),{method:previous?'PATCH':'POST',body:JSON.stringify({properties:{...properties,...(!previous?{pipeline:'default',dealstage:'appointmentscheduled'}:{})}})});
   return result.id;
  },
  verify,
  async reconcile(p,owner){const found=await search(p);if(found.total!==1||found.results?.length!==1)return null;const id=found.results[0].id;return typeof id==='string'&&/^\d+$/.test(id)&&await verify(p,owner,id)?id:null;},
 };
}
