/**
 * Section: Glossary. Every term the systems use, in plain language. The
 * search engine also uses these definitions as synonyms, so a user who
 * types the plain phrase finds the technical page.
 */

import type { Article } from "../types.ts";

export const glossary: Article[] = [
  {
    slug: "glossary",
    section: "glossary",
    title: "System glossary",
    summary: "Plain-language definitions for every term you will meet in QuickBooks, HubSpot, and the P5 panel.",
    lastVerified: "2026-08-22",
    keywords: ["glossary", "definitions", "terms", "what does mean", "jargon"],
    blocks: [
      { t: "h", text: "Money terms" },
      {
        t: "terms",
        items: [
          { term: "Accounts receivable (AR)", def: "Money customers owe us - invoices sent but not yet paid." },
          { term: "Accounts payable (AP)", def: "Money we owe vendors - bills received but not yet paid." },
          { term: "Invoice", def: "The bill WE send a customer." },
          { term: "Bill", def: "The bill a vendor sends US." },
          { term: "Estimate", def: "Our priced proposal for a job. Once accepted, it is the budget and the basis for invoicing." },
          { term: "Purchase order (PO)", def: "A written commitment to buy from a vendor before the bill exists. Its open balance is a committed cost." },
          { term: "Committed cost", def: "Money promised but not yet billed - open purchase orders. Counts against the budget immediately." },
          { term: "Progress invoicing", def: "Billing an accepted estimate in slices (percentages or specific lines) as work proceeds." },
          { term: "Deposit (customer)", def: "Money received before work is done. Held in Customer Deposits (2100) as a liability until earned." },
          { term: "Undeposited Funds", def: "QuickBooks' waiting room for received payments that have not been deposited to the bank yet." },
          { term: "Gross profit", def: "Revenue minus direct project costs. Overhead comes out later." },
          { term: "Margin", def: "Gross profit as a percentage of revenue. The default project goal is 45%." },
          { term: "Budget variance", def: "The difference between what we planned to spend and what we are actually on course to spend." },
          { term: "Estimate to complete (ETC)", def: "Our current guess of the cost still to come on a project, beyond bills and commitments already known." },
          { term: "Safe Cash", def: "Cash actually spendable after protecting reserves, taxes, and required payments. The Money Run's key number." },
          { term: "Reconciliation", def: "Matching QuickBooks records against the bank statement until they agree exactly." },
          { term: "Retainage", def: "A percentage of payment held back until work is verified complete." },
          { term: "Contingency", def: "A budget reserve for surprises. Drawing it needs a reason; it is never a cost category." },
          { term: "Backlog", def: "Signed contract value not yet earned - future work already sold." },
          { term: "1099", def: "The IRS form we file for vendors paid $600+ per year. Why every vendor needs a W-9 on file." },
          { term: "W-9", def: "The tax form a vendor gives us with their legal name and tax ID. Required before first payment." },
          { term: "Lien waiver", def: "A vendor's signed statement giving up lien rights for work paid. Conditional = before payment clears; unconditional = after." },
          { term: "Trial balance", def: "An accountant's report proving the books balance - every debit has a credit." },
        ],
      },
      { t: "h", text: "QuickBooks terms" },
      {
        t: "terms",
        items: [
          { term: "Chart of accounts", def: "The numbered list of every bucket money can sit in or move through. Ours has numbered accounts like 1010 Operating Checking and 5040 Project Materials." },
          { term: "Class", def: "QuickBooks' brand label. Every transaction line carries one of our six classes so each brand reports separately." },
          { term: "Project", def: "A job folder under a customer collecting its estimates, invoices, bills, and profit." },
          { term: "Phase", def: "A part of a job (Framing, Plumbing, Cabinet Product). Phases belong to each project and come from the P5 taxonomy." },
          { term: "Cost group", def: "The kind of cost: Labor, Material, Equipment, Subcontractor, or Miscellaneous. Carried by the item automatically." },
          { term: "Item (product/service)", def: "The thing you pick on a transaction line. It carries the right accounts and cost group - 13 items cover everything." },
          { term: "P5 Project ID", def: "Our custom field carrying the P5 project number (P5-YYYY-####) on every document." },
          { term: "COGS / direct costs", def: "Costs that belong to a specific job (the 5xxx accounts), as opposed to overhead (6xxx)." },
        ],
      },
      { t: "h", text: "HubSpot terms" },
      {
        t: "terms",
        items: [
          { term: "CRM", def: "Customer relationship manager - the system that remembers every person and conversation. Ours is HubSpot." },
          { term: "Contact", def: "A person in HubSpot." },
          { term: "Deal", def: "One potential job, moving through the pipeline." },
          { term: "Pipeline / stage", def: "The eight steps a deal moves through, from New Lead to Closed Won or Closed Lost." },
          { term: "Property", def: "A field on a record. Our custom ones live in the P5 Lead Manager group." },
          { term: "Timeline / activity", def: "The record's history: every email, call, note, and meeting." },
          { term: "Stage ID", def: "The internal code for a pipeline stage. Renaming a stage does not change its ID - integrations must use IDs, not labels." },
        ],
      },
      { t: "h", text: "P5 panel terms" },
      {
        t: "terms",
        items: [
          { term: "SLA", def: "Service level agreement - our response promise: a human contact attempt within 5 business minutes of a lead arriving." },
          { term: "Needs Your Attention", def: "The exception queue (one for leads, one for finance). If it is empty, nothing needs you." },
          { term: "Watchdog", def: "The 5-minute background check that re-evaluates every open lead against the rules." },
          { term: "Money Run", def: "The weekly payment screen: preliminary Wednesday, final Friday." },
          { term: "Attention item", def: "One entry in the finance queue. Auto-created when a condition starts, auto-resolved when it clears; manual resolution requires a note." },
          { term: "Payment hold", def: "A block on paying a vendor, always with a reason (usually compliance). Releases need a reason too." },
          { term: "Draw", def: "A request for construction-loan funds, assembled into a frozen package for the lender." },
          { term: "Magic link", def: "The one-time sign-in link portals email to vendors and clients instead of passwords." },
          { term: "Sync", def: "The panel refreshing its read-only copy of QuickBooks or pushing deal fields to HubSpot." },
          { term: "Drift", def: "When live system configuration no longer matches this documentation. Detected nightly; flagged, never silently rewritten." },
        ],
      },
    ],
  },
];
