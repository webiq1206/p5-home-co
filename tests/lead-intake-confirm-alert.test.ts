import assert from "node:assert/strict";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// One team email per request from a brand site (owner, 17 November 2026).
// The brand site asks the intake to confirm its team email went
// (`team_alert: "confirm"`) and sends its own only when it did not. These
// tests hold the intake's half of that: it waits, it tells the truth, and a
// caller that does not ask sees no change at all.

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
delete process.env.HUBSPOT_TOKEN;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;

const db = await leadDatabase();
await db.exec(
  `INSERT INTO app_user (email, full_name, role) VALUES ('coord@example.invalid','Coordinator One','lead_coordinator')`,
);

const { handleIntake } = await import("../app/api/leads/intake/handler.ts");
const { readTeamNotes, MAX_TEAM_NOTES, MAX_TEAM_NOTE_LENGTH } = await import("../app/lib/leads/intakeContract.ts");

type Json = Record<string, unknown>;
type Sent = { to: string; subject: string; text: string; html: string };
let ip = 0;
let sent: Sent[] = [];
let afterTasks: (() => Promise<void>)[] = [];
let delivering: "ok" | "refused" | "slow" = "ok";

const transport = {
  name: "test",
  async send(to: string, message: { subject: string; text: string; html: string }) {
    if (delivering === "slow") await new Promise((resolve) => setTimeout(resolve, 150));
    if (delivering === "refused") return { ok: false as const, error: "mailbox refused" };
    sent.push({ to, ...message });
    return { ok: true as const };
  },
};

async function post(body: Json, deps: Json = {}): Promise<{ status: number; json: Json }> {
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` },
      body: JSON.stringify(body),
    }),
    (task) => afterTasks.push(task),
    { alertTransport: transport, ...deps },
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const request = (id: string, extra: Json = {}): Json => ({
  brand: "Boise Cabinet Co",
  name: `Pat Example ${id}`,
  form: "Cabinet consultation",
  source: "Organic Website",
  projectType: "Kitchen cabinets",
  email: `pat${id}@example.com`,
  // A number of its own per request: the intake limits repeats from one person.
  phone: `(208) 55${id}-0142`,
  summary: "New uppers and a pantry.",
  external_id: `boisecabinet-consultation:${id}`,
  submission_kind: "initial",
  ...extra,
});

test.beforeEach(() => { sent = []; afterTasks = []; delivering = "ok"; });

test("a caller that does not ask is answered exactly as before, and the email goes after the response", async () => {
  const { status, json } = await post(request("1"));
  assert.equal(status, 201);
  assert.deepEqual(Object.keys(json).sort(), ["accepted", "duplicate", "message", "ok"]);
  assert.equal(sent.length, 0, "nothing is sent before the response");
  assert.equal(afterTasks.length, 1);
  await afterTasks[0]();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^New lead: /);
});

test("a caller that asks is told the team email went, and it has gone by the time it is told", async () => {
  const { status, json } = await post(request("2", { team_alert: "confirm" }));
  assert.equal(status, 201);
  assert.equal(json.alert, "sent");
  assert.equal(json.accepted, true);
  assert.equal(sent.length, 1, "sent before the response, not after it");
  assert.equal(afterTasks.length, 0, "and not sent a second time afterwards");
});

test("a caller that asks is told when the team email did not go, so it can send its own", async () => {
  delivering = "refused";
  const { status, json } = await post(request("3", { team_alert: "confirm" }));
  assert.equal(status, 201, "the lead is still accepted");
  assert.equal(json.alert, "failed");
  assert.equal(sent.length, 0);
});

test("an email that is still sending is reported as not confirmed, and is left to finish", async () => {
  delivering = "slow";
  const { json } = await post(request("4", { team_alert: "confirm" }), { confirmAlertTimeoutMs: 20 });
  assert.equal(json.alert, "failed");
  assert.equal(afterTasks.length, 1, "the send is kept alive after the response");
  await afterTasks[0]();
  assert.equal(sent.length, 1);
});

test("an exact repeat produces no email and says so", async () => {
  await post(request("5", { team_alert: "confirm" }));
  sent = [];
  const { status, json } = await post(request("5", { team_alert: "confirm" }));
  assert.equal(status, 200);
  assert.equal(json.duplicate, true);
  assert.equal(json.alert, "none");
  assert.equal(sent.length, 0);
});

test("Step 2 details: the follow-up email is confirmed the same way", async () => {
  await post(request("6", { team_alert: "confirm" }));
  sent = [];
  const { status, json } = await post({
    brand: "Boise Cabinet Co",
    name: "Pat Example 6",
    external_id: "boisecabinet-consultation:6",
    submission_kind: "details",
    address: "123 N Main St",
    city: "Boise",
    timeline: "1 to 3 months",
    team_alert: "confirm",
  });
  assert.equal(status, 200);
  assert.equal(json.merged, true);
  assert.equal(json.alert, "sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Details added: /);
});

test("team notes are printed in the email only: not stored on the lead, not among the submitted fields", async () => {
  const notes = ["Planning range: $18,000 to $24,000", "Parcel: R1234567", "Lead dashboard: https://boisecabinet.co/admin/leads/77"];
  const { json } = await post(request("7", { team_alert: "confirm", team_notes: notes }));
  assert.equal(json.alert, "sent");
  const [mail] = sent;
  assert.match(mail.text, /From the website:\n  Planning range: \$18,000 to \$24,000\n  Parcel: R1234567/);
  assert.match(mail.html, /From the website/);
  assert.match(mail.html, /Planning range<\/td>/);
  assert.doesNotMatch(mail.text, /Team notes|Team alert/i, "the instruction itself is not a submitted field");
  assert.doesNotMatch(mail.html, /Team notes|Team alert/i);
  const [deal] = await db.rows<{ summary: string }>("SELECT summary FROM deal WHERE name LIKE $1", ["%Example 7%"]);
  assert.ok(deal, "the lead was created");
  assert.doesNotMatch(deal.summary ?? "", /Planning range|Parcel/);
  const fields = await db.rows<{ fields: unknown }>("SELECT fields FROM lead_intake_submission");
  assert.doesNotMatch(JSON.stringify(fields), /Planning range|R1234567|team_notes|team_alert/);
  // The inbox sync reads exactly one Name, Email and Phone line.
  for (const label of ["Name", "Email", "Phone"]) {
    assert.equal(mail.text.split("\n").filter((line) => line.startsWith(`${label}:`)).length, 1, label);
  }
});

test("a team note that names a cost or a margin never reaches the email, which HubSpot copies", async () => {
  const notes = [
    "Planning range: $18,000 to $24,000",
    "Our cost: $11,200",
    "Gross margin: 38%",
    "Contingency: $900",
    "Markup 1.6x",
    "Kitchen: $14,500 to $19,000",
  ];
  assert.deepEqual(readTeamNotes(notes), [
    "Planning range: $18,000 to $24,000",
    "Kitchen: $14,500 to $19,000",
    "Withheld: 4 internal lines (not emailed; see the site's own record)",
  ]);
  const { json } = await post(request("8", { team_alert: "confirm", team_notes: notes }));
  assert.equal(json.alert, "sent");
  const [mail] = sent;
  for (const secret of ["11,200", "38%", "$900", "1.6x"]) {
    assert.ok(!mail.text.includes(secret) && !mail.html.includes(secret), secret);
  }
  assert.match(mail.text, /Withheld: 4 internal lines/);
});

test("team notes are plain single lines, capped in number and length", () => {
  assert.deepEqual(readTeamNotes("not a list"), []);
  assert.deepEqual(readTeamNotes(["  a  b ", 7, "", "line\nbreak\tand tab", null]), ["a b", "line break and tab"]);
  assert.equal(readTeamNotes(Array.from({ length: 100 }, (_, i) => `note ${i}`)).length, MAX_TEAM_NOTES);
  assert.equal(readTeamNotes(["x".repeat(5000)])[0].length, MAX_TEAM_NOTE_LENGTH);
});
