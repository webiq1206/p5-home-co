import assert from "node:assert/strict";
import test from "node:test";

import {
  composeIntakeSummary,
  detailLines,
  detailsFingerprint,
  intakeNoticeLines,
  readFileLinks,
  readIntakeExtras,
  readLeadDetails,
} from "../app/lib/leads/intakeContract.ts";
import { issueRequestToken, REQUEST_TOKEN_TTL_SECONDS, verifyRequestToken } from "../app/lib/leads/requestToken.ts";
import { readShortRequest, readShortRequestDetails, TIMING_OPTIONS } from "../app/lib/leads/shortRequest.ts";
import {
  MAX_SHORT_REQUEST_FILE_BYTES,
  MAX_SHORT_REQUEST_FILES,
  readEachUpload,
  readOneUpload,
  SHORT_REQUEST_FILE_ERRORS,
} from "../app/lib/leads/shortRequestFiles.ts";
import { dealDescription, dealProperties, detailsNoteBody, type DealSyncInput } from "../app/lib/integrations/hubspot-map.ts";
import { PROJECT_OPTIONS } from "../app/quote/options.ts";

// Owner, 1 November: two-step forms on every site, every lead in HubSpot,
// files included. The brand sites code to docs/lead-intake-contract.md.

test("intake extras: every new field is optional and read forgivingly", () => {
  const none = readIntakeExtras({ brand: "Boise Remodeling Co", name: "Jane" });
  assert.deepEqual(none, {
    submissionKind: "initial",
    externalId: null,
    requestKind: null,
    contactPreference: null,
    bestTime: null,
    timeline: null,
    files: [],
    filesDropped: 0,
  });

  const full = readIntakeExtras({
    submission_kind: "details",
    external_id: "  hm-req-123 ",
    request_kind: "callback",
    contact_preference: "text",
    best_time: "Weekday mornings",
    timeline: "1 to 3 months",
    files: [
      { name: "deck.jpg", url: "https://boisehandyman.co/api/files/abc", contentType: "image/jpeg", size: 120394 },
      { name: "../../plan.pdf", url: "https://boisehandyman.co/api/files/def", content_type: "application/pdf", size: "88000" },
      { name: "insecure.jpg", url: "http://example.com/x.jpg" },
      { name: "creds.jpg", url: "https://user:pass@example.com/x.jpg" },
      { name: "dup.jpg", url: "https://boisehandyman.co/api/files/abc" },
      "not an object",
    ],
  });
  assert.equal(full.submissionKind, "details");
  assert.equal(full.externalId, "hm-req-123");
  assert.equal(full.requestKind, "callback");
  assert.equal(full.contactPreference, "text");
  assert.equal(full.bestTime, "Weekday mornings");
  assert.equal(full.timeline, "1 to 3 months");
  assert.deepEqual(full.files, [
    { name: "deck.jpg", url: "https://boisehandyman.co/api/files/abc", contentType: "image/jpeg", size: 120394 },
    { name: "plan.pdf", url: "https://boisehandyman.co/api/files/def", contentType: "application/pdf", size: 88000 },
  ]);
  assert.equal(full.filesDropped, 3);

  // Accepted spellings and values from older brand code.
  const camel = readIntakeExtras({ submissionKind: "initial", externalId: "x", requestKind: "request", contactPreference: "phone" });
  assert.equal(camel.requestKind, "quote");
  assert.equal(camel.contactPreference, "call");
  assert.equal(readIntakeExtras({ request_type: "callback" }).requestKind, "callback");
  assert.equal(readIntakeExtras({ contact_preference: "fax" }).contactPreference, null);
  assert.equal(readIntakeExtras({ submission_kind: "something" }).submissionKind, "initial");
  // Files may arrive as a JSON string; a bad one is dropped, never fatal.
  assert.equal(readFileLinks(JSON.stringify([{ name: "a.png", url: "https://x.test/a.png" }])).files.length, 1);
  assert.deepEqual(readFileLinks("{nope"), { files: [], dropped: 1 });
  assert.equal(readFileLinks(Array.from({ length: 25 }, (_, i) => ({ name: `${i}.jpg`, url: `https://x.test/${i}` }))).files.length, 20);
});

test("a callback reads as one: the summary opens with Callback request and the best time", () => {
  assert.equal(composeIntakeSummary("Gate latch", { requestKind: "quote", bestTime: null }), "Gate latch");
  assert.equal(composeIntakeSummary(null, { requestKind: null, bestTime: null }), null);
  assert.equal(
    composeIntakeSummary("Gate latch", { requestKind: "callback", bestTime: "Morning" }),
    "Callback request: call this person back. Best time to call: Morning.\n\nGate latch",
  );
  assert.equal(composeIntakeSummary(null, { requestKind: "callback", bestTime: null }), "Callback request: call this person back.");
  // A brand that already wrote the marker is not doubled.
  assert.equal(composeIntakeSummary("Callback request. Morning.", { requestKind: "callback", bestTime: "Morning" }), "Callback request. Morning.");
  assert.deepEqual(
    intakeNoticeLines({ requestKind: "callback", contactPreference: "call", bestTime: "Morning", timeline: null, files: [{ name: "a.jpg", url: "https://x.test/a", contentType: null, size: null }] }),
    ["Request: Callback request", "Preferred contact: Call", "Best time to call: Morning", "File: a.jpg https://x.test/a"],
  );
});

test("details: lines, fingerprint and idempotency identity", () => {
  const details = readLeadDetails({
    address: "123 N Main St",
    zip: "83702",
    city: "Boise",
    projectType: "Kitchen remodel",
    timeline: "Soon",
    email: "dana@example.com",
    message: "Island if it fits",
    files: [{ name: "b.pdf", url: "https://x.test/b" }, { name: "a.jpg", url: "https://x.test/a" }],
  });
  assert.equal(details.propertyAddress, "123 N Main St, 83702");
  assert.deepEqual(detailLines(details), [
    "Project: Kitchen remodel",
    "Address: 123 N Main St, 83702",
    "City: Boise",
    "Timing: Soon",
    "Email: dana@example.com",
    "Note: Island if it fits",
    "File: b.pdf https://x.test/b",
    "File: a.jpg https://x.test/a",
  ]);
  const reordered = { ...details, files: [...details.files].reverse(), email: "DANA@example.com" };
  assert.equal(detailsFingerprint(details), detailsFingerprint(reordered));
  assert.notEqual(detailsFingerprint(details), detailsFingerprint({ ...details, timeline: "Just planning" }));
});

test("request token: issued per lead, verified, rejected when tampered, foreign or expired", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "synthetic-secret-for-tests";
  try {
    const now = new Date("2026-11-01T18:00:00Z");
    const token = issueRequestToken(42, now);
    assert.match(token, /^42\.\d+\.[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(verifyRequestToken(token, 42, now), { ok: true, dealId: 42 });
    assert.deepEqual(verifyRequestToken(token, "42", now), { ok: true, dealId: 42 });
    assert.deepEqual(verifyRequestToken(token, 43, now), { ok: false, reason: "invalid" });
    const [id, exp, sig] = token.split(".");
    assert.deepEqual(verifyRequestToken(`43.${exp}.${sig}`, undefined, now), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyRequestToken(`${id}.${Number(exp) + 999}.${sig}`, undefined, now), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyRequestToken("nonsense", undefined, now), { ok: false, reason: "malformed" });
    assert.deepEqual(verifyRequestToken(undefined, undefined, now), { ok: false, reason: "malformed" });
    const later = new Date(now.getTime() + (REQUEST_TOKEN_TTL_SECONDS + 1) * 1000);
    assert.deepEqual(verifyRequestToken(token, 42, later), { ok: false, reason: "expired" });
    process.env.SESSION_SECRET = "a-different-secret";
    assert.deepEqual(verifyRequestToken(token, 42, now), { ok: false, reason: "invalid" });
    assert.throws(() => issueRequestToken(0, now));
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});

test("Step 1 payload shape: the request needs what it can help with, a name and a phone", () => {
  const sent = readShortRequest((key) => ({ name: "Dana Reyes", phone: "(208) 555-0142", note: "Loose deck boards", contact_preference: "text", request_type: "request", project: "Something else, or I am not sure" } as Record<string, string>)[key] ?? null);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.value, {
    kind: "request",
    name: "Dana Reyes",
    phone: "(208) 555-0142",
    email: null,
    note: "Loose deck boards",
    project: "Something else, or I am not sure",
    contactPreference: "text",
    bestTime: null,
  });
});

test("Step 2 reader: all optional, unknown values dropped, a bad email named", () => {
  const projects = PROJECT_OPTIONS.map((option) => option.value);
  const read = (fields: Record<string, string>) => readShortRequestDetails((key) => fields[key] ?? null, projects);
  assert.deepEqual(read({ project: "Kitchen remodel", address: "83702", timing: "1 to 3 months" }), {
    ok: true,
    value: { project: "Kitchen remodel", address: "83702", timing: "1 to 3 months", bestTime: null, email: null },
  });
  assert.deepEqual(read({ project: "Pool", timing: "Yesterday", address: "Meridian" }), {
    ok: true,
    value: { project: null, address: "Meridian", timing: null, bestTime: null, email: null },
  });
  assert.equal(read({}).ok, false);
  assert.deepEqual(read({ email: "nope" }), { ok: false, field: "email", error: "That email address does not look right." });
  assert.deepEqual([...TIMING_OPTIONS], ["Soon", "1 to 3 months", "3 to 6 months", "Just planning"]);
});

test("file validation: one verdict per file, limits from the brief, nothing read when too large", async () => {
  assert.equal(MAX_SHORT_REQUEST_FILES, 10);
  assert.equal(MAX_SHORT_REQUEST_FILE_BYTES, 20 * 1024 * 1024);
  const upload = (name: string, data: Uint8Array, size = data.length) => ({
    name,
    size,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  });
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
  const pdf = new TextEncoder().encode("%PDF-1.7");
  const outcomes = await readEachUpload([upload("kitchen.jpg", jpeg), upload("notes.txt", new TextEncoder().encode("hi")), upload("plan.pdf", pdf)]);
  assert.deepEqual(outcomes.map((o) => [o.name, o.file?.mimeType ?? null, o.error]), [
    ["kitchen.jpg", "image/jpeg", null],
    ["notes.txt", null, SHORT_REQUEST_FILE_ERRORS.type],
    ["plan.pdf", "application/pdf", null],
  ]);
  let read = false;
  await assert.rejects(
    () => readOneUpload({ name: "huge.jpg", size: MAX_SHORT_REQUEST_FILE_BYTES + 1, arrayBuffer: async () => { read = true; return jpeg.buffer as ArrayBuffer; } }),
    new RegExp(SHORT_REQUEST_FILE_ERRORS.size),
  );
  assert.equal(read, false);
});

function deal(overrides: Partial<DealSyncInput> = {}): DealSyncInput {
  return {
    name: "Reyes | Boise Handyman Co",
    brand: "Boise Handyman Co",
    stage: "New Lead",
    leadSource: "Organic Website",
    leadSourceDetail: null,
    projectType: null,
    propertyAddress: null,
    propertyCity: null,
    serviceArea: null,
    summary: "Callback request: call this person back. Best time to call: Morning.",
    estimatedValue: null,
    assignedTeamMember: null,
    hubspotOwnerId: null,
    receivedAt: new Date("2026-11-01T18:00:00Z"),
    slaDeadline: null,
    slaStatus: "on_track",
    firstAttemptAt: null,
    firstTwoWayAt: null,
    nextAction: null,
    nextActionAt: null,
    appointmentAt: null,
    externalLeadId: null,
    facebookLeadId: null,
    originalForm: "Handyman quote",
    originalCampaign: null,
    closedLostReason: null,
    requestKind: "callback",
    contactPreference: "text",
    bestTime: "Morning",
    timeline: "Soon",
    files: [{ name: "deck.jpg", url: "https://boisehandyman.co/api/files/abc" }],
    ...overrides,
  };
}

test("HubSpot: request kind, contact preference, best time and files go to properties when they exist, else the description", () => {
  const without = dealProperties(deal(), new Set());
  assert.equal(
    without.description,
    "Callback request: call this person back. Best time to call: Morning.\n\nRequest: Callback request\nPreferred contact: Text\nBest time to call: Morning\nTiming: Soon\nFiles:\ndeck.jpg: https://boisehandyman.co/api/files/abc",
  );
  assert.ok(!("p5_request_kind" in without));
  const all = new Set(["p5_request_kind", "p5_contact_preference", "p5_best_time", "p5_timeline", "p5_file_links"]);
  const withProps = dealProperties(deal(), all);
  assert.equal(withProps.p5_request_kind, "Callback request");
  assert.equal(withProps.p5_contact_preference, "Text");
  assert.equal(withProps.p5_best_time, "Morning");
  assert.equal(withProps.p5_timeline, "Soon");
  assert.equal(withProps.p5_file_links, "deck.jpg: https://boisehandyman.co/api/files/abc");
  assert.equal(withProps.description, "Callback request: call this person back. Best time to call: Morning.");
  // An older lead with none of the new facts maps exactly as before.
  const legacy = deal({ requestKind: null, contactPreference: null, bestTime: null, timeline: null, files: [], summary: "Kitchen refresh" });
  assert.equal(dealProperties(legacy).description, "Kitchen refresh");
  assert.equal(dealDescription({ ...legacy, summary: null }), undefined);
  assert.equal(
    detailsNoteBody(["Address: 1 <Main>", "File: plan.pdf https://x.test/p?a=1&b=2"]),
    '<p><strong>Details added</strong></p><p>Address: 1 &lt;Main&gt;<br>File: <a href="https://x.test/p?a=1&amp;b=2">plan.pdf</a></p>',
  );
});

test("team email: the new lead lists request details, and a follow-up reads Details added or Files added", async () => {
  const { notifyLeadCreated, notifyLeadDetailsAdded } = await import("../app/lib/notifications/lead-created.ts");
  const sent: { subject: string; text: string }[] = [];
  const transport = { name: "capture", send: async (_to: string, message: { subject: string; text: string }) => { sent.push(message); return { ok: true as const }; } };
  await notifyLeadCreated(
    {
      dealId: 7, brand: "Boise Handyman Co", projectType: null, firstName: "Sam", lastName: "Ortiz", email: null, phone: "208-555-0199",
      propertyCity: null, propertyAddress: null, summary: "Callback request: call this person back.", source: "Organic Website", originalForm: "Handyman quote",
      extraLines: ["Request: Callback request", "File: gate.jpg https://boisehandyman.co/api/files/k1"],
    },
    { transport },
  );
  assert.match(sent[0].text, /Deal id: 7\nRequest: Callback request\nFile: gate\.jpg https:\/\/boisehandyman\.co\/api\/files\/k1\n/);
  await notifyLeadDetailsAdded(
    { dealId: 7, brand: "Boise Handyman Co", firstName: "Sam", lastName: "Ortiz", phone: "208-555-0199", email: null, lines: ["Timing: Soon"] },
    { transport },
  );
  assert.equal(sent[1].subject, "Details added: Sam Ortiz · Boise Handyman Co");
  assert.match(sent[1].text, /Timing: Soon/);
  await notifyLeadDetailsAdded(
    { dealId: 7, brand: "P5 Home Co", firstName: "Dana", lastName: null, phone: null, email: null, lines: ["File: plan.pdf https://p5homeco.com/api/admin/lead-files?id=3"] },
    { transport, subjectPrefix: "Files added" },
  );
  assert.equal(sent[2].subject, "Files added: Dana · P5 Home Co");
});
