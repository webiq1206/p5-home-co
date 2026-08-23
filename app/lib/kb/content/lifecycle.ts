/**
 * Section: How P5 works. The complete project lifecycle, start to finish.
 *
 * ON ACCURACY
 *
 * This article describes what the system ACTUALLY does today, not what it is
 * meant to do eventually. Every "happens automatically" claim below points at
 * code that exists and runs. Where a step is still manual, or a connection is
 * planned but not built, it says so in those words.
 *
 * That distinction is the whole value of the document. A runbook that
 * describes an intended system teaches people to expect help that never
 * arrives, and the first time somebody relies on an automation that was only
 * ever aspirational, they stop trusting the rest of it too.
 *
 * When a step becomes automated, move it from "what you do" to "what happens
 * automatically" HERE, in the same change that automates it.
 */

import type { Article } from "../types.ts";

export const lifecycle: Article[] = [
  {
    slug: "project-lifecycle",
    section: "how-p5-works",
    title: "The complete project lifecycle, step by step",
    summary:
      "Every stage from a lead arriving to a warranty expiring: what happens on its own, what you do, what comes next, and what can stop it.",
    lastVerified: "2026-08-23",
    keywords: [
      "lifecycle",
      "workflow",
      "process",
      "start to finish",
      "steps",
      "new job",
      "new project",
      "what do i do",
      "next step",
      "runbook",
      "onboarding",
    ],
    blocks: [
      {
        t: "p",
        text:
          "This is the whole job, in order. Each stage says what the system does by itself, what a person has to do, what happens next, and what can stop the job moving. If you are new, read it once end to end; after that, jump to whichever stage you are in.",
      },
      {
        t: "callout",
        kind: "review",
        title: "What this document promises",
        text:
          "Everything described as automatic below is code that exists and runs today. Anything still manual, or planned but not built, is labelled that way in plain words. If you find a step where the system behaves differently from this page, the page is wrong and should be corrected - that is a real bug, not a documentation nicety.",
      },

      // -- Stage 1: getting the work -------------------------------------
      { t: "h", text: "1. Lead received" },
      {
        t: "p",
        text:
          "A lead arrives from the website form and lands in the Lead Manager. The system timestamps it and starts a clock immediately.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "The lead is recorded, acknowledged, and put on an escalation clock measured in business minutes - so a Friday evening enquiry is not counted as overdue by Monday morning. If nobody responds, it escalates on a ladder rather than sitting quietly.",
      },
      {
        t: "list",
        items: [
          "You do: respond. Speed of first response is the single biggest lever on whether a lead converts.",
          "Next: qualification.",
          "Blocks it: nothing technical. This stage fails through inattention, which is exactly what the escalation clock exists to catch.",
        ],
      },

      { t: "h", text: "2. Qualification" },
      {
        t: "p",
        text:
          "Decide whether this is work P5 wants and can do: scope, budget realism, timeline, location, and which of the five divisions it belongs to.",
      },
      {
        t: "list",
        items: [
          "You do: qualify, and record the division. The division drives class tracking in QuickBooks all the way through, so getting it wrong here is felt in every report later.",
          "Next: site visit, or a polite decline.",
          "Blocks it: an unclear scope. It is cheaper to lose an unqualified lead now than to discover the mismatch after a contract.",
        ],
      },

      { t: "h", text: "3. Site visit and discovery" },
      {
        t: "p",
        text:
          "See the property. Take photographs, measurements, and notes on anything that looks like a concealed condition - the things that later become change orders.",
      },
      {
        t: "list",
        items: [
          "You do: visit, document, and note the risks you can see.",
          "Next: the estimate.",
          "Blocks it: no access to the property.",
        ],
      },

      { t: "h", text: "4. Handoff estimate" },
      {
        t: "callout",
        kind: "warning",
        title: "Not connected - this step is entirely manual",
        text:
          "Handoff is listed in P5 as a planned integration and is switched off. There is no link between Handoff and P5 or QuickBooks today: the estimate is produced in Handoff, and the numbers are then re-entered by hand. Any budget figure that reaches P5 was typed by a person, so it carries no automatic check against the estimate it came from.",
      },
      {
        t: "list",
        items: [
          "You do: build the estimate, then re-enter the contract value and budget into P5 when the project is created.",
          "Next: proposal.",
          "Blocks it: nothing automated - and that is the problem. Re-keying is where transcription errors enter, so the figures are worth checking twice.",
        ],
      },

      { t: "h", text: "5. Proposal" },
      {
        t: "p",
        text:
          "Present the price and scope. This is where allowances get set, and an allowance is a budget placeholder rather than a fixed price - be explicit about that with the customer now, because allowance overruns are one of the two most common residential disputes.",
      },
      {
        t: "list",
        items: [
          "You do: present it, and make the exclusions explicit.",
          "Next: create the project.",
          "Blocks it: the customer not accepting.",
        ],
      },

      // -- Stage 2: setting the job up ------------------------------------
      { t: "h", text: "6. Create the P5 and QuickBooks project" },
      {
        t: "p",
        text:
          "The project is created in P5 with its own reference number, then created in QuickBooks and linked. In QuickBooks the job is a sub-customer sitting underneath the customer who hired us - never a customer of its own.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "Creating the project in QuickBooks from P5 sets it up correctly as a sub-customer and stores the link, so costs and income attach to the job from then on. The write is idempotent: pressing the button twice cannot create two jobs.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "The daily check watches this",
        text:
          "If a job ends up at the top level instead of under its customer, or is set to bill with its parent, or was never linked to QuickBooks at all, the morning data-quality check raises it. Those three between them are what silently destroy job profitability, so they are checked every day rather than trusted once.",
      },
      {
        t: "list",
        items: [
          "You do: create it in P5, set division, contract type, contract amount and budget, then create it in QuickBooks.",
          "Next: the payment schedule.",
          "Blocks it: QuickBooks being disconnected. Nothing can be created there while it is.",
        ],
      },

      { t: "h", text: "7. Build the client payment schedule" },
      {
        t: "p",
        text:
          "Set out what the customer pays and when. The aim is that P5 is funded ahead of the work rather than behind it: money for a phase arrives before the costs for that phase fall due.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Read this before relying on the recommended draw",
        text:
          "The funding calculation counts open purchase orders, the cash already collected, and what has already gone out. It does NOT count planned purchases that are not yet committed, or expected labour, because P5 does not record those anywhere yet. Everything unrecorded is treated as zero, and a zero only ever makes the recommended figure SMALLER. So treat the recommended draw as a floor, never as the answer - the Client funding page now says so on every project.",
      },
      {
        t: "list",
        items: [
          "You do: set the milestones, front-loaded enough that P5 is not financing the build.",
          "Next: the Idaho disclosure.",
          "Blocks it: a payment schedule that funds P5 behind the work. That is a contract structure problem, and no amount of chasing fixes it later.",
        ],
      },

      { t: "h", text: "8. Idaho disclosure" },
      {
        t: "p",
        text:
          "Idaho requires a written disclosure to a residential owner BEFORE work begins, explaining that people who supply labour or materials can place a lien on their property even if they have paid us in full.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Before work starts, and it cannot be fixed afterwards",
        text:
          "Deliver it and keep the signed acknowledgement. The project records the delivery date, and that date is the evidence. Late delivery is not something that can be corrected once the work has started.",
      },
      {
        t: "list",
        items: [
          "You do: deliver it, get it acknowledged, record the date on the project.",
          "Next: the client contract.",
          "Blocks it: this blocks the project start gate, deliberately.",
        ],
      },

      { t: "h", text: "9. Client contract" },
      {
        t: "callout",
        kind: "review",
        title: "Attorney review outstanding",
        text:
          "P5 has a drafted Residential Construction Agreement covering scope, exclusions, price, allowances, changes, warranty and the lien notice. No attorney has reviewed it yet, and every document produced from it prints that warning on its own face. It is a starting point for counsel - do not sign or send one until it has been reviewed.",
      },
      {
        t: "list",
        items: [
          "You do: get the contract reviewed, then signed. Record the contract amount on the project.",
          "Next: initial funding.",
          "Blocks it: attorney review, which is a genuine outstanding dependency and not a formality.",
        ],
      },

      { t: "h", text: "10. Initial client funding" },
      {
        t: "p",
        text:
          "The deposit arrives and is recorded against the job in QuickBooks. From this point the job has cash of its own, and the funding board can tell whether it is ahead or behind.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "Once the payment is in QuickBooks it flows into P5 on the next sync, and the project's funding position updates. A project whose cash cannot cover its near-term costs shows red on the Client funding page, sorted to the top.",
      },
      {
        t: "list",
        items: [
          "You do: invoice the deposit and confirm it clears.",
          "Next: choosing subcontractors.",
          "Blocks it: starting work before the deposit clears means P5 is funding the job from day one.",
        ],
      },

      // -- Stage 3: the trades --------------------------------------------
      { t: "h", text: "11. Select subcontractors" },
      {
        t: "p",
        text:
          "Pick the trades. Check first whether each one already exists in QuickBooks - searching before creating is what stops the same company existing twice.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "The daily check looks for vendors whose names match once punctuation and company suffixes are stripped, so 'ABC Plumbing' and 'ABC Plumbing, LLC' are flagged as a probable duplicate. QuickBooks blocks exact duplicates by itself; these near-misses are the ones that get through.",
      },

      { t: "h", text: "12. W-9, insurance and compliance" },
      {
        t: "p",
        text:
          "Before a subcontractor is paid anything, P5 needs their W-9 and a current insurance certificate naming P5 as additional insured.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "Each vendor's required documents are tracked. A missing W-9 or an expired insurance certificate puts the vendor on payment hold, and their bills drop out of the recommended payment list until it is fixed. Expiry dates are watched on a reminder ladder, so a certificate about to lapse is raised before it does.",
      },
      {
        t: "callout",
        kind: "action",
        title: "The 1099 decision comes from the W-9, never from a guess",
        text:
          "Whether a vendor gets a tax form at year end is decided by the tax classification printed on their W-9. Sole proprietors, partnerships and LLCs taxed as either are reportable; corporations generally are not. The flag stays unset until the W-9 exists, and the daily check chases any vendor paid over the threshold without one - because collecting a W-9 in January, after the work is done, is far harder than collecting it now.",
      },

      { t: "h", text: "13. Master Subcontractor Agreement" },
      {
        t: "p",
        text:
          "Signed ONCE per subcontractor, before their first job. It carries the insurance, indemnity, payment, lien waiver and warranty terms for every job that follows.",
      },
      {
        t: "callout",
        kind: "review",
        title: "Attorney review outstanding",
        text:
          "Drafted, not yet reviewed. Same position as the client contract.",
      },

      { t: "h", text: "14. Project-specific subcontract" },
      {
        t: "p",
        text:
          "Every subcontractor gets a work order for every job and every scope they perform - no exceptions. It is one page: scope, exclusions, price, retainage and dates. Everything else is inherited from the master agreement.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "A work order signed without a master agreement protects nothing",
        text:
          "The work order deliberately contains none of the insurance, indemnity or lien terms. On its own it is a bare price quote. If a subcontractor will sign the work order but not the master agreement, there is no agreement.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "The daily check raises any subcontract marked as under way with no signature date recorded - a crew on site with nothing signed - and any subcontract past draft with no purchase order in QuickBooks, which is a commitment that exists but is invisible to the job budget.",
      },

      { t: "h", text: "15. Purchase orders and commitments" },
      {
        t: "p",
        text:
          "The subcontract becomes a purchase order in QuickBooks. That is what makes the promise visible on the job's remaining budget, so the same money cannot be committed twice.",
      },
      {
        t: "list",
        items: [
          "You do: create the purchase order from the subcontract in P5.",
          "Next: the job starts.",
          "Blocks it: nothing - but skipping it makes the budget look healthier than it is.",
        ],
      },

      // -- Stage 4: building ----------------------------------------------
      { t: "h", text: "16. Project start" },
      {
        t: "p",
        text:
          "Work begins. Before it does, the disclosure must be delivered, the contract signed, and the deposit cleared.",
      },

      { t: "h", text: "17. Construction" },
      {
        t: "p",
        text:
          "The build runs. Costs arrive as bills against purchase orders, and every one of them must carry the job.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Watched every morning",
        text:
          "A bill with no job on it, a job cost wrongly flagged billable to the customer, a cost dropped into a catch-all account, the same vendor invoice number entered twice, a subcontractor billing past their agreed amount - all raised daily, most serious first, on Today and in the 6am email.",
      },

      { t: "h", text: "18. Client payment milestones" },
      {
        t: "p",
        text:
          "As the job progresses, P5 requests the next payment. The intended shape is: calculate, prepare, review, approve and send.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "Two of those four steps do not exist yet",
        text:
          "The system CALCULATES the recommended amount, and a person REVIEWS it on the Client funding page. Nothing prepares the invoice automatically and nothing sends it - the draw invoice is raised by hand in QuickBooks. The code to create a draw invoice exists but is not wired to anything, so today this stage is: calculate automatically, then do the rest manually.",
      },
      {
        t: "list",
        items: [
          "You do: read the funding page, decide the amount (remembering the recommendation is a floor), raise the invoice, send it.",
          "Next: keep building.",
          "Blocks it: billing more than the contract and approved change orders permit. The daily check raises that as critical, because over-billing a homeowner loses the payment and the relationship together.",
        ],
      },

      { t: "h", text: "19. Vendor bills" },
      {
        t: "p",
        text:
          "Subcontractor and supplier invoices are entered against the job and the purchase order they draw on.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "QuickBooks now warns if a bill number has already been used for that vendor, which is the moment right before a bill gets paid twice. Bills also carry Net 30 terms by default, so they appear as due rather than never appearing at all.",
      },

      { t: "h", text: "20. Lien waivers" },
      {
        t: "p",
        text:
          "Collect a waiver with every payment. Which of the four forms to use is decided by two facts: is this the final payment, and has the money actually cleared.",
      },
      {
        t: "table",
        headers: ["", "Progress payment", "Final payment"],
        rows: [
          ["Payment has NOT cleared", "Conditional, progress", "Conditional, final"],
          ["Payment HAS cleared", "Unconditional, progress", "Unconditional, final"],
        ],
      },
      {
        t: "callout",
        kind: "warning",
        title: "The expensive mistake",
        text:
          "An unconditional waiver gives up the lien right the moment it is signed, whether or not the payment ever clears. Sign one against a cheque that bounces and the right is gone anyway. P5 sends conditional waivers with payment requests and collects unconditional ones only after money has cleared the bank - not after it was sent, after it cleared. The system picks the form from the payment's actual state and will not produce an unconditional waiver for an uncleared payment.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Lower-tier waivers are the ones people forget",
        text:
          "A supplier P5 never dealt with, hired by our subcontractor, can still lien our customer's house. Final payment and retainage are not released until waivers are in from the subcontractor AND from everyone below them.",
      },

      { t: "h", text: "21. Vendor payments" },
      {
        t: "p",
        text:
          "Payments are grouped into the Weekly Money Run rather than made ad hoc.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "A preliminary run is built on Wednesday and a final one on Friday. Vendors on payment hold are excluded, and the reason is always shown - a payment is never blocked without saying why.",
      },

      { t: "h", text: "22. Change orders" },
      {
        t: "p",
        text:
          "Any change to scope, price or schedule is recorded on a change order and signed BEFORE the changed work happens. Signed afterwards it is not an agreement, it is a negotiation conducted from a weak position.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Why entering them matters beyond the paperwork",
        text:
          "Approved change orders raise the contract value the daily check measures billing against. Entering them is therefore what stops a perfectly legitimate invoice being flagged as over-billing. Subcontractor scope changes use a subcontractor change order, and a subcontractor billing past their commitment is raised as critical.",
      },

      { t: "h", text: "23. Allowances" },
      {
        t: "p",
        text:
          "Where an actual selection costs more or less than its allowance, the difference moves the contract price by change order. An allowance is a placeholder, not a price - saying so in the contract is what prevents the argument.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "Not tracked by the system yet",
        text:
          "P5 has no allowance register. Allowances live in the contract and are reconciled by hand. Nothing watches whether a selection has been made or whether its cost has drifted, so this is a manual discipline today.",
      },

      // -- Stage 5: finishing ----------------------------------------------
      { t: "h", text: "24. Substantial completion" },
      {
        t: "p",
        text:
          "The job is usable for its intended purpose. This starts the warranty clock and is the point retainage becomes releasable, subject to the punch list.",
      },

      { t: "h", text: "25. Punch list" },
      {
        t: "p",
        text: "The remaining defects and unfinished items, agreed with the customer and worked off.",
      },

      { t: "h", text: "26. Vendor closeout" },
      {
        t: "p",
        text:
          "Each subcontractor finishes, provides final unconditional waivers, and retainage is released.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Automatic",
        text:
          "A purchase order still open on a finished job is raised daily - it makes the job look like it still has money to spend, which holds cash back in the forecast that will never be used.",
      },

      { t: "h", text: "27. Idaho final disclosure" },
      {
        t: "p",
        text: "The closing disclosure is delivered and the date recorded on the project.",
      },

      { t: "h", text: "28. Final client billing and payment" },
      {
        t: "p",
        text:
          "The last invoice, including any retainage held by the customer. Final payment should not go out ahead of the lower-tier waivers being in hand.",
      },

      { t: "h", text: "29. Financial reconciliation" },
      {
        t: "p",
        text:
          "Compare what the job was meant to cost against what it did. This is the number that tells P5 whether the estimate was any good, which is the only way estimates improve.",
      },
      {
        t: "callout",
        kind: "action",
        title: "Close the books once the period is done",
        text:
          "Closing the books locks a month so nobody can quietly change a period already reported to the CPA or a lender. It is currently switched off, correctly, because no period has closed yet. The daily check will keep raising it until it is on - which is the right behaviour, not a nuisance.",
      },

      { t: "h", text: "30. Closeout documents" },
      {
        t: "p",
        text:
          "Warranties, manuals, permits, final lien waivers and as-builts handed to the customer and stored.",
      },
      {
        t: "callout",
        kind: "warning",
        title: "No document storage integration",
        text:
          "P5 stores references to documents, not the documents themselves. There is no Google Drive integration, so filing is manual and nothing checks that a closeout pack is complete.",
      },

      { t: "h", text: "31. One-year workmanship warranty" },
      {
        t: "p",
        text:
          "The warranty runs for a year from substantial completion. Defects in workmanship are corrected at P5's cost.",
      },

      { t: "h", text: "32. Project closed" },
      {
        t: "p",
        text:
          "The project is marked Closed. It then drops out of the funding board, the WIP schedule and the subcontract pickers.",
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Fixed 2026-08-23",
        text:
          "Until recently it did not drop out of any of them. The queries filtered on lowercase status values while the column stores capitalised ones, so the filter matched nothing and closed jobs kept appearing - including on the WIP schedule, which feeds the financial statements. A test now checks every status filter against the database constraint.",
      },

      // -- What runs on its own --------------------------------------------
      { t: "h", text: "What runs on its own, every day" },
      {
        t: "table",
        headers: ["When", "What happens"],
        rows: [
          ["Every morning, 6am", "Pull from QuickBooks, process any missed webhook events, scan for items needing attention, run the 31-rule data-quality check, then send the daily email."],
          ["Continuously", "QuickBooks webhooks update P5 as things change there, covering customers, vendors, accounts, classes and all twelve transaction types."],
          ["Wednesday", "Preliminary Weekly Money Run."],
          ["Friday", "Final Weekly Money Run."],
          ["Daily", "Vendor document expiry ladder, subscription and insurance renewal alerts."],
        ],
      },
      {
        t: "callout",
        kind: "automatic",
        title: "Nothing fails silently",
        text:
          "Every automated step records whether it succeeded. A failed sync, a parked QuickBooks write, or a stale connection is raised as an item needing a person rather than being retried blindly - because a retry that creates a duplicate invoice is worse than a failure somebody can see.",
      },

      { t: "h", text: "Where this lifecycle is still manual" },
      {
        t: "p",
        text:
          "Stated plainly, because knowing where the system does not help is as useful as knowing where it does:",
      },
      {
        t: "list",
        items: [
          "Handoff is not connected. Estimates are re-keyed into P5 by hand.",
          "Client payment requests are calculated but not prepared or sent. The invoice is raised manually.",
          "The funding recommendation omits planned purchases and labour, so it reads low. It is labelled as a floor on the page.",
          "Allowances are not tracked anywhere.",
          "There is no document storage integration. Closeout packs are assembled by hand.",
          "Every contract template is still awaiting attorney review.",
        ],
      },
      {
        t: "links",
        title: "The pages this lifecycle uses",
        items: [
          { label: "Today - what needs a person", href: "/admin/finance" },
          { label: "The daily QuickBooks check", href: "/admin/finance/data-quality" },
          { label: "Client funding and draws", href: "/admin/finance/funding" },
          { label: "Vendors and compliance", href: "/admin/finance/vendors" },
          { label: "Subcontracts", href: "/admin/finance/subcontracts" },
          { label: "Contracts and documents", href: "/admin/finance/contracts" },
          { label: "Weekly Money Run", href: "/admin/finance/money-run" },
        ],
      },
    ],
  },
];
