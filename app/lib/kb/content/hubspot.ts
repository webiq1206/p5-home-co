/**
 * Section: HubSpot. Documents the ACTUAL portal (247066159 on app-na2),
 * inspected live. The portal is on the free tier; several things generic
 * HubSpot advice assumes (workflows, multiple pipelines) do not exist here.
 */

import type { Article } from "../types.ts";

export const hubspot: Article[] = [
  {
    slug: "hubspot-overview",
    section: "hubspot",
    title: "Our HubSpot setup at a glance",
    summary:
      "What HubSpot is for at P5, the free-tier limits that shape how we use it, and why employees work in the P5 panel instead.",
    lastVerified: "2026-08-22",
    verifies: ["hubspot-pipeline"],
    keywords: ["hubspot", "crm", "portal", "free tier", "seats", "limits"],
    blocks: [
      {
        t: "p",
        text:
          "HubSpot is our customer relationship manager (CRM): the master list of everyone who has inquired, every deal, and where each one stands. Our portal is number 247066159, named P5 Home Co, set to Boise time.",
      },
      { t: "h", text: "The free-tier limits, and how we designed around them" },
      {
        t: "table",
        headers: ["Limit", "Value", "Our answer"],
        rows: [
          [
            "User seats",
            "2 (1 in use: hello@p5homeco.com)",
            "Employees work in the P5 admin panel; the panel talks to HubSpot through one service key.",
          ],
          [
            "Deal pipelines",
            "1",
            "One shared Sales Pipeline for all five brands - a P5 Brand field on every deal says which brand it belongs to.",
          ],
          [
            "Booking pages",
            "1",
            "The single page offers both meeting types: a 15-minute Discovery Call and a 1-hour Project Walk.",
          ],
          [
            "Workflows (automation builder)",
            "Not available on this plan",
            "All lead automation - timers, escalations, alerts - runs in the P5 panel instead.",
          ],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "So where do I work?",
        text:
          "Day to day: the P5 panel. HubSpot is where the customer record lives and where you look at full history. If you find yourself editing deal stages by hand in HubSpot, check first whether the panel already does it for you.",
      },
      {
        t: "h", text: "The scheduling page" },
      {
        t: "p",
        text:
          "Customers book us at meetings-na2.hubspot.com/client3 (\"Meet with P5 Home Co\"). It offers 15-minute and 1-hour slots, Monday-Saturday 7:00am-6:00pm Mountain time, connected to the hello@p5homeco.com Google Calendar. Booked meetings appear on the contact's HubSpot timeline automatically.",
      },
    ],
  },
  {
    slug: "crm-structure",
    section: "hubspot",
    title: "Contacts, deals, and the other CRM building blocks",
    summary:
      "What each HubSpot object means at P5, and which fields (properties) we added.",
    lastVerified: "2026-08-22",
    verifies: ["hubspot-properties"],
    keywords: [
      "contact",
      "company",
      "deal",
      "lead",
      "task",
      "property",
      "properties",
      "activity",
      "record",
    ],
    blocks: [
      {
        t: "table",
        headers: ["HubSpot object", "At P5 it means"],
        rows: [
          [
            "Contact",
            "A person: name, email, phone. One person = one contact, even if they inquire twice.",
          ],
          [
            "Deal",
            "One potential job. The same person asking for a kitchen AND a deck has two deals. Deals move through the pipeline stages.",
          ],
          [
            "Company",
            "Rarely used - our customers are homeowners. Exists mainly for commercial or partner records.",
          ],
          [
            "Task",
            "A to-do attached to a contact or deal. The P5 panel is the primary task queue; HubSpot tasks are secondary.",
          ],
          [
            "Activity",
            "Anything that happened: an email, call, note, or meeting, shown on the record's timeline.",
          ],
        ],
      },
      { t: "h", text: "The P5 Lead Manager properties" },
      {
        t: "p",
        text:
          "We added 28 custom deal fields, all grouped under \"P5 Lead Manager\" so they are easy to find. The important ones:",
      },
      {
        t: "table",
        headers: ["Property", "What it holds"],
        rows: [
          ["P5 Brand", "Which of the six brands the deal belongs to"],
          ["Lead Source", "Where the lead came from (website, referral, Google...)"],
          ["Project Type", "One of the 20 project types (Kitchen Remodel, Detached ADU...)"],
          ["Service Area", "Which of the approved cities the property is in"],
          ["SLA Status / SLA Deadline", "The response promise: on track, due soon, breached, met, or after hours"],
          ["First Contact Attempt / First Two-Way Contact", "When we first tried, and when we first actually connected"],
          ["Next Action / Next Action Date", "What happens next on this deal, and when"],
          ["Appointment Date", "The scheduled visit"],
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "The P5 panel fills these fields when it syncs a deal. A sync never blanks a field a person typed in HubSpot - it only writes values it actually has.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "For anyone writing integrations",
        text:
          "Deal stages must be referenced by their internal stage IDs, never by their labels. HubSpot kept the original IDs when we renamed the default stages, so the stage labeled \"New Lead\" is stored as \"appointmentscheduled\". The mapping table lives in the sales-pipeline article and in code at app/lib/integrations/hubspot-map.ts.",
      },
    ],
  },
  {
    slug: "sales-pipeline",
    section: "hubspot",
    title: "The sales pipeline, stage by stage",
    summary:
      "All eight stages of the one shared pipeline: what each means, what moves a deal forward, and what to do when one is stuck.",
    lastVerified: "2026-08-22",
    verifies: ["hubspot-pipeline"],
    keywords: [
      "pipeline",
      "deal stage",
      "stage",
      "new lead",
      "contacting",
      "estimate sent",
      "decision pending",
      "closed won",
      "closed lost",
      "why is this deal in this stage",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Every brand shares one pipeline (\"Sales Pipeline\"). A deal is always in exactly one of these eight stages. Moving a deal is a human decision - nothing moves a deal automatically.",
      },
      {
        t: "table",
        headers: ["#", "Stage", "It means", "You enter it when", "To move on"],
        rows: [
          [
            "1",
            "New Lead",
            "Just arrived; nobody has reached out yet.",
            "The lead is created (website form, call, referral).",
            "A person makes the first contact attempt - within 5 business minutes.",
          ],
          [
            "2",
            "Contacting",
            "We are actively trying to reach them.",
            "First attempt made but no real conversation yet.",
            "A two-way conversation happens and a visit is booked.",
          ],
          [
            "3",
            "Appointment Scheduled",
            "A visit is on the calendar.",
            "The appointment is booked (record the date on the deal).",
            "The visit happens; we agree to estimate the work.",
          ],
          [
            "4",
            "Estimate in Progress",
            "We are pricing the job.",
            "After the visit, while the estimate is being built.",
            "The estimate is finished and sent to the customer.",
          ],
          [
            "5",
            "Estimate Sent",
            "The customer has our number.",
            "The estimate goes out.",
            "Follow up within 3 days; the customer engages.",
          ],
          [
            "6",
            "Decision Pending",
            "They are deciding.",
            "The customer confirms they are considering it.",
            "They say yes (Closed Won) or no (Closed Lost).",
          ],
          [
            "7",
            "Closed Won",
            "They said yes. This becomes a project.",
            "Agreement to proceed.",
            "Create the project (QuickBooks + P5 registry) - see Create a project.",
          ],
          [
            "8",
            "Closed Lost",
            "It is not happening.",
            "The customer declines or goes silent past the give-up point.",
            "Record the reason - required, so we learn why we lose.",
          ],
        ],
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Every open deal must always have: an owner, a next action, and a next action date. The panel flags any deal missing one - that flag is telling you what to fix.",
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "When a deal is moved into Closed Won or Closed Lost, HubSpot sets the close date automatically. That is the portal's only built-in automation - everything else (timers, escalation, staleness) runs in the P5 panel.",
      },
      {
        t: "callout",
        kind: "info",
        title: "If a deal is not moving",
        text:
          "A deal with no activity for 3 days is stale and gets flagged. Do the next action, or snooze it with a reason and a date, or close it honestly. A pipeline full of dead deals hides the live ones.",
      },
    ],
  },
  {
    slug: "lead-flow",
    section: "hubspot",
    title: "The lead lifecycle, end to end",
    summary:
      "The complete path from website form to QuickBooks project, exactly as our systems run it.",
    lastVerified: "2026-08-22",
    keywords: ["lead flow", "new lead", "lead lifecycle", "intake", "what happens to a lead"],
    blocks: [
      {
        t: "flow",
        title: "Lead lifecycle",
        steps: [
          {
            label: "Lead arrives",
            detail: "Website form, phone call, or referral - any brand.",
            kind: "human",
          },
          {
            label: "P5 intake creates the records",
            detail:
              "One contact + one deal, duplicate-checked (the same person resubmitting does not create a second deal). Response timer starts - or, after hours, is scheduled for the next business morning.",
            kind: "auto",
          },
          {
            label: "Deal syncs to HubSpot",
            detail: "Stage New Lead, with brand, source, project type, and SLA fields filled.",
            kind: "auto",
          },
          {
            label: "First human contact",
            detail:
              "Call, text, or email from the panel's Needs Your Attention board. Target: 5 business minutes. Escalates at 5, 15, 30, and 60 minutes if not.",
            kind: "human",
          },
          {
            label: "Qualify and book",
            detail:
              "Confirm what they need, which brand fits, and book the appointment (customers can also self-book on the scheduling page).",
            kind: "human",
          },
          {
            label: "Estimate built and sent",
            detail: "Stages: Estimate in Progress, then Estimate Sent, then Decision Pending.",
            kind: "human",
          },
          {
            label: "Won or lost",
            detail:
              "Closed Won leads to a project; Closed Lost requires a recorded reason.",
            kind: "human",
          },
          {
            label: "Project created",
            detail:
              "Customer + project in QuickBooks, project registered in the P5 panel. Accounting takes over from here.",
            kind: "human",
          },
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "Why a form submission never satisfies the response promise",
        text:
          "The system tracks two separate clocks: time to first HUMAN attempt, and time to first two-way conversation. The customer writing in does not count as us responding - only a person reaching out stops the first clock.",
      },
    ],
  },
  {
    slug: "hubspot-automations-and-tracking",
    section: "hubspot",
    title: "HubSpot automations and communication tracking",
    summary:
      "The complete (short) list of what HubSpot does automatically, and where to see a customer's full history.",
    lastVerified: "2026-08-22",
    keywords: [
      "automation",
      "workflow",
      "email tracking",
      "call log",
      "notes",
      "meeting",
      "timeline",
      "history",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Admins should never have to guess whether something happened automatically. Here is the complete list of what HubSpot itself does in our portal - it is short on purpose, because our plan has no workflow builder and the real automation lives in the P5 panel.",
      },
      {
        t: "table",
        headers: ["Automation", "Trigger", "What HubSpot does", "You"],
        rows: [
          [
            "Close date stamp",
            "A deal moves to Closed Won or Closed Lost",
            "Sets the deal's close date to today",
            "Nothing",
          ],
          [
            "Contact from email",
            "hello@p5homeco.com corresponds with someone new",
            "Creates a contact owned by Client Services",
            "Review: this also captures vendors and newsletters - not every auto-created contact is a lead",
          ],
          [
            "Meeting booked",
            "A customer books on the scheduling page",
            "Creates the meeting on the contact's timeline and the Google Calendar",
            "Show up",
          ],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Everything else is the P5 panel",
        text:
          "SLA timers, escalation alerts, stale-deal flags, missing-owner checks - none of that is HubSpot. If an automation seems broken, check the P5 panel's health page first, not HubSpot.",
      },
      { t: "h", text: "Where to see the full history of a lead or customer" },
      {
        t: "steps",
        items: [
          "Open the contact (or deal) in HubSpot.",
          "The middle column is the timeline: every email, logged call, note, and meeting, newest first.",
          "Emails to and from hello@p5homeco.com (and the brand aliases) log automatically because Gmail is connected.",
          "Calls and texts made from the P5 panel are logged as outcome entries on the deal - the panel's lead page shows the same history.",
        ],
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Anything that happened off-system (a conversation at the supply house, a text from your personal phone) must be logged as a note - the record is only as good as what reaches it.",
      },
    ],
  },
];
