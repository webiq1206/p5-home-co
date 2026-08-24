/**
 * Lien waivers (S215).
 *
 * Four documents, and the difference between them is the single most expensive
 * piece of paperwork knowledge in residential construction:
 *
 *                  | Progress (partial)        | Final
 *   ---------------+---------------------------+---------------------------
 *   Conditional    | Give BEFORE payment       | Give BEFORE final payment
 *   Unconditional  | Give AFTER payment clears | Give AFTER final clears
 *
 * A CONDITIONAL waiver only takes effect once the money actually arrives. An
 * UNCONDITIONAL waiver gives up the lien right immediately, whether or not the
 * cheque ever clears. Sign an unconditional waiver in exchange for a cheque
 * that bounces and the lien right is gone anyway - that is the whole trap, and
 * it is why the type is chosen by the state of the payment and never by which
 * form happened to be to hand.
 *
 * IDAHO HAS NO STATUTORY FORM. Unlike California, Texas, Arizona and others,
 * Idaho does not prescribe waiver language, so these are contract documents
 * whose effect depends on their own wording. That makes attorney review more
 * important here, not less: there is no statutory safe harbour to fall back on
 * if the wording is wrong.
 */

import type { DocumentTemplate, TemplateField } from "./types.ts";

const claimant: TemplateField[] = [
  {
    key: "claimant_name",
    label: "Claimant (who is giving up the lien right)",
    kind: "text",
    required: true,
    help: "The legal name of the subcontractor or supplier, exactly as on their W-9.",
    source: "Vendor record",
  },
  {
    key: "customer_name",
    label: "Customer / owner",
    kind: "text",
    required: true,
    source: "Project's parent customer",
  },
  {
    key: "property_address",
    label: "Property address",
    kind: "text",
    required: true,
    help: "The job site. A waiver that does not identify the property may not attach to it.",
    source: "Project record",
  },
  {
    key: "job_reference",
    label: "Job reference",
    kind: "text",
    required: true,
    source: "Project P5 number",
  },
  {
    key: "subcontract_reference",
    label: "Subcontract / work order reference",
    kind: "text",
    required: true,
    help: "The work order this payment is made under, for example SC-001. It is what ties the waiver to the scope and the agreed price.",
    source: "Subcontract record",
  },
  {
    key: "master_agreement_date",
    label: "Master Subcontractor Agreement dated",
    kind: "date",
    required: false,
    help: "Leave blank for a supplier with no master agreement.",
    source: "Vendor record",
  },
];

const signature = [
  { role: "Claimant", nameField: "claimant_name" },
  { role: "Title" },
  { role: "Date" },
];

/** Shared warning language, so the four forms cannot drift apart. */
const CONDITIONAL_EFFECT =
  "This waiver is CONDITIONAL. It becomes effective only when the payment described above " +
  "has actually been received and has cleared. If that payment is not received, or is " +
  "received and does not clear, this document is of no effect and the claimant's lien and " +
  "bond rights remain in full force.";

const UNCONDITIONAL_EFFECT =
  "This waiver is UNCONDITIONAL and effective immediately upon signing. The claimant is " +
  "giving up lien and bond rights for the amounts described above whether or not any " +
  "payment is actually received or clears. The claimant should not sign this document " +
  "until the payment described has been received and has cleared the bank.";

const IDAHO_NOTE =
  "Idaho does not prescribe a statutory lien waiver form. The effect of this document " +
  "depends entirely on its own wording and on Idaho Code Title 45, Chapter 5.";

function waiver(spec: {
  key: string;
  title: string;
  purpose: string;
  conditional: boolean;
  final: boolean;
}): DocumentTemplate {
  const amountFields: TemplateField[] = spec.final
    ? [
        {
          key: "final_amount",
          label: "Final payment amount",
          kind: "money",
          required: true,
          help: "The final payment, including any retainage being released.",
        },
      ]
    : [
        {
          key: "payment_amount",
          label: "Payment amount",
          kind: "money",
          required: true,
        },
        {
          key: "through_date",
          label: "Covering work through",
          kind: "date",
          required: true,
          help: "Work after this date is NOT waived. Getting it wrong waives work not yet paid for.",
        },
      ];

  const scope = spec.final
    ? `The claimant has been paid, or upon clearing of the payment described will have been paid, ` +
      `in full for all labour, services, equipment and materials furnished to the property at ` +
      `{{property_address}} in connection with job {{job_reference}}, in the final amount of {{final_amount}}.`
    : `The claimant has been paid, or upon clearing of the payment described will have been paid, ` +
      `the sum of {{payment_amount}} for labour, services, equipment and materials furnished to the ` +
      `property at {{property_address}} in connection with job {{job_reference}} THROUGH ` +
      `{{through_date}} only.`;

  const reservation = spec.final
    ? "The claimant reserves no further claim against the property, except for disputed claims " +
      "expressly identified below, if any: {{disputed_claims}}"
    : "This waiver covers only the work and materials described above and only through the date " +
      "stated. It does not waive any right relating to work performed, or materials supplied, " +
      "after that date, nor to retainage not yet released, nor to any claim expressly identified " +
      "below: {{disputed_claims}}";

  return {
    key: spec.key,
    title: spec.title,
    purpose: spec.purpose,
    category: "waiver",
    reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
    // A waiver that does not name the property may not attach to it.
    projectSpecific: true,
    statute: "Idaho Code Title 45, Chapter 5 (mechanics' and materialmen's liens)",
    fields: [
      ...claimant,
      ...amountFields,
      {
        key: "disputed_claims",
        label: "Claims expressly excluded",
        kind: "multiline",
        required: false,
        help: "Anything the claimant is NOT waiving. Leave empty if nothing is in dispute.",
      },
    ],
    clauses: [
      {
        heading: "Identification",
        body:
          `Claimant: {{claimant_name}}\nCustomer / owner: {{customer_name}}\n` +
          `Property: {{property_address}}\nJob: {{job_reference}}`,
      },
      {
        heading: spec.final ? "Final payment and waiver" : "Progress payment and waiver",
        body: scope,
        rationale:
          "The amount and the through-date are what bound the waiver. A waiver with no date bound waives everything, including work not yet paid for.",
        loadBearing: true,
      },
      {
        heading: spec.conditional ? "Conditional - effective on payment" : "Unconditional - effective now",
        body: spec.conditional ? CONDITIONAL_EFFECT : UNCONDITIONAL_EFFECT,
        rationale:
          "This is the entire difference between the four waiver forms. An unconditional waiver given before payment clears gives up the lien right for nothing.",
        loadBearing: true,
      },
      {
        heading: "Reservations",
        body: reservation,
        rationale:
          "What the claimant is NOT giving up. Without an explicit carve-out, a disputed extra can be argued to have been waived along with everything else in the same signature.",
        loadBearing: true,
      },
      {
        heading: "Signature authority",
        body:
          "The person signing represents that they are authorised to sign on behalf of the " +
          "claimant and to waive the rights described.",
      },
      { heading: "Governing law", body: IDAHO_NOTE },
    ],
    signatures: signature,
    issuingNotes: spec.conditional
      ? [
          "Send this one BEFORE paying. It costs the subcontractor nothing, because it only takes effect once the money clears.",
          "If a subcontractor refuses a conditional waiver, that is worth understanding before the payment goes out.",
        ]
      : [
          "Only collect this AFTER the payment has cleared the bank. Not after it is sent - after it clears.",
          "Collecting an unconditional waiver against an uncleared payment is the mistake this whole form exists to prevent.",
        ],
  };
}

export const conditionalProgressWaiver = waiver({
  key: "waiver_conditional_progress",
  title: "Conditional Waiver and Release on Progress Payment",
  purpose:
    "Given to a subcontractor with a progress payment. Takes effect only once that payment clears.",
  conditional: true,
  final: false,
});

export const unconditionalProgressWaiver = waiver({
  key: "waiver_unconditional_progress",
  title: "Unconditional Waiver and Release on Progress Payment",
  purpose:
    "Collected from a subcontractor AFTER a progress payment has cleared. Effective immediately.",
  conditional: false,
  final: false,
});

export const conditionalFinalWaiver = waiver({
  key: "waiver_conditional_final",
  title: "Conditional Waiver and Release on Final Payment",
  purpose:
    "Given with the final payment, including retainage. Takes effect only once that payment clears.",
  conditional: true,
  final: true,
});

export const unconditionalFinalWaiver = waiver({
  key: "waiver_unconditional_final",
  title: "Unconditional Waiver and Release on Final Payment",
  purpose:
    "Collected AFTER the final payment has cleared. Closes out the subcontractor's lien rights entirely.",
  conditional: false,
  final: true,
});

export const lienWaivers: DocumentTemplate[] = [
  conditionalProgressWaiver,
  unconditionalProgressWaiver,
  conditionalFinalWaiver,
  unconditionalFinalWaiver,
];

/**
 * Which waiver to use, decided by the facts rather than by what is to hand.
 *
 * This exists because the choice is the part people get wrong, and getting it
 * wrong is only discovered when a lien appears on a customer's house months
 * later.
 */
export function chooseWaiver(input: {
  isFinalPayment: boolean;
  paymentHasCleared: boolean;
}): { template: DocumentTemplate; because: string } {
  const { isFinalPayment, paymentHasCleared } = input;

  if (isFinalPayment) {
    return paymentHasCleared
      ? {
          template: unconditionalFinalWaiver,
          because:
            "The final payment has cleared, so the subcontractor can safely give up the right outright.",
        }
      : {
          template: conditionalFinalWaiver,
          because:
            "The final payment has not cleared yet, so the waiver must depend on it arriving.",
        };
  }

  return paymentHasCleared
    ? {
        template: unconditionalProgressWaiver,
        because:
          "This progress payment has cleared, so the waiver for that amount can be unconditional.",
      }
    : {
        template: conditionalProgressWaiver,
        because:
          "This progress payment has not cleared yet, so the waiver must depend on it arriving.",
      };
}
