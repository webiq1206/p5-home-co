/**
 * Section: Future integrations - what is deliberately NOT connected, why,
 * and what unblocks each. Honest status beats optimistic status.
 */

import type { Article } from "../types.ts";

export const future: Article[] = [
  {
    slug: "future-integrations",
    section: "future",
    title: "What is planned but not connected yet",
    summary:
      "Handoff estimating, Facebook lead forms, bank feeds, payroll, and sales tax - each deliberately off, with what unblocks it.",
    lastVerified: "2026-08-22",
    keywords: ["future", "planned", "handoff", "facebook", "bank feed", "payroll", "roadmap", "not connected"],
    blocks: [
      {
        t: "p",
        text:
          "Several integrations are designed and even wired in code, but deliberately switched off. While off, they make no requests, raise no alerts, and show as \"Planned\" - never as \"Failed\". Here is each one, why it waits, and what turns it on.",
      },
      {
        t: "table",
        headers: ["Integration", "What it will do", "Why it is off", "Unblocked by"],
        rows: [
          [
            "Handoff (estimating)",
            "Create bids from qualified deals, track proposal status, and flow approved work toward QuickBooks",
            "Feature flag off by design; the estimating workflow currently lives in QuickBooks estimates",
            "Owner decision to adopt Handoff; then the stage mapping in the docs applies",
          ],
          [
            "Facebook Lead Ads",
            "Import ad-form leads straight into intake (duplicate-proof via the external lead id)",
            "The ad account (P5 Home Co, active) is located, but forms are not yet mapped to brands",
            "Owner decides which page/form belongs to which brand",
          ],
          [
            "Bank feeds",
            "Automatic import of bank and card transactions into QuickBooks for matching",
            "Bank credentials are owner-only; accounts 1010/1030/1040 are not yet linked",
            "Owner connects the banks inside QuickBooks",
          ],
          [
            "Payroll (QuickBooks Workforce)",
            "W-2 payroll, with Direct Labor re-pointed to 5010",
            "Tax structure (and therefore payroll) awaits the CPA's election",
            "CPA decision; until then the subscription sits unused",
          ],
          [
            "Idaho sales tax",
            "Correct tax on cabinet sales (installed vs supply-only differ in Idaho)",
            "CPA approval required for the treatment",
            "CPA ruling, then tax setup in QuickBooks",
          ],
          [
            "Idaho SS45-525 disclosures",
            "Auto-generated initial and final disclosure documents per residential project",
            "Templates sourced (IHBA forms) but awaiting attorney approval",
            "Attorney sign-off, then generation can be automated",
          ],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "The rule for adding anything new",
        text:
          "New integrations follow the same pattern as the existing ones: one system owns the data, the panel reads it, automations announce themselves in the registry, and this Knowledge Center gets a page before the switch flips. If you connect something, document it here in the same change.",
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "Do not build a direct HubSpot-to-QuickBooks sync. The intended path is deal -> project -> (eventually Handoff) -> QuickBooks; a second path would create duplicate customers and invoices.",
      },
    ],
  },
];
