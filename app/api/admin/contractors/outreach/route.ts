import { NextResponse } from "next/server";

import { query, transaction } from "../../../../lib/db.ts";
import { divisionOrder } from "../../../../lib/scopes/divisions.ts";
import { currentVersion, getProject } from "../../../../lib/scopes/store.ts";
import { listContractors, requireContractorActor, ContractorStoreError } from "../../../../lib/contractors/store.ts";
import { projectLocality, rank } from "../../../../lib/contractors/match.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const EVENT_STATUSES = ["not_contacted", "contacted", "bidding", "follow_up", "declined", "awarded"] as const;
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

type Event = { id: number; contractorId: number; scopeVersionId: number | null; status: string; note: string;
  followUpAt: string | null; createdAt: string; actorName: string | null; items: {id:string;title:string;division:string;costCode:string|null}[] };

function positiveId(value:unknown):number|null {
  if(typeof value!=="string"&&typeof value!=="number")return null;
  if(!/^\d+$/.test(String(value))) return null;
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}
function errorResponse(error:unknown){
  if(error instanceof ContractorStoreError) return reply({error:error.message},error.status);
  if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="42P01") return reply({error:"Contractor outreach is not installed in this database yet."},503);
  return reply({error:"Contractor outreach could not be loaded or saved. Please try again."},500);
}
const eventColumns = `e.id::int, e.contractor_id::int AS "contractorId", e.scope_version_id::int AS "scopeVersionId",
    e.status, e.note, e.follow_up_at AS "followUpAt", e.created_at AS "createdAt", u.full_name AS "actorName", e.items`;
export async function GET(req:Request) {
  try{
    await requireContractorActor();
    const projectId=positiveId(new URL(req.url).searchParams.get("projectId"));
    if(!projectId)return reply({error:"Project not found."},404);
    const project=await getProject(projectId);
    if(!project)return reply({error:"Project not found."},404);
    const [version, contractors, history, latest]=await Promise.all([
      currentVersion(project),listContractors(),
      query<Event>(`SELECT ${eventColumns} FROM contractor_outreach_event e LEFT JOIN app_user u ON u.id=e.actor_id
       WHERE e.project_id=$1 ORDER BY e.id DESC LIMIT 500`,[projectId]),
      query<Event>(`SELECT DISTINCT ON(e.contractor_id) ${eventColumns}
       FROM contractor_outreach_event e LEFT JOIN app_user u ON u.id=e.actor_id
       WHERE e.project_id=$1 ORDER BY e.contractor_id, e.id DESC`,[projectId])
    ]);
    const city=projectLocality(project.project_address);
    const grouped=new Map<number,{contractor:typeof contractors[number];itemIds:string[]}>();
    const items=(version?.doc.tasks??[]).filter(t=>!t.dismissed)
      .slice().sort((a,b)=>divisionOrder(a.division)-divisionOrder(b.division))
      .map(task=>{
        const inScope=task.bucket==="approved";
        const internal=task.performer==="internal";
        const options=inScope&&!internal?rank(task,contractors,city):[];
        for(const option of options){
          const id=option.contractor.id, group=grouped.get(id);
          if(group)group.itemIds.push(task.id);
          else grouped.set(id,{contractor:option.contractor,itemIds:[task.id]});
        }
        return {id:task.id,division:task.division,title:task.title,
          status:internal?"internal":!inScope?"not_in_scope":options.length?"qualified":"needs_contractor",
          options:options.map(({contractor,reason})=>({contractor,reason}))};
      });
    // Keep previously contacted companies visible even after the scope or the ranking changes.
    for(const event of latest){
      const contractor=contractors.find(c=>c.id===event.contractorId);
      if(contractor&&!grouped.has(contractor.id)) grouped.set(contractor.id,{contractor,itemIds:[]});
    }
    const latestById=new Map(latest.map(e=>[e.contractorId,e]));
    const historyById=new Map<number,Event[]>();
    for(const event of history){
      const entries=historyById.get(event.contractorId)??[];
      entries.push(event);historyById.set(event.contractorId,entries);
    }
    return reply({project:{id:project.id,title:project.title},items,
      groups:[...grouped.values()].map(group=>{
        const id=group.contractor.id,lastEvent=latestById.get(id)??null;
        const events=historyById.get(id)??(lastEvent?[lastEvent]:[]);
        return {...group,status:lastEvent?.status??"not_contacted",lastEvent,events};
      }),history,historyLimited:history.length===500,
      warning:!version?"No saved project scope yet. Save a scope to see trade coverage.":!city?"Confirm the project locality before relying on contractor coverage.":null});
  }catch(error){return errorResponse(error);}
}
export async function POST(req:Request) {
  try{
    const actor=await requireContractorActor({write:true});
    const origin=req.headers.get("origin");
    if(!origin || !new Set([new URL(req.url).origin,"https://p5homeco.com","https://www.p5homeco.com"]).has(origin)) {
      return reply({error:"Open the P5 project to record outreach."},403);
    }
    let body:Record<string,unknown>;
    try{
      const raw=await req.text();
      if(raw.length>16000)return reply({error:"This outreach update is too large."},413);
      const value:unknown=JSON.parse(raw);
      if(!value||Array.isArray(value)||typeof value!=="object")return reply({error:"Invalid outreach update."},400);
      body=value as Record<string,unknown>;
    }catch{return reply({error:"Invalid outreach update."},400);}
    const projectId=positiveId(body.projectId),contractorId=positiveId(body.contractorId);
    const status=body.status as typeof EVENT_STATUSES[number];
    if(!projectId||!contractorId||!EVENT_STATUSES.includes(status))return reply({error:"Select a project, a contractor, and an outreach status."},400);
    if(body.note!=null&&typeof body.note!=="string")return reply({error:"Enter a text note."},400);
    const note=(body.note as string|undefined)?.trim()??"";
    if(note.length>2000)return reply({error:"Keep the note under 2,000 characters."},400);
    let date:string|null=null;
    if(body.followUpAt){
      if(typeof body.followUpAt!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.followUpAt)||
          !Number.isFinite(Date.parse(body.followUpAt)))return reply({error:"Enter a follow-up date and time with a time zone."},400);
      date=new Date(body.followUpAt).toISOString();
    }
    if(status==="follow_up"&&!date)return reply({error:"Set a follow-up date and time."},400);
    if(!Array.isArray(body.itemIds)||body.itemIds.length>200||body.itemIds.some(id=>typeof id!=="string"||!id||id.length>160))return reply({error:"Select valid project scope items."},400);
    const project=await getProject(projectId);
    if(!project||project.archived_at)return reply({error:"Find an active project before recording outreach."},404);
    const [version,contractors]=await Promise.all([currentVersion(project),listContractors()]);
    const contractor=contractors.find(c=>c.id===contractorId);
    if(!contractor)return reply({error:"Contractor not found."},404);
    if(!version)return reply({error:"Save the project scope first."},409);
    const selected=new Set(body.itemIds as string[]);
    const items=version.doc.tasks.filter(t=>selected.has(t.id)&&!t.dismissed&&t.bucket==="approved"&&t.performer!=="internal")
      .map(t=>({id:t.id,title:t.title,division:t.division,costCode:t.costCode??null}));
    if(items.length!==selected.size)return reply({error:"The scope changed. Refresh the list before saving outreach."},409);
    const result=await transaction(async client=>{
      const lock=await client.query<{id:string|null}>(`SELECT current_version_id::text AS id FROM scope_project
        WHERE id=$1 AND deleted_at IS NULL AND archived_at IS NULL FOR UPDATE`,[projectId]);
      if(lock.rows[0]?.id!==String(version.id))return null;
      const inserted=await client.query<{id:string}>(`INSERT INTO contractor_outreach_event
        (project_id,contractor_id,scope_version_id,actor_id,status,note,follow_up_at,items)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id::text`,
        [projectId,contractorId,version.id,actor.id,status,note,date,JSON.stringify(items)]);
      return inserted.rows[0];
    });
    return result?reply({saved:true,eventId:result.id},201):reply({error:"The scope changed. Refresh the list before saving outreach."},409);
  }catch(error){return errorResponse(error);}
}
