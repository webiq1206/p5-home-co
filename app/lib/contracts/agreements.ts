/**
 * The agreements P5 issues (S215).
 *
 * Structured as a master agreement plus per-job work orders, which is the
 * arrangement that actually holds up on a small builder's volume: the long
 * document with the insurance, indemnity and payment terms is signed ONCE per
 * subcontractor, and each job then needs only a one-page work order naming the
 * scope, price and schedule. Negotiating indemnity language on every kitchen is
 * how subcontracts stop getting signed at all.
 *
 * Every clause marked `loadBearing` is one that decides who pays when something
 * goes wrong. Those are the ones to escalate rather than concede when a
 * subcontractor sends back a redline.
 */

import { P5_STANDING } from "./standing.ts";
import type { DocumentTemplate } from "./types.ts";

// ---------------------------------------------------------------------------
// Master Subcontractor Agreement - signed once per subcontractor
// ---------------------------------------------------------------------------

export const masterSubcontractorAgreement: DocumentTemplate = {
  key: "master_subcontractor_agreement",
  title: "Master Subcontractor Agreement",
  purpose:
    "Signed once by each subcontractor, before their first job. Sets insurance, payment, indemnity and lien terms for every job that follows.",
  category: "subcontractor",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  // Signed once per subcontractor, so it is deliberately NOT tied to a job.
  projectSpecific: false,
  statute:
    "Idaho Code Title 54, Chapter 52 (contractor registration); Title 45, Chapter 5 (liens); Title 72 (workers' compensation)",
  fields: [
    { key: "sub_legal_name", label: "Subcontractor legal name", kind: "text", required: true, help: "Exactly as written on their W-9.", source: "Vendor record" },
    { key: "sub_address", label: "Subcontractor address", kind: "text", required: true, source: "Vendor record" },
    { key: "sub_registration", label: "Idaho contractor registration number", kind: "text", required: true, help: "Idaho requires registration to perform most construction work. No number, no work." },
    { key: "effective_date", label: "Effective date", kind: "date", required: true },
    { key: "retainage_pct", label: "Retainage percentage", kind: "number", required: true, help: "Held back from each payment until final completion.", source: "Finance settings" },
    { key: "payment_days", label: "Payment days after approved invoice", kind: "number", required: true, defaultValue: P5_STANDING.subcontractorPaymentDays, help: "Standing P5 term, not per subcontractor." },
    { key: "gl_limit", label: "General liability minimum, each occurrence", kind: "money", required: true },
    { key: "auto_limit", label: "Commercial auto minimum", kind: "money", required: true },
    { key: "wc_note", label: "Workers' compensation requirement", kind: "multiline", required: false },
    { key: "warranty_months", label: "Warranty period, months", kind: "number", required: true, defaultValue: P5_STANDING.constructionWarrantyMonths, help: "Standing P5 term." },
  ],
  clauses: [
    {
      heading: "1. Parties and scope of this agreement",
      body:
        "This Master Subcontractor Agreement is made effective {{effective_date}} between P5 Home Co. LLC " +
        "(\"Contractor\") and {{sub_legal_name}} of {{sub_address}} (\"Subcontractor\"), Idaho contractor " +
        "registration number {{sub_registration}}.\n\n" +
        "This agreement does not itself commit either party to any particular work. It sets the terms that " +
        "apply to every Work Order issued under it. Each Work Order describes the scope, price and schedule " +
        "for one job and is governed by this agreement.",
      rationale:
        "Separating the terms from the work is what makes it realistic to get a signed subcontract on every job.",
      loadBearing: true,
    },
    {
      heading: "2. Registration and licensing",
      body:
        "Subcontractor represents that it is registered with the Idaho Contractors Board and holds every " +
        "licence its trade requires, and will keep them current for the whole term. Subcontractor will notify " +
        "Contractor in writing within five days if any registration or licence lapses, is suspended or is revoked.\n\n" +
        "Work performed while unregistered is a material breach.",
      rationale:
        "Idaho requires contractor registration. Work by an unregistered subcontractor creates exposure for P5 and can affect the customer's own remedies.",
      loadBearing: true,
    },
    {
      heading: "3. Insurance",
      body:
        "Before beginning any work and continuously thereafter, Subcontractor will maintain at its own expense:\n\n" +
        "(a) Commercial General Liability of not less than {{gl_limit}} each occurrence, naming P5 Home Co. LLC " +
        "as additional insured on a primary and non-contributory basis;\n" +
        "(b) Commercial Automobile Liability of not less than {{auto_limit}} combined single limit;\n" +
        "(c) Workers' Compensation as required by Idaho law, with a waiver of subrogation in favour of " +
        "Contractor. {{wc_note}}\n\n" +
        "Subcontractor will provide certificates evidencing this coverage before starting work and upon each " +
        "renewal. Contractor may withhold payment while any required coverage is not evidenced as current.",
      rationale:
        "This is the clause that decides who pays when somebody is hurt on site. The additional-insured and waiver-of-subrogation language is the part that actually transfers risk; a bare certificate does not.",
      loadBearing: true,
    },
    {
      heading: "4. Payment",
      body:
        "Contractor will pay approved invoices within {{payment_days}} days of approval, less retainage of " +
        "{{retainage_pct}} percent. Retainage is released after final completion of the Work Order, receipt of " +
        "all required lien waivers, and correction of any punch list items.\n\n" +
        "Contractor may withhold payment, in an amount reasonably related to the problem, for defective work, " +
        "for failure to provide required documents, or for claims made against the property arising from " +
        "Subcontractor's work or its lower-tier subcontractors and suppliers.",
      rationale:
        "Withholding must be tied to a reason and proportionate. An unlimited right to withhold tends not to survive a challenge and sours the relationship in the meantime.",
      loadBearing: true,
    },
    {
      heading: "5. Lien waivers",
      body:
        "With each payment request, Subcontractor will provide a conditional lien waiver for the amount " +
        "requested, and an unconditional lien waiver for all amounts previously paid and cleared. Subcontractor " +
        "will obtain equivalent waivers from its own subcontractors and suppliers and provide them on request.\n\n" +
        "Final payment and retainage will not be released until unconditional final waivers are received from " +
        "Subcontractor and from every lower-tier party who has furnished labour or materials.",
      rationale:
        "Lower-tier waivers are the ones people forget. A supplier P5 never dealt with can lien the customer's house, and the customer will hold P5 responsible for it.",
      loadBearing: true,
    },
    {
      heading: "6. Indemnity",
      body:
        "To the fullest extent permitted by Idaho law, Subcontractor will indemnify, defend and hold harmless " +
        "Contractor and the property owner from claims, damages, losses and expenses, including reasonable " +
        "legal fees, arising out of Subcontractor's work, but only to the extent caused by the negligent or " +
        "wrongful acts or omissions of Subcontractor or anyone for whose acts it is responsible.\n\n" +
        "This clause does not require Subcontractor to indemnify anyone for that person's own sole negligence.",
      rationale:
        "The comparative-fault limit is deliberate. Idaho restricts indemnity for one's own negligence in construction contracts, and an over-broad clause risks being unenforceable in full rather than merely trimmed.",
      loadBearing: true,
    },
    {
      heading: "7. Independent contractor",
      body:
        "Subcontractor is an independent contractor, not an employee, agent or partner of Contractor. " +
        "Subcontractor controls the means and methods of its work, supplies its own tools and materials except " +
        "as a Work Order states otherwise, and is responsible for its own taxes, insurance and personnel.\n\n" +
        "Subcontractor will furnish a completed Form W-9 before its first payment.",
      rationale:
        "Worker classification is examined by how the relationship actually runs, not only by what the contract says - but a contract saying the opposite of the facts is worse than useless.",
      loadBearing: true,
    },
    {
      heading: "8. Warranty",
      body:
        "Subcontractor warrants its work against defects in workmanship and materials for {{warranty_months}} " +
        "months from substantial completion of each Work Order, and will correct defective work at its own " +
        "expense within a reasonable time of written notice. This warranty is in addition to, not instead of, " +
        "any warranty implied by law.",
    },
    {
      heading: "9. Safety",
      body:
        "Subcontractor is responsible for the safety of its own personnel and for compliance with all " +
        "applicable safety laws and regulations. Subcontractor will immediately report to Contractor any " +
        "injury, near miss or unsafe condition on the job site.",
    },
    {
      heading: "10. Schedule and delay",
      body:
        "Subcontractor will perform each Work Order in accordance with the schedule stated in it and will " +
        "cooperate with other trades. Subcontractor will give prompt written notice of any circumstance likely " +
        "to delay the work.",
    },
    {
      heading: "11. Termination",
      body:
        "Contractor may terminate a Work Order for cause upon written notice if Subcontractor fails to cure a " +
        "material breach within five days of notice, and may terminate for convenience upon written notice, in " +
        "which case Subcontractor is paid for work properly performed to the date of termination.",
    },
    {
      heading: "12. Confidentiality and customer relations",
      body:
        "Subcontractor will not contact Contractor's customer about scope, price, change orders or payment " +
        "except through Contractor, and will not use the customer's name or images of the work for marketing " +
        "without Contractor's written consent.",
      rationale:
        "A subcontractor negotiating directly with the homeowner is how a change order gets promised that P5 never priced and cannot bill.",
    },
    {
      heading: "13. Governing law and disputes",
      body:
        "This agreement is governed by the laws of the State of Idaho. Venue for any dispute is Ada County, " +
        "Idaho. The parties will attempt to resolve disputes by direct discussion before commencing any " +
        "proceeding.",
    },
    {
      heading: "14. Entire agreement",
      body:
        "This agreement, together with each Work Order issued under it, is the entire agreement between the " +
        "parties on its subject. It may be amended only in writing signed by both parties. Terms printed on " +
        "Subcontractor's invoices or acknowledgements have no effect.",
      rationale:
        "Without the last sentence, a subcontractor's standard invoice terms can quietly override the ones negotiated here.",
      loadBearing: true,
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Subcontractor", nameField: "sub_legal_name" },
  ],
  issuingNotes: [
    "Signed once per subcontractor, before their first job - not once per job.",
    "Collect the W-9 and the insurance certificate with it. Both are conditions of the first payment.",
  ],
};

// ---------------------------------------------------------------------------
// Work Order - one per job, under the master agreement
// ---------------------------------------------------------------------------

export const subcontractWorkOrder: DocumentTemplate = {
  key: "subcontract_work_order",
  title: "Subcontract Work Order {{work_order_number}}",
  purpose:
    "One page per job. Names the scope, price and schedule; every other term comes from the Master Subcontractor Agreement.",
  category: "subcontractor",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  exhibits: [
    {
      label: "Exhibit A",
      name: "Subcontractor's bid or proposal",
      required: false,
      purpose:
        "Attach the bid the price came from and have it initialled. When a subcontractor later says the scope meant something else, the document they wrote is the answer.",
    },
  ],
  fields: [
    { key: "work_order_number", label: "Work order number", kind: "text", required: true, source: "Subcontract reference" },
    { key: "sub_legal_name", label: "Subcontractor", kind: "text", required: true, source: "Vendor record" },
    { key: "master_date", label: "Master agreement dated", kind: "date", required: true },
    { key: "job_reference", label: "Job", kind: "text", required: true, source: "Project P5 number" },
    { key: "property_address", label: "Property address", kind: "text", required: true, source: "Project record" },
    { key: "scope", label: "Scope of work", kind: "multiline", required: true, help: "What is included AND what is excluded. Most disputes are about the exclusions." },
    { key: "exclusions", label: "Exclusions", kind: "multiline", required: false },
    { key: "contract_amount", label: "Subcontract amount", kind: "money", required: true, source: "Subcontract record" },
    { key: "retainage_pct", label: "Retainage percentage", kind: "number", required: true, source: "Subcontract record" },
    { key: "start_date", label: "Start date", kind: "date", required: true },
    { key: "completion_date", label: "Substantial completion date", kind: "date", required: true },
  ],
  clauses: [
    {
      heading: "Work order",
      body:
        "This Work Order is issued under the Master Subcontractor Agreement between P5 Home Co. LLC and " +
        "{{sub_legal_name}} dated {{master_date}}, and is governed entirely by its terms.",
      rationale:
        "The sentence that carries every term of the master agreement onto this job. Without it, this page is a bare price quote with no insurance, indemnity or lien terms behind it.",
      loadBearing: true,
    },
    {
      heading: "Job",
      body: "Job: {{job_reference}}\nProperty: {{property_address}}",
    },
    {
      heading: "Scope of work",
      body: "{{scope}}",
      rationale: "The single most argued-about part of any subcontract.",
      loadBearing: true,
    },
    {
      heading: "Specifically excluded",
      body:
        "The following are NOT included and remain the responsibility of others: {{exclusions}}\n\n" +
        "Anything not listed in the scope above is excluded.",
      rationale:
        "The last sentence closes the gap. Without it, silence about an item gets argued as inclusion.",
      loadBearing: true,
    },
    {
      heading: "Price",
      body:
        "Subcontract amount: {{contract_amount}}, subject to retainage of {{retainage_pct}} percent.\n\n" +
        "This is the complete price for the scope described. No additional amount is payable without a " +
        "Change Order signed by P5 Home Co. LLC before the additional work is performed.",
      rationale:
        "\"Signed before the work is performed\" is what stops a bill arriving for work nobody authorised.",
      loadBearing: true,
    },
    {
      heading: "Schedule",
      body: "Start: {{start_date}}\nSubstantial completion: {{completion_date}}",
    },
    {
      heading: "Payment and waivers",
      body:
        "Payment terms, retainage release and lien waiver requirements are as set out in the Master " +
        "Subcontractor Agreement. A conditional lien waiver must accompany every payment request.",
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Subcontractor", nameField: "sub_legal_name" },
  ],
  issuingNotes: [
    "Must be signed BEFORE the crew starts. An unsigned work order with work under way is flagged by the daily QuickBooks check.",
    "Creating this in P5 also creates the purchase order in QuickBooks, which is what makes the commitment visible on the job budget.",
  ],
};

// ---------------------------------------------------------------------------
// Client construction agreement
// ---------------------------------------------------------------------------

export const clientConstructionAgreement: DocumentTemplate = {
  key: "client_construction_agreement",
  title: "Residential Construction Agreement",
  purpose:
    "The agreement between P5 and the homeowner. Covers scope, price, payment schedule, changes and warranty.",
  category: "client",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  exhibits: [
    {
      label: "Exhibit A",
      name: "Plan set and drawings",
      required: true,
      purpose:
        "The plan set is what actually defines the scope. Initialled alongside this agreement, it turns a later dispute about what was agreed into a question of reading the drawing the customer signed.",
    },
    {
      label: "Exhibit B",
      name: "Allowance schedule",
      required: false,
      purpose:
        "Every allowance, its amount and what it covers. Allowance overruns are one of the two most common residential disputes, and a written schedule makes the overrun arithmetic rather than argument.",
    },
    {
      label: "Exhibit C",
      name: "Payment schedule",
      required: true,
      purpose:
        "What the customer pays and when. Front loaded enough that P5 is funded ahead of the work rather than financing it.",
    },
  ],
  statute:
    "Idaho Code § 45-525 (residential disclosure); Title 54, Chapter 52 (contractor registration)",
  fields: [
    { key: "customer_name", label: "Customer name", kind: "text", required: true, source: "Customer record" },
    { key: "property_address", label: "Property address", kind: "text", required: true, source: "Project record" },
    { key: "job_reference", label: "Job reference", kind: "text", required: true, source: "Project P5 number" },
    { key: "agreement_date", label: "Agreement date", kind: "date", required: true },
    { key: "p5_registration", label: "P5 Idaho registration number", kind: "text", required: true },
    { key: "scope", label: "Scope of work", kind: "multiline", required: true },
    { key: "exclusions", label: "Exclusions", kind: "multiline", required: false },
    { key: "contract_amount", label: "Contract price", kind: "money", required: true, source: "Project record" },
    { key: "deposit_amount", label: "Deposit", kind: "money", required: true },
    { key: "payment_schedule", label: "Payment schedule", kind: "multiline", required: true, help: "Each milestone and the amount due at it." },
    { key: "start_date", label: "Estimated start", kind: "date", required: true },
    { key: "completion_date", label: "Estimated substantial completion", kind: "date", required: true },
    { key: "warranty_months", label: "Warranty period, months", kind: "number", required: true, defaultValue: P5_STANDING.constructionWarrantyMonths, help: "Standing P5 term." },
    { key: "allowances", label: "Allowances", kind: "multiline", required: false, help: "Budget placeholders for selections not yet made. Overruns are billed as changes." },
  ],
  clauses: [
    {
      heading: "1. Parties",
      body:
        "This Agreement is made {{agreement_date}} between P5 Home Co. LLC, Idaho contractor registration " +
        "number {{p5_registration}} (\"Contractor\"), and {{customer_name}} (\"Owner\"), for work at " +
        "{{property_address}}. Job reference {{job_reference}}.",
    },
    {
      heading: "2. Scope of work",
      body: "Contractor will furnish the labour, materials and supervision to perform:\n\n{{scope}}",
      rationale:
        "Everything else in the agreement is machinery around this paragraph. If the scope is vague, no other clause can rescue it, because there is nothing definite to hold either party to.",
      loadBearing: true,
    },
    {
      heading: "3. Not included",
      body:
        "The following are excluded: {{exclusions}}\n\n" +
        "Anything not described in the scope above is excluded. Concealed conditions discovered during the " +
        "work - including structural, moisture, pest, code or utility conditions not visible at the time of " +
        "pricing - are not included and will be handled as a Change Order.",
      rationale:
        "Concealed conditions are the most common cause of a residential dispute. Naming them in advance turns a confrontation into a process.",
      loadBearing: true,
    },
    {
      heading: "4. Contract price and payment",
      body:
        "The contract price is {{contract_amount}}. A deposit of {{deposit_amount}} is due on signing. The " +
        "balance is payable as follows:\n\n{{payment_schedule}}\n\n" +
        "Each payment is due within seven days of invoice. Work may be suspended while any undisputed amount " +
        "is more than fourteen days overdue.",
      rationale:
        "The right to suspend for non-payment is the only real leverage a builder has mid-job. The word \"undisputed\" is what keeps it fair, and what keeps it enforceable.",
      loadBearing: true,
    },
    {
      heading: "5. Allowances",
      body:
        "The contract price includes the following allowances for items not yet selected:\n\n{{allowances}}\n\n" +
        "An allowance is a budget placeholder, not a fixed price. Where the actual cost of a selection differs " +
        "from its allowance, the difference is added to or deducted from the contract price by Change Order.",
      rationale:
        "Allowance overruns are the second most common residential dispute. Stating plainly that an allowance is not a price prevents the argument.",
      loadBearing: true,
    },
    {
      heading: "6. Changes",
      body:
        "Any change to the scope, price or schedule must be in a written Change Order signed by both parties " +
        "BEFORE the changed work is performed. Contractor is not obliged to perform changed work without a " +
        "signed Change Order, and Owner is not obliged to pay for changed work performed without one.",
      rationale:
        "The obligation runs both ways deliberately. A one-sided clause reads as a trap and gets negotiated; a mutual one gets signed.",
      loadBearing: true,
    },
    {
      heading: "7. Schedule",
      body:
        "Work is estimated to begin {{start_date}} and reach substantial completion by {{completion_date}}. " +
        "These dates are estimates and may be extended for changes, weather, concealed conditions, permit or " +
        "inspection delays, material availability, or Owner delay in making selections or payments.",
    },
    {
      heading: "8. Warranty",
      body:
        "Contractor warrants workmanship for {{warranty_months}} months from substantial completion and will " +
        "correct defective work at no cost within a reasonable time of written notice. Manufacturer warranties " +
        "on materials and appliances are passed through to Owner.\n\n" +
        "This warranty does not cover damage from misuse, neglect, alterations by others, normal wear, or " +
        "normal settlement and material movement.",
    },
    {
      heading: "9. Insurance",
      body:
        "Contractor carries general liability and workers' compensation insurance and will provide a " +
        "certificate on request. Owner is responsible for maintaining property insurance on the residence.",
    },
    {
      heading: "10. Lien notice",
      body:
        "Idaho law gives persons who furnish labour or materials for improvements to real property the right " +
        "to file a lien against that property if they are not paid. The separate disclosure statement provided " +
        "with this Agreement explains those rights and how Owner may protect against them.",
      rationale:
        "Idaho Code § 45-525 requires a disclosure before residential work begins. This clause points to it; it does not replace it.",
      loadBearing: true,
    },
    {
      heading: "11. Termination",
      body:
        "Either party may terminate for a material breach the other fails to cure within ten days of written " +
        "notice. On termination, Owner pays for work properly performed and materials ordered to that date.",
    },
    {
      heading: "12. Governing law and disputes",
      body:
        "This Agreement is governed by Idaho law. Venue is Ada County, Idaho. The parties will attempt direct " +
        "discussion, then mediation, before commencing any proceeding.",
    },
    {
      heading: "13. Entire agreement",
      body:
        "This Agreement, with its attachments and any signed Change Orders, is the entire agreement between " +
        "the parties. It may be amended only in writing signed by both.",
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Owner", nameField: "customer_name" },
  ],
  issuingNotes: [
    "For residential work over the Idaho threshold, the § 45-525 disclosure must be delivered BEFORE work begins - and P5 should keep the signed acknowledgement.",
    "The registration number must appear on the agreement. Idaho requires it.",
  ],
};

// ---------------------------------------------------------------------------
// Change order - used with both clients and subcontractors
// ---------------------------------------------------------------------------

export const changeOrder: DocumentTemplate = {
  key: "change_order",
  title: "Change Order {{change_order_number}}",
  purpose:
    "Records a change to scope, price or schedule. Signed before the changed work is performed. Used on both sides, with customers and with subcontractors.",
  category: "change",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  exhibits: [
    {
      label: "Exhibit A",
      name: "Supporting pricing, drawings or photographs",
      required: false,
      purpose:
        "Where the number came from. A change order priced with no backup is the one a customer questions hardest, usually months later when nobody remembers the detail.",
    },
  ],
  fields: [
    { key: "change_order_number", label: "Change order number", kind: "text", required: true },
    { key: "original_agreement_date", label: "Date of the agreement being changed", kind: "date", required: true, help: "The client agreement or subcontract this change amends. A change order that does not say what it changes is hard to enforce and easy to dispute." },
    { key: "original_agreement_title", label: "Title of the agreement being changed", kind: "text", required: true, help: "For example: Residential Construction Agreement, or Subcontract Work Order SC-001." },
    { key: "job_reference", label: "Job", kind: "text", required: true, source: "Project P5 number" },
    { key: "property_address", label: "Property address", kind: "text", required: true, source: "Project record" },
    { key: "counterparty_name", label: "Other party", kind: "text", required: true, help: "The customer, or the subcontractor, depending on which side this change is on." },
    { key: "change_date", label: "Date", kind: "date", required: true },
    { key: "reason", label: "Why this change is needed", kind: "multiline", required: true, help: "Concealed condition, owner request, design change, code requirement." },
    { key: "description", label: "Description of the change", kind: "multiline", required: true },
    { key: "price_change", label: "Change to the price", kind: "money", required: true, help: "Negative for a credit." },
    { key: "prior_contract_amount", label: "Contract amount before this change", kind: "money", required: true },
    { key: "new_contract_amount", label: "Contract amount after this change", kind: "money", required: true },
    { key: "schedule_days", label: "Days added to the schedule", kind: "number", required: true, help: "Zero if none. Leaving it blank is how a schedule silently slips." },
  ],
  clauses: [
    {
      heading: "Change order",
      body:
        "Job: {{job_reference}}\nProperty: {{property_address}}\nBetween: P5 Home Co. LLC and " +
        "{{counterparty_name}}\nDate: {{change_date}}",
    },
    {
      heading: "Reason for the change",
      body: "{{reason}}",
      rationale:
        "Recording the reason is what makes a change order defensible a year later, when nobody remembers why the price moved.",
    },
    {
      heading: "The change",
      body: "{{description}}",
      rationale:
        "The whole point of the document. A change order describing the change loosely leaves both parties with a different memory of what was agreed, which is the argument it was written to prevent.",
      loadBearing: true,
    },
    {
      heading: "Effect on the price",
      body:
        "Contract amount before this change: {{prior_contract_amount}}\n" +
        "This change: {{price_change}}\n" +
        "Contract amount after this change: {{new_contract_amount}}",
      rationale:
        "Showing the before, the change and the after on one line is what lets anyone check the arithmetic later without reassembling the job history from scratch.",
      loadBearing: true,
    },
    {
      heading: "Effect on the schedule",
      body:
        "Days added to the schedule: {{schedule_days}}\n\n" +
        "Except as stated above, the schedule is unchanged.",
      rationale:
        "A change order that adjusts price but is silent on time is how a builder ends up liable for a delay they were paid to cause.",
      loadBearing: true,
    },
    {
      heading: "Everything else unchanged",
      body:
        "All other terms of the original agreement remain in full effect. This Change Order is not effective " +
        "until signed by both parties, and the work it describes should not begin before then.",
      rationale:
        "Stops a change order being read as reopening the original agreement, and repeats the before-the-work rule at the point of signature where it actually gets ignored.",
      loadBearing: true,
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Accepted by", nameField: "counterparty_name" },
  ],
  issuingNotes: [
    "Signed BEFORE the work happens. A change order signed afterwards is a negotiation, not an agreement.",
    "Approved change orders raise the contract value the daily QuickBooks check measures billing against - so entering them is what stops a legitimate invoice being flagged as over-billing.",
  ],
};

// ---------------------------------------------------------------------------
// Idaho residential disclosure
// ---------------------------------------------------------------------------

export const idahoResidentialDisclosure: DocumentTemplate = {
  key: "idaho_residential_disclosure",
  title: "Idaho Residential Construction Disclosure",
  purpose:
    "Delivered to a residential owner BEFORE work begins, as Idaho Code § 45-525 requires. Explains lien rights and how to protect against them.",
  category: "disclosure",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  statute: "Idaho Code § 45-525",
  fields: [
    { key: "customer_name", label: "Owner name", kind: "text", required: true, source: "Customer record" },
    { key: "property_address", label: "Property address", kind: "text", required: true, source: "Project record" },
    { key: "job_reference", label: "Job reference", kind: "text", required: true, source: "Project P5 number" },
    { key: "disclosure_date", label: "Date delivered", kind: "date", required: true, help: "Must be before work begins. The date is the evidence." },
    { key: "p5_registration", label: "P5 Idaho registration number", kind: "text", required: true },
    { key: "contract_amount", label: "Contract price", kind: "money", required: true, source: "Project record" },
  ],
  clauses: [
    {
      heading: "Disclosure",
      body:
        "To: {{customer_name}}\nProperty: {{property_address}}\nJob: {{job_reference}}\n" +
        "Contractor: P5 Home Co. LLC, Idaho registration {{p5_registration}}\n" +
        "Contract price: {{contract_amount}}\nDate delivered: {{disclosure_date}}",
    },
    {
      heading: "Your right to know about liens",
      body:
        "Under Idaho law, any person who furnishes labour, materials, or professional services to improve your " +
        "property may claim a lien against that property if they are not paid - including subcontractors and " +
        "suppliers you have never met and have no contract with.\n\n" +
        "This can happen even if you have paid your contractor in full. If your contractor does not pay them, " +
        "they may still be able to look to your property.",
      rationale:
        "This paragraph is the substance Idaho Code 45-525 requires. Softening it to avoid alarming a customer would defeat the disclosure and leave P5 non-compliant.",
      loadBearing: true,
    },
    {
      heading: "How to protect yourself",
      body:
        "You may protect yourself by:\n\n" +
        "1. Asking your contractor for a list of every subcontractor and supplier who will furnish labour or " +
        "materials to your property. You are entitled to request this.\n\n" +
        "2. Requiring lien waivers from each of them as work progresses and as payments are made.\n\n" +
        "3. Making payment conditional on receiving those waivers.\n\n" +
        "4. Asking your title company or attorney about additional protections available to you.",
      rationale:
        "A warning with no remedy attached is just alarming. The statute contemplates telling owners what they can actually do about it.",
      loadBearing: true,
    },
    {
      heading: "Our practice",
      body:
        "P5 Home Co. LLC collects conditional lien waivers with every subcontractor payment request and " +
        "unconditional waivers once payments clear, and requires the same of its subcontractors from their own " +
        "suppliers. A current list of subcontractors and suppliers for your job is available on request at any " +
        "time.",
    },
    {
      heading: "Acknowledgement",
      body:
        "By signing below, the Owner acknowledges receiving this disclosure BEFORE work began on the property " +
        "described. Signing acknowledges receipt only; it waives nothing.",
      rationale:
        "The signed acknowledgement is P5's evidence of timely delivery. Without it, compliance rests on somebody's recollection.",
      loadBearing: true,
    },
  ],
  signatures: [
    { role: "Delivered by, for P5 Home Co. LLC" },
    { role: "Received by Owner", nameField: "customer_name" },
    { role: "Date received" },
  ],
  issuingNotes: [
    "Deliver BEFORE work begins, and keep the signed acknowledgement. Late delivery cannot be corrected afterwards.",
    "The project record stores the delivery date, and the project cannot pass its start gate without it.",
    "Idaho's requirement applies to residential work over a dollar threshold - confirm the current threshold with counsel rather than assuming the one in force when this was written.",
  ],
};

export const agreements: DocumentTemplate[] = [
  masterSubcontractorAgreement,
  subcontractWorkOrder,
  clientConstructionAgreement,
  changeOrder,
  idahoResidentialDisclosure,
];
