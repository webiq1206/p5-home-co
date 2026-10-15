import test from "node:test";
import assert from "node:assert/strict";
import { classify, MAILBOX, type Mail } from "../app/lib/integrations/inbox-policy.ts";
import { parseVoiceNotesMessage, preliminaryScopeDraft } from "../app/lib/integrations/voice-call-notes.ts";

const base = {
  subject: "Notes from call with (208) 555-0160",
  text: "Notes from call with (208) 555-0160\n\nThe content was auto-generated on 15 Oct 2026 and may contain errors. Note, only English is supported.\n\nNotes\n\nCall was too short for notes.\n\nWas this email useful?\n\nGoogle LLC",
  from: [{email:"gemini-call-notes-noreply@google.com"}],
  headers: [{key:"x-notifications",line:"X-Notifications: synthetic-automatic_call_recording"}],
};
test("actual short-call notification is recognized but never creates a scope", () => {
  const notes = parseVoiceNotesMessage(base);
  assert.equal(notes?.callerPhone, "+12085550160");
  assert.equal(notes?.automatic, true);
  assert.equal(notes?.usable, false);
  assert.equal(notes?.scopeDraft, null);
});
test("unrelated and malformed sender/subject cannot be treated as a voice note", () => {
  assert.equal(parseVoiceNotesMessage({...base, from:[{email:"attacker@example.invalid"}]}), null);
  assert.equal(parseVoiceNotesMessage({...base,subject:"Notes from call with caller unknown"}),null);
  assert.equal(parseVoiceNotesMessage({...base,subject:"Notes from call with (208) 477-1169"}),null);
});
test("construction request produces source-grounded internal scope with no fabricated quantity", () => {
  const summary = "The caller requested a kitchen remodel with new cabinets and updated lighting. They discussed replacing old flooring and asked for a walkthrough before making selections. No square footage, quantities, material specifications, budget or schedule were confirmed.";
  const notes = parseVoiceNotesMessage({...base,text:base.text.replace("Call was too short for notes.",summary)});
  assert.equal(notes?.usable,true);
  assert.ok(notes?.scopeDraft?.includes(summary));
  assert.match(notes?.scopeDraft||"",/INTERNAL REVIEW ONLY/);
  assert.ok(!/\$\d/.test(notes?.scopeDraft||""));
});
test("ordinary call summaries and unspecified details do not create a construction scope", () => {
  assert.equal(preliminaryScopeDraft("The caller asked what the office hours are and wanted a follow-up call next week."),null);
  assert.equal(preliminaryScopeDraft("The customer mentioned having a kitchen, but discussed only a duplicate invoice and asked that accounting return their call."),null);
});


function mailboxMail(body: string, headersOverride?: {key:string;line:string}[]): Mail {
  return {
    messageId:"<synthetic-google-note@notifications.google.com>",
    subject:base.subject,
    from:[{email:base.from[0].email,name:"Google Voice"}],
    to:[{email:MAILBOX,name:"P5"}],cc:[],bcc:[],
    text:body,html:"",
    receivedAt:"2026-10-15T19:28:08.000Z",sentAt:"2026-10-15T19:28:08.000Z",
    headers:headersOverride||[...base.headers,{key:"authentication-results",line:"Authentication-Results: mx.google.com; dmarc=pass header.from=google.com"}],
    attachments:[],labels:["\\All"]
  };
}
test("authenticated Gemini call-notes email uses existing phone-only receipt path", () => {
  const detailed="The owner requests a kitchen remodel and cabinet replacement with new counters. They also discussed replacing flooring in the living room and requested an on-site visit. Dimensions, costs and selections remain unknown.";
  const body=base.text.replace("Call was too short for notes.",detailed);
  const decision=classify(mailboxMail(body));
  assert.deepEqual(decision,{status:"pending",reason:"gemini-call-notes",identity:{kind:"phone",value:"+12085550160",create:false}});
  assert.deepEqual(classify(mailboxMail(base.text)),{status:"review",reason:"voice-notes-insufficient"});
  assert.equal(classify(mailboxMail(body,[...base.headers,{key:"authentication-results",line:"Authentication-Results: mx.google.com; dmarc=fail header.from=google.com"}])).reason,"unverified-gemini-call-notes");
});
