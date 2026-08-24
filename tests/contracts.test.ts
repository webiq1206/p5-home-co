import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_TEMPLATES,
  MissingFieldsError,
  awaitingReview,
  canIssue,
  changeOrder,
  chooseWaiver,
  conditionalFinalWaiver,
  conditionalProgressWaiver,
  getTemplate,
  masterSubcontractorAgreement,
  missingFields,
  renderDocument,
  unconditionalFinalWaiver,
  unconditionalProgressWaiver,
} from "../app/lib/contracts/index.ts";

/** Fills every required field with something plausible. */
function completeValues(template = masterSubcontractorAgreement) {
  const values: Record<string, string> = {};
  for (const field of template.fields) {
    if (!field.required) continue;
    values[field.key] =
      field.kind === "money" || field.kind === "number"
        ? "10"
        : field.kind === "date"
          ? "2026-08-23"
          : `value for ${field.key}`;
  }
  return values;
}

// ---------------------------------------------------------------------------
// The refusal. This is the behaviour the module exists for.
// ---------------------------------------------------------------------------

test("a document with an unfilled required field is refused, not rendered with a blank", () => {
  // A subcontract that goes out reading "retainage of ___ percent" looks signed
  // and is unenforceable on exactly the term that gets argued about.
  const values = completeValues();
  delete values.retainage_pct;

  assert.throws(
    () => renderDocument(masterSubcontractorAgreement, values),
    (error: unknown) => {
      assert.ok(error instanceof MissingFieldsError);
      assert.equal(error.missing.length, 1);
      assert.equal(error.missing[0].key, "retainage_pct");
      // The message has to name the field, or it cannot be acted on.
      assert.match(error.message, /Retainage percentage/);
      return true;
    },
  );
});

test("whitespace does not count as filling a field in", () => {
  const values = { ...completeValues(), sub_legal_name: "   " };
  assert.equal(missingFields(masterSubcontractorAgreement, values)[0]?.key, "sub_legal_name");
});

test("an optional field left empty renders as a blank line, not as a broken marker", () => {
  const values = completeValues(conditionalProgressWaiver);
  delete values.disputed_claims; // optional
  const doc = renderDocument(conditionalProgressWaiver, values);
  const reservations = doc.clauses.find((c) => c.heading === "Reservations");
  assert.ok(reservations);
  assert.match(reservations.body, /________/);
  assert.doesNotMatch(reservations.body, /\{\{/);
});

test("every template renders once its required fields are filled", () => {
  // Catches a clause referencing a field the template never declared, which
  // would otherwise ship "{{owner_name}}" to a customer.
  for (const template of ALL_TEMPLATES) {
    assert.doesNotThrow(
      () => renderDocument(template, completeValues(template)),
      `${template.key} failed to render`,
    );
  }
});

test("no rendered document ever contains an unsubstituted marker", () => {
  for (const template of ALL_TEMPLATES) {
    const doc = renderDocument(template, completeValues(template));
    for (const clause of doc.clauses) {
      assert.doesNotMatch(clause.body, /\{\{/, `${template.key} / ${clause.heading}`);
    }
    assert.doesNotMatch(doc.title, /\{\{/, `${template.key} title`);
  }
});

// ---------------------------------------------------------------------------
// Formatting. A contract is not the place for a raw number.
// ---------------------------------------------------------------------------

test("money and dates are formatted for a document, not printed raw", () => {
  const doc = renderDocument(changeOrder, {
    ...completeValues(changeOrder),
    price_change: 4200,
    change_date: "2026-08-23",
  });
  const price = doc.clauses.find((c) => c.heading === "Effect on the price");
  assert.match(price!.body, /\$4,200\.00/);

  const header = doc.clauses.find((c) => c.heading === "Change order");
  assert.match(header!.body, /August 23, 2026/);
});

test("an unparseable date is left alone rather than silently becoming today", () => {
  // Quietly stamping today's date on a contract is a forgery, not a fallback.
  const doc = renderDocument(changeOrder, {
    ...completeValues(changeOrder),
    change_date: "sometime next spring",
  });
  const header = doc.clauses.find((c) => c.heading === "Change order");
  assert.match(header!.body, /sometime next spring/);
});

test("a negative change order renders as a credit rather than as a mistake", () => {
  const doc = renderDocument(changeOrder, {
    ...completeValues(changeOrder),
    price_change: -1500,
  });
  const price = doc.clauses.find((c) => c.heading === "Effect on the price");
  assert.match(price!.body, /-\$1,500\.00/);
});

// ---------------------------------------------------------------------------
// The attorney-review gate.
// ---------------------------------------------------------------------------

test("an unreviewed template is watermarked on the document itself", () => {
  // On the document, not in the interface: the document is what gets emailed,
  // printed and signed, and by then whatever the screen said is long gone.
  const doc = renderDocument(masterSubcontractorAgreement, completeValues());
  assert.ok(doc.draftWatermark);
  assert.match(doc.draftWatermark, /NOT REVIEWED BY AN ATTORNEY/);
});

test("an unreviewed template cannot be issued, and the refusal explains why", () => {
  const verdict = canIssue(masterSubcontractorAgreement);
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.length > 40, "a bare no teaches nobody anything");
});

test("only a counsel-approved template may be issued", () => {
  const approved = { ...changeOrder, reviewState: "approved" as const, reviewedOn: "2026-09-01" };
  assert.equal(canIssue(approved).allowed, true);
  assert.equal(renderDocument(approved, completeValues(changeOrder)).draftWatermark, null);

  const inReview = { ...changeOrder, reviewState: "in_review" as const };
  assert.equal(canIssue(inReview).allowed, false);
  assert.match(renderDocument(inReview, completeValues(changeOrder)).draftWatermark!, /Not to be signed/);
});

test("every template currently ships unreviewed, and says so", () => {
  // If this ever fails, it is because somebody marked a template approved.
  // That is a real event: it means counsel signed off, and the reviewer and
  // date must be recorded alongside it.
  for (const template of awaitingReview()) {
    assert.notEqual(template.reviewState, "approved");
  }
  assert.equal(awaitingReview().length, ALL_TEMPLATES.length);
});

// ---------------------------------------------------------------------------
// Lien waivers: the choice is made from the facts, never from what is to hand.
// ---------------------------------------------------------------------------

test("the waiver type follows the payment state, not convenience", () => {
  assert.equal(
    chooseWaiver({ isFinalPayment: false, paymentHasCleared: false }).template.key,
    conditionalProgressWaiver.key,
  );
  assert.equal(
    chooseWaiver({ isFinalPayment: false, paymentHasCleared: true }).template.key,
    unconditionalProgressWaiver.key,
  );
  assert.equal(
    chooseWaiver({ isFinalPayment: true, paymentHasCleared: false }).template.key,
    conditionalFinalWaiver.key,
  );
  assert.equal(
    chooseWaiver({ isFinalPayment: true, paymentHasCleared: true }).template.key,
    unconditionalFinalWaiver.key,
  );
});

test("an uncleared payment never produces an unconditional waiver", () => {
  // This is the trap the whole module exists to close: an unconditional waiver
  // given against a cheque that bounces gives up the lien right for nothing.
  for (const isFinalPayment of [true, false]) {
    const { template } = chooseWaiver({ isFinalPayment, paymentHasCleared: false });
    assert.match(template.key, /conditional/);
    assert.doesNotMatch(template.key, /unconditional/);
  }
});

test("every waiver choice explains itself", () => {
  for (const isFinalPayment of [true, false]) {
    for (const paymentHasCleared of [true, false]) {
      const { because } = chooseWaiver({ isFinalPayment, paymentHasCleared });
      assert.ok(because.length > 30);
    }
  }
});

test("a conditional waiver says it depends on payment; an unconditional one warns", () => {
  const conditional = renderDocument(
    conditionalProgressWaiver,
    completeValues(conditionalProgressWaiver),
  );
  const conditionalClause = conditional.clauses.find((c) => c.heading.includes("Conditional"));
  assert.match(conditionalClause!.body, /only when the payment described above has actually been received/);

  const unconditional = renderDocument(
    unconditionalProgressWaiver,
    completeValues(unconditionalProgressWaiver),
  );
  const unconditionalClause = unconditional.clauses.find((c) => c.heading.includes("Unconditional"));
  assert.match(unconditionalClause!.body, /whether or not any payment is actually received/);
  assert.match(unconditionalClause!.body, /cleared the bank/);
});

test("a progress waiver is bounded by a date; a final waiver is not", () => {
  // An undated progress waiver waives everything, including work not yet paid for.
  const throughDate = conditionalProgressWaiver.fields.find((f) => f.key === "through_date");
  assert.ok(throughDate?.required, "a progress waiver must be bounded by a date");
  assert.ok(!conditionalFinalWaiver.fields.some((f) => f.key === "through_date"));
});

// ---------------------------------------------------------------------------
// Registry hygiene.
// ---------------------------------------------------------------------------

test("template keys are unique and resolvable", () => {
  const keys = ALL_TEMPLATES.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.ok(getTemplate(key));
  assert.equal(getTemplate("no_such_template"), null);
});

test("every template says what it is for and who signs it", () => {
  for (const t of ALL_TEMPLATES) {
    assert.ok(t.purpose.length > 40, `${t.key}: purpose is too thin`);
    assert.ok(t.signatures.length >= 2, `${t.key}: needs at least two signatories`);
    assert.ok(t.clauses.length > 0, `${t.key}: has no clauses`);
  }
});

test("every load-bearing clause explains why it is load-bearing", () => {
  // These are the clauses to escalate rather than concede on a redline, and
  // "it is important" is not something anyone can negotiate against.
  for (const t of ALL_TEMPLATES) {
    for (const clause of t.clauses.filter((c) => c.loadBearing)) {
      assert.ok(
        clause.rationale && clause.rationale.length > 30,
        `${t.key} / ${clause.heading}: a load-bearing clause needs its reason recorded`,
      );
    }
  }
});

test("documents that exist because of a law record which law", () => {
  for (const t of ALL_TEMPLATES) {
    if (t.category === "waiver" || t.category === "disclosure") {
      assert.ok(t.statute, `${t.key}: must record the statute it satisfies`);
    }
  }
});

test("the work order inherits from the master agreement rather than restating it", () => {
  // Renegotiating indemnity on every kitchen is how subcontracts stop getting
  // signed at all.
  const workOrder = getTemplate("subcontract_work_order")!;
  const headings = workOrder.clauses.map((c) => c.heading).join(" ");
  assert.doesNotMatch(headings, /Indemnity|Insurance/);
  assert.match(workOrder.clauses[0].body, /Master Subcontractor Agreement/);
});

// ---------------------------------------------------------------------------
// Rules set by the owner, 2026-08-24. Each one is here because a document that
// breaks it fails in a way nobody notices until it matters.
// ---------------------------------------------------------------------------

test("every project document carries the property address", () => {
  // The address is what ties the paperwork to the land. A lien waiver or change
  // order that does not name the property may not attach to it at all.
  for (const t of ALL_TEMPLATES) {
    if (!t.projectSpecific) continue;
    const address = t.fields.find((f) => f.key === "property_address");
    assert.ok(address, `${t.key}: project documents must have a property_address field`);
    assert.ok(address.required, `${t.key}: the property address cannot be optional`);
    const body = t.clauses.map((c) => c.body).join(" ");
    assert.match(body, /{{property_address}}/, `${t.key}: address is never printed`);
  }
});

test("a document signed once per party is not marked project specific", () => {
  // The master agreement covers every future job, so tying it to one address
  // would be wrong - and would force a new signature per job, which is exactly
  // what splitting it into master plus work order exists to avoid.
  const master = getTemplate("master_subcontractor_agreement");
  assert.equal(master?.projectSpecific, false);
  assert.ok(!master?.fields.some((f) => f.key === "property_address"));
});

test("no contract text contains an em dash or en dash", () => {
  // Owner's instruction. They also have no glyph in the PDF base font, so any
  // that slipped through would be silently substituted at render time.
  for (const t of ALL_TEMPLATES) {
    const text = [t.title, t.purpose, ...t.clauses.flatMap((c) => [c.heading, c.body])].join(" ");
    assert.doesNotMatch(text, /[–—]/, `${t.key}: contains an em or en dash`);
    for (const ex of t.exhibits ?? []) {
      assert.doesNotMatch(`${ex.name} ${ex.purpose}`, /[–—]/, `${t.key}: exhibit text`);
    }
    for (const note of t.issuingNotes ?? []) {
      assert.doesNotMatch(note, /[–—]/, `${t.key}: issuing note`);
    }
  }
});

test("the documents that take job-specific attachments declare them", () => {
  // Plan sets and subcontractor bids cannot live in a reusable template, so the
  // only way a preparer knows to attach one is the exhibit list on the page.
  const client = getTemplate("client_construction_agreement");
  const planSet = client?.exhibits?.find((e) => /plan set/i.test(e.name));
  assert.ok(planSet, "the client agreement must expect a plan set");
  assert.ok(planSet.required, "the plan set defines the scope; it is not optional");

  const workOrder = getTemplate("subcontract_work_order");
  assert.ok(
    workOrder?.exhibits?.some((e) => /bid|proposal/i.test(e.name)),
    "the work order must allow the subcontractor's bid to be attached",
  );
});

test("every exhibit says whether it is required and why it is there", () => {
  for (const t of ALL_TEMPLATES) {
    for (const ex of t.exhibits ?? []) {
      assert.match(ex.label, /^Exhibit [A-Z]$/, `${t.key}: ${ex.label}`);
      assert.ok(ex.purpose.length > 40, `${t.key}/${ex.label}: purpose is too thin`);
      assert.equal(typeof ex.required, "boolean");
    }
  }
});
