/**
 * Create the P5 deal properties in HubSpot.
 *
 * Reads HUBSPOT_TOKEN from the environment and never prints it. Idempotent:
 * a property that already exists is left untouched, so re-running is safe.
 *
 *   npm run hubspot:setup          # create anything missing
 *   npm run hubspot:setup -- --dry # report what would change, write nothing
 *
 * Deliberately does NOT create properties HubSpot already provides. Those are
 * listed in REUSED below and should be used as-is.
 */

const TOKEN = process.env.HUBSPOT_TOKEN;
const API = "https://api.hubapi.com";
const DRY = process.argv.includes("--dry");
const GROUP = "p5_lead_manager";

/** HubSpot defaults we reuse rather than duplicate. */
const REUSED: Record<string, string> = {
  dealname: "Deal Name — holds 'Last Name | Brand | Project Type | City'",
  amount: "Amount — Estimated Project Value",
  dealstage: "Deal Stage",
  pipeline: "Pipeline",
  closedate: "Close Date",
  hubspot_owner_id: "Deal owner — the HubSpot-side owner",
  description: "Description — Project Summary",
  closed_lost_reason: "Closed Lost Reason",
};

type Opt = { label: string; value: string };
type PropDef = {
  name: string;
  label: string;
  type: "string" | "enumeration" | "datetime" | "date" | "number";
  fieldType: "text" | "textarea" | "select" | "date" | "number";
  description: string;
  options?: Opt[];
};

const opts = (...labels: string[]): Opt[] =>
  labels.map((label) => ({ label, value: label }));

/**
 * Every value list here must stay in step with app/lib/leads/types.ts.
 * Changing a stored value is a migration, not an edit.
 */
const BRANDS = opts(
  "P5 Home Co",
  "Boise Construction Co",
  "Boise Remodeling Co",
  "Boise Handyman Co",
  "Boise ADU Co",
  "Boise Cabinet Co",
);

const LEAD_SOURCES = opts(
  "Facebook Lead Ad",
  "Organic Website",
  "Google Business Profile",
  "Direct Email",
  "Phone",
  "Referral",
  "Manual Entry",
  "Paid Search",
  "Social Media",
  "Other",
);

const PROJECT_TYPES = opts(
  "Custom home",
  "Semi-custom home",
  "Build on land I own",
  "Home plans or lot evaluation",
  "Kitchen remodel",
  "Bathroom remodel",
  "Whole-home remodel",
  "Addition, ADU, or basement",
  "Detached ADU",
  "Garage conversion",
  "Basement or interior unit",
  "Feasibility and permits",
  "Drywall or trim repair",
  "Mounting or installation",
  "Deck or exterior repair",
  "A multi-item home list",
  "Kitchen cabinets",
  "Bathroom vanity",
  "Built-ins or storage",
  "Whole-home cabinetry",
);

// The eight cities the approved website claims. The Google Business Profile
// appears to list nine; this stays at eight until the owner reconciles them.
const SERVICE_AREAS = opts(
  "Boise", "Meridian", "Eagle", "Nampa", "Kuna", "Star", "Middleton", "Caldwell",
);

const PROPERTIES: PropDef[] = [
  // --- Identity and routing ------------------------------------------------
  { name: "p5_brand", label: "P5 Brand", type: "enumeration", fieldType: "select",
    options: BRANDS,
    description: "Which P5 company owns this project. Lives on the deal, not the contact, so one person can hold deals with several brands." },
  { name: "p5_project_type", label: "Project Type", type: "enumeration", fieldType: "select",
    options: PROJECT_TYPES, description: "The kind of work requested." },
  { name: "p5_lead_source", label: "Lead Source", type: "enumeration", fieldType: "select",
    options: LEAD_SOURCES, description: "Where the lead came from. Does not overwrite HubSpot's own attribution." },
  { name: "p5_lead_source_detail", label: "Lead Source Detail", type: "string", fieldType: "text",
    description: "Free-text detail about the source, such as the campaign or referrer name." },
  { name: "p5_assigned_team_member", label: "Assigned P5 Team Member", type: "string", fieldType: "text",
    description: "Who owns this lead in the P5 admin panel. P5 owns assignment; this mirrors it into HubSpot." },

  // --- Property -------------------------------------------------------------
  { name: "p5_property_address", label: "Property Address", type: "string", fieldType: "text",
    description: "Street address of the project property." },
  { name: "p5_property_city", label: "Property City", type: "string", fieldType: "text",
    description: "City of the project property." },
  { name: "p5_service_area", label: "Service Area", type: "enumeration", fieldType: "select",
    options: SERVICE_AREAS, description: "Which service area the property falls in." },

  // --- Response and SLA -----------------------------------------------------
  { name: "p5_first_attempt_at", label: "First Contact Attempt Date", type: "datetime", fieldType: "date",
    description: "When a person first tried to reach this lead. A voicemail counts; an automatic acknowledgment does not." },
  { name: "p5_first_two_way_at", label: "First Two-Way Contact Date", type: "datetime", fieldType: "date",
    description: "When we actually spoke with the lead. Tracked separately from the first attempt." },
  { name: "p5_sla_deadline", label: "SLA Deadline", type: "datetime", fieldType: "date",
    description: "When the first human response is due, in business hours (Mon-Sat, 7:00am-6:00pm America/Boise)." },
  { name: "p5_sla_status", label: "SLA Status", type: "enumeration", fieldType: "select",
    options: opts("On track", "Due soon", "Breached", "Met", "After hours", "Not applicable"),
    description: "Response status, computed by the P5 rules engine. Do not edit by hand." },

  // --- Next action ----------------------------------------------------------
  { name: "p5_next_action", label: "Next Action", type: "string", fieldType: "text",
    description: "The single next thing to do on this deal." },
  { name: "p5_next_action_at", label: "Next Action Date", type: "datetime", fieldType: "date",
    description: "When the next action is due." },
  { name: "p5_appointment_at", label: "Appointment Date", type: "datetime", fieldType: "date",
    description: "Scheduled appointment or site visit." },

  // --- Attribution and idempotency -----------------------------------------
  { name: "p5_external_lead_id", label: "External Lead ID", type: "string", fieldType: "text",
    description: "Stable id from the originating system. Used as the idempotency key so a retried webhook cannot create a second deal." },
  { name: "p5_facebook_lead_id", label: "Facebook Lead ID", type: "string", fieldType: "text",
    description: "Meta lead id, when the lead came from a Facebook Lead Ad." },
  { name: "p5_original_form", label: "Original Form", type: "string", fieldType: "text",
    description: "Which form or page produced the lead." },
  { name: "p5_original_campaign", label: "Original Campaign", type: "string", fieldType: "text",
    description: "Campaign the lead is attributed to." },

  // --- Integration health ---------------------------------------------------
  { name: "p5_integration_sync_status", label: "Integration Sync Status", type: "enumeration", fieldType: "select",
    options: opts("Pending", "Synced", "Failed", "Not applicable"),
    description: "Whether this deal is in sync with the P5 admin panel." },
  { name: "p5_last_integration_error", label: "Last Integration Error", type: "string", fieldType: "textarea",
    description: "Most recent sync error, for administrators." },

  // --- Handoff: MANUAL AND UNVERIFIED until handoffIntegrationEnabled is on --
  { name: "p5_handoff_project_id", label: "Handoff Project ID (manual)", type: "string", fieldType: "text",
    description: "MANUAL AND UNVERIFIED. Handoff is not connected; nothing validates this value." },
  { name: "p5_handoff_project_url", label: "Handoff Project URL (manual)", type: "string", fieldType: "text",
    description: "MANUAL AND UNVERIFIED. A link someone pasted in, not a synced value." },
  { name: "p5_handoff_status", label: "Handoff Status (manual)", type: "string", fieldType: "text",
    description: "MANUAL AND UNVERIFIED. Handoff is not connected." },
  { name: "p5_proposal_status", label: "Proposal Status (manual)", type: "enumeration", fieldType: "select",
    options: opts("Draft", "Sent", "Approved", "Declined"),
    description: "MANUAL AND UNVERIFIED. Approved here must never move a deal to Closed Won on its own." },
  { name: "p5_proposal_sent_at", label: "Proposal Sent Date (manual)", type: "date", fieldType: "date",
    description: "MANUAL AND UNVERIFIED." },
  { name: "p5_proposal_approved_at", label: "Proposal Approved Date (manual)", type: "date", fieldType: "date",
    description: "MANUAL AND UNVERIFIED." },
  { name: "p5_estimate_amount", label: "Estimate Amount (manual)", type: "number", fieldType: "number",
    description: "MANUAL AND UNVERIFIED. The deal's Amount property remains the figure of record." },
];

async function hs(path: string, init?: RequestInit): Promise<Response> {
  return fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error(
      "HUBSPOT_TOKEN is not set.\n" +
        "Put it in .env.local (gitignored) as HUBSPOT_TOKEN=... and re-run.",
    );
    process.exit(1);
  }

  // Verify the token before changing anything, so a bad scope fails loudly
  // rather than half-way through creating properties.
  const probe = await hs("/crm/v3/properties/deals");
  if (!probe.ok) {
    console.error(
      `Cannot read deal properties (HTTP ${probe.status}). ` +
        "Check the token and that it has crm.schemas.deals.read/write.",
    );
    process.exit(1);
  }
  const existing = (await probe.json()) as { results: { name: string }[] };
  const have = new Set(existing.results.map((p) => p.name));

  console.log(`Connected. ${have.size} deal properties already exist.\n`);
  console.log("Reusing HubSpot defaults rather than duplicating them:");
  for (const [name, why] of Object.entries(REUSED)) {
    console.log(`  ${have.has(name) ? "ok  " : "MISSING"} ${name.padEnd(20)} ${why}`);
  }
  console.log();

  // Property group, so the P5 fields sit together on the record.
  if (!DRY) {
    const g = await hs("/crm/v3/properties/deals/groups", {
      method: "POST",
      body: JSON.stringify({ name: GROUP, label: "P5 Lead Manager", displayOrder: -1 }),
    });
    if (g.ok) console.log("Created property group: P5 Lead Manager");
    else if (g.status === 409) console.log("Property group already exists.");
    else console.log(`Property group: HTTP ${g.status}`);
    console.log();
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of PROPERTIES) {
    if (have.has(def.name)) {
      console.log(`  skip    ${def.name}  (already exists)`);
      skipped += 1;
      continue;
    }
    if (DRY) {
      console.log(`  would create ${def.name.padEnd(30)} ${def.label}`);
      created += 1;
      continue;
    }

    const res = await hs("/crm/v3/properties/deals", {
      method: "POST",
      body: JSON.stringify({
        name: def.name,
        label: def.label,
        type: def.type,
        fieldType: def.fieldType,
        groupName: GROUP,
        description: def.description,
        ...(def.options
          ? { options: def.options.map((o, i) => ({ ...o, displayOrder: i, hidden: false })) }
          : {}),
      }),
    });

    if (res.ok) {
      console.log(`  created ${def.name.padEnd(30)} ${def.label}`);
      created += 1;
    } else if (res.status === 409) {
      console.log(`  skip    ${def.name}  (already exists)`);
      skipped += 1;
    } else {
      const body = await res.text();
      console.error(`  FAILED  ${def.name}  HTTP ${res.status}  ${body.slice(0, 200)}`);
      failed += 1;
    }
  }

  console.log(
    `\n${DRY ? "Dry run. " : ""}created ${created}, skipped ${skipped}, failed ${failed}.`,
  );
  if (failed) process.exit(1);
}

await main();

// Makes this file a module, which top-level await requires.
export {};
