import { randomUUID } from "node:crypto";
import { MAILBOX, type Mail } from "./inbox-policy.ts";
import { parseVoiceNotesMessage } from "./voice-call-notes.ts";
import { InboxHubSpot } from "./inbox-hubspot.ts";
import { htmlMatches, sourcePrefix } from "./inbox-content.ts";
import type { Read } from "./inbox-store.ts";

type Activity = {
  source_id: string; mailbox: string; contact_id: string | null;
  state: string; lease_token: string; note_attempted_at: string | null;
  note_id: string | null; call_attempted_at: string | null; call_id: string | null;
};
type Source = { payload: Mail; hubspot_contact_id: string | null; status: string; reason: string };
type Assoc = { results: { category: string; typeId: number }[] };
type ObjectRecord = { id: string; archived?: boolean; properties: Record<string,string|null>;
  associations?: Record<string,{ results: {id:string}[]; paging?: unknown }> };

const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
function sourceUrl(id:string) {
  if (!/^\d+$/.test(id)) throw Error("unverified-voice-source-id");
  return `https://mail.google.com/mail/?authuser=hello%40p5homeco.com#all/${BigInt(id).toString(16)}`;
}
export function voiceNoteHtml(mail: Mail, sourceId: string): string | null {
  const note = parseVoiceNotesMessage(mail);
  if (!note?.usable) return null;
  const parts = [
    "<p><strong>Google Voice Gemini call notes - INTERNAL RECORD, AI-GENERATED</strong></p>",
    "<p>Call participant number (Google Voice): " + escape(note.callerPhone) + "</p>",
    "<p>Received: " + escape(mail.receivedAt) + ". Actual call start/end time was not supplied.</p>",
    "<p>Google automatic recording indicator: " + (note.automatic ? "present" : "not confirmed") + ".</p>",
    "<p><strong>Original Google Voice summary (verify accuracy before use):</strong></p>",
    "<pre>" + escape(note.summary) + "</pre>",
  ];
  if (note.scopeDraft) parts.push("<p><strong>INTERNAL DRAFT SCOPE - REQUIRES REVIEW, NOT A BID</strong></p>",
    "<pre>" + escape(note.scopeDraft) + "</pre>");
  parts.push("<p>Source Gmail message: <a href=\"" + escape(sourceUrl(sourceId)) + "\">view the original</a></p>",
    "<p>Immutable source RFC ID: " + escape(mail.messageId) + "</p>");
  return parts.join("\n");
}
export function voiceCallBody(mail: Mail, sourceId: string, noteId: string): string {
  const note = parseVoiceNotesMessage(mail);
  if (!note?.usable) throw Error("voice-notes-insufficient");
  return [
    "Google Voice automatically generated Gemini AI notes. This record does not contain the audio or a verified verbatim transcript.",
    "Caller: " + note.callerPhone,
    "Summary (Google-generated, requires review):",
    note.summary,
    "Linked HubSpot AI notes activity: " + noteId,
    "Source Gmail: " + sourceUrl(sourceId),
    "Source RFC Message-ID: " + mail.messageId,
    "For construction requests, any generated draft scope is inside the associated HubSpot note and requires approval."
  ].join("\n");
}
function fixedError(error: unknown) {
  const s=error instanceof Error ? error.message : "";
  return /^[a-z0-9-]{1,80}$/.test(s) ? s : "voice-activity-provider-error";
}
function label(associations: Assoc, code:number) {
  if (!associations.results.some(x=>x.category==="HUBSPOT_DEFINED"&&x.typeId===code))
    throw Error("voice-contact-association-unverified");
  return [{ associationCategory:"HUBSPOT_DEFINED", associationTypeId:code }];
}
async function verifyActivity(crm: InboxHubSpot, object: "notes"|"calls", id: string, body: string, contactId: string) {
  const field=object==="notes" ? "hs_note_body" : "hs_call_body";
  const r=await crm.call<ObjectRecord>(`/crm/v3/objects/${object}/${encodeURIComponent(id)}?properties=${field}&associations=contacts`);
  if (r.id!==id || r.archived || !(object==="notes" ? htmlMatches(body,r.properties[field]||"") : sourcePrefix(body,r.properties[field]||"")) || r.associations?.contacts?.paging ||
    !r.associations?.contacts?.results.some(x=>x.id===contactId)) throw Error("voice-activity-readback-mismatch");
}
async function finish(read:Read, row:Activity, state:"review"|"complete", reason:string|null) {
  await read(`UPDATE p5_voice_activity SET state=$4,lease_token=NULL,lease_until=NULL,last_error=$5,updated_at=now()
    WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3`,[MAILBOX,row.source_id,row.lease_token,state,reason]);
}
/**
 * Called ONLY inside the gated P5 central inbox watchdog, never as a second
 * mailbox collector. Each Google email is identified by its persistent Gmail
 * source ID. Writes save a durable create intent BEFORE any HubSpot POST; if a
 * response is lost, the record goes to review and must NOT be posted again.
 */
export async function processGeminiActivities(read:Read, crm:InboxHubSpot, opts:{limit?:number; deadline?:number}={}) {
  const limit=Math.min(3,Math.max(1,opts.limit||2));
  const deadline=opts.deadline||Date.now()+45000;
  // Only verified usable email receipts. The classifier has already checked
  // Google DMARC transport and extracted the caller's phone, never a name guess.
  await read(`INSERT INTO p5_voice_activity(mailbox,source_id,contact_id)
    SELECT mailbox,source_id,hubspot_contact_id FROM p5_inbox_message
    WHERE mailbox=$1 AND reason='gemini-call-notes' AND status IN ('synced','existing')
    ORDER BY created_at LIMIT 40 ON CONFLICT DO NOTHING`,[MAILBOX]);
  // Fail closed before posting anything if this private key lacks activity reads.
  await crm.call("/crm/v3/objects/notes?limit=1");
  await crm.call("/crm/v3/objects/calls?limit=1");
  const [noteLabels,callLabels]=await Promise.all([
    crm.call<Assoc>("/crm/v4/associations/notes/contacts/labels"),
    crm.call<Assoc>("/crm/v4/associations/calls/contacts/labels"),
  ]);
  const noteAssoc=label(noteLabels,202),callAssoc=label(callLabels,194);
  let completed=0,review=0;
  for(let i=0;i<limit && Date.now()<deadline-10000;i++){
    const token=randomUUID();
    const [row]=await read(`WITH candidate AS (SELECT mailbox,source_id
      FROM p5_voice_activity WHERE mailbox=$1 AND state IN ('pending','processing')
      AND (lease_until IS NULL OR lease_until<=now())
      ORDER BY created_at,source_id LIMIT 1 FOR UPDATE SKIP LOCKED)
      UPDATE p5_voice_activity a SET state='processing',lease_token=$2,
      lease_until=now()+interval '120 seconds',updated_at=now()
      FROM candidate c WHERE a.mailbox=c.mailbox AND a.source_id=c.source_id RETURNING a.*`,[MAILBOX,token]);
    if(!row)break;
    const a=row as unknown as Activity;
    try{
      const [src]=await read(`SELECT payload,hubspot_contact_id,status,reason FROM p5_inbox_message
        WHERE mailbox=$1 AND source_id=$2`,[MAILBOX,a.source_id]);
      const source=src as Source|undefined;
      const notes=source && parseVoiceNotesMessage(source.payload);
      if(!source || !notes?.usable || !source.hubspot_contact_id || !a.contact_id ||
        source.hubspot_contact_id!==a.contact_id || source.reason!=="gemini-call-notes" ||
        !["existing","synced"].includes(source.status)) throw Error("voice-notes-contact-review");
      const matched=await crm.findContact({kind:"phone",value:notes.callerPhone,create:false});
      if(matched!==a.contact_id) throw Error("voice-notes-contact-review");
      const noteBody=voiceNoteHtml(source.payload,a.source_id);
      if(!noteBody)throw Error("voice-notes-insufficient");
      let noteId=a.note_id;
      if(!noteId){
        if(a.note_attempted_at)throw Error("voice-note-create-uncertain-no-repost");
        const intent=await read(`UPDATE p5_voice_activity SET note_attempted_at=now()
          WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND note_attempted_at IS NULL
          AND lease_until>now() RETURNING source_id`,[MAILBOX,a.source_id,a.lease_token]);
        if(!intent.length)throw Error("voice-note-intent-not-verified");
        const created=await crm.call<{id:string}>("/crm/v3/objects/notes","POST",{
          properties:{hs_timestamp:source.payload.receivedAt,hs_note_body:noteBody},
          associations:[{to:{id:a.contact_id},types:noteAssoc}]
        });
        if(!/^\d+$/.test(created.id))throw Error("voice-note-create-uncertain-no-repost");
        noteId=created.id;
        await read(`UPDATE p5_voice_activity SET note_id=$4,updated_at=now()
          WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3`,[MAILBOX,a.source_id,a.lease_token,noteId]);
      }
      await verifyActivity(crm,"notes",noteId,noteBody,a.contact_id);
      const callBody=voiceCallBody(source.payload,a.source_id,noteId);
      let callId=a.call_id;
      if(!callId){
        if(a.call_attempted_at)throw Error("voice-call-create-uncertain-no-repost");
        const intent=await read(`UPDATE p5_voice_activity SET call_attempted_at=now()
          WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3 AND call_attempted_at IS NULL
          AND lease_until>now() RETURNING source_id`,[MAILBOX,a.source_id,a.lease_token]);
        if(!intent.length)throw Error("voice-call-intent-not-verified");
        const created=await crm.call<{id:string}>("/crm/v3/objects/calls","POST",{
          properties:{hs_timestamp:source.payload.receivedAt,
            hs_call_title:"Google Voice Gemini AI notes - " + notes.callerPhone,
            hs_call_body:callBody,hs_call_status:"COMPLETED"},
          associations:[{to:{id:a.contact_id},types:callAssoc}]
        });
        if(!/^\d+$/.test(created.id))throw Error("voice-call-create-uncertain-no-repost");
        callId=created.id;
        await read(`UPDATE p5_voice_activity SET call_id=$4,updated_at=now()
          WHERE mailbox=$1 AND source_id=$2 AND lease_token=$3`,[MAILBOX,a.source_id,a.lease_token,callId]);
      }
      await verifyActivity(crm,"calls",callId,callBody,a.contact_id);
      await finish(read,a,"complete",null);
      completed++;
    }catch(error){
      await finish(read,a,"review",fixedError(error));
      review++;
    }
  }
  return {completed,review};
}
