/**
 * Section: Automated processes - the complete registry. If it runs without a
 * person, it is listed here with its trigger, action, result, and whether a
 * human needs to do anything. Nobody should ever guess whether something
 * happened automatically.
 */

import type { Article } from "../types.ts";

export const automations: Article[] = [
  {
    slug: "automatic-vs-your-job",
    section: "automations",
    title: "What runs itself, and what is your job",
    summary:
      "How to read the three markers used across this Knowledge Center and the panel: AUTOMATIC, ACTION REQUIRED, and REVIEW REQUIRED.",
    lastVerified: "2026-08-22",
    keywords: ["automatic", "manual", "action required", "review", "what do I need to do"],
    blocks: [
      {
        t: "p",
        text:
          "Every process at P5 is split into three kinds of work, and the documentation marks each one the same way everywhere:",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "AUTOMATIC",
        text:
          "The system does this with no human involved. You do not need to remember it, start it, or check that it started. If it fails, it reports itself on the Health page and in Needs Your Attention.",
      },
      {
        t: "callout",
        kind: "action",
        title: "ACTION REQUIRED",
        text:
          "A person must do this. The system will queue it, remind about it, and escalate it - but it will not do it. Responding to leads, coding bills, approving payments, and moving deals are always human work.",
      },
      {
        t: "callout",
        kind: "review",
        title: "REVIEW REQUIRED",
        text:
          "The system did something, and a person should verify it. AI-drafted bills, suggested bank matches, and auto-created contacts all fall here: usually right, never trusted blindly.",
      },
      {
        t: "p",
        text:
          "The master principle: safe, routine activity runs itself; anything needing judgment surfaces in Needs Your Attention. If the attention queues are empty, nothing needs you.",
      },
    ],
  },
  {
    slug: "automation-registry",
    section: "automations",
    title: "Every automation we run",
    summary:
      "The complete registry: trigger, what it does, the result you should expect, and whether you need to do anything.",
    lastVerified: "2026-08-22",
    keywords: [
      "automations list",
      "registry",
      "watchdog",
      "daily job",
      "what happens automatically",
      "scheduled",
    ],
    blocks: [
      { t: "h", text: "Lead side (P5 panel)" },
      {
        t: "table",
        headers: ["Automation", "Trigger", "It does", "You"],
        rows: [
          [
            "Lead intake",
            "A lead arrives from any source",
            "Creates contact + deal (duplicate-checked), starts the SLA clock, syncs to HubSpot",
            "Respond to the lead",
          ],
          [
            "Watchdog",
            "Every 5 minutes",
            "Re-checks every open deal against the rules: response deadlines, missing owners, overdue next actions, staleness",
            "Nothing - act on what it surfaces",
          ],
          [
            "SLA escalation",
            "5 / 15 / 30 / 60 business minutes with no human attempt",
            "Notifies owner, then manager, marks Critical, then notifies the administrator. Alerts auto-resolve when the condition clears",
            "Make the contact attempt",
          ],
          [
            "Alert de-duplication",
            "Every watchdog pass",
            "Unchanged conditions never re-alert; a higher escalation replaces the lower one",
            "Nothing",
          ],
          [
            "HubSpot deal sync",
            "A deal changes in the panel",
            "Writes the deal and its P5 fields to HubSpot (by stage ID, never label)",
            "Nothing",
          ],
        ],
      },
      { t: "h", text: "Money side (P5 panel + QuickBooks)" },
      {
        t: "table",
        headers: ["Automation", "Trigger", "It does", "You"],
        rows: [
          [
            "QuickBooks daily sync",
            "Daily job",
            "Pulls accounts, classes, customers, vendors, and all transactions into the panel's read-only copy",
            "Nothing",
          ],
          [
            "QuickBooks webhooks",
            "A record changes in QuickBooks",
            "Panel re-fetches the changed records within about a minute",
            "Nothing",
          ],
          [
            "Attention scanners",
            "Daily job (and manual refresh)",
            "Scan for expiring vendor documents, pending lien waivers, overdue invoices, subscription/insurance renewals, corporate deadlines, stale forecasts, missing budgets, unassigned bills, stuck draws, integration failures",
            "Work the queue; resolving requires a note",
          ],
          [
            "Compliance payment holds",
            "A required vendor document goes missing/expired",
            "Puts the vendor's payments on hold with a reason; releases automatically on verification",
            "Get the document",
          ],
          [
            "Money Run assembly",
            "Wednesdays (preliminary) and Fridays (final)",
            "Builds the cash screen: cash, inflows, required payments, holds, Safe Cash",
            "Review and pay on Friday",
          ],
          [
            "Daily financial report",
            "Daily job",
            "Assembles the company + project snapshot, compares to yesterday, emails accounting@p5homeco.com",
            "Read it (30-60 seconds)",
          ],
          [
            "AP intake + AI bill drafting",
            "A bill is emailed to ap@p5homeco.com",
            "QuickBooks drafts the bill from the attachment",
            "REVIEW: check every field, add project/phase/item",
          ],
          [
            "Bill and PO approvals",
            "A bill or commitment is saved",
            "Routes to approvers by amount tier",
            "Approve or reject",
          ],
          [
            "Recurring obligations",
            "A corporate obligation is completed",
            "Rolls the next occurrence forward automatically",
            "Nothing",
          ],
        ],
      },
      { t: "h", text: "HubSpot side" },
      {
        t: "table",
        headers: ["Automation", "Trigger", "It does", "You"],
        rows: [
          [
            "Close date stamp",
            "Deal moved to Closed Won / Closed Lost",
            "Sets the close date to today",
            "Nothing",
          ],
          [
            "Contact from email",
            "New correspondent at hello@p5homeco.com",
            "Creates a contact automatically",
            "REVIEW: not every auto-contact is a lead (vendors and newsletters get captured too)",
          ],
          [
            "Meeting booking",
            "Customer books on the scheduling page",
            "Creates the meeting on the timeline + Google Calendar",
            "Attend",
          ],
        ],
      },
      { t: "h", text: "Documentation" },
      {
        t: "table",
        headers: ["Automation", "Trigger", "It does", "You"],
        rows: [
          [
            "Knowledge Center drift check",
            "Daily job",
            "Compares live QuickBooks and HubSpot configuration against what this documentation says; flags affected pages and raises an attention item on mismatch",
            "Review the flagged page; accept the change or fix the configuration",
          ],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "How automations prove they ran",
        text:
          "Every scheduled job writes a run record with what it actually processed - a job that merely ran is not counted as a success. Finance > Health shows each one. A job that stops running becomes a critical attention item; silence is never assumed to be health.",
      },
    ],
  },
];
