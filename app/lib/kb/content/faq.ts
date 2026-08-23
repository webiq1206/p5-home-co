/**
 * Section: FAQ. Short answers with links to the page that goes deeper.
 * These entries also feed Ask P5 directly.
 */

import type { Article } from "../types.ts";

export const faq: Article[] = [
  {
    slug: "faq",
    section: "faq",
    title: "Frequently asked questions",
    summary: "Short answers to the questions admins ask most, with links to the full pages.",
    lastVerified: "2026-08-22",
    keywords: ["faq", "questions", "quick answers"],
    blocks: [
      {
        t: "faq",
        items: [
          {
            q: "How do I enter a subcontractor bill?",
            a: "Email it to ap@p5homeco.com (QuickBooks drafts it), then confirm vendor, project, phase, and item, and save - approval routes by amount. Full steps: Enter a subcontractor bill.",
          },
          {
            q: "Who needs to approve a bill?",
            a: "By amount: up to $2,500 the project manager; up to $10,000 add the manager; up to $50,000 manager plus an administrator; above $50,000 an administrator. These tiers are settings in Finance > Settings.",
          },
          {
            q: "What happens when a lead becomes a customer?",
            a: "The deal is marked Closed Won, then a person creates the customer and project in QuickBooks and registers the project in Finance > Projects. From there accounting and the daily report take over. See Create a project.",
          },
          {
            q: "How do I see how much money is left on a project?",
            a: "The project's card in the daily report (or Finance > Projects) shows Remaining budget = current budget - actual costs - open commitments. In QuickBooks, the project dashboard shows estimated vs actual live.",
          },
          {
            q: "Where do I see outstanding customer invoices?",
            a: "The daily report's company snapshot and each project card show open and overdue receivables; QuickBooks' A/R Aging report has the full list. Seriously overdue invoices also appear in Needs Your Attention.",
          },
          {
            q: "What happens after an estimate is accepted?",
            a: "Move the deal toward Closed Won, collect the deposit (it books to Customer Deposits 2100), create the project, and invoice progress from the estimate as work proceeds. See Accounts receivable.",
          },
          {
            q: "Why is this deal still in this stage?",
            a: "Nothing moves deals automatically - a deal is where a person left it. Check its next action and date; if it has been idle 3+ days it is flagged stale. Do the next action or close it honestly.",
          },
          {
            q: "How does a remodel project get entered into QuickBooks?",
            a: "As a project under the customer, brand class Boise Remodeling Co, with Build (03-*) phases and the standard items. Kitchens keep their cabinetry in the remodel - Cabinet Co is only for standalone cabinet jobs.",
          },
          {
            q: "When do vendors get paid?",
            a: "Weekly: the Money Run assembles Wednesday (preliminary) and Friday (final); payment happens Friday from Operating Checking, unless a vendor is on compliance hold.",
          },
          {
            q: "Why is a vendor's payment on hold?",
            a: "A required document is missing or expired (usually the W-9 or insurance), or a conditional lien waiver has not been accepted. The hold shows its reason and releases automatically when the document is verified.",
          },
          {
            q: "Do I ever need to log into HubSpot?",
            a: "Rarely. Day-to-day work happens in the P5 panel; HubSpot holds the customer record and full timeline. There are only 2 seats, used by the service account and ownership.",
          },
          {
            q: "Why does the report say Safe Cash is provisional?",
            a: "Two inputs are still awaiting decisions: the minimum operating reserve (owner) and the tax reserve rate (CPA). Until both are confirmed in Finance > Settings, Safe Cash is computed but labeled provisional.",
          },
          {
            q: "Can the panel change my QuickBooks data?",
            a: "No. The panel reads QuickBooks and never writes money records. Anything you need changed in the books gets changed in QuickBooks itself.",
          },
          {
            q: "What is the ZZ Test customer/project?",
            a: "Setup-verification data flagged for deletion before launch. Ignore it in reports; an administrator will remove it (it is tracked in Needs Your Attention until gone).",
          },
        ],
      },
    ],
  },
];
