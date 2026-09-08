import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAbandonmentMessage,
  buildCallbackMessage,
  isEngaged,
  sanitizePath,
  sanitizeSelections,
  type SessionRow,
} from "../app/lib/leads/estimatorSessions.ts";

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    flow: "quote",
    page_path: "/quote/kitchen-remodel",
    device: "phone",
    started_at: new Date("2026-09-08T16:00:00Z"),
    last_activity_at: new Date("2026-09-08T16:03:00Z"),
    current_step: "filling",
    current_step_index: 1,
    last_completed_step: "form",
    total_steps: 2,
    completion_percent: 50,
    time_spent_seconds: 180,
    selections: { project: "kitchen-remodel", fields_filled: 2 },
    validation_errors: ["phone"],
    exit_method: "navigation",
    prompt_shown: true,
    clicked_call: false,
    clicked_text: false,
    requested_callback: false,
    dismissed_prompt: true,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    callback_note: null,
    status: "active",
    ...overrides,
  };
}

test("selections keep only allow-listed, non-sensitive scalars", () => {
  const out = sanitizeSelections({
    project: "kitchen-remodel",
    fields_filled: 2,
    email: "leak@example.com",
    contact_phone: "2085551234",
    "bad key!": "x",
    nested: { a: 1 },
    long: "x".repeat(500),
  });
  assert.deepEqual(Object.keys(out).sort(), ["fields_filled", "long", "project"]);
  assert.equal((out.long as string).length, 120);
});

test("page path never carries a query string or fragment", () => {
  assert.equal(sanitizePath("/quote/adu?gclid=abc&utm_source=x#top"), "/quote/adu");
  assert.equal(sanitizePath(undefined), "/");
  assert.equal(sanitizePath("not a url"), "/not%20a%20url");
});

test("engagement needs a completed step or twenty seconds", () => {
  assert.equal(isEngaged(0, null, 5), false);
  assert.equal(isEngaged(0, null, 20), true);
  assert.equal(isEngaged(1, null, 0), true);
  assert.equal(isEngaged(0, "form", 0), true);
});

test("an anonymous abandonment email says so and carries every session fact", () => {
  const m = buildAbandonmentMessage(row());
  assert.match(m.subject, /^\[Partial\] Anonymous quote form drop-off at filling \(50%\)/);
  assert.match(m.text, /No contact information was provided/);
  for (const label of ["Website", "Form", "Page", "Started", "Last activity", "Device", "Session id", "Current step", "Last completed step", "Progress", "Time in form", "Validation errors", "Exit method", "Recovery prompt shown", "Clicked to call", "Clicked to text", "Requested a callback", "Dismissed the prompt"]) {
    assert.match(m.text, new RegExp(`^${label}:`, "m"), `missing ${label}`);
  }
  assert.match(m.text, /Exit method: navigation/);
  assert.match(m.html, /kitchen-remodel/);
});

test("a callback email leads with the number and is labelled identified", () => {
  const m = buildCallbackMessage(row({ contact_name: "Test Caller", contact_phone: "2085550100", requested_callback: true }));
  assert.equal(m.subject, "Callback requested: Test Caller, (208) 555-0100 (quote form)");
  assert.match(m.text, /Phone: \(208\) 555-0100/);
  assert.doesNotMatch(m.text, /No contact information/);
});
