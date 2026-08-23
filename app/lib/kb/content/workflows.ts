/**
 * Section: P5 workflows and integrations - what the panel itself runs.
 * Sources: the code in this repository (app/lib/leads, app/lib/finance) and
 * docs/, which describe the same systems for developers.
 */

import type { Article } from "../types.ts";

export const workflows: Article[] = [
  {
    slug: "lead-intake-and-sla",
    section: "workflows",
    title: "Lead intake and the response promise (SLA)",
    summary:
      "How every lead enters one funnel, how the 5-minute response promise is measured, and what escalates when it slips.",
    lastVerified: "2026-08-22",
    keywords: [
      "sla",
      "intake",
      "response time",
      "five minutes",
      "escalation",
      "business hours",
      "after hours",
      "duplicate lead",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Every lead source converges on one intake path in the P5 panel. That single path is what guarantees the four promises: every lead is captured, every lead gets a fast human response, every lead has an owner and a next action, and anything overdue makes itself visible.",
      },
      { t: "h", text: "Business hours" },
      {
        t: "p",
        text:
          "Monday through Saturday, 7:00am to 6:00pm, Boise time. Sundays are closed. All timers count business minutes only - a lead arriving Saturday night is not \"late\" on Sunday; its clock starts Monday at 7:00am. (Hours and holidays are settings, not hardcoded.)",
      },
      { t: "h", text: "The escalation ladder" },
      {
        t: "table",
        headers: ["Business minutes with no human attempt", "What happens"],
        rows: [
          ["5", "The owner of the lead is notified"],
          ["15", "The owner and the manager are notified"],
          ["30", "The lead is marked Critical on the board"],
          ["60", "The designated administrator is notified"],
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Duplicate protection is automatic: the same person resubmitting the same request does not create a second lead. The same person with a genuinely different project (different brand) correctly creates a second deal under the same contact.",
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Snoozing a lead requires a reason and a future date - and a snooze can never hide a lead that has blown past its response deadline. The promise that somebody replies cannot be bought out.",
      },
    ],
  },
  {
    slug: "finance-os",
    section: "workflows",
    title: "The P5 Financial Operating System",
    summary:
      "What the Finance section of the panel actually does: sync, watch, calculate, and gate - while QuickBooks stays the only ledger.",
    lastVerified: "2026-08-22",
    keywords: [
      "finance",
      "financial operating system",
      "safe cash",
      "attention",
      "payment gate",
      "sync",
      "read only",
    ],
    blocks: [
      {
        t: "p",
        text:
          "The Finance section (Admin > Finance) sits on top of QuickBooks. It pulls a read-only copy of the books every day, and adds the judgment layer QuickBooks does not have: which projects are drifting, which vendors may not be paid, how much cash is actually safe to spend.",
      },
      {
        t: "table",
        headers: ["Page", "What it shows"],
        rows: [
          ["Attention", "The exception queue - everything that needs a person, ranked by severity"],
          ["Money Run", "The weekly cash screen: cash, expected inflows, required payments, Safe Cash"],
          ["Daily Report", "The daily email snapshot, viewable in the panel with history"],
          ["Projects", "The project registry: brand, budget, status, contingency, forecasts"],
          ["Vendors", "Compliance per vendor: W-9, insurance, lien waivers, holds"],
          ["Draws", "Construction-loan draw packages, for lender-funded projects"],
          ["Registries", "Subscriptions, insurance policies, and corporate deadlines"],
          ["Settings", "Every threshold: approval tiers, margin bands, reserves, report recipients"],
          ["Health", "Whether each integration and job actually ran, and the QuickBooks connection"],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "The one design rule",
        text:
          "The panel READS QuickBooks; it never writes money records into it. Invoices, bills, and payments are created in QuickBooks itself. That is why the panel can never corrupt the books - and why a number you fix in the panel but not in QuickBooks will come back on the next sync.",
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "The payment gate fails closed: if the approval rules are ever misconfigured, a payment requires the highest approval rather than none. Holds always carry a reason; releases require one too, and both are audited.",
      },
    ],
  },
  {
    slug: "qbo-sync-and-webhooks",
    section: "workflows",
    title: "How QuickBooks data reaches the panel",
    summary:
      "Three overlapping paths - webhooks, the daily sync, and manual refresh - so the panel's copy of the books stays current and self-heals.",
    lastVerified: "2026-08-22",
    keywords: ["sync", "webhook", "refresh", "stale data", "last sync", "connection"],
    blocks: [
      {
        t: "flow",
        title: "Data flow",
        steps: [
          {
            label: "Something changes in QuickBooks",
            detail: "An invoice is created, a bill paid, a balance moves.",
            kind: "human",
          },
          {
            label: "QuickBooks notifies the panel (webhook)",
            detail:
              "Within about a minute, QuickBooks pushes a signed notification; the panel re-fetches just the changed records.",
            kind: "auto",
          },
          {
            label: "Daily full sync",
            detail:
              "Once a day the panel re-pulls everything anyway - accounts, classes, customers, vendors, and all transactions - so a missed webhook can never cause lasting drift.",
            kind: "auto",
          },
          {
            label: "Manual refresh",
            detail:
              "The \"Refresh now\" button on Finance > Attention runs the same sync on demand.",
            kind: "human",
          },
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Every sync is idempotent - running it twice can never duplicate a record. Every run is logged on the Health page; failures surface as critical attention items, never silently.",
      },
      {
        t: "callout",
        kind: "review",
        text:
          "Each financial screen shows when its data was last synced. If a number looks stale, check Finance > Health before doubting the number: nine times out of ten the answer is \"the sync has not run since you changed it\".",
      },
    ],
  },
  {
    slug: "vendor-client-portals",
    section: "workflows",
    title: "The vendor and client portals",
    summary:
      "External vendors and clients get their own limited view at /portal - no passwords, strict scoping, and everything they submit lands in your attention queue.",
    lastVerified: "2026-08-22",
    keywords: ["portal", "vendor portal", "client portal", "magic link", "invite"],
    blocks: [
      {
        t: "p",
        text:
          "Vendors and clients sign in at p5homeco.com/portal with a one-time email link (valid 15 minutes, single use) that starts a 30-day session. No external user ever has a password.",
      },
      {
        t: "table",
        headers: ["Who", "Sees", "Never sees"],
        rows: [
          [
            "Vendor",
            "Their own compliance documents, payment statuses, lien waiver requests, and awarded projects",
            "Other vendors, P5 costs, or P5 margins",
          ],
          [
            "Client",
            "Their contract, approved change orders, invoices, payments, and balance",
            "Any cost, budget, vendor, or margin information - the revenue side only",
          ],
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Anything a vendor submits through the portal (an invoice reference, a waiver confirmation, a question) becomes an attention item until a person reviews it - nothing important lives only in an inbox.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Admins invite portal users from Finance > Portal. Disabling a contact there ends their access immediately.",
      },
    ],
  },
  {
    slug: "lender-draws",
    section: "workflows",
    title: "Construction loan draws",
    summary:
      "For loan-funded projects: how draw requests are gated, assembled, and frozen, so what the lender received never changes afterwards.",
    lastVerified: "2026-08-22",
    keywords: ["draw", "lender", "construction loan", "draw package", "funding"],
    blocks: [
      {
        t: "p",
        text:
          "A project funded by a construction loan gets a lender configuration (contact, loan number, approved budget, and which documents this lender requires) and a numbered sequence of draws at Finance > Draws.",
      },
      {
        t: "flow",
        title: "Draw lifecycle",
        steps: [
          { label: "Draft", detail: "The draw is being prepared.", kind: "human" },
          {
            label: "Readiness gate",
            detail:
              "The panel names every unmet lender requirement (inspection, lien waivers, invoices, photos) and blocks amounts beyond the remaining approved loan budget.",
            kind: "auto",
          },
          {
            label: "Submitted",
            detail:
              "The draw package - pay application, invoice schedule, vendor schedule, waiver register, history - assembles automatically and freezes as a snapshot.",
            kind: "auto",
          },
          { label: "Approved, then funded", detail: "The lender's decision and the money arriving.", kind: "human" },
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "A draw sitting submitted for 14+ days becomes an urgent attention item - money the project is waiting on gets a phone call, not patience.",
      },
    ],
  },
];
