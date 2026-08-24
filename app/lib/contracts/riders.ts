/**
 * Riders to the Residential Construction Agreement (S226).
 *
 * The core agreement carries what is true of every construction job: parties,
 * scope, price, changes, warranty, insurance, disputes. A rider carries what is
 * true of one KIND of job.
 *
 * Riders rather than five separate contracts, because five near-identical
 * agreements drift. A clause improved on the remodel contract quietly stops
 * matching the new build one, and nobody finds out until the two are compared
 * in a dispute. One core plus a short rider keeps the shared terms shared.
 *
 * Each rider is a document in the same QuickBooks signing packet as the core,
 * so the customer signs one thing. QuickBooks allows five documents per
 * template, and a fully loaded packet is core + rider + design-build rider +
 * disclosure, which is four.
 */

import type { DocumentTemplate } from "./types.ts";

/** Every rider says the same thing about its relationship to the core. */
function attachmentClause(riderName: string) {
  return {
    heading: "1. This rider attaches to the Agreement",
    body:
      `This ${riderName} forms part of the Residential Construction Agreement dated ` +
      `{{agreement_date}} between P5 Home Co. LLC and {{customer_name}} for the property at ` +
      `{{property_address}}, job reference {{job_reference}}.\n\n` +
      `The Agreement applies in full. This rider adds terms specific to this kind of work. ` +
      `Where this rider and the Agreement conflict, this rider governs, and only as to the ` +
      `matters it expressly addresses.`,
    rationale:
      "A rider floating free of its parent is unenforceable and hard to read. Naming the agreement, its date and the property makes the chain provable, and the narrow conflict rule stops a rider being argued to have replaced the whole contract.",
    loadBearing: true,
  };
}

/** The identifying fields every rider needs to tie itself to the core. */
const linkFields = [
  { key: "customer_name", label: "Customer name", kind: "text" as const, required: true, source: "Customer record" },
  { key: "property_address", label: "Property address", kind: "text" as const, required: true, source: "Project record" },
  { key: "job_reference", label: "Job reference", kind: "text" as const, required: true, source: "Project P5 number" },
  { key: "agreement_date", label: "Date of the Agreement this rider attaches to", kind: "date" as const, required: true },
];

const riderSignatures = [
  { role: "P5 Home Co. LLC, by" },
  { role: "Owner", nameField: "customer_name" },
];

// ---------------------------------------------------------------------------
// New build
// ---------------------------------------------------------------------------

export const newBuildRider: DocumentTemplate = {
  key: "rider_new_build",
  title: "New Construction Rider",
  purpose:
    "Attaches to the Residential Construction Agreement for a new home on a bare or cleared lot.",
  category: "client",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  fields: [
    ...linkFields,
    { key: "permit_responsibility", label: "Who obtains the building permit", kind: "text", required: true },
    { key: "utility_responsibility", label: "Who brings utilities to the lot", kind: "multiline", required: true, help: "Power, water, sewer or septic, gas. On a bare lot this is frequently assumed and rarely agreed." },
    { key: "survey_responsibility", label: "Who provides the survey", kind: "text", required: true },
    { key: "soils_allowance", label: "Allowance for unsuitable soils or rock", kind: "money", required: false },
    { key: "lender_name", label: "Construction lender, if any", kind: "text", required: false },
  ],
  clauses: [
    attachmentClause("New Construction Rider"),
    {
      heading: "2. The lot",
      body:
        "This Agreement is priced on the lot as it existed when P5 inspected it and on the information " +
        "Owner supplied about it.\n\n" +
        "Survey: {{survey_responsibility}}\nUtilities to the lot: {{utility_responsibility}}\n" +
        "Building permit: {{permit_responsibility}}",
      rationale:
        "On a bare lot, who brings power and water is assumed by both sides and agreed by neither. Writing it down is the cheapest clause in the document.",
      loadBearing: true,
    },
    {
      heading: "3. Soils, rock and subsurface conditions",
      body:
        "The price includes an allowance of {{soils_allowance}} for unsuitable soils, rock, groundwater or " +
        "fill requiring removal, replacement or engineering.\n\n" +
        "Where the actual cost of dealing with subsurface conditions exceeds that allowance, the difference " +
        "is added by Change Order. Where it is less, the difference is credited to Owner.\n\n" +
        "Nobody can see below the surface before digging. This clause exists so that what is found is priced " +
        "against an agreed starting figure rather than argued about from nothing.",
      rationale:
        "The largest single unknown on a new build, and the one most likely to blow the budget in month one. An allowance with a two-way adjustment is fairer than a flat exclusion and far easier to defend than silence.",
      loadBearing: true,
    },
    {
      heading: "4. Permits, inspections and approvals",
      body:
        "P5 will schedule and attend inspections required by the building permit. Delay caused by the " +
        "permitting authority, a utility provider, or an inspection failure not caused by P5's work extends " +
        "the schedule by the period of delay.\n\n" +
        "Fees charged by the authority are Owner's cost unless the Agreement states otherwise.",
    },
    {
      heading: "5. Construction lending",
      body:
        "Where the work is financed by a construction loan with {{lender_name}}, Owner is responsible for " +
        "the loan being in place and for draws being requested and released on time.\n\n" +
        "P5 will provide the documentation the lender reasonably requires for each draw. A delay in a lender " +
        "disbursement is not a failure by P5, and work may be suspended while a properly requested draw is " +
        "outstanding.",
      rationale:
        "Draw delays are common and P5 is not a party to the loan. Without this, a slow lender becomes P5's schedule problem and P5's cash problem at the same time.",
      loadBearing: true,
    },
    {
      heading: "6. Weather",
      body:
        "The schedule assumes weather normal for the season in Ada County. Days lost to weather that " +
        "prevents work safely or properly extend the schedule by the days lost.",
    },
  ],
  signatures: riderSignatures,
  issuingNotes: [
    "Agree who brings utilities to the lot before pricing. It is the most commonly assumed item on a new build.",
    "Set the soils allowance deliberately. Zero is a decision, not a default.",
  ],
};

// ---------------------------------------------------------------------------
// Remodel
// ---------------------------------------------------------------------------

export const remodelRider: DocumentTemplate = {
  key: "rider_remodel",
  title: "Remodel Rider",
  purpose:
    "Attaches to the Residential Construction Agreement for work on an existing structure, usually while the owner is living in it.",
  category: "client",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  fields: [
    ...linkFields,
    { key: "occupied", label: "Will the home be occupied during the work", kind: "text", required: true },
    { key: "work_hours", label: "Working hours", kind: "text", required: true },
    { key: "concealed_allowance", label: "Allowance for concealed conditions", kind: "money", required: false },
    { key: "year_built", label: "Approximate year built", kind: "text", required: true, help: "Drives the hazardous materials clause. Pre-1978 raises lead paint duties." },
    { key: "protected_areas", label: "Areas to be protected or kept in use", kind: "multiline", required: false },
  ],
  clauses: [
    attachmentClause("Remodel Rider"),
    {
      heading: "2. Concealed conditions",
      body:
        "This Agreement is priced on what could be seen without opening walls, floors or ceilings.\n\n" +
        "The price includes an allowance of {{concealed_allowance}} for conditions discovered once the " +
        "structure is opened: rot, pest damage, failed or undersized structure, non-compliant wiring or " +
        "plumbing, moisture, or work by others that does not meet code.\n\n" +
        "Where the cost of dealing with concealed conditions exceeds that allowance, P5 will stop, show " +
        "Owner what was found, and proceed on a signed Change Order. Where it is less, the difference is " +
        "credited to Owner.",
      rationale:
        "The defining risk of remodelling and the most common cause of a residential dispute. Stopping and showing the owner what was found, rather than proceeding and billing, is what keeps this a process instead of a confrontation.",
      loadBearing: true,
    },
    {
      heading: "3. Living in the home during the work",
      body:
        "Occupied during the work: {{occupied}}\nWorking hours: {{work_hours}}\n\n" +
        "Where the home is occupied, P5 will maintain dust containment and floor protection in the work " +
        "area and will restore power and water at the end of each working day where it is safe to do so.\n\n" +
        "Areas to be protected or kept in use: {{protected_areas}}\n\n" +
        "Construction is noisy, dusty and disruptive even when done carefully. Owner accepts that living in " +
        "the home during the work involves that disruption.",
      rationale:
        "Sets an expectation that would otherwise be set by disappointment. The daily power and water commitment is the practical one owners care about most, and it is cheap to promise and easy to keep.",
      loadBearing: true,
    },
    {
      heading: "4. Hazardous materials",
      body:
        "Approximate year built: {{year_built}}\n\n" +
        "Where the structure is of an age that asbestos or lead-based paint may be present, P5 will not " +
        "disturb suspected material until it has been tested. Testing, and any abatement found necessary, is " +
        "additional work handled by Change Order and performed by a licensed abatement contractor.\n\n" +
        "P5 does not perform abatement.",
      rationale:
        "Disturbing asbestos or lead is a regulatory and health problem, not a cost problem, and it is not work P5 is licensed to do. Saying so in advance stops a crew being asked to just get on with it.",
      loadBearing: true,
    },
    {
      heading: "5. Matching existing work",
      body:
        "Where new work meets existing work, P5 will match materials, finishes and profiles as closely as " +
        "commercially available materials allow. Exact matching of aged finishes, discontinued products, " +
        "settled framing or hand-applied textures cannot be guaranteed.",
      rationale:
        "A remodel always meets something old. Promising a perfect match is a promise nobody can keep, and this is the sentence that prevents it being assumed.",
      loadBearing: true,
    },
    {
      heading: "6. Owner's belongings",
      body:
        "Owner will remove personal property from the work area before work begins. P5 is not responsible " +
        "for damage to personal property left in the work area.",
    },
  ],
  signatures: riderSignatures,
  issuingNotes: [
    "Set the concealed conditions allowance deliberately. On an older home, zero is optimistic.",
    "Record the year built. It decides whether the hazardous materials clause is likely to be used.",
  ],
};

// ---------------------------------------------------------------------------
// ADU
// ---------------------------------------------------------------------------

export const aduRider: DocumentTemplate = {
  key: "rider_adu",
  title: "Accessory Dwelling Unit Rider",
  purpose:
    "Attaches to the Residential Construction Agreement for an accessory dwelling unit on a lot with an existing home.",
  category: "client",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  fields: [
    ...linkFields,
    { key: "zoning_confirmed", label: "Zoning and setback confirmation", kind: "multiline", required: true, help: "What has actually been confirmed with the jurisdiction, and by whom." },
    { key: "utility_approach", label: "Utility approach", kind: "multiline", required: true, help: "Shared with the main house, or separately metered. This is a design and a cost decision." },
    { key: "owner_occupancy_note", label: "Owner-occupancy or rental restrictions", kind: "multiline", required: false },
    { key: "access_route", label: "Construction access route", kind: "multiline", required: true, help: "An ADU is usually behind an occupied house. How equipment reaches it is a real constraint." },
  ],
  clauses: [
    attachmentClause("Accessory Dwelling Unit Rider"),
    {
      heading: "2. Zoning, setbacks and permitted use",
      body:
        "Confirmed with the jurisdiction: {{zoning_confirmed}}\n\n" +
        "Owner is responsible for the lot being eligible for an accessory dwelling unit and for any " +
        "restriction on its use, including owner-occupancy requirements, short-term rental rules, and " +
        "restrictive covenants: {{owner_occupancy_note}}\n\n" +
        "P5 builds to the approved plans. P5 does not warrant that the completed unit may be used for any " +
        "particular purpose.",
      rationale:
        "ADU rules are local, change often, and frequently carry an owner-occupancy or rental restriction the owner did not know about. Building a legal unit that cannot be used the way the owner planned is a disaster that has nothing to do with construction quality.",
      loadBearing: true,
    },
    {
      heading: "3. Utilities",
      body:
        "{{utility_approach}}\n\n" +
        "Where services are shared with the main house, capacity of the existing service is Owner's " +
        "responsibility. Where an upgrade to the existing service is required, it is additional work handled " +
        "by Change Order.",
      rationale:
        "Discovering the main panel cannot carry a second dwelling, halfway through, is the classic ADU cost surprise.",
      loadBearing: true,
    },
    {
      heading: "4. Access and the existing home",
      body:
        "Access route: {{access_route}}\n\n" +
        "P5 will take reasonable care of existing landscaping, driveway and fencing on the access route, and " +
        "will restore disturbed ground on completion. Some disturbance is unavoidable where equipment must " +
        "reach a rear lot.\n\n" +
        "Where the existing home is occupied during the work, the working hours and containment terms of the " +
        "Remodel Rider apply if that rider is also attached.",
    },
    {
      heading: "5. Impact fees and connection charges",
      body:
        "Fees charged by the jurisdiction or a utility provider for a new dwelling, including impact fees " +
        "and connection charges, are Owner's cost unless the Agreement states otherwise. These are set by " +
        "the authority and are outside P5's control.",
      rationale:
        "ADU impact fees can run into five figures and are frequently assumed to be inside the contract price. Naming them prevents a large and entirely avoidable argument.",
      loadBearing: true,
    },
  ],
  signatures: riderSignatures,
  issuingNotes: [
    "Confirm zoning and any owner-occupancy restriction in writing with the jurisdiction before pricing.",
    "Check the existing electrical service capacity early. It is the most common ADU surprise.",
  ],
};

// ---------------------------------------------------------------------------
// Design-build
// ---------------------------------------------------------------------------

export const designBuildRider: DocumentTemplate = {
  key: "rider_design_build",
  title: "Design-Build Rider",
  purpose:
    "Attaches where P5 performs design as well as construction. Sets the design phase, what is delivered, who owns the drawings, and what happens if the owner does not proceed to build.",
  category: "client",
  reviewState: "owner_accepted",
  reviewedOn: "2026-08-24",
  reviewedBy: "Jared Brost (owner)",
  acceptanceNote:
    "Accepted for use pending attorney review. No attorney has reviewed this template.",
  projectSpecific: true,
  fields: [
    ...linkFields,
    { key: "design_fee", label: "Design fee", kind: "money", required: true },
    { key: "design_deliverables", label: "Design deliverables", kind: "multiline", required: true, help: "What the owner actually receives at the end of design." },
    { key: "credit_pct", label: "Percentage of the design fee credited against the build", kind: "number", required: true, help: "Zero is a valid answer, but it must be a decision rather than a silence." },
    { key: "proceed_by_date", label: "Credit available if construction is signed by", kind: "date", required: true },
    { key: "revision_rounds", label: "Included revision rounds", kind: "number", required: true, help: "Unlimited revisions is how a design phase runs at a loss." },
  ],
  clauses: [
    attachmentClause("Design-Build Rider"),
    {
      heading: "2. The design phase",
      body:
        "P5 will perform design for a fee of {{design_fee}}, delivering:\n\n{{design_deliverables}}\n\n" +
        "The fee includes {{revision_rounds}} rounds of revision. Further revisions are additional work.\n\n" +
        "The design phase is complete when the deliverables above have been provided, whether or not Owner " +
        "proceeds to construction.",
      rationale:
        "An open-ended revision commitment is how a design phase runs at a loss, and defining completion by deliverables rather than by the owner's satisfaction is what makes the fee collectable.",
      loadBearing: true,
    },
    {
      heading: "3. Design fee credit",
      body:
        "Where Owner signs a construction agreement with P5 for this project on or before " +
        "{{proceed_by_date}}, {{credit_pct}} percent of the design fee is credited against the contract price.\n\n" +
        "Where Owner does not proceed, or proceeds after that date, the design fee is earned in full and no " +
        "credit applies.",
      rationale:
        "The credit is what makes a design fee acceptable to an owner who suspects it is a way of charging twice. The date is what stops the credit sitting open indefinitely against a price that has since moved.",
      loadBearing: true,
    },
    {
      heading: "4. Ownership and use of the drawings",
      body:
        "P5 retains ownership of and copyright in the drawings and design documents it produces.\n\n" +
        "On payment of the design fee in full, Owner receives a licence to use the drawings to construct " +
        "THIS project on THIS property, once.\n\n" +
        "The licence does not permit Owner to use the drawings to build elsewhere, to build the project more " +
        "than once, or to have the project built by another contractor, unless P5 agrees in writing and any " +
        "agreed further fee is paid.",
      rationale:
        "The commercial heart of design-build. Without it an owner can pay a design fee, take the drawings, and have somebody else build from them - which is the outcome the credit structure is designed to make unattractive rather than impossible.",
      loadBearing: true,
    },
    {
      heading: "5. Construction is a separate agreement",
      body:
        "This rider does not commit either party to construction. The price, scope and schedule for building " +
        "the design are agreed in a construction agreement signed after the design is complete.\n\n" +
        "Any construction figure discussed during design is an estimate for planning and is not a price.",
      rationale:
        "Separating the two is what protects P5 from being held to a number quoted before the design existed, and protects the owner from being committed to build something they have not seen.",
      loadBearing: true,
    },
    {
      heading: "6. Approvals",
      body:
        "P5 will submit for the approvals the design requires. P5 does not warrant that any authority will " +
        "grant an approval, or grant it within any period. Where an authority requires a change, the redesign " +
        "is additional work unless it corrects an error by P5.",
    },
  ],
  signatures: riderSignatures,
  issuingNotes: [
    "Set the credit percentage and the proceed-by date deliberately. They are the terms an owner will actually negotiate.",
    "Design costs are tracked under the 02 Design phase family, separately from the Build phases, which is what makes the credit computable.",
    "Do not quote a construction price during design. An estimate for planning is not a price.",
  ],
};

export const riders: DocumentTemplate[] = [
  newBuildRider,
  remodelRider,
  aduRider,
  designBuildRider,
];
