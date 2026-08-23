/**
 * Section: Financial reporting - the daily report, the Money Run, and how
 * project health is scored. Explains the WHY behind each number, in the
 * same order the reader sees them in the email.
 */

import type { Article } from "../types.ts";

export const reporting: Article[] = [
  {
    slug: "daily-financial-report",
    section: "reporting",
    title: "The daily financial report",
    summary:
      "The morning email to accounting@p5homeco.com: what each section means, where every number comes from, and the accuracy rules behind it.",
    lastVerified: "2026-08-22",
    keywords: [
      "daily report",
      "email report",
      "morning report",
      "snapshot",
      "needs attention",
      "what changed",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Every day the panel assembles a snapshot of the whole business and every active project, compares it with yesterday, and emails it to accounting@p5homeco.com. It is built to be read on a phone in 30-60 seconds and to answer four questions: Where do we stand? Where does each project stand? What changed? What needs us right now?",
      },
      { t: "h", text: "The sections, in order" },
      {
        t: "table",
        headers: ["Section", "What it tells you"],
        rows: [
          [
            "NEEDS YOUR ATTENTION",
            "Open exceptions, worst first: overdue invoices, vendor holds, budget problems. If it says all clear, it means it.",
          ],
          [
            "COMPANY SNAPSHOT",
            "Cash by bucket, Safe Cash, receivables (with overdue), payables (with due-soon), and activity today / month to date / year to date.",
          ],
          [
            "WHAT CHANGED",
            "Only meaningful movement since yesterday: new bills, payments received, invoices sent, projects changing health.",
          ],
          [
            "ACTIVE PROJECTS",
            "One card per project: contract, budget, spent, committed, remaining, collected, outstanding, projected margin, and a health label.",
          ],
          [
            "UPCOMING",
            "Bills due and invoices expected over the next two weeks.",
          ],
          [
            "VIEW DETAILS",
            "Links straight into the panel and QuickBooks - the email should be enough, but the source is one tap away.",
          ],
        ],
      },
      { t: "h", text: "The accuracy rules" },
      {
        t: "list",
        items: [
          "Every number comes from synced QuickBooks data plus the P5 project registry - nothing is estimated by the report itself.",
          "A number that cannot be computed confidently is shown as what it is (for example \"No budget set\"), never as a guess.",
          "Overdue receivables are never counted as available cash.",
          "If QuickBooks is not connected or the sync failed, the report says so plainly instead of mailing stale numbers as fresh.",
          "The report states when its data was last synced.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Assembly, comparison to yesterday, and sending are all automatic (part of the daily finance job). The report is also viewable with history at Finance > Daily Report.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Recipients and the on/off switch live in Finance > Settings. Sending requires the email transport (SMTP) to be configured on the server - the Health page will say if it is not.",
      },
    ],
  },
  {
    slug: "money-run",
    section: "reporting",
    title: "The weekly Money Run",
    summary:
      "The cash discipline: what Safe Cash means, and why paying happens on Friday from one screen.",
    lastVerified: "2026-08-22",
    keywords: ["money run", "safe cash", "cash position", "pay week", "reserves"],
    blocks: [
      {
        t: "p",
        text:
          "The Money Run is the one screen for the weekly payment decision. Preliminary on Wednesday (see problems early), final on Friday (decide and pay). Its headline is deliberately blunt: \"P5 recommends paying $X this run.\"",
      },
      { t: "h", text: "How Safe Cash is calculated" },
      {
        t: "table",
        headers: ["Step", "Amount"],
        rows: [
          ["Start with", "Cleared operating cash (not reserves)"],
          ["Add", "Only high-confidence inflows: invoices due within 7 days, not disputed"],
          ["Subtract", "Required payments due before the next run"],
          ["Subtract", "The tax reserve requirement (a CPA-controlled rate on year-to-date income)"],
          ["Subtract", "The minimum operating reserve (an owner decision)"],
          ["Subtract", "Any other protected reserves"],
          ["Equals", "Safe Cash - what is genuinely spendable"],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "Until the owner confirms the operating reserve and the CPA confirms the tax rate, Safe Cash is marked PROVISIONAL - the math runs, but treat the number as directional, not gospel. Both pending decisions appear in Needs Your Attention.",
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Uncertain receivables are never in the inflow line. \"They will probably pay us next week\" is hope, and hope is not cash.",
      },
    ],
  },
  {
    slug: "project-financial-health",
    section: "reporting",
    title: "How project health is scored",
    summary:
      "What ON TRACK, WATCH, and ACTION REQUIRED actually mean, and the exact math behind remaining budget and projected margin.",
    lastVerified: "2026-08-22",
    keywords: [
      "on track",
      "watch",
      "action required",
      "health",
      "remaining budget",
      "budget used",
      "margin",
      "variance",
      "over budget",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Every project card carries one of three labels. They are words, not just colors, so they read the same on any screen:",
      },
      {
        t: "table",
        headers: ["Label", "Means", "Rule"],
        rows: [
          [
            "ON TRACK",
            "Budget and margin are where they should be.",
            "Projected margin within 2 points of the project's goal, and funding healthy.",
          ],
          [
            "WATCH",
            "Something is approaching a limit.",
            "Projected margin 2-5 points below goal, or cash held for the project is getting thin.",
          ],
          [
            "ACTION REQUIRED",
            "A financial issue needs a person now.",
            "Projected margin more than 5 points below goal, a projected loss, budget exhausted, or the project is spending P5's money instead of the customer's.",
          ],
        ],
      },
      { t: "h", text: "The math, spelled out" },
      {
        t: "table",
        headers: ["Number", "Formula"],
        rows: [
          ["Revised contract", "Original contract + approved change orders"],
          ["Actual cost", "Vendor bills + direct purchases recorded on the project"],
          ["Committed", "Open purchase-order balances (promised but not yet billed)"],
          ["Remaining budget", "Current budget - actual cost - committed"],
          ["Budget used %", "(Actual + committed) / current budget"],
          ["Projected final cost", "Actual + committed + estimate-to-complete"],
          ["Projected gross profit", "Revised contract - projected final cost"],
          ["Projected margin %", "Projected gross profit / revised contract"],
          ["Customer balance", "Revised contract - payments received"],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "Why \"committed\" matters so much",
        text:
          "A signed purchase order is money already spent - the bill just has not arrived. Remaining budget subtracts commitments precisely so a project cannot look healthy while its POs quietly exceed the budget. The margin bands (2 and 5 points) are settings, not constants.",
      },
      {
        t: "callout",
        kind: "review",
        text:
          "The projection is only as fresh as the estimate-to-complete. Update the ETC on Finance > Projects after each project review; at 30 days old it is flagged stale automatically.",
      },
    ],
  },
];
