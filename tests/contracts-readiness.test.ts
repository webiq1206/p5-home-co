import { test } from "node:test";
import assert from "node:assert/strict";

import {
  IDAHO_DISCLOSURE_THRESHOLD,
  getTemplate,
  preSendChecklist,
  summariseReadiness,
} from "../app/lib/contracts/index.ts";

const clientAgreement = getTemplate("client_construction_agreement")!;
const workOrder = getTemplate("subcontract_work_order")!;

function filled(template = clientAgreement) {
  const values: Record<string, string> = {};
  for (const f of template.fields) {
    if (f.required) values[f.key] = f.kind === "date" ? "2026-08-24" : "x";
  }
  return values;
}

const residentialJob = {
  residential: true,
  contractAmount: 120_000,
  idahoDisclosureDeliveredOn: "2026-08-20",
};

test("an owner-accepted contract can be sent without attorney approval", () => {
  // The owner decided to use these. The gate lets them through and says why.
  const r = preSendChecklist({
    template: clientAgreement, // owner_accepted
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: residentialJob,
  });
  assert.equal(r.canSend, true, summariseReadiness(r));
  const check = r.checks.find((c) => c.code === "attorney_review");
  assert.match(check!.fix, /without attorney review/i);
});

test("a complete, reviewed contract with its exhibits can be sent", () => {
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: residentialJob,
  });
  assert.equal(r.canSend, true, summariseReadiness(r));
});

test("an unreviewed contract cannot be sent, however complete it is", () => {
  // Forced back to unreviewed: P5's own templates are owner-accepted now, and
  // this test is about the gate, not about their current state.
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "unreviewed" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: residentialJob,
  });
  assert.equal(r.canSend, false);
  assert.ok(r.blocking.some((c) => c.code === "attorney_review"));
});

test("a missing plan set blocks the send", () => {
  // The plan set is what defines the scope. Sending without it is how "that is
  // not what we agreed" becomes unanswerable.
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit C"], // no plan set
    project: residentialJob,
  });
  assert.equal(r.canSend, false);
  assert.ok(r.blocking.some((c) => /Plan set/i.test(c.label)));
});

test("a missing required field blocks, and the fix names the field", () => {
  const values = filled();
  delete values.contract_amount;
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values,
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: residentialJob,
  });
  assert.equal(r.canSend, false);
  const check = r.blocking.find((c) => c.code === "required_fields");
  assert.match(check!.fix, /Contract price/);
});

// ---------------------------------------------------------------------------
// Prompts ask; they do not block. This distinction is the whole design.
// ---------------------------------------------------------------------------

test("an optional exhibit is asked about but never blocks", () => {
  const r = preSendChecklist({
    template: { ...workOrder, reviewState: "approved" },
    values: filled(workOrder),
    attachedExhibits: [],
  });
  assert.equal(r.canSend, true, "an absent bid must not stop a subcontract going out");
  assert.ok(r.unanswered.some((c) => /bid|proposal/i.test(c.label)));
});

test("a prompt is answered either by attaching or by saying there is none", () => {
  // A gate that blocks on things legitimately absent gets clicked through on
  // reflex, and then it is not a gate.
  const base = {
    template: { ...workOrder, reviewState: "approved" as const },
    values: filled(workOrder),
  };
  const code = "exhibit_optional_exhibit_a";

  const byAttaching = preSendChecklist({ ...base, attachedExhibits: ["Exhibit A"] });
  assert.equal(byAttaching.unanswered.length, 0);

  const bySaying = preSendChecklist({ ...base, attachedExhibits: [], acknowledged: [code] });
  assert.equal(bySaying.unanswered.length, 0);
});

// ---------------------------------------------------------------------------
// The Idaho disclosure, only where the law actually reaches.
// ---------------------------------------------------------------------------

test("residential work over the threshold cannot be sent without the disclosure", () => {
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: { ...residentialJob, idahoDisclosureDeliveredOn: null },
  });
  assert.equal(r.canSend, false);
  const check = r.blocking.find((c) => c.code === "idaho_disclosure");
  assert.match(check!.why, /cannot be corrected afterwards/);
});

test("commercial work is not blocked by a duty that does not apply to it", () => {
  // Demanding a disclosure the law does not require trains people to dismiss
  // the check, and then they dismiss the one that mattered.
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: { residential: false, contractAmount: 250_000, idahoDisclosureDeliveredOn: null },
  });
  assert.equal(r.canSend, true);
  assert.ok(r.checks.some((c) => c.code === "idaho_disclosure_na"));
});

test("small residential work falls under the threshold", () => {
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: {
      residential: true,
      contractAmount: IDAHO_DISCLOSURE_THRESHOLD - 1,
      idahoDisclosureDeliveredOn: null,
    },
  });
  assert.equal(r.canSend, true);
});

test("a job exactly at the threshold is covered, not excused", () => {
  // Boundaries are where these get argued. At the threshold, the duty applies.
  const r = preSendChecklist({
    template: { ...clientAgreement, reviewState: "approved" },
    values: filled(),
    attachedExhibits: ["Exhibit A", "Exhibit C"],
    project: {
      residential: true,
      contractAmount: IDAHO_DISCLOSURE_THRESHOLD,
      idahoDisclosureDeliveredOn: null,
    },
  });
  assert.equal(r.canSend, false);
});

// ---------------------------------------------------------------------------
// The summary is what reaches a person, so it has to say something.
// ---------------------------------------------------------------------------

test("the summary names what is wrong rather than counting problems", () => {
  const r = preSendChecklist({
    template: clientAgreement,
    values: {},
    attachedExhibits: [],
    project: { ...residentialJob, idahoDisclosureDeliveredOn: null },
  });
  const text = summariseReadiness(r);
  assert.match(text, /Cannot send/);
  assert.doesNotMatch(text, /^\d+ issues?$/, "a bare count makes somebody go and look");
  assert.ok(text.length > 40);
});

test("every check explains itself and names a next action", () => {
  const r = preSendChecklist({
    template: clientAgreement,
    values: {},
    attachedExhibits: [],
    project: residentialJob,
  });
  for (const c of r.checks) {
    assert.ok(c.why.length > 30, `${c.code}: why is too thin`);
    assert.ok(c.fix.length > 8, `${c.code}: fix is too thin`);
  }
});
