import test from "node:test";
import assert from "node:assert/strict";
import {voiceNoteHtml,voiceCallBody} from "../app/lib/integrations/voice-activity.ts";
import type {Mail} from "../app/lib/integrations/inbox-policy.ts";

const source:Mail={
  messageId:"<synthetic-google-voice@notifications.google.com>",
  subject:"Notes from call with (208) 555-0160",
  from:[{email:"gemini-call-notes-noreply@google.com",name:"Google Voice"}],
  to:[{email:"hello@p5homeco.com",name:"P5"}],cc:[],bcc:[],
  text:"Notes from call with (208) 555-0160\n\nNotes\n\nThe caller requested a kitchen remodel with replacement cabinets and new flooring. They asked for a site visit before deciding on materials. No dimensions or final pricing were discussed.\n\nWas this email useful?",
  html:"",labels:["\\All"],attachments:[],sentAt:"2026-10-15T19:28:08Z",receivedAt:"2026-10-15T19:28:08Z",
  headers:[{key:"x-notifications",line:"X-Notifications: synthetic-automatic_call_recording"}]
};
test("native HubSpot call notes preserve the original and internal-only scope with traceability",()=>{
 const html=voiceNoteHtml(source,"1883000000000000001");
 assert.ok(html?.includes("INTERNAL DRAFT SCOPE"));
 assert.ok(html?.includes("requires review")||html?.includes("REQUIRES REVIEW"));
 assert.match(html||"",/kitchen remodel/);
 assert.match(html||"",/Gmail/);
 assert.ok(!/\$\d+/.test(html||""));
 const call=voiceCallBody(source,"1883000000000000001","123");
 assert.match(call,/does not contain the audio/);
 assert.match(call,/123/);
});
test("short, invalid, missing details never generate a HubSpot scope",()=>{
 const x={...source,text:source.text.replace(/The caller requested[\s\S]*?Was this email useful\?/,"Call was too short for notes.\n\nWas this email useful?")};
 assert.equal(voiceNoteHtml(x,"1883000000000000001"),null);
 assert.throws(()=>voiceCallBody(x,"1883000000000000001","123"),/insufficient/);
});
test("source text from a caller is HTML escaped",()=>{
 const x={...source,text:source.text.replace("The caller requested","<script>alert(1)</script> The caller requested")};
 assert.ok(voiceNoteHtml(x,"1883000000000000001")?.includes("&lt;script&gt;"));
 assert.ok(!voiceNoteHtml(x,"1883000000000000001")?.includes("<script>"));
});

import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import {processGeminiActivities} from "../app/lib/integrations/voice-activity.ts";
import type {Read} from "../app/lib/integrations/inbox-store.ts";
import type {InboxHubSpot} from "../app/lib/integrations/inbox-hubspot.ts";

async function voiceDb(callback:(db:PGlite,read:Read)=>Promise<void>) {
 const db=new PGlite();
 await db.exec(readFileSync("migrations/018_inbox_sync.sql","utf8"));
 await db.exec(readFileSync("migrations/019_voice_activities.sql","utf8"));
 const read:Read=async (sql,values=[]) => (await db.query(sql,[...values])).rows as Record<string,unknown>[];
 try {await callback(db,read)} finally {await db.close()}
}
function mockCRM(match="100") {
 const created:{note?:Record<string,unknown>;call?:Record<string,unknown>}={};
 const posts:{type:string;id:string}[]=[];
 const crm={
  findContact: async()=>match,
  call:async (path:string,method="GET",body?:unknown)=>{
   if(path.includes("associations/notes/contacts/labels"))return {results:[{category:"HUBSPOT_DEFINED",typeId:202}]};
   if(path.includes("associations/calls/contacts/labels"))return {results:[{category:"HUBSPOT_DEFINED",typeId:194}]};
   if(method==="POST"){
    const type=path.includes("/notes")?"note":"call";
    const id=type==="note"?"901":"902";
    posts.push({type,id});
    created[type]={...(body as Record<string,unknown>),id};
    return {id};
   }
   const type=path.includes("/notes")?"note":"call";
   if(path.includes("/901")||path.includes("/902")){
    const written=created[type]!;
    return {id:written.id,properties:written.properties,associations:{contacts:{results:[{id:"100"}]}}};
   }
   return {results:[]};
  }
 };
 return {crm:crm as unknown as InboxHubSpot,posts,created};
}
async function seedVoice(read:Read,contact:string|null) {
 await read(`INSERT INTO p5_inbox_message(mailbox,source_id,rfc_id,payload,labels,locations,status,reason,identity,next_attempt_at,hubspot_contact_id)
 VALUES($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb,'synced','gemini-call-notes',$5::jsonb,now(),$6)`,
 ["hello@p5homeco.com","1883000000000000001",source.messageId,JSON.stringify(source),
 JSON.stringify({kind:"phone",value:"+12085550160",create:false}),contact]);
}
test("one verified Gemini message creates one associated NOTE and CALL, never duplicates on later runs",async()=>
 voiceDb(async(db,read)=>{
  await seedVoice(read,"100");
  const {crm,posts}=mockCRM();
  assert.deepEqual(await processGeminiActivities(read,crm,{limit:2}),{completed:1,review:0});
  const result=(await db.query<{state:string;note_id:string;call_id:string}>("SELECT state,note_id,call_id FROM p5_voice_activity")).rows[0];
  assert.deepEqual(result,{state:"complete",note_id:"901",call_id:"902"});
  assert.deepEqual(await processGeminiActivities(read,crm,{limit:2}),{completed:0,review:0});
  assert.deepEqual(posts.map(x=>x.type),["note","call"]);
 }));
test("unmatched caller is held for review and no CRM activity is posted",async()=>voiceDb(async(db,read)=>{
 await seedVoice(read,null);
 const {crm,posts}=mockCRM();
 assert.deepEqual(await processGeminiActivities(read,crm),{completed:0,review:1});
 assert.equal((await db.query<{state:string}>("SELECT state FROM p5_voice_activity")).rows[0].state,"review");
 assert.equal(posts.length,0);
}));
test("uncertain NOTE POST creates an unretriable review state, never duplicate POST",async()=>voiceDb(async(db,read)=>{
 await seedVoice(read,"100");
 const {crm,posts}=mockCRM();
 const liveCall=crm.call.bind(crm);
 (crm as unknown as {call:typeof liveCall}).call=async(path,method="GET",body)=> {
  if(method==="POST"){posts.push({type:"note",id:"unknown"});throw Error("synthetic-api-timeout")}
  return liveCall(path,method,body)
 };
 assert.deepEqual(await processGeminiActivities(read,crm),{completed:0,review:1});
 assert.deepEqual(await processGeminiActivities(read,crm),{completed:0,review:0});
 assert.equal(posts.length,1);
 const record=(await db.query<{state:string;note_attempted_at:string}>("SELECT state,note_attempted_at FROM p5_voice_activity")).rows[0];
 assert.equal(record.state,"review");
 assert.ok(record.note_attempted_at);
}));
