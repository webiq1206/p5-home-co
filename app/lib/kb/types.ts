/**
 * Knowledge Center content model.
 *
 * Articles are data, not prose files: every page is a typed list of blocks.
 * That is what makes the rest of the system possible - search indexes the
 * same blocks the page renders, Ask P5 quotes them without inventing
 * anything, and drift checks can flag exactly the articles whose facts they
 * watch (via `verifies`). One source, three consumers, no copies.
 */

export type SectionId =
  | "how-p5-works"
  | "quickbooks"
  | "hubspot"
  | "workflows"
  | "procedures"
  | "automations"
  | "reporting"
  | "troubleshooting"
  | "faq"
  | "glossary"
  | "future";

export type Section = {
  id: SectionId;
  title: string;
  /** One plain sentence: what a reader finds inside. */
  blurb: string;
};

export const SECTIONS: Section[] = [
  {
    id: "how-p5-works",
    title: "How P5 Works",
    blurb: "The big picture: how a lead becomes a project, and which system owns what.",
  },
  {
    id: "quickbooks",
    title: "QuickBooks Online",
    blurb: "Money: projects, costs, bills, invoices, payments, and the reports that matter.",
  },
  {
    id: "hubspot",
    title: "HubSpot",
    blurb: "Leads and customers: contacts, deals, the pipeline, and follow-up.",
  },
  {
    id: "workflows",
    title: "P5 Workflows & Integrations",
    blurb: "What the P5 admin panel itself does, and how the systems connect.",
  },
  {
    id: "procedures",
    title: "Common Admin Procedures",
    blurb: "Step-by-step instructions for the tasks you will actually do.",
  },
  {
    id: "automations",
    title: "Automated Processes",
    blurb: "Every automation we run: what triggers it, what it does, what you should expect.",
  },
  {
    id: "reporting",
    title: "Financial Reporting",
    blurb: "The daily report, the Money Run, and the QuickBooks reports we rely on.",
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    blurb: "When something looks wrong: what to check, in order.",
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    blurb: "Short answers to the questions people ask most.",
  },
  {
    id: "glossary",
    title: "System Glossary",
    blurb: "Plain-language definitions for every term the systems use.",
  },
  {
    id: "future",
    title: "Future Integrations",
    blurb: "What is planned but deliberately not connected yet, and why.",
  },
];

/**
 * Callout kinds. The three the whole Knowledge Center leans on:
 *  - automatic: "P5 does this for you" - no human involvement.
 *  - action:    "You need to do this" - a person must act.
 *  - review:    "Check this" - the system did something a person should verify.
 */
export type CalloutKind = "automatic" | "action" | "review" | "warning" | "info";

export type FlowStep = {
  label: string;
  detail?: string;
  /** Who does it: auto = the system, human = a person, review = person checks. */
  kind?: "auto" | "human" | "review";
};

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "steps"; title?: string; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "callout"; kind: CalloutKind; title?: string; text: string }
  | { t: "table"; headers: string[]; rows: string[][] }
  | { t: "flow"; title?: string; steps: FlowStep[] }
  | { t: "faq"; items: { q: string; a: string }[] }
  | { t: "terms"; items: { term: string; def: string }[] }
  | { t: "links"; title?: string; items: { label: string; href: string }[] };

export type Article = {
  slug: string;
  section: SectionId;
  title: string;
  /** One sentence: what this page tells you. Shown in lists and search. */
  summary: string;
  /** ISO date the facts on this page were last checked against the live systems. */
  lastVerified: string;
  /** Drift-check keys that watch this article (see app/lib/kb/drift.ts). */
  verifies?: string[];
  /** Extra search words people might use that the text itself does not. */
  keywords?: string[];
  blocks: Block[];
};
