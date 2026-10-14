import type {ReceiptStore,ReceiverReceipt} from './canonicalReviewReceiver.ts';
type Query=(sql:string,values?:unknown[])=>Promise<Record<string,any>[]>;
type Transaction=<T>(fn:(q:Query)=>Promise<T>)=>Promise<T>;
/** Migration 018 is required; schema creation never runs in the request handler. */
export function canonicalReviewStore(query:Query,transaction:Transaction):ReceiptStore {
 return {
  reserve:(p,key,digest)=>transaction(async q=>{
   await q('INSERT INTO p5_canonical_review_projects(external_lead_id,source,origin_site) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.externalLeadId,p.source,p.request.originSite]);
   const [project]=await q('SELECT * FROM p5_canonical_review_projects WHERE external_lead_id=$1 FOR UPDATE',[p.externalLeadId]);
   // Cross-brand transfers require a separately verified handoff; source credentials
   // alone do not authorize taking ownership of an existing project's HubSpot deal.
   if(project.source!==p.source||project.origin_site!==p.request.originSite)return {kind:'conflict'};
   const [old]=await q('SELECT body_digest,receipt FROM p5_canonical_review_operations WHERE operation_key=$1',[key]);
   if(old)return old.body_digest===digest?{kind:'existing',receipt:old.receipt||undefined}:{kind:'conflict'};
   if(project.pending_operation)return {kind:'conflict'};
   if(p.request.revision<=project.latest_revision)return {kind:'conflict'};
   await q('INSERT INTO p5_canonical_review_operations(operation_key,external_lead_id,source,revision,snapshot_digest,body_digest,request) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[key,p.externalLeadId,p.source,p.request.revision,p.snapshotDigest,digest,JSON.stringify(p)]);
   await q('UPDATE p5_canonical_review_projects SET pending_operation=$2 WHERE external_lead_id=$1',[p.externalLeadId,key]);
   const [previous]=project.deal_id?await q('SELECT request FROM p5_canonical_review_operations WHERE external_lead_id=$1 AND receipt IS NOT NULL ORDER BY revision DESC LIMIT 1',[p.externalLeadId]):[];
   return {kind:'new',previousDealId:project.deal_id||undefined,previousReview:previous?.request};
  }),
  accept:(p,key,digest,receipt)=>transaction(async q=>{
   const [project]=await q('SELECT * FROM p5_canonical_review_projects WHERE external_lead_id=$1 FOR UPDATE',[p.externalLeadId]);
   if(project?.pending_operation!==key)throw new Error('receipt-conflict');
   const rows=await q('UPDATE p5_canonical_review_operations SET receipt=$3::jsonb WHERE operation_key=$1 AND body_digest=$2 AND receipt IS NULL RETURNING operation_key',[key,digest,JSON.stringify(receipt)]);
   if(rows.length!==1)throw new Error('receipt-conflict');
   await q('UPDATE p5_canonical_review_projects SET pending_operation=NULL,deal_id=$2,latest_revision=$3,owner_id=$4 WHERE external_lead_id=$1',[p.externalLeadId,receipt.dealId,p.request.revision,receipt.ownerId]);
  }),
  async pending(source,key){const [row]=await query('SELECT request FROM p5_canonical_review_operations WHERE source=$1 AND operation_key=$2 AND receipt IS NULL',[source,key]);return row?.request||null;},
  async read(source,key){const [row]=await query('SELECT receipt FROM p5_canonical_review_operations WHERE source=$1 AND operation_key=$2',[source,key]);return row?.receipt as ReceiverReceipt||null;},
 };
}
