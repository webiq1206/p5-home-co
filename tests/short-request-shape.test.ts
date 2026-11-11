import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLBACK_REQUEST,
  SHORT_REQUEST_ERRORS,
  readShortRequest,
  shortRequestSummary,
} from "../app/lib/leads/shortRequest.ts";

// The server checker behind /api/leads/short-request. Owner, 1 November: the
// quote form is name, phone and what they need, with email optional, and
// "Have us call you" sends name and phone alone through the same route.
const read = (fields: Record<string, string>) => readShortRequest((key) => fields[key] ?? null);

test("a full request needs a name, a phone and a note, and email is optional", () => {
  const ok = read({ name: "Dana Reyes", phone: "(208) 555-0142", note: "Loose deck boards", project: "Home repairs or handyman work" });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.value.kind, "request");
  assert.equal(ok.value.email, null);
  assert.equal(ok.value.contactPreference, "call");
  assert.equal(
    shortRequestSummary(ok.value, ["deck.jpg"]),
    "Project: Home repairs or handyman work. Preferred contact: Call me. Loose deck boards Files: deck.jpg.",
  );

  assert.deepEqual(read({ phone: "2085550142", note: "x" }), { ok: false, field: "name", error: SHORT_REQUEST_ERRORS.name });
  assert.deepEqual(read({ name: "Dana", note: "x" }), { ok: false, field: "phone", error: SHORT_REQUEST_ERRORS.phone });
  assert.deepEqual(read({ name: "Dana", phone: "123", note: "x" }), { ok: false, field: "phone", error: SHORT_REQUEST_ERRORS.phone });
  assert.deepEqual(read({ name: "Dana", phone: "2085550142" }), { ok: false, field: "note", error: SHORT_REQUEST_ERRORS.note });
  assert.equal(SHORT_REQUEST_ERRORS.note, "Add a short note about the project.");
});

test("email is checked when given, and required only when the visitor asks to be emailed", () => {
  const base = { name: "Dana", phone: "2085550142", note: "Kitchen" };
  assert.deepEqual(read({ ...base, email: "not-an-email" }), { ok: false, field: "email", error: SHORT_REQUEST_ERRORS.emailInvalid });
  assert.deepEqual(read({ ...base, contact_preference: "email" }), { ok: false, field: "email", error: SHORT_REQUEST_ERRORS.emailMissing });
  assert.match(SHORT_REQUEST_ERRORS.emailMissing, /^Enter an email address/);
  const emailed = read({ ...base, email: "dana@example.com", contact_preference: "email" });
  assert.equal(emailed.ok && emailed.value.contactPreference, "email");
  const texted = read({ ...base, contact_preference: "text" });
  assert.equal(texted.ok && shortRequestSummary(texted.value), "Preferred contact: Text me. Kitchen");
  // An unknown preference falls back to a call rather than failing the lead.
  const odd = read({ ...base, contact_preference: "fax" });
  assert.equal(odd.ok && odd.value.contactPreference, "call");
});

test("a full request may carry an optional project address, and a callback never does", () => {
  // Owner, 11 November: most requests have an address, a new build may not yet.
  const base = { name: "Dana", phone: "2085550142", note: "Kitchen" };
  const withAddress = read({ ...base, address: "  412 N Sample St, Boise  " });
  assert.equal(withAddress.ok && withAddress.value.address, "412 N Sample St, Boise");
  // Absent or blank is fine and reads as no address; nothing about it is checked but its length.
  const absent = read(base);
  assert.equal(absent.ok && absent.value.address, null);
  const blank = read({ ...base, address: "   " });
  assert.equal(blank.ok && blank.value.address, null);
  const odd = read({ ...base, address: "lot 4, no number yet" });
  assert.equal(odd.ok && odd.value.address, "lot 4, no number yet");
  const long = read({ ...base, address: "x".repeat(400) });
  assert.equal(long.ok && long.value.address?.length, 300);
  // The address has its own place on the lead; the summary the team reads is unchanged.
  assert.equal(withAddress.ok && shortRequestSummary(withAddress.value), "Preferred contact: Call me. Kitchen");
  const callback = read({ request_type: CALLBACK_REQUEST, name: "Sam", phone: "2085550199", address: "412 N Sample St" });
  assert.equal(callback.ok && callback.value.address, null);
});

test("a callback request is name and phone, marked as a callback for the team", () => {
  const callback = read({ request_type: CALLBACK_REQUEST, name: "Sam Ortiz", phone: "208-555-0199", best_time: "Weekday mornings", project: "Something else, or I am not sure" });
  assert.equal(callback.ok, true);
  if (!callback.ok) return;
  assert.equal(callback.value.kind, "callback");
  assert.equal(callback.value.contactPreference, "call");
  assert.equal(callback.value.email, null);
  assert.equal(
    shortRequestSummary(callback.value),
    "Callback request: call this person back. Best time to call: Weekday mornings. Project: Something else, or I am not sure.",
  );
  // Name and phone are still required; nothing else is.
  assert.deepEqual(read({ request_type: CALLBACK_REQUEST, phone: "2085550199" }), { ok: false, field: "name", error: SHORT_REQUEST_ERRORS.name });
  assert.deepEqual(read({ request_type: CALLBACK_REQUEST, name: "Sam" }), { ok: false, field: "phone", error: SHORT_REQUEST_ERRORS.phone });
  const bare = read({ request_type: CALLBACK_REQUEST, name: "Sam", phone: "2085550199" });
  assert.equal(bare.ok && shortRequestSummary(bare.value), "Callback request: call this person back.");
  // A callback is a request to be called, whatever else was sent; a typed note is kept, never dropped.
  const mixed = read({ request_type: CALLBACK_REQUEST, name: "Sam", phone: "2085550199", contact_preference: "email", note: "Gate latch" });
  assert.equal(mixed.ok && mixed.value.contactPreference, "call");
  assert.equal(mixed.ok && shortRequestSummary(mixed.value), "Callback request: call this person back. Gate latch");
});

test("the route reads both shapes through the shared checker and reports the field", () => {
  return import("node:fs").then(({ readFileSync }) => {
    const route = readFileSync("app/api/leads/short-request/route.ts", "utf8");
    assert.match(route, /readShortRequest\(\(key\) => form\.get\(key\)\)/);
    assert.match(route, /error: checked\.error, field: checked\.field/);
    assert.match(route, /shortRequestSummary\(submitted, files\.map/);
    // Same lead pipeline for both: one ingestLead call, one notify call.
    assert.equal((route.match(/await ingestLead\(/g) ?? []).length, 1);
    assert.equal((route.match(/await notifyLeadCreated\(/g) ?? []).length, 1);
    assert.equal(route.includes("/api/leads/callback"), false);
    // A Step 1 address reaches the stored lead and the team alert the way a Step 2 address does.
    assert.equal((route.match(/propertyAddress: submitted\.address,/g) ?? []).length, 2);
    assert.doesNotMatch(route, /propertyAddress: null/);
    const ingest = route.slice(route.indexOf("await ingestLead("), route.indexOf("settings,", route.indexOf("await ingestLead(")));
    assert.match(ingest, /propertyAddress: submitted\.address,/);
    const notice = route.slice(route.indexOf("const notice: LeadCreatedNotifyInput"));
    assert.match(notice, /propertyAddress: submitted\.address,/);
  });
});
