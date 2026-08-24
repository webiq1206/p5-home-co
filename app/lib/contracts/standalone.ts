/**
 * The two agreements that are not construction contracts (S224).
 *
 * Handyman and cabinet work were split out of the construction core rather than
 * given riders, because neither is really a construction project:
 *
 *   - Handyman work is short, often has no permit, and is frequently ordered by
 *     somebody who is not the homeowner - a realtor working an inspection list
 *     during a sale. Who pays, and what happens if the sale falls through, is
 *     the question a construction contract never has to ask.
 *
 *   - Cabinet work sold standalone is a supply-and-install sale. Where P5 only
 *     supplies, it is closer to a goods contract: risk of loss passes on
 *     delivery, the warranty is largely the manufacturer's, and measurement
 *     responsibility decides who pays when a door does not fit.
 *
 * Both can be sold to a homeowner OR a commercial client, which is why neither
 * assumes the Idaho residential disclosure applies. That decision is made per
 * job by the pre-send check, not baked into the document.
 */

import type { DocumentTemplate } from "./types.ts";

// ---------------------------------------------------------------------------
// Handyman services
// ---------------------------------------------------------------------------

export const handymanAgreement: DocumentTemplate = {
  key: "handyman_services_agreement",
  title: "Handyman Services Agreement",
  purpose:
    "Short-duration repair and maintenance work, for a homeowner, a commercial client, or a realtor ordering repairs during a sale.",
  category: "client",
  reviewState: "unreviewed",
  projectSpecific: true,
  statute: "Idaho Code Title 54, Chapter 52 (contractor registration); Idaho Code 45-525 where the work is residential and above the threshold",
  exhibits: [
    {
      label: "Exhibit A",
      name: "Work list, inspection report or repair addendum",
      required: false,
      purpose:
        "Where the scope came from. On realtor-ordered work this is usually the inspection report or the repair addendum, and attaching it is what stops an argument about whether an item was on the list.",
    },
  ],
  fields: [
    { key: "client_name", label: "Client name", kind: "text", required: true, source: "Customer record" },
    { key: "client_type", label: "Client type", kind: "text", required: true, help: "Homeowner, commercial, or realtor / brokerage ordering on behalf of a party to a sale." },
    { key: "property_address", label: "Property address", kind: "text", required: true, source: "Project record" },
    { key: "job_reference", label: "Job reference", kind: "text", required: true, source: "Project P5 number" },
    { key: "agreement_date", label: "Agreement date", kind: "date", required: true },
    { key: "p5_registration", label: "P5 Idaho registration number", kind: "text", required: true },
    { key: "scope", label: "Work to be performed", kind: "multiline", required: true, help: "Item by item. Vague scope on small jobs is where most of the friction lives." },
    { key: "exclusions", label: "Not included", kind: "multiline", required: false },
    { key: "pricing_basis", label: "Pricing basis", kind: "text", required: true, help: "Fixed price, or time and materials at the rates below." },
    { key: "price_or_rate", label: "Price, or hourly rate and material markup", kind: "text", required: true },
    { key: "not_to_exceed", label: "Not-to-exceed amount", kind: "money", required: false, help: "Strongly recommended on time and materials work. Without it the client has no ceiling and no way to plan." },
    { key: "payer", label: "Who pays", kind: "text", required: true, help: "The client, the brokerage, or escrow at closing. On realtor work this is the question that causes trouble later." },
    { key: "warranty_days", label: "Workmanship warranty, days", kind: "number", required: true },
  ],
  clauses: [
    {
      heading: "1. Parties and property",
      body:
        "This Agreement is made {{agreement_date}} between P5 Home Co. LLC, Idaho contractor registration " +
        "number {{p5_registration}} (\"P5\"), and {{client_name}} (\"Client\"), a {{client_type}}, for work at " +
        "{{property_address}}. Job reference {{job_reference}}.",
    },
    {
      heading: "2. Work to be performed",
      body:
        "P5 will perform the following:\n\n{{scope}}\n\n" +
        "Not included: {{exclusions}}\n\n" +
        "Anything not listed above is excluded. Where a listed item cannot be completed as described because " +
        "of a condition that was not visible when this Agreement was signed, P5 will stop, notify Client, and " +
        "proceed only on written agreement about the additional work and cost.",
      rationale:
        "Small jobs go wrong through vague scope more often than through bad work. The stop-and-notify rule prevents the most common handyman dispute, which is a two-hour job that became a two-day job without anybody agreeing to it.",
      loadBearing: true,
    },
    {
      heading: "3. Price",
      body:
        "Pricing basis: {{pricing_basis}}\nPrice or rate: {{price_or_rate}}\n" +
        "Not-to-exceed amount: {{not_to_exceed}}\n\n" +
        "Where a not-to-exceed amount is stated, P5 will not exceed it without Client's written agreement. " +
        "Where work is charged by time and materials, P5 will provide a record of hours and materials on request.",
      rationale:
        "A not-to-exceed figure is what makes time and materials acceptable to a client. Without one, the client is signing an open cheque and tends to dispute the invoice instead.",
      loadBearing: true,
    },
    {
      heading: "4. Who pays, and when",
      body:
        "Payment is due from {{payer}} on completion, unless stated otherwise in writing.\n\n" +
        "WHERE THIS WORK IS ORDERED IN CONNECTION WITH A SALE OF THE PROPERTY: the person or entity signing " +
        "this Agreement is responsible for payment, whether or not the sale closes, and whether or not any " +
        "escrow or closing disbursement is made. If payment is intended to come from closing proceeds, that " +
        "does not change who owes it if the sale does not close.",
      rationale:
        "The single most important clause in realtor-ordered work. Repairs get done for a sale, the sale falls through, and the invoice has nobody attached to it. Naming the signer as responsible regardless of closing is what prevents that.",
      loadBearing: true,
    },
    {
      heading: "5. Access and site condition",
      body:
        "Client will provide safe access to the work area and to power and water where the work needs them. " +
        "P5 is not responsible for delay caused by lack of access.\n\n" +
        "P5 will leave the work area broom clean and will remove its own debris.",
    },
    {
      heading: "6. Permits",
      body:
        "The work described is not expected to require a permit. If P5 determines that any part of it does, " +
        "P5 will stop that part and notify Client. Permitted work is not performed under this Agreement " +
        "unless both parties agree in writing to add it.",
      rationale:
        "Handyman scope creeping into permit-required work is how an unpermitted alteration ends up attached to somebody's house. Stopping is the correct response, not quietly continuing.",
      loadBearing: true,
    },
    {
      heading: "7. Warranty",
      body:
        "P5 warrants its workmanship for {{warranty_days}} days from completion and will correct defective " +
        "workmanship at no cost within that period on written notice.\n\n" +
        "This warranty does not cover materials supplied by Client, pre-existing conditions, normal wear, or " +
        "the continued performance of a system or component that P5 repaired but did not replace.",
      rationale:
        "The last exclusion matters on repair work. Repairing an old fixture is not a promise that the rest of it will keep working, and saying so prevents a repair being treated as a replacement warranty.",
      loadBearing: true,
    },
    {
      heading: "8. Insurance and registration",
      body:
        "P5 carries general liability insurance and is registered with the Idaho Contractors Board. A " +
        "certificate is available on request.",
    },
    {
      heading: "9. Lien rights",
      body:
        "Idaho law gives persons who furnish labour or materials to improve real property the right to claim " +
        "a lien if they are not paid. Where this work is residential and above the threshold set by Idaho " +
        "Code 45-525, the separate disclosure provided with this Agreement explains those rights.",
      rationale:
        "Written conditionally on purpose. This agreement is used for commercial work too, and asserting a residential duty on a commercial job is both wrong and teaches people to ignore the notice.",
      loadBearing: true,
    },
    {
      heading: "10. Governing law",
      body:
        "This Agreement is governed by Idaho law, with venue in Ada County. It is the entire agreement " +
        "between the parties on its subject and may be changed only in writing signed by both.",
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Client", nameField: "client_name" },
  ],
  issuingNotes: [
    "For realtor-ordered work, make sure the person signing understands clause 4: they owe the money whether or not the sale closes.",
    "No plan set is expected. Attach the inspection report or repair addendum instead where there is one.",
    "If the work turns out to need a permit, stop and re-scope. Do not continue under this agreement.",
  ],
};

// ---------------------------------------------------------------------------
// Cabinet supply and installation
// ---------------------------------------------------------------------------

export const cabinetAgreement: DocumentTemplate = {
  key: "cabinet_supply_install_agreement",
  title: "Cabinet Supply and Installation Agreement",
  purpose:
    "Standalone cabinet work sold as Boise Cabinet Co, to a homeowner or a commercial client, supplied only or supplied and installed.",
  category: "client",
  reviewState: "unreviewed",
  projectSpecific: true,
  statute: "Idaho Code Title 54, Chapter 52; Idaho Code 45-525 where residential and above the threshold; Idaho's Uniform Commercial Code where product is supplied without installation",
  exhibits: [
    {
      label: "Exhibit A",
      name: "Cabinet drawings, elevations and specification",
      required: false,
      purpose:
        "The drawings are what the client is actually buying. Signed alongside this agreement, a later argument about door style, finish or configuration is answered by the drawing rather than by recollection.",
    },
    {
      label: "Exhibit B",
      name: "Final field measurements",
      required: false,
      purpose:
        "Who measured, and when. Measurement responsibility decides who pays when a run does not fit, and that is the most expensive thing that goes wrong on a cabinet job.",
    },
  ],
  fields: [
    { key: "client_name", label: "Client name", kind: "text", required: true, source: "Customer record" },
    { key: "client_type", label: "Client type", kind: "text", required: true, help: "Homeowner or commercial." },
    { key: "property_address", label: "Property / delivery address", kind: "text", required: true, source: "Project record" },
    { key: "job_reference", label: "Job reference", kind: "text", required: true, source: "Project P5 number" },
    { key: "agreement_date", label: "Agreement date", kind: "date", required: true },
    { key: "p5_registration", label: "P5 Idaho registration number", kind: "text", required: true },
    { key: "supply_scope", label: "Supply or supply and install", kind: "text", required: true, help: "This changes what P5 is responsible for. Say which plainly." },
    { key: "product_description", label: "Product", kind: "multiline", required: true, help: "Line, door style, finish, box construction, hardware." },
    { key: "exclusions", label: "Not included", kind: "multiline", required: false, help: "Countertops, appliances, plumbing disconnect and reconnect, electrical, flooring, and painting are common exclusions." },
    { key: "contract_amount", label: "Contract price", kind: "money", required: true },
    { key: "deposit_amount", label: "Deposit", kind: "money", required: true, help: "Cabinets are made to order and cannot be restocked, which is why a deposit is non-refundable once released to production." },
    { key: "balance_terms", label: "Balance terms", kind: "multiline", required: true },
    { key: "measured_by", label: "Field measurements taken by", kind: "text", required: true, help: "P5, or the client / their contractor. This decides who pays for a misfit." },
    { key: "lead_time_weeks", label: "Estimated lead time, weeks", kind: "number", required: true },
    { key: "warranty_months", label: "Installation workmanship warranty, months", kind: "number", required: true },
  ],
  clauses: [
    {
      heading: "1. Parties and property",
      body:
        "This Agreement is made {{agreement_date}} between P5 Home Co. LLC trading as Boise Cabinet Co, " +
        "Idaho contractor registration number {{p5_registration}} (\"P5\"), and {{client_name}} " +
        "(\"Client\"), a {{client_type}}, for the property at {{property_address}}. Job reference " +
        "{{job_reference}}.",
    },
    {
      heading: "2. What P5 is providing",
      body:
        "Scope: {{supply_scope}}\n\nProduct:\n{{product_description}}\n\nNot included: {{exclusions}}\n\n" +
        "Where this Agreement is for SUPPLY ONLY, P5 is responsible for delivering the product described and " +
        "is not responsible for installation, fit, or any work by others. Where it is for SUPPLY AND " +
        "INSTALLATION, P5 is responsible for both.",
      rationale:
        "Supply-only and installed work are different obligations and the difference is routinely blurred. Stating which one this is decides who is responsible when something does not fit.",
      loadBearing: true,
    },
    {
      heading: "3. Measurements",
      body:
        "Final field measurements were taken by {{measured_by}}.\n\n" +
        "Where P5 took the measurements, P5 is responsible for the product fitting the space as measured. " +
        "Where Client or Client's contractor supplied the measurements, P5 builds to those figures and is not " +
        "responsible for a product that does not fit because a supplied measurement was wrong.\n\n" +
        "Cabinets are made to order. A product built to a wrong supplied measurement cannot be returned or " +
        "restocked and is chargeable in full.",
      rationale:
        "The most expensive failure on a cabinet job, and the one clients least expect to owe for. Naming who measured, in the contract, is what makes the answer obvious instead of contested.",
      loadBearing: true,
    },
    {
      heading: "4. Price, deposit and payment",
      body:
        "Contract price: {{contract_amount}}\nDeposit due on signing: {{deposit_amount}}\n" +
        "Balance: {{balance_terms}}\n\n" +
        "The deposit becomes non-refundable once the order is released to production, because the product is " +
        "made to Client's specification and has no resale value. P5 will confirm in writing when the order is " +
        "released.",
      rationale:
        "A non-refundable deposit is only defensible if the client was told when it becomes non-refundable and why. The written release notice is what makes that clause hold up.",
      loadBearing: true,
    },
    {
      heading: "5. Lead time and delivery",
      body:
        "Estimated lead time is {{lead_time_weeks}} weeks from the later of order release and receipt of " +
        "final approved drawings. Lead times are estimates given by the manufacturer and are not guaranteed.\n\n" +
        "Client will provide a dry, secure, climate-appropriate space for delivery. Risk of loss or damage " +
        "passes to Client on delivery to the address above, except where P5 is installing, in which case it " +
        "passes on completion of installation.",
      rationale:
        "Risk of loss has to be stated or it defaults to rules neither party expects. Splitting it by supply-only versus installed matches who actually has custody of the product.",
      loadBearing: true,
    },
    {
      heading: "6. Site readiness, where P5 installs",
      body:
        "Where P5 is installing, Client is responsible for the space being ready: walls square and finished " +
        "to the extent the drawings assume, flooring complete where it runs under the cabinets, and services " +
        "roughed in at the locations shown. P5 will notify Client if the space is not ready and may reschedule.\n\n" +
        "Additional visits caused by the space not being ready are chargeable.",
    },
    {
      heading: "7. Warranty",
      body:
        "Product is covered by the manufacturer's warranty, which P5 passes through to Client in full. P5 " +
        "makes no separate warranty of the product itself.\n\n" +
        "Where P5 installed, P5 warrants its installation workmanship for {{warranty_months}} months from " +
        "completion.\n\n" +
        "Natural variation in wood grain, colour and figure, and normal movement of wood with humidity, are " +
        "characteristics of the material and are not defects.",
      rationale:
        "The wood variation sentence prevents the most common cabinet complaint. The pass-through structure is honest: P5 did not make the product and should not warrant it as though it did, but the client must still get the benefit of the maker's warranty.",
      loadBearing: true,
    },
    {
      heading: "8. Changes",
      body:
        "Changes after the order is released to production may not be possible, and where possible are " +
        "chargeable at cost plus P5's standard markup, with a revised lead time. Any change must be agreed in " +
        "a written Change Order before it is made.",
    },
    {
      heading: "9. Lien rights",
      body:
        "Idaho law gives persons who furnish labour or materials to improve real property the right to claim " +
        "a lien if they are not paid. Where this work is residential and above the threshold set by Idaho " +
        "Code 45-525, the separate disclosure provided with this Agreement explains those rights.",
      rationale:
        "Conditional for the same reason as the handyman agreement: this document is used for commercial work, where the residential disclosure duty does not apply.",
      loadBearing: true,
    },
    {
      heading: "10. Governing law",
      body:
        "This Agreement is governed by Idaho law, with venue in Ada County. It is the entire agreement " +
        "between the parties on its subject and may be changed only in writing signed by both.",
    },
  ],
  signatures: [
    { role: "P5 Home Co. LLC, by" },
    { role: "Client", nameField: "client_name" },
  ],
  issuingNotes: [
    "Say plainly whether this is supply only or supply and installation. It changes what P5 is responsible for throughout.",
    "Record who took the final measurements. It is the answer to the most expensive question on a cabinet job.",
    "Attach the drawings. They are what the client is actually buying.",
    "Confirm the order release date in writing - it is what makes the non-refundable deposit defensible.",
  ],
};

export const standaloneAgreements: DocumentTemplate[] = [handymanAgreement, cabinetAgreement];
