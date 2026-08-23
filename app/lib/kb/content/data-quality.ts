/**
 * Section: QuickBooks. The data-quality rulebook.
 *
 * The rule tables in this article are GENERATED from the rulebook the daily
 * inspection actually runs (app/lib/finance/qbo/audit-rules.ts). That is the
 * whole point: if somebody adds a rule, changes what it means, or reclassifies
 * who enforces it, this article changes with it. Documentation that is written
 * separately from the code it describes is documentation that is wrong within
 * a month, and the Knowledge Center's whole promise is that it is not.
 *
 * The prose around the tables is hand-written, because the reason we bother is
 * not derivable from the rules themselves.
 */

import {
  allRules,
  detectOnlyRules,
  qboEnforceableRules,
  type AuditRule,
} from "../../finance/qbo/audit-rules.ts";
import type { Article, Block } from "../types.ts";

const ENTITY_LABEL: Record<string, string> = {
  customer: "Customer",
  project: "Job",
  vendor: "Vendor",
  invoice: "Invoice",
  bill: "Bill",
  purchase_order: "Purchase order",
  subcontract: "Subcontract",
  connection: "The connection",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Fix today",
  urgent: "Fix this week",
  warning: "Clean up",
  info: "Tidy",
};

/** One row per rule: what it is, what it means, what it costs, how to fix it. */
function ruleTable(rules: AuditRule[]): Block {
  return {
    t: "table",
    headers: ["Rule", "What it means", "Why it matters", "How to fix it"],
    rows: rules.map((rule) => [
      `${ENTITY_LABEL[rule.entity] ?? rule.entity} - ${rule.label} (${SEVERITY_LABEL[rule.severity] ?? rule.severity})`,
      rule.plain,
      rule.consequence,
      rule.fix,
    ]),
  };
}

export const dataQuality: Article[] = [
  {
    slug: "data-quality-rules",
    section: "quickbooks",
    title: "The daily QuickBooks check, and every rule it runs",
    summary:
      "What the morning inspection looks at, why each rule exists, and which ones QuickBooks prevents rather than merely reports.",
    lastVerified: "2026-08-23",
    keywords: [
      "data quality",
      "audit",
      "check",
      "rules",
      "wrong",
      "missing",
      "misconfigured",
      "setup",
      "monitor",
      "alert",
      "notification",
      "validation",
    ],
    blocks: [
      {
        t: "p",
        text:
          "QuickBooks is agreeable. It will happily save a bill with no job on it, an invoice sent to the customer instead of to their job, or a subcontractor with no tax form on file. Nothing breaks that day. It breaks in March, when the job costs are wrong, the tax forms are late, and nobody can work out what happened.",
      },
      {
        t: "p",
        text:
          "So every morning, before the daily report goes out, the system inspects QuickBooks against the way P5 has agreed to work. Anything set up wrong or missing something becomes an item on Needs Your Attention, exactly like every other thing that needs a person - there is no second list to remember to check.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "This runs on its own",
        text:
          "The check runs each morning as part of the daily pass. Findings appear on Today and in the 6am email, and they close themselves the morning after somebody fixes the underlying record. Nothing has to be cleared by hand.",
      },
      { t: "h", text: "How urgent is urgent" },
      {
        t: "table",
        headers: ["Label", "What it means"],
        rows: [
          [
            "Fix today",
            "This is costing money or trust right now - a customer billed twice, a payment about to go out that should not.",
          ],
          [
            "Fix this week",
            "This will cost money soon, usually at tax time or when somebody chases a payment nobody was tracking.",
          ],
          [
            "Clean up",
            "The numbers are less reliable than they look and the work is harder than it needs to be.",
          ],
          [
            "Tidy",
            "Nothing breaks today, but the gap will be inconvenient the day somebody needs it.",
          ],
        ],
      },
      { t: "h", text: "Prevented versus detected" },
      {
        t: "p",
        text:
          "This distinction is the most useful thing on the page. Some of these rules QuickBooks itself enforces, once the right setting is switched on: the mistake becomes impossible, and nobody ever sees a finding for it. The rest QuickBooks does not care about at all, so the only thing standing between us and the mistake is this daily inspection, running the morning after.",
      },
      {
        t: "p",
        text:
          "Every rule that can be moved into the first group has been. The second group is not an oversight - it is the list of things QuickBooks offers no way to prevent.",
      },
      {
        t: "h",
        text: `Rules QuickBooks prevents (${qboEnforceableRules().length})`,
      },
      {
        t: "p",
        text:
          "These settings are switched on in the P5 company file. If one is ever switched off, the matching mistakes start happening again immediately - so treat this table as a configuration checklist, not as background reading.",
      },
      {
        t: "table",
        headers: ["Rule", "The setting that prevents it"],
        rows: qboEnforceableRules().map((rule) => [
          rule.label,
          rule.qboSetting ?? "-",
        ]),
      },
      ruleTable(qboEnforceableRules()),
      {
        t: "h",
        text: `Rules only the daily check catches (${detectOnlyRules().length})`,
      },
      ruleTable(detectOnlyRules()),
      {
        t: "callout",
        kind: "warning",
        title: "The two worth reading twice",
        text:
          "Charging a customer twice for one thing, and billing past what the contract allows, are the only findings on this list that damage a relationship rather than a number. Customers find both. Everything else is fixable in private.",
      },
      { t: "h", text: "Common questions" },
      {
        t: "faq",
        items: [
          {
            q: "An item disappeared without anyone touching it. Is that a bug?",
            a: "No - that is the design. Each morning the check re-derives everything from scratch. If the underlying record has been fixed, the item closes itself and is marked 'Fixed in QuickBooks'. Items only need a person to fix the record, never to tidy the list.",
          },
          {
            q: "Something on the list is not actually a problem. What now?",
            a: "Say so rather than ignoring it. Either the record needs a change QuickBooks can see, or the rule is wrong for how P5 works - and a rule that is wrong should be changed, not tolerated. A list with known-false items on it trains everyone to skim past the real ones.",
          },
          {
            q: "Why does the same problem sometimes appear on two records?",
            a: "Duplicates are reported on both copies, because either one could be the keeper. You cannot tell from the finding alone which record should survive a merge - that takes a person looking at the history on both.",
          },
          {
            q: "Can I run it now instead of waiting for the morning?",
            a: "Yes. Finance > Today > QuickBooks check has a 'Check QuickBooks now' button for administrators. It runs exactly the same pass, so it is the right way to confirm a fix actually cleared.",
          },
          {
            q: "The check says QuickBooks has not been read recently. Does that make the rest of the list wrong?",
            a: "It makes it stale, which is worse than wrong because it looks fine. Every other finding is judged against the last data we pulled. Fix the connection first, then re-run the check before trusting anything else on the page.",
          },
        ],
      },
      {
        t: "links",
        title: "Where to go",
        items: [
          { label: "The live findings", href: "/admin/finance/data-quality" },
          { label: "Everything else needing a person", href: "/admin/finance" },
          { label: "The connection itself", href: "/admin/finance/health" },
        ],
      },
      {
        t: "p",
        text: `There are ${allRules().length} rules in total. They are defined in one place in the code, and this article is generated from that same place - so what you have just read is what actually ran this morning, not a description of it written at some point in the past.`,
      },
    ],
  },
];
