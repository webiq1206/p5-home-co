/**
 * Section: Troubleshooting - symptom first, checks in order, and when to
 * stop and call an administrator. Written for the person seeing the
 * symptom, not the person who built the system.
 */

import type { Article } from "../types.ts";

export const troubleshooting: Article[] = [
  {
    slug: "troubleshooting-guide",
    section: "troubleshooting",
    title: "When something looks wrong",
    summary:
      "The common symptoms, what to check in order, and what never to do while investigating.",
    lastVerified: "2026-08-22",
    keywords: [
      "problem",
      "broken",
      "wrong number",
      "stale",
      "not working",
      "error",
      "help",
      "fix",
    ],
    blocks: [
      {
        t: "callout",
        kind: "warning",
        title: "Two rules before touching anything",
        text:
          "1) Never \"fix\" a financial number by typing over it - find where it comes from first, because the next sync will bring the wrong number back and now two systems disagree. 2) Never delete records to clean things up without an administrator - deletes are forever, and duplicates are usually merges, not deletes.",
      },
      { t: "h", text: "A financial number looks wrong or old" },
      {
        t: "steps",
        items: [
          "Check the \"last synced\" time on the screen. If it predates your change in QuickBooks, it is lag, not error.",
          "Open Finance > Attention and press \"Refresh now\" to sync and rescan.",
          "Still wrong? Open the record in QuickBooks itself - the panel only mirrors it. If QuickBooks is wrong, fix it there.",
          "If QuickBooks is right but the panel disagrees after a refresh, check Finance > Health for a failing sync, and tell an administrator.",
        ],
      },
      { t: "h", text: "The daily report did not arrive" },
      {
        t: "steps",
        items: [
          "Check Finance > Daily Report in the panel - if today's report is there, only the email leg failed.",
          "Check Finance > Settings: is the report enabled, and is accounting@p5homeco.com in the recipients?",
          "Check Finance > Health: if the email transport (SMTP) is not configured, the report is generated but only logged - an administrator needs to set the mail credentials.",
          "Check spam, and whether the daily job itself ran (Health shows every run).",
        ],
      },
      { t: "h", text: "\"QuickBooks is not connected\"" },
      {
        t: "steps",
        items: [
          "This banner means the panel's authorized link to QuickBooks is missing or expired - QuickBooks itself is fine.",
          "An administrator reconnects from Finance > Health with the Connect QuickBooks button (it must be authorized for P5 Home Co., never any other company file).",
          "After connecting, press Refresh now and confirm numbers appear.",
        ],
      },
      { t: "h", text: "A lead I expected is not on the board" },
      {
        t: "steps",
        items: [
          "Search the panel for the person - the board only shows what needs action; a lead with a future next-action date is filed under Upcoming.",
          "If they inquired twice, it was attached to their existing deal on purpose.",
          "If they are truly absent, check whether the source (website form) submitted successfully, and tell an administrator - intake failures are loud, not silent.",
        ],
      },
      { t: "h", text: "An estimate will not save in QuickBooks" },
      {
        t: "steps",
        items: [
          "The usual cause: the project was typed but never actually SELECTED from the dropdown. Click the project so it commits, and Save re-enables.",
          "Also check for an empty line row or an empty phase group in the grid - remove them; empty rows block saving.",
        ],
      },
      { t: "h", text: "A Knowledge Center page is flagged \"may be out of date\"" },
      {
        t: "steps",
        items: [
          "The nightly drift check found the live configuration no longer matches what the page documents (for example a renamed account or changed pipeline stage).",
          "Read the flag reason on the page - it names the exact difference.",
          "If the change was intentional: an administrator accepts it (which re-baselines and clears the flag) and the page gets updated.",
          "If the change was NOT intentional: fix the configuration back, and the flag clears on the next check.",
        ],
      },
      { t: "h", text: "\"Database unavailable\" on an admin page" },
      {
        t: "p",
        text:
          "The panel cannot reach its own database. Nothing is lost - QuickBooks and HubSpot are unaffected - but the panel cannot work until it is restored. This is an administrator/hosting issue; report it immediately.",
      },
      {
        t: "callout",
        kind: "info",
        title: "Still stuck?",
        text:
          "Ask P5 (in this Knowledge Center) answers questions from these pages. If the answer is not here, tell an administrator what you expected, what you saw, and the exact time - those three facts make every diagnosis faster.",
      },
    ],
  },
];
