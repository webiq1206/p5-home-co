/**
 * Section: Procedures. Contracts, work orders, change orders and lien waivers.
 *
 * The document tables are generated from the template registry, so a template
 * added or changed in code shows up here without anybody remembering to update
 * the article.
 */

import { ALL_TEMPLATES, awaitingReview } from "../../contracts/index.ts";
import type { Article } from "../types.ts";

export const contracts: Article[] = [
  {
    slug: "contracts-and-documents",
    section: "procedures",
    title: "Contracts, work orders, change orders and lien waivers",
    summary:
      "Which document to use when, why subcontracts are split into two pieces, and the lien waiver rule that costs the most when it is got wrong.",
    lastVerified: "2026-08-23",
    keywords: [
      "contract",
      "subcontract",
      "work order",
      "change order",
      "lien waiver",
      "waiver",
      "conditional",
      "unconditional",
      "disclosure",
      "idaho",
      "45-525",
      "master agreement",
      "template",
    ],
    blocks: [
      {
        t: "p",
        text:
          "P5 issues the same handful of documents over and over. They live in one place so that no clause quietly differs between two jobs, and so that a document cannot go out with a blank left in it.",
      },
      {
        t: "callout",
        kind: "review",
        title: "None of these have been through a lawyer yet",
        text: `${awaitingReview().length} of ${ALL_TEMPLATES.length} templates are still marked unreviewed. They are good enough to hand to an attorney as a starting point - reviewing a finished draft costs far less than drafting from scratch - but nothing here should be signed, sent out or relied on until counsel has been through it. Every document produced from an unreviewed template prints that warning on its own face, so it cannot be mistaken for a finished one.`,
      },
      { t: "h", text: "Why a subcontract is two documents, not one" },
      {
        t: "p",
        text:
          "The long document - insurance, indemnity, payment terms, lien waivers, warranty - is the Master Subcontractor Agreement, and a subcontractor signs it ONCE, before their first job. After that, each job needs only a one-page Work Order naming the scope, the price and the dates.",
      },
      {
        t: "p",
        text:
          "This split exists for a practical reason. Nobody renegotiates indemnity language on a bathroom remodel, so if the full terms had to be signed per job, the realistic outcome is not careful negotiation - it is crews starting work with nothing signed at all. Signing the hard part once is what makes the easy part actually happen every time.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Before a subcontractor's first job",
        text:
          "Master Subcontractor Agreement signed, W-9 received, insurance certificate on file naming P5 as additional insured. All three are conditions of the first payment, and the vendor sits on payment hold until they are done.",
      },
      { t: "h", text: "Lien waivers: the one worth memorising" },
      {
        t: "p",
        text:
          "There are four waiver forms, and the difference between them is the most expensive piece of paperwork knowledge in residential construction. Two questions decide which one: is this the final payment, and has the money actually cleared?",
      },
      {
        t: "table",
        headers: ["", "Progress payment", "Final payment"],
        rows: [
          [
            "Payment has NOT cleared yet",
            "Conditional waiver on progress payment",
            "Conditional waiver on final payment",
          ],
          [
            "Payment HAS cleared",
            "Unconditional waiver on progress payment",
            "Unconditional waiver on final payment",
          ],
        ],
      },
      {
        t: "p",
        text:
          "A CONDITIONAL waiver only takes effect once the money actually arrives. An UNCONDITIONAL waiver gives up the lien right the moment it is signed, whether or not the payment ever clears.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "The trap, stated plainly",
        text:
          "Sign an unconditional waiver in exchange for a cheque, and the cheque bounces, and the lien right is gone anyway. That is why the form is chosen by the state of the payment and never by which one happens to be to hand. P5 sends conditional waivers with payment requests and collects unconditional ones only after the money has cleared the bank - not after it was sent, after it cleared.",
      },
      {
        t: "p",
        text:
          "A progress waiver also has to be bounded by a date. A waiver with no through-date waives everything, including work that has not been paid for yet. The final waiver needs no date because it covers everything by design.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "P5 picks the form",
        text:
          "The system chooses the waiver from the payment's actual state and says why. It is not possible to produce an unconditional waiver for a payment that has not cleared.",
      },
      { t: "h", text: "Lower-tier waivers, which are the ones people forget" },
      {
        t: "p",
        text:
          "A supplier that P5 has never dealt with, hired by our subcontractor, can still put a lien on our customer's house if our subcontractor does not pay them. The customer will hold P5 responsible for that, and reasonably so.",
      },
      {
        t: "p",
        text:
          "This is why the Master Agreement requires subcontractors to collect waivers from their own suppliers and produce them on request, and why final payment and retainage are not released until the lower-tier waivers are in.",
      },
      { t: "h", text: "Change orders" },
      {
        t: "p",
        text:
          "A change order records a change to scope, price or schedule, and is signed BEFORE the changed work happens. Signed afterwards it is not an agreement, it is a negotiation - and one conducted from a weak position, because the work is already done.",
      },
      {
        t: "p",
        text:
          "Two things about the P5 form are deliberate. The obligation runs both ways: P5 need not perform changed work without a signed order, and the customer need not pay for changed work done without one. A one-sided version reads as a trap and gets argued about; a mutual one gets signed. And the schedule effect is a required field, including when it is zero - a change order that moves the price but says nothing about time is how a builder ends up liable for a delay they were paid to cause.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Change orders and the daily QuickBooks check",
        text:
          "Approved change orders raise the contract value that the daily check measures billing against. Entering them is therefore what stops a perfectly legitimate invoice being flagged as over-billing.",
      },
      { t: "h", text: "The Idaho disclosure" },
      {
        t: "p",
        text:
          "Idaho Code section 45-525 requires a written disclosure to a residential owner before work begins, explaining that people who supply labour or materials can lien their property even if they have paid us in full, and what they can do to protect themselves.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Before work begins - and it cannot be fixed afterwards",
        text:
          "Deliver the disclosure and keep the signed acknowledgement. The date is the evidence, and late delivery is not something that can be corrected once the work has started. The project records the delivery date and cannot pass its start gate without it.",
      },
      { t: "h", text: "Every document in one place" },
      {
        t: "table",
        headers: ["Document", "What it is for", "Who signs it"],
        rows: ALL_TEMPLATES.map((t) => [
          t.title.replace(/\{\{.*?\}\}/g, "").trim(),
          t.purpose,
          t.signatures.map((s) => s.role).join(", "),
        ]),
      },
      { t: "h", text: "Common questions" },
      {
        t: "faq",
        items: [
          {
            q: "A subcontractor sent back the agreement with changes. What do I do?",
            a: "Look at whether the clauses they changed are marked as carrying risk - insurance, indemnity, lien waivers, the entire-agreement clause. Those are worth a call to counsel rather than a quick concession. Changes anywhere else are usually worth accepting to get a signature.",
          },
          {
            q: "Can I just send one of these to a customer now?",
            a: "Not yet. They have not been reviewed by an attorney, and any document produced from them prints that on its face. Send them to counsel first - that is the intended next step, and having complete drafts is what makes it a small job.",
          },
          {
            q: "Why won't it produce the document?",
            a: "A required field is empty, and it names which. This is a refusal rather than a warning on purpose: a subcontract that goes out reading 'retainage of ___ percent' looks signed and is unenforceable on exactly the term that gets argued about.",
          },
          {
            q: "The subcontractor says they'll sign the work order but not the master agreement.",
            a: "Then there is no agreement. The work order deliberately contains none of the insurance, indemnity or lien terms - it inherits them all from the master. Signed on its own it is a bare price quote with no protection behind it.",
          },
          {
            q: "Do we need a lien waiver from a materials supplier we pay directly?",
            a: "Yes. Anyone who furnishes labour or materials to the property can claim a lien, and being paid directly by us does not change that - only a waiver does.",
          },
        ],
      },
      {
        t: "links",
        title: "Where to go",
        items: [
          { label: "The documents themselves", href: "/admin/finance/contracts" },
          { label: "Subcontracts by job", href: "/admin/finance/subcontracts" },
          { label: "Vendor compliance and holds", href: "/admin/finance/vendors" },
        ],
      },
    ],
  },
];
