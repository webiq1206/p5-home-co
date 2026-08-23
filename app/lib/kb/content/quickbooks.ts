/**
 * Section: QuickBooks Online. Documents the ACTUAL P5 tenant configuration
 * (QBO Advanced, realm 9341 4577 7058 0983), inspected live in the tenant.
 * Nothing here is generic QuickBooks advice; where P5 differs, P5 wins.
 */

import type { Article } from "../types.ts";

export const quickbooks: Article[] = [
  {
    slug: "qbo-overview",
    section: "quickbooks",
    title: "Our QuickBooks setup at a glance",
    summary:
      "What QuickBooks is for at P5, which features are switched on, and the few facts about our file everyone should know.",
    lastVerified: "2026-08-22",
    verifies: ["qbo-connection", "qbo-key-accounts"],
    keywords: ["quickbooks", "qbo", "setup", "configuration", "advanced", "settings"],
    blocks: [
      {
        t: "p",
        text:
          "QuickBooks Online (QBO) is our accounting system - the single home for every dollar. If a number is about money, QuickBooks is where it is true. We use the Advanced plan under the login accounting@p5homeco.com.",
      },
      { t: "h", text: "What is switched on in our file" },
      {
        t: "table",
        headers: ["Feature", "State", "What it means for you"],
        rows: [
          [
            "Account numbers",
            "On",
            "Every account has a number (like 5040 Project Materials), so people can say numbers instead of long names.",
          ],
          [
            "Class tracking (per line)",
            "On, with a warning if missing",
            "Every transaction line is labeled with a brand. See One company, five brands.",
          ],
          [
            "Projects",
            "On",
            "Each job is a project under its customer, with its own dashboard of income, costs, and profit.",
          ],
          [
            "Progress invoicing",
            "On",
            "We can invoice a percentage of an estimate as work proceeds, instead of all at once.",
          ],
          [
            "Purchase orders",
            "On",
            "We can commit to a vendor cost before the bill arrives, and the project shows it as a committed cost.",
          ],
          [
            "Custom field: P5 Project ID",
            "On (invoices, estimates, credit memos, POs, bills, vendor credits)",
            "Carries the P5 project number (like P5-2026-0001) on every document.",
          ],
          [
            "Estimate deposits",
            "On",
            "A requested deposit on an estimate flows to the Customer Deposits account (2100) until earned.",
          ],
          [
            "Payroll (Workforce Premium)",
            "Subscribed but unused",
            "Payroll is deferred until the CPA settles the tax structure. Do not run payroll.",
          ],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Test data is still in the file",
        text:
          "The customer \"ZZ Test Customer\" and project \"ZZ TEST - Verification Only - Delete Before Launch\" (with test transactions totalling $5,937.50 income and $8,000 costs) were used to verify the setup. They must be deleted before real business starts. Until then, ignore them in every report.",
      },
      {
        t: "h", text: "Decisions still waiting on professionals" },
      {
        t: "p",
        text:
          "Some settings are deliberately unfinished because they are professional decisions, not admin tasks: the tax election and accounting method (CPA), Idaho sales tax for cabinets (CPA), contract and lien-waiver templates (attorney), and bank connections (owner - bank logins are owner-only). The panel's Needs Your Attention list tracks these; do not work around them.",
      },
    ],
  },
  {
    slug: "projects-and-jobs",
    section: "quickbooks",
    title: "Projects and jobs",
    summary:
      "How a P5 job lives in QuickBooks: creating it, naming it, budgeting it, and how every cost and invoice finds its way onto it.",
    lastVerified: "2026-08-22",
    keywords: [
      "project",
      "job",
      "new project",
      "create project",
      "budget",
      "phases",
      "profitability",
      "estimated cost",
      "margin goal",
    ],
    blocks: [
      {
        t: "p",
        text:
          "In QuickBooks, a project is a folder under a customer that collects everything about one job: the estimate, invoices, bills, purchase orders, and payments. Open the project and you see what it earns, what it costs, and the profit - live.",
      },
      { t: "h", text: "How a project is born" },
      {
        t: "steps",
        items: [
          "The deal is won in the pipeline (Closed Won).",
          "An admin creates the customer in QuickBooks if they are new. Search first - never create a duplicate.",
          "Create the project under that customer. Name it with the P5 project number and a short address, like \"P5-2026-0001 - 412 Alder St Kitchen\".",
          "Set the brand: every line on this project will carry the brand's class.",
          "Add the phases this project actually needs (see Cost codes and phases). Phases belong to the project - you add them once at creation.",
          "Set the profit margin goal on the project (the default target is 45%).",
          "Register the project in the P5 panel (Finance > Projects) with its brand, budget, contract type, and status.",
        ],
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Phases are per-project in QuickBooks - there is no global phase list. The P5 phase taxonomy (Plan, Design, Build, Cabinet) is the menu you choose from; you only add the phases the job needs.",
      },
      { t: "h", text: "How money attaches to a project" },
      {
        t: "p",
        text:
          "Every transaction answers three small questions, and then the accounting takes care of itself:",
      },
      {
        t: "list",
        items: [
          "WHICH JOB? Pick the project (this also determines the class/brand).",
          "WHICH PART OF THE JOB? Pick the phase (Plumbing, Framing, Cabinet Product...).",
          "WHAT KIND OF COST? Pick the item (Subcontractor Work, Project Materials...). The item automatically carries the right account and cost group.",
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Project + Phase + Item = fully coded. You never pick ledger accounts or cost groups by hand - the item does it. If you are choosing an account number on a bill, something is wrong.",
      },
      { t: "h", text: "Budgets and profitability" },
      {
        t: "p",
        text:
          "The estimate is the budget: it carries estimated cost, income, and margin per line, grouped by phase. As bills arrive, the project dashboard shows estimated vs actual for income, costs, and profit, and the Cost to complete report projects where the job will land. If the projected margin falls below the goal, QuickBooks shows a below-goal warning on the project.",
      },
      {
        t: "callout",
        kind: "review",
        text:
          "Review each active project's numbers at least weekly, and update the estimate-to-complete in the P5 panel. A forecast older than 30 days is treated as stale and gets flagged automatically.",
      },
      { t: "h", text: "Change orders" },
      {
        t: "p",
        text:
          "When the customer approves extra work, add it with the Change Order item so it books to change-order revenue (4050), and record the approved amount on the P5 project registry so the revised contract and budget move together. QuickBooks keeps a change log on every project.",
      },
      {
        t: "links",
        items: [
          { label: "Step-by-step: create a project", href: "/admin/kb/create-a-project" },
          { label: "Step-by-step: record a change order", href: "/admin/kb/record-a-change-order" },
          { label: "Cost codes and phases", href: "/admin/kb/cost-codes-and-cost-groups" },
          { label: "How project health is scored", href: "/admin/kb/project-financial-health" },
        ],
      },
    ],
  },
  {
    slug: "cost-codes-and-cost-groups",
    section: "quickbooks",
    title: "Cost codes, phases, and cost groups",
    summary:
      "The P5 cost structure: three build phases plus a cabinet track, five cost groups, and the handful of codes you must never post costs to.",
    lastVerified: "2026-08-22",
    keywords: [
      "cost code",
      "phase",
      "cost group",
      "labor",
      "material",
      "equipment",
      "subcontractor",
      "contingency",
      "warranty",
      "cabinet codes",
      "taxonomy",
    ],
    blocks: [
      {
        t: "p",
        text:
          "Every project cost gets two labels: a PHASE (which part of the job) and a COST GROUP (what kind of cost). Phases come from the locked P5 taxonomy below. Cost groups come automatically from the item you pick.",
      },
      { t: "h", text: "The phase taxonomy" },
      {
        t: "table",
        headers: ["Range", "Phase family", "Examples"],
        rows: [
          [
            "01-*",
            "Plan",
            "Home Inspection, Hazardous Material Testing, As-Builts, Schematic Architecture",
          ],
          [
            "02-*",
            "Design",
            "Architecture Design Development, Engineering, MEP Schematic, Plan Approvals",
          ],
          [
            "03-*",
            "Build",
            "Site Work, Foundation, Framing, HVAC, Electrical, Plumbing, Drywall, Flooring, Cabinetry/Countertops, Punch/Final Clean",
          ],
          [
            "CAB-*",
            "Cabinet (Boise Cabinet Co standalone jobs only)",
            "Design/Measure, Cabinet Product, Freight, Delivery, Installation, Countertops, Field Modifications",
          ],
        ],
      },
      {
        t: "callout",
        kind: "info",
        title: "The cabinet difference",
        text:
          "A standalone cabinet job sold as Boise Cabinet Co uses the CAB-* phases and the cabinet items (which post to the 52xx cabinet cost accounts). Cabinets inside a construction, remodel, or ADU project use the normal Build phase 03-17 Cabinetry/Countertops and stay with that project's brand.",
      },
      { t: "h", text: "The five cost groups" },
      {
        t: "table",
        headers: ["Cost group", "Means"],
        rows: [
          ["Labor", "Our own people's time on the job"],
          ["Material", "Physical things that become part of the job"],
          ["Equipment", "Rentals and equipment used to do the work"],
          ["Subcontractor", "Work performed by another company"],
          ["Miscellaneous", "Permits, freight, and other direct costs (shown as \"Other\")"],
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "You never pick a cost group. Each item carries one (for example, Subcontractor Work is always the Subcontractor group). Choosing the right item does the coding.",
      },
      { t: "h", text: "Codes that exist but must NEVER receive actual costs" },
      {
        t: "table",
        headers: ["Code", "What it is", "Rule"],
        rows: [
          [
            "01-00-00 / 02-00-00 / 03-00-00",
            "Phase roll-ups",
            "Totals only. Post to the child codes underneath.",
          ],
          [
            "03-23-04 Contingency",
            "A budget reserve",
            "Never a cost. Real cost posts to the real work phase; the reserve is drawn down separately in the P5 panel with a reason.",
          ],
          [
            "03-23-03 Warranty",
            "Estimating reference",
            "Warranty work after close posts to ledger account 5090, flagged Warranty = Yes - not to this phase.",
          ],
          [
            "L-01-02 / L-03-00 Design-Build Team Labor",
            "Estimating roll-ups for pricing",
            "Actual labor posts to the work phase with the Labor cost group. Posting here would count it twice.",
          ],
          [
            "F-01-02 / F-03-00 Design-Build Fee",
            "Pricing/markup structures",
            "Fee revenue flows through the revenue accounts. Never booked as both a cost and a markup.",
          ],
          [
            "03-24-00 Furnishings",
            "Hidden by default",
            "Only activated when furnishings are actually in the contract.",
          ],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "The \"Other\" codes (01-00-99, 02-00-99, CAB-99) and the Other Direct Cost item always require a written description of what the cost was. They are not dumping grounds - a cost nobody can explain is a cost nobody can control.",
      },
    ],
  },
  {
    slug: "items-products-services",
    section: "quickbooks",
    title: "The 13 items (products & services)",
    summary:
      "The short list of items that codes every transaction, and the accounts each one posts to.",
    lastVerified: "2026-08-22",
    verifies: ["qbo-items"],
    keywords: ["items", "products and services", "service items", "coding", "which item"],
    blocks: [
      {
        t: "p",
        text:
          "P5 keeps the item list deliberately tiny: 13 items cover every kind of direct cost and every revenue stream. Detail lives in the line description, not in more items. Picking the item is how a transaction gets its accounts and its cost group - so \"which item do I pick?\" is the only coding question you ever answer.",
      },
      {
        t: "table",
        headers: ["Item", "Cost group", "Cost account", "Income account"],
        rows: [
          ["Direct Labor", "Labor", "5030 Subcontractors and Contract Labor", "4020"],
          ["Subcontractor Work", "Subcontractor", "5030 Subcontractors and Contract Labor", "4020"],
          ["Project Materials", "Material", "5040 Project Materials", "4020"],
          ["Equipment and Rentals", "Equipment", "5050 Project Equipment and Rentals", "4020"],
          ["Permits and Fees", "Miscellaneous", "5060 Permits and Direct Fees", "4020"],
          ["Freight and Delivery", "Miscellaneous", "5070 Freight and Delivery", "4020"],
          ["Other Direct Cost", "Miscellaneous", "5100 Other Direct Project Costs", "4070"],
          ["Design and Preconstruction Services", "Labor", "5030", "4010"],
          ["Handyman Service Work", "Subcontractor", "5030", "4030"],
          ["Change Order", "Miscellaneous", "5100 Other Direct Project Costs", "4050"],
          ["Cabinet Product", "Material", "5210 Cabinet Product Cost", "4040"],
          ["Cabinet Installation", "Subcontractor", "5270 Cabinet Installation Subcontractors", "4040"],
          ["Cabinet Freight and Delivery", "Miscellaneous", "5240 Cabinet Freight", "4040"],
        ],
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Direct Labor points at contract labor (5030) until real W-2 payroll is activated; then it will be re-pointed at 5010 Direct W-2 Labor. That switch waits on the CPA's payroll decision.",
      },
      {
        t: "callout",
        kind: "warning",
        text:
          "QuickBooks' built-in items \"Hours\" and \"Services\" exist but are not part of the P5 structure - do not use them on transactions.",
      },
    ],
  },
  {
    slug: "vendors-and-subcontractors",
    section: "quickbooks",
    title: "Vendors and subcontractors",
    summary:
      "Creating vendors without duplicates, keeping their paperwork current, and how compliance can put payments on hold.",
    lastVerified: "2026-08-22",
    keywords: [
      "vendor",
      "subcontractor",
      "sub",
      "w-9",
      "w9",
      "insurance",
      "compliance",
      "duplicate vendor",
      "payment hold",
      "1099",
    ],
    blocks: [
      {
        t: "p",
        text:
          "A vendor is anyone we pay: subcontractors, suppliers, rental companies. Vendors live in QuickBooks; their compliance paperwork (W-9, insurance certificates, lien waivers) is tracked in the P5 panel under Finance > Vendors.",
      },
      { t: "h", text: "\"Vendor\" or \"contractor\"? There is only one record" },
      {
        t: "p",
        text:
          "This trips people up constantly, so it is worth being exact: QuickBooks has ONE record type, the vendor. The \"Contractors\" area is not a second kind of record - it is a filtered view of the vendors you have marked \"Track payments for 1099\". Adding someone as a contractor creates a vendor; the only thing that differs is whether that checkbox is ticked.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "The rule at P5",
        text:
          "Every subcontractor is created as a VENDOR. Whether they also appear under Contractors is decided by their W-9, not by how they were added.",
      },
      {
        t: "p",
        text:
          "The 1099 flag follows the tax classification on the W-9. Individuals, sole proprietors, partnerships, and LLCs taxed as either of those are tracked for 1099. C-corporations and S-corporations are not, with narrow exceptions such as legal services. That is why the flag stays OFF until the W-9 is actually on file - guessing it produces either a missing 1099 or one filed for a company that should never have received it.",
      },
      {
        t: "table",
        headers: ["What the W-9 says", "Track for 1099?", "Effect"],
        rows: [
          ["Individual / sole proprietor", "Yes", "Appears under Contractors; counts toward the 1099 threshold"],
          ["Partnership", "Yes", "Same"],
          ["LLC taxed as sole prop or partnership", "Yes", "Same"],
          ["LLC taxed as C-corp or S-corp", "No", "Vendor only; payments are not 1099-reportable"],
          ["C-corporation / S-corporation", "No", "Vendor only (attorneys are the usual exception)"],
          ["No W-9 yet", "Leave unset", "Vendor is on payment hold until the W-9 arrives"],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Do not tick the box to be safe",
        text:
          "Flagging a corporation for 1099 is not harmless caution - it puts a filing obligation on a payment that never had one, and the Tax Center will keep listing them as reportable. Set it from the W-9 or leave it alone.",
      },
      {
        t: "p",
        text:
          "The Tax Center (Finance > Company > Tax center) lists every vendor paid this year, whether a W-9 is on file, and who has crossed the reporting threshold without one. That list is the year-end 1099 worklist, and chasing a W-9 in January is far harder than collecting it before the first payment.",
      },
      { t: "h", text: "Creating a vendor (without creating a duplicate)" },
      {
        t: "steps",
        items: [
          "Search QuickBooks vendors for the company name AND likely variations (\"ABC Plumbing\", \"ABC Plumbing LLC\").",
          "If found: use the existing vendor. Never create a second record for the same company.",
          "If new: create the vendor with the legal name from their W-9, plus email and phone.",
          "Add the vendor's profile in the P5 panel (Finance > Vendors) so compliance tracking starts.",
          "Request the W-9 and, for subcontractors, the insurance certificate, before their first payment.",
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "Duplicates poison reporting",
        text:
          "Two records for one vendor split their payment history, break 1099 totals, and hide how much we really spend with them. If you find a duplicate, tell an administrator - merging needs care, not speed.",
      },
      { t: "h", text: "Compliance, and how it blocks payment" },
      {
        t: "p",
        text:
          "The P5 panel tracks each required document per vendor. A missing W-9 or an expired insurance certificate places the vendor on payment hold: their bills drop out of the recommended payment list until the document is fixed.",
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "The panel scans documents daily, reminds ahead of expiry (30 / 14 / 7 / 0 days), puts expired vendors on hold, and releases the hold automatically when a renewed document is verified. Every hold and release records a reason.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "When Needs Your Attention says a vendor document is missing or expiring, request the document from the vendor and record it. Do not pay around a hold.",
      },
      { t: "h", text: "1099s" },
      {
        t: "p",
        text:
          "Vendors paid $600 or more in a year (the current IRS threshold - it is a setting, not a constant) generally get a 1099 in January. This is exactly why the W-9 must exist before the first payment, not at year-end.",
      },
      {
        t: "links",
        items: [
          { label: "Enter a subcontractor bill", href: "/admin/kb/enter-a-subcontractor-bill" },
          { label: "Paying vendors (the Money Run)", href: "/admin/kb/pay-vendors" },
          { label: "Accounts payable, end to end", href: "/admin/kb/accounts-payable" },
        ],
      },
    ],
  },
  {
    slug: "accounts-payable",
    section: "quickbooks",
    title: "Accounts payable: from bill to paid",
    summary:
      "The complete life of a vendor bill - received, coded, approved, paid, reconciled - and exactly which steps are automatic.",
    lastVerified: "2026-08-22",
    keywords: [
      "accounts payable",
      "ap",
      "bill",
      "pay bill",
      "approval",
      "bill approval",
      "who approves",
      "vendor bill",
    ],
    blocks: [
      {
        t: "flow",
        title: "The AP flow",
        steps: [
          {
            label: "Bill arrives",
            detail:
              "Vendors email bills to ap@p5homeco.com, which forwards into QuickBooks' bill inbox. Paper bills get photographed and forwarded the same way.",
            kind: "human",
          },
          {
            label: "QuickBooks drafts the bill",
            detail: "AI reads the attachment and pre-fills vendor, date, amount, and lines.",
            kind: "auto",
          },
          {
            label: "A person completes the coding",
            detail:
              "Confirm the vendor, pick the project, phase, and item, and link the purchase order if one exists.",
            kind: "human",
          },
          {
            label: "Approval",
            detail:
              "Based on amount: up to $2,500 project manager; to $10,000 PM + manager; to $50,000 manager + administrator; above that, administrator. (These tiers are settings.)",
            kind: "review",
          },
          {
            label: "Compliance gate",
            detail:
              "The P5 panel checks the vendor's W-9, insurance, and any required lien waiver. A failure holds payment automatically.",
            kind: "auto",
          },
          {
            label: "Payment scheduled and made",
            detail:
              "Bills due within 7 days appear in the weekly Money Run's recommended list. Payment happens in QuickBooks from Operating Checking (1010).",
            kind: "human",
          },
          {
            label: "Reconciliation",
            detail:
              "When the bank shows the payment, it is matched to the QuickBooks record during reconciliation.",
            kind: "review",
          },
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Automatic: the AP email inbox, AI bill drafting, the daily sync into the P5 panel, compliance holds, overdue tracking, and the Money Run's recommended-payment math.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Always yours: confirming the coding (project / phase / item), approving, and clicking pay. Money never moves without a person.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "A bill with no project is a red flag",
        text:
          "Every project cost must name its project. The panel flags bills that have no project attached - fix the bill rather than resolving the flag.",
      },
    ],
  },
  {
    slug: "accounts-receivable",
    section: "quickbooks",
    title: "Accounts receivable: invoicing and getting paid",
    summary:
      "Deposits, progress invoices, final payment, and what happens when an invoice goes overdue.",
    lastVerified: "2026-08-22",
    keywords: [
      "accounts receivable",
      "ar",
      "invoice",
      "customer payment",
      "deposit",
      "progress invoice",
      "overdue",
      "outstanding invoices",
    ],
    blocks: [
      {
        t: "flow",
        title: "The AR flow",
        steps: [
          {
            label: "Estimate accepted",
            detail: "The signed estimate on the project is the basis for all invoicing.",
            kind: "human",
          },
          {
            label: "Deposit invoiced",
            detail:
              "The requested deposit books to Customer Deposits (2100) - a liability, because we have not earned it yet.",
            kind: "human",
          },
          {
            label: "Progress invoices as work proceeds",
            detail:
              "Invoice a percentage or specific lines of the estimate. Phases group cleanly on the customer's PDF.",
            kind: "human",
          },
          {
            label: "Customer pays",
            detail:
              "Payments are received against the invoice and land in Undeposited Funds until deposited to the bank.",
            kind: "human",
          },
          {
            label: "P5 watches the aging",
            detail:
              "The panel tracks every open invoice daily. Overdue invoices raise attention items and appear in the daily report.",
            kind: "auto",
          },
          {
            label: "Final invoice and closeout",
            detail:
              "The last invoice trues up the contract plus approved change orders. The project is not closed until the balance is zero.",
            kind: "review",
          },
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "Automatic: overdue detection (with reminder laddering at 3 days before, on the due date, 1 day after, and 7 days after), attention items for past-due invoices, and the daily report's receivables section.",
      },
      {
        t: "callout",
        kind: "action",
        text:
          "Yours: creating each invoice at the agreed milestone, recording payments promptly, and calling the customer when the panel says an invoice is seriously overdue. An invoice nobody sends cannot be paid.",
      },
      {
        t: "callout",
        kind: "info",
        title: "Why overdue money is never counted as cash",
        text:
          "In every P5 calculation (Safe Cash, the Money Run, the daily report), an overdue invoice is money to chase, not money to spend. Only invoices due within the next 7 days count as expected cash.",
      },
    ],
  },
  {
    slug: "bank-reconciliation",
    section: "quickbooks",
    title: "Bank and credit card reconciliation",
    summary:
      "How bank transactions get into QuickBooks, matched, and reconciled - and the current status of our bank connections.",
    lastVerified: "2026-08-22",
    keywords: [
      "bank",
      "reconciliation",
      "reconcile",
      "bank feed",
      "matching",
      "categorize",
      "credit card",
      "unmatched transaction",
    ],
    blocks: [
      {
        t: "callout",
        kind: "warning",
        title: "Current status: banks are not connected yet",
        text:
          "Connecting bank accounts requires the owner's bank credentials, which only the owner may enter. Until Operating Checking (1010), Tax Reserve Savings (1030), and Operating Reserve Savings (1040) are connected, there are no bank feeds and QuickBooks balances only reflect entered transactions.",
      },
      { t: "h", text: "How it works once connected" },
      {
        t: "steps",
        items: [
          "The bank feed imports each cleared transaction automatically.",
          "QuickBooks suggests a match against existing records (a bill payment, an invoice payment, a deposit).",
          "A person confirms each match. Matching is never auto-confirmed - a wrong match corrupts two records at once.",
          "Transactions with no match get categorized: pick the project, item, and class like any other cost.",
          "Monthly, reconcile each account against its statement so the books and the bank agree to the penny.",
        ],
      },
      {
        t: "callout",
        kind: "review",
        text:
          "Accounting must review: every suggested match before accepting, anything the feed could not match, transfers between our own accounts (easy to double-count), and the monthly reconciliation itself.",
      },
      {
        t: "callout",
        kind: "automatic",
        text:
          "The P5 panel's daily sync mirrors QuickBooks account balances into the daily report, and flags transactions that sit unmatched.",
      },
    ],
  },
  {
    slug: "qbo-reports",
    section: "quickbooks",
    title: "The QuickBooks reports that matter",
    summary:
      "Five reports, what question each one answers for P5, and when to look at them.",
    lastVerified: "2026-08-22",
    keywords: ["reports", "profit and loss", "p&l", "aging", "cost to complete", "trial balance"],
    blocks: [
      {
        t: "p",
        text:
          "QuickBooks has hundreds of reports. We use a handful, each for one question. (For the day-to-day view, the daily email report and the panel's Finance pages already summarize these.)",
      },
      {
        t: "table",
        headers: ["Report", "The question it answers", "When"],
        rows: [
          [
            "Profit & Loss by Class",
            "Is each brand making money?",
            "Monthly, and before any big brand decision",
          ],
          [
            "A/R Aging",
            "Who owes us money, and how late are they?",
            "Weekly (it also feeds the daily report's overdue list)",
          ],
          [
            "A/P Aging",
            "Whom do we owe, and when is it due?",
            "Weekly, before the Money Run",
          ],
          [
            "Project Profitability / project dashboard",
            "Is this job on budget and on margin?",
            "Every project review",
          ],
          [
            "Cost to Complete",
            "Given progress so far, where will the job land?",
            "When updating a project forecast",
          ],
          [
            "Balance Sheet",
            "What do we own and owe overall?",
            "Monthly close, with the CPA",
          ],
        ],
      },
      {
        t: "callout",
        kind: "info",
        text:
          "Why not just one big report? Because each decision needs one number set. \"Can we pay subs this week\" is the Money Run; \"is the kitchen job sliding\" is the project dashboard. Matching the report to the question is the whole trick.",
      },
    ],
  },
];
