import {query} from './database.ts';
import {DraftError} from './store.ts';
/**
 * Saved estimates and revisions (owner request 2026-09-22): a customer returns to a saved estimate and
 * asks for a change in plain words ("Remove painting", "Use upgraded cabinets", "Update this using the
 * revised plans"). The submitted version is archived intact (inputs, scope, pricing, both records and
 * its date) and the project reopens as the next revision, with the request added to the description
 * and every upload kept. The normal read, review and pricing flow then produces the new version; work
 * that did not change is reused from the saved analysis and pricing caches. Earlier versions stay
 * readable, with their own PDF, and the new version records what changed.
 */
export const VERSION_KEY=(revision:number)=>`version-v1:${revision}`;
export const MAX_CHANGE_LENGTH=2000;
export interface VersionSummary {revision:number;submittedAt:string|null;total:string;reference:string}
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.round(n));
export const rangeText=(range:{low:number;high:number}|null|undefined)=>!range?'Not priced':range.low===range.high?money(range.low):`${money(range.low)} to ${money(range.high)}`;
/** The customer's request as it is added to the project description for the next revision. */
export function revisedDescription(text:string,change:string,revision:number):string{
  const request=change.replace(/\s+/g,' ').trim();
  return request?`${text.trim()}\n\nRequested change for revision ${revision+1}: ${request}`:text;
}
/** Archive the submitted version and reopen the project as the next revision. */
export async function startRevision(id:string,change:string){
  const {ensureReviewSchema}=await import('./manualReview.ts');
  await ensureReviewSchema();
  const request=String(change||'').trim();
  if(request.length>MAX_CHANGE_LENGTH)throw new DraftError(`Describe the change in ${MAX_CHANGE_LENGTH} characters or fewer, or attach a document.`);
  const [row]=await query("SELECT revision,status,payload,customer_estimate,internal_estimate,submitted_at FROM p5_estimator_drafts WHERE id=$1",[id]);
  if(!row)throw new DraftError('Estimate not found.',404);
  if(row.status!=='submitted')throw new DraftError('This estimate is already open for changes.',409);
  const revision=Number(row.revision);const payload=row.payload||{};
  const archived={revision,submittedAt:row.submitted_at?new Date(row.submitted_at).toISOString():null,payload,customer:row.customer_estimate,internal:row.internal_estimate,change:request,archivedAt:new Date().toISOString()};
  const next={...payload,text:revisedDescription(String(payload.text||''),request,revision),reviewed:null,revisionOf:revision,revisionRequest:request};
  const reopened=await query(`WITH reopened AS (
    UPDATE p5_estimator_drafts SET status='draft',revision=revision+1,payload=$2::jsonb,
      customer_estimate=NULL,internal_estimate=NULL,submitted_at=NULL,updated_at=now()
    WHERE id=$1 AND revision=$3 AND status='submitted' RETURNING revision
  ), archived AS (
    INSERT INTO p5_estimator_work(draft_id,work_key,payload)
    SELECT $1,$4,$5::jsonb FROM reopened
    ON CONFLICT(draft_id,work_key) DO NOTHING
  ), admin_archive AS (
    INSERT INTO p5_estimator_history(draft_id,revision,record)
    SELECT $1,$3,$5::jsonb FROM reopened
    ON CONFLICT(draft_id,revision) DO NOTHING
  ) SELECT revision FROM reopened`,[id,JSON.stringify(next),revision,VERSION_KEY(revision),JSON.stringify(archived)]);
  if(!reopened.length)throw new DraftError('This estimate changed while it was being reopened. Reload and try again.',409);
  return {revision:Number(reopened[0].revision),previous:revision,text:next.text};
}
export async function listVersions(id:string):Promise<VersionSummary[]>{
  const rows=await query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'version-v1:%' ORDER BY (payload->>'revision')::int DESC",[id]);
  return rows.map(r=>{const v=r.payload as {revision:number;submittedAt:string|null;customer?:{range?:{low:number;high:number}|null;issue?:{reference?:string}}};
    return {revision:Number(v.revision),submittedAt:v.submittedAt,total:rangeText(v.customer?.range),reference:String(v.customer?.issue?.reference||'')};});
}
export async function archivedVersion(id:string,revision:number){
  const [row]=await query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2",[id,VERSION_KEY(revision)]);
  return row?.payload as {revision:number;submittedAt:string|null;customer:any;change:string}|undefined;
}
/** What changed from the prior version, in the customer's terms: the request, the total, work added or removed. */
export function changeSummary(previous:{customer?:any;change?:string}|undefined,current:any):string[]{
  if(!previous?.customer)return [];
  const lines:string[]=[];
  if(previous.change)lines.push(`Requested change: ${previous.change}`);
  const before=rangeText(previous.customer.range),after=rangeText(current?.range);
  if(before!==after)lines.push(`Total was ${before}; now ${after}.`);else lines.push(`Total unchanged at ${after}.`);
  const tasks=(v:any)=>new Set<string>(((v?.scopeTasks||[]) as {description?:string}[]).map(t=>String(t.description||'').trim()).filter(Boolean));
  const was=tasks(previous.customer),now=tasks(current);
  const added=[...now].filter(t=>!was.has(t)),removed=[...was].filter(t=>!now.has(t));
  if(added.length)lines.push(`Added: ${added.slice(0,6).join('; ')}${added.length>6?` and ${added.length-6} more`:''}.`);
  if(removed.length)lines.push(`Removed: ${removed.slice(0,6).join('; ')}${removed.length>6?` and ${removed.length-6} more`:''}.`);
  return lines;
}
