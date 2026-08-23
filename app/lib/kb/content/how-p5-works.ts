/**
 * Section: How P5 Works. The orientation pages every new admin reads first.
 * Facts verified against the live systems on the date each article carries.
 */

import type { Article } from "../types.ts";

export const howP5Works: Article[] = [
  {
    slug: "the-big-picture",
    section: "how-p5-works",
    title: "The big picture: from lead to finished project",
    summary:
      "How one customer moves through our three systems, from first website visit to final payment.",
    lastVerified: "2026-08-22",
    keywords: ["lifecycle", "overview", "start here", "how it works", "customer journey"],
    blocks: [
      {
        t: "p",
        text:
          "P5 Home Co runs on three systems. Each one has a single, clear job. You never have to wonder where something lives - this page shows the whole journey once, and the rest of the Knowledge Center explains each step in detail.",
      },
      {
        t: "table",
        headers: ["System", "Its one job", "Where"],
        rows: [
          [
            "P5 Admin Panel",
            "Where you work every day: leads, follow-up, finances, this Knowledge Center.",
            "p5homeco.com/admin",
          ],
          [
            "HubSpot",
            "The customer list. Who inquired, who we are talking to, what stage they are at.",
            "app-na2.hubspot.com",
          ],
          [
            "QuickBooks Online",
            "The money. Every invoice, bill, payment, and account balance.",
            "qbo.intuit.com",
          ],
        ],
      },
      { t: "h", text: "The journey of one customer" },
      {
        t: "flow",
        title: "Lead to finished project",
        steps: [
          {
            label: "Someone asks for work",
            detail: "They fill out a website form, call, or come from a referral.",
            kind: "human",
          },
          {
            label: "P5 records the lead",
            detail:
              "The admin panel creates the contact and the deal, starts the response timer, and syncs the record to HubSpot.",
            kind: "auto",
          },
          {
            label: "A person responds fast",
            detail:
              "Our promise: a human reaches out within 5 business minutes. The panel escalates if that slips.",
            kind: "human",
          },
          {
            label: "Appointment and estimate",
            detail:
              "We meet the customer, then build the estimate in QuickBooks on their project.",
            kind: "human",
          },
          {
            label: "Customer says yes",
            detail:
              "The deal is marked Closed Won in the pipeline. The project moves to contract and deposit.",
            kind: "human",
          },
          {
            label: "Project runs in QuickBooks",
            detail:
              "Costs, vendor bills, purchase orders, and customer invoices all attach to the project.",
            kind: "human",
          },
          {
            label: "P5 watches the money",
            detail:
              "The panel syncs QuickBooks daily, checks budgets and margins, and emails the daily financial report.",
            kind: "auto",
          },
          {
            label: "Project completes",
            detail:
              "Final invoice, final payment, lien waivers collected, and a final look at what the project actually earned.",
            kind: "review",
          },
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "One rule that keeps everything sane",
        text:
          "Each piece of information has exactly one home. Customer relationship details live in HubSpot. Money lives in QuickBooks. The P5 panel reads from both and adds the operational layer - it never becomes a second copy of either.",
      },
      {
        t: "links",
        title: "Go deeper",
        items: [
          { label: "One company, five brands", href: "/admin/kb/one-company-five-brands" },
          { label: "Which system owns which data", href: "/admin/kb/who-owns-what-data" },
          { label: "The sales pipeline, stage by stage", href: "/admin/kb/sales-pipeline" },
          { label: "Projects and jobs in QuickBooks", href: "/admin/kb/projects-and-jobs" },
        ],
      },
    ],
  },
  {
    slug: "one-company-five-brands",
    section: "how-p5-works",
    title: "One company, five brands",
    summary:
      "P5 Home Co is one legal company. The five Boise brands are how we appear to customers - and QuickBooks tracks each one separately using classes.",
    lastVerified: "2026-08-22",
    verifies: ["qbo-classes"],
    keywords: [
      "operating company",
      "division",
      "class",
      "dba",
      "boise construction",
      "boise remodeling",
      "boise adu",
      "boise handyman",
      "boise cabinet",
      "brands",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Legally there is one company: P5 Home Co. LLC, in Meridian, Idaho. It has one QuickBooks file, one bank relationship, and one tax return. The five Boise companies are brands (DBAs - names the one company does business under), not separate legal companies.",
      },
      {
        t: "p",
        text:
          "Inside QuickBooks, each brand is a \"class\". A class is just a label QuickBooks puts on every transaction line so we can see each brand's income and costs separately - like a colored sticker on every dollar.",
      },
      {
        t: "table",
        headers: ["Class in QuickBooks", "Used for", "Main revenue account"],
        rows: [
          ["Boise Construction Co", "New builds and new residential construction", "4020"],
          ["Boise Remodeling Co", "Remodels, kitchens, bathrooms, additions", "4020"],
          ["Boise ADU Co", "Accessory dwelling units and garage conversions", "4020"],
          ["Boise Handyman Co", "Repairs, installations, service work", "4030"],
          ["Boise Cabinet Co", "Standalone cabinetry sold as Cabinet Co", "4040"],
          ["P5 Corporate / Shared", "Company overhead only - never a customer project", "-"],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Two rules people get wrong",
        text:
          "1) P5 Corporate / Shared is for overhead (rent, software, insurance) - never put a customer project on it. 2) Cabinets inside a kitchen remodel stay with Boise Remodeling Co. Only standalone cabinet jobs sold as Cabinet Co use the Cabinet Co class.",
      },
      {
        t: "h", text: "How a project gets its brand" },
      {
        t: "p",
        text:
          "Every project belongs to exactly one brand, chosen when the project is created. From then on, every estimate line, invoice line, and bill line for that project carries the brand's class. QuickBooks is set to track a class on every line and to warn when one is missing.",
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "QuickBooks warns you if you save a transaction line without a class, so brand tracking does not silently drift.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "When you create anything on a project (estimate, invoice, bill, purchase order), make sure the class matches the project's brand. One project = one brand = one class.",
      },
    ],
  },
  {
    slug: "who-owns-what-data",
    section: "how-p5-works",
    title: "Which system owns which information",
    summary:
      "The single-source-of-truth map: where each kind of information lives, and where you should go to change it.",
    lastVerified: "2026-08-22",
    keywords: ["source of truth", "where do I find", "where does it live", "system of record"],
    blocks: [
      {
        t: "p",
        text:
          "When the same fact lives in two places, one of them is always wrong eventually. So each kind of information has exactly one owner. To change something, change it in the system that owns it - the other systems read from there.",
      },
      {
        t: "table",
        headers: ["Information", "Owner", "What the others do"],
        rows: [
          [
            "Leads, contacts, deal stages",
            "HubSpot (synced from the P5 panel)",
            "The P5 panel creates and updates them; HubSpot is the CRM record.",
          ],
          [
            "Response timers, escalations, task queue",
            "P5 Admin Panel",
            "HubSpot shows SLA fields the panel writes, read-only.",
          ],
          [
            "Invoices, bills, payments, balances, the ledger",
            "QuickBooks Online",
            "The P5 panel keeps a read-only copy for dashboards and reports. It never writes money records.",
          ],
          [
            "Project registry: brand, budget, status, contingency",
            "P5 Admin Panel (Finance > Projects)",
            "Links each project to its QuickBooks customer record.",
          ],
          [
            "Vendor compliance: W-9s, insurance, lien waivers, holds",
            "P5 Admin Panel (Finance > Vendors)",
            "QuickBooks holds the vendor and its bills; compliance gates live here.",
          ],
          [
            "Email with customers",
            "Gmail (hello@p5homeco.com and brand aliases)",
            "Each brand sends from its own verified address.",
          ],
          [
            "This documentation",
            "Knowledge Center (in this panel)",
            "Watches the live systems and flags pages when configuration changes.",
          ],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Never build a second copy",
        text:
          "Do not keep side spreadsheets of invoices, budgets, or customer lists. If a screen here seems to be missing something, say so - the fix is to surface the owner's data, not to start a parallel list.",
      },
    ],
  },
];
