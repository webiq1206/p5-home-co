/**
 * Section: Common admin procedures. Step-by-step, in task order, written so
 * a first-day admin can follow them without prior QuickBooks or HubSpot
 * experience. Each ends with "what happens next" so nobody wonders.
 */

import type { Article } from "../types.ts";

export const procedures: Article[] = [
  {
    slug: "handle-a-new-lead",
    section: "procedures",
    title: "Handle a new lead",
    summary: "The five-step loop that is most of the job, done from the Needs Your Attention board.",
    lastVerified: "2026-08-22",
    keywords: ["new lead", "respond", "call", "log outcome", "board"],
    blocks: [
      {
        t: "steps",
        items: [
          "Open the admin panel and choose Lead Manager from the menu at the top. That is the Needs Your Attention board. (The panel opens on the dashboard, which summarises the same board.)",
          "Start at the top - the first card is the most urgent.",
          "Tap Call, Text, or Email on the card and reach out. You have 5 business minutes from arrival, and the card tells you how long they have waited.",
          "Log what happened: pick the outcome that matches (spoke, left voicemail, emailed...).",
          "Confirm the next action and its date. Then take the next card.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "What happens next: your contact attempt stops the response timer, resolves any escalation alert, and syncs to the HubSpot deal. The lead reappears on the board only when its next action comes due.",
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "If the same person inquires again, do NOT create a second lead - the system already attached the new inquiry to the existing one. An empty board means you are done.",
      },
    ],
  },
  {
    slug: "create-a-project",
    section: "procedures",
    title: "Create a project (after a deal is won)",
    summary:
      "Both halves of project setup: the QuickBooks project that holds the money, and the P5 registry entry that holds the budget and status.",
    lastVerified: "2026-08-22",
    keywords: ["create project", "new project", "closed won", "project setup", "won deal"],
    blocks: [
      { t: "h", text: "In QuickBooks" },
      {
        t: "steps",
        items: [
          "Search Customers for the person. Create them only if they truly do not exist.",
          "On the customer, choose New project. Name it \"P5-YYYY-#### - short address / job\", using the next P5 project number.",
          "Add the phases this job needs from the P5 taxonomy (for example Site Work, Framing, Plumbing - or the CAB codes for a standalone cabinet job).",
          "Set the profit margin goal (default 45%).",
          "Build the estimate on the project: one line per piece of work, each with its phase and item, entering our cost and the customer price per line.",
          "Include the project-management fee line: enough labor and supervision to cover our team running the job, at the percentage of contract set in Finance > Settings (currently 15%). Every project carries this; it is how the team that runs the work gets paid.",
          "IMPORTANT: when picking the project on any form, click it in the dropdown so it is actually committed - typing the name without selecting it silently disables Save.",
        ],
      },
      {
        t: "callout",
        kind: "action",
        title: "Project-management fee is not optional",
        text:
          "Every estimate must carry a project-management fee equal to the percentage of contract set in Finance > Settings (currently 15%). It funds the team that manages and runs the project. On a $200,000 job that is $30,000. If an estimate does not include it, add it before the estimate goes out.",
      },
      { t: "h", text: "In the P5 panel (Finance > Projects)" },
      {
        t: "steps",
        items: [
          "Register the project with the same P5 number and name.",
          "Set the brand (division), project type, and contract type.",
          "Enter the contract amount and the original budget (the estimate's cost total), plus contingency if budgeted.",
          "Link the QuickBooks customer record so the money flows into the project card automatically.",
          "Set the status honestly: Contract Pending until signed, Deposit Pending until the deposit clears, then Active.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "What happens next: the project appears in the daily financial report with its own card, budget tracking starts, and the panel begins watching its margin and forecast freshness.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "Idaho disclosure gate",
        text:
          "Residential projects require the Idaho SS45-525 disclosure before contract. The attorney-approved templates are pending - until they exist, contract signing is gated. Ask the owner; do not improvise a disclosure.",
      },
    ],
  },
  {
    slug: "enter-a-subcontractor-bill",
    section: "procedures",
    title: "Enter a subcontractor or vendor bill",
    summary: "From the AP inbox (or by hand), code it in four picks, and let approval take over.",
    lastVerified: "2026-08-22",
    keywords: ["bill", "enter bill", "subcontractor bill", "vendor bill", "ap inbox", "code a bill"],
    blocks: [
      {
        t: "steps",
        items: [
          "Bills should arrive by email at ap@p5homeco.com (forwarded into QuickBooks' bill inbox). If you have a paper bill, photograph it and email it there.",
          "In QuickBooks, open the drafted bill. The AI pre-fills vendor, date, and amount - check every field against the document.",
          "Confirm the vendor (watch for near-duplicate names).",
          "Pick the PROJECT. Never leave a project cost unassigned.",
          "Pick the PHASE and the ITEM (for a sub, usually Subcontractor Work). The item sets the account and cost group.",
          "If a purchase order exists for this work, link it so the commitment closes.",
          "Save. The bill now waits for approval per the amount tiers.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "What happens next: approval routing by amount (up to $2,500 project manager; $10,000 adds the manager; $50,000 adds an administrator; above that administrator only), then the compliance gate checks the vendor's W-9 and insurance, and the bill joins the payment schedule. If the vendor is on hold, the bill waits and the hold appears in Needs Your Attention.",
      },
      {
        t: "callout",
        kind: "review",
        text:
          "A bill against a project that pushes it over budget will surface on the project card and in the daily report - that is expected behavior, not an error to suppress.",
      },
    ],
  },
  {
    slug: "pay-vendors",
    section: "procedures",
    title: "Pay vendors (the weekly Money Run)",
    summary: "Preliminary on Wednesday, final on Friday: decide once a week, from one screen.",
    lastVerified: "2026-08-22",
    keywords: ["pay", "payment", "money run", "pay bills", "pay subs", "when do vendors get paid"],
    blocks: [
      {
        t: "steps",
        items: [
          "Wednesday: open Finance > Money Run. The preliminary run shows cash by bucket, expected inflows, required payments (bills due within 7 days), anything on hold, and Safe Cash.",
          "Review the recommended list. Anything on hold shows why (missing W-9, expired insurance, waiver pending).",
          "Chase what unblocks payments: request documents, resolve waivers.",
          "Friday: the final run. Approve, then make the actual payments in QuickBooks (from 1010 Operating Checking).",
          "Record payments against the right bills so balances clear.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Automatic: the run assembles itself Wednesday and Friday; held vendors' bills are excluded from the recommended list; Safe Cash subtracts tax reserve, operating reserve, and required payments before telling you what is spendable.",
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "Never pay around a hold, and never treat overdue receivables as money you can spend this week. Both rules exist because breaking them quietly is how contractors go broke.",
      },
    ],
  },
  {
    slug: "invoice-a-customer",
    section: "procedures",
    title: "Invoice a customer",
    summary: "Progress-invoice from the estimate so billing always ties back to what was agreed.",
    lastVerified: "2026-08-22",
    keywords: ["invoice", "progress invoice", "bill customer", "deposit invoice", "final invoice"],
    blocks: [
      {
        t: "steps",
        items: [
          "Open the project in QuickBooks and find its accepted estimate.",
          "Choose Create invoice from the estimate.",
          "Pick how much: a percentage of the whole estimate, or specific lines/phases completed.",
          "Check the invoice: phases group cleanly for the customer, and the P5 Project ID field is filled.",
          "Send it from QuickBooks. Record the sent date as the deal/project activity.",
          "When payment arrives, use Receive payment against that invoice - never enter a payment with no invoice.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "What happens next: the invoice appears in the panel after sync, ages automatically, and - if it goes overdue - raises an attention item and shows in the daily report until paid. Deposits invoiced from an estimate's deposit request go to Customer Deposits (2100) until earned.",
      },
    ],
  },
  {
    slug: "record-a-change-order",
    section: "procedures",
    title: "Record a change order",
    summary: "Price it, get approval in writing, then record it in both systems so contract and budget move together.",
    lastVerified: "2026-08-22",
    keywords: ["change order", "co", "extra work", "scope change", "budget change"],
    blocks: [
      {
        t: "steps",
        items: [
          "Price the change first: cost and customer price. No verbal go-aheads on money.",
          "Get the customer's written approval (the attorney-approved CO form once available; email approval at minimum).",
          "In QuickBooks: add the change to the project using the Change Order item (books to 4050 change-order revenue), on the right phase.",
          "In the P5 panel (Finance > Projects): record the approved amount so the revised contract and current budget update, with the reason.",
          "Invoice the change per its agreed terms - some COs are billed immediately, some at the next progress invoice.",
        ],
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Why both systems: QuickBooks carries the customer-facing money; the P5 registry carries the revised budget the health checks compare against. Record only one side and the project will look over budget (or under contract) forever.",
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "Contingency is not a change order. Using contingency covers a cost inside the existing contract (recorded as a contingency draw with a reason); a change order changes the contract itself.",
      },
    ],
  },
  {
    slug: "manage-users-and-portal-invites",
    section: "procedures",
    title: "Manage admin users and portal invites",
    summary: "Adding staff to the panel, and inviting vendors or clients to their portals.",
    lastVerified: "2026-08-22",
    keywords: ["user", "add user", "roles", "invite", "portal invite", "permissions"],
    blocks: [
      { t: "h", text: "Staff (admin panel)" },
      {
        t: "p",
        text:
          "Staff sign in at p5homeco.com/admin with their P5 Google Workspace account. Each user has one role: administrator (everything), manager (leads + finance), sales rep (their own leads), or project manager (project work, no pipeline controls). Finance pages are visible to administrators and managers only.",
      },
      { t: "h", text: "Vendors and clients (portals)" },
      {
        t: "steps",
        items: [
          "Open Finance > Portal.",
          "Invite the contact by email, scoped to their vendor record (vendors) or their project (clients).",
          "They receive a sign-in link by email - no password to manage.",
          "To revoke access, disable the contact on the same page; their sessions end immediately.",
        ],
      },
      {
        t: "callout",
        kind: "info",
        text:
          "HubSpot seats are not involved: employees do not get HubSpot logins (the free plan has 2 seats). The panel is the working surface.",
      },
    ],
  },
  {
    slug: "win-a-handoff-bid",
    section: "procedures",
    title: "Turn a won Handoff bid into a QuickBooks project and signed contracts",
    summary:
      "The exact steps when a client accepts a Handoff estimate: get the numbers into QuickBooks, create the customer and project, and send the right contracts for signature.",
    lastVerified: "2026-08-24",
    keywords: [
      "handoff",
      "won bid",
      "accepted estimate",
      "estimate",
      "bid",
      "new project intake",
      "start a job",
      "client said yes",
      "move forward",
      "send contracts",
      "closed won",
    ],
    blocks: [
      {
        t: "p",
        text:
          "This is what to do the moment a client accepts a Handoff estimate and wants to move forward. It covers getting the exact bid into QuickBooks, creating the customer and project, and sending the contracts.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "Handoff and QuickBooks are not connected",
        text:
          "By the owner's decision, Handoff is standalone for now. Nothing pushes a Handoff estimate into QuickBooks automatically; the numbers are re-keyed by hand using the steps below. When that connection is built, this page changes in the same edit.",
      },
      { t: "h", text: "1. Confirm the winning numbers in Handoff" },
      {
        t: "steps",
        items: [
          "Open the accepted estimate in Handoff and mark it won there, so Handoff stays the source of truth for what the client agreed to.",
          "Note the final contract total and the line-by-line breakdown you will re-enter: scope, quantities, our cost, and the customer price.",
          "Confirm the project address, because every project-related contract must carry it.",
        ],
      },
      { t: "h", text: "2. Create or confirm the customer in QuickBooks" },
      {
        t: "steps",
        items: [
          "Search Customers first. Create the customer only if they truly do not already exist, so you never split one client across two records.",
          "Enter their name, billing address, email, and phone.",
        ],
      },
      { t: "h", text: "3. Create the project and key the estimate" },
      {
        t: "steps",
        items: [
          "On the customer, choose New project. Name it \"P5-YYYY-#### - short address / job\" using the next P5 project number.",
          "Add the phases this job needs from the P5 taxonomy (for example Site Work, Framing, Plumbing, or the CAB codes for a standalone cabinet job).",
          "Set the profit margin goal (default 45%).",
          "Re-enter the Handoff estimate on the project: one line per piece of work, each with its phase and item, with our cost and the customer price. The totals should match the Handoff estimate the client accepted.",
          "Add the project-management fee line at the percentage of contract set in Finance > Settings (currently 15%). Every project carries it; it funds the team that runs the job.",
          "Click the project in the dropdown so it is committed before saving; typing the name without selecting it silently disables Save.",
        ],
      },
      {
        t: "callout",
        kind: "action",
        title: "Cross-check before you send anything",
        text:
          "The QuickBooks estimate total, minus the project-management fee, should reconcile to what Handoff shows the client accepted. If they do not match, find out why before contracts go out; a contract built on the wrong number is worse than a slow one.",
      },
      { t: "h", text: "4. Register the project in the P5 panel" },
      {
        t: "steps",
        items: [
          "In Finance > Projects, register the project with the same P5 number and name.",
          "Set the brand (division), project type, and contract type (build-only or design-build).",
          "Enter the contract amount and the original budget (the estimate's cost total), plus contingency if budgeted.",
          "Link the QuickBooks customer record so money flows into the project card automatically.",
          "Set the status honestly: Contract Pending until signed, Deposit Pending until the deposit clears, then Active.",
        ],
      },
      { t: "h", text: "5. Send the contracts from QuickBooks" },
      {
        t: "steps",
        items: [
          "Open Sales > Contracts > Contract templates in QuickBooks. Contracts are sent from there, not from the P5 panel.",
          "Pick the client agreement that matches the job: new construction, remodel, or ADU (each pairs with its rider), or the standalone handyman or cabinet agreement.",
          "For a design-build job, include the design-build rider so the design fee and its credit are on paper.",
          "Fill the project address and the accepted figures, and attach the plan set for signature when the job has one.",
          "Send it for e-signature to the client, and collect every required signer.",
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Residential Idaho disclosure and attorney review",
        text:
          "Residential projects need the Idaho disclosure delivered before work begins; it is bundled into the client agreement packet so it signs together. Note that the contract templates are owner-accepted pending attorney review, not yet counsel-approved. If a job is unusual, ask the owner before sending.",
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Why re-key at all: keeping Handoff standalone means one clear source for what the client agreed to and one clear source for the books, with a deliberate human cross-check between them. When the volume justifies it, this becomes an automated import and this page is rewritten to match.",
      },
    ],
  },
];
