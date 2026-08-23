/**
 * The QuickBooks data-quality rulebook (S214).
 *
 * One entry per thing that can be set up wrong in QuickBooks. This file is the
 * ONLY place those rules are explained: the audit page, the alert email and the
 * Knowledge Center article all render from here, so the wording can never drift
 * away from the check that produces it.
 *
 * House style for the prose, and it is not decoration:
 *
 *   - `plain` is written for someone who has never done bookkeeping. Short
 *     sentences, no jargon, no abbreviations. If a term is unavoidable, it gets
 *     explained in the same sentence.
 *   - `consequence` says what it actually costs - money, taxes, or trust.
 *     "Invalid data" persuades nobody to go fix anything.
 *   - `fix` is the next physical action, not a principle.
 *
 * A finding nobody understands is a finding nobody acts on, and an unactioned
 * finding is worse than none: it teaches people the list is noise.
 */

export type AuditSeverity = "info" | "warning" | "urgent" | "critical";

export type AuditEntity =
  | "customer"
  | "project"
  | "vendor"
  | "invoice"
  | "bill"
  | "purchase_order"
  | "subcontract"
  | "connection";

/**
 * Where the rule is enforced, which matters more than it first appears.
 *
 * A rule QuickBooks itself refuses to break is PREVENTED. A rule only P5 checks
 * is merely DETECTED, after the fact, by a scanner that runs once a day. Every
 * rule marked `p5_only` is a gap that stays open because QuickBooks offers no
 * way to close it - so the goal is to move as many rules as possible out of
 * that bucket and into a setting.
 */
export type Enforcement =
  /** QuickBooks physically will not save the record without this. */
  | "qbo_blocks"
  /** A QuickBooks setting makes it required or warns. It can be switched on. */
  | "qbo_setting"
  /** QuickBooks does not care. Only this scanner catches it. */
  | "p5_only";

export type AuditRule = {
  /**
   * Stable machine key. This is also the `attention_item.kind`, so renaming one
   * orphans every open item of that kind - add a new rule instead.
   */
  code: string;
  label: string;
  entity: AuditEntity;
  severity: AuditSeverity;
  enforcement: Enforcement;
  /** What the rule checks, in the plainest words available. */
  plain: string;
  /** What actually goes wrong when it is broken. */
  consequence: string;
  /** The next physical action. */
  fix: string;
  /**
   * For `qbo_setting` rules: the switch in QuickBooks that makes this harder or
   * impossible to get wrong. Named exactly as it appears in the interface, so
   * the setup can be checked against reality rather than against memory.
   */
  qboSetting?: string;
};

export const RULES = {
  // -------------------------------------------------------------------------
  // Projects and customers
  // -------------------------------------------------------------------------
  project_not_linked: {
    code: "project_not_linked",
    label: "Job has no QuickBooks record",
    entity: "project",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "This job exists in P5 but was never created in QuickBooks. It is like keeping a folder for a job on your desk that nobody ever filed in the cabinet.",
    consequence:
      "Nothing spent on this job has anywhere to land. Costs pile into the company totals instead of onto the job, so the job looks free and the company looks unprofitable.",
    fix: "Open the project in P5 and create it in QuickBooks. P5 links the two automatically.",
  },
  project_not_sub_customer: {
    code: "project_not_sub_customer",
    label: "Job was created as its own customer",
    entity: "project",
    severity: "critical",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Advanced > Projects > Use project financial tracking",
    plain:
      "Every job has to sit underneath the customer who hired us, not beside them. Picture the customer as a drawer and each of their jobs as a folder inside it. This job got its own drawer.",
    consequence:
      "The customer's history splits across two records. Nobody can see what one customer actually owes, and job profit reports skip this job entirely.",
    fix: "In QuickBooks, edit the job, tick 'Is a sub-customer', and choose the real customer as the parent.",
  },
  project_bills_with_parent: {
    code: "project_bills_with_parent",
    label: "Job is set to bill the parent customer",
    entity: "project",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "This job is set to send its bills up to the customer above it instead of keeping them on the job. The money still arrives - it just stops being attached to this job.",
    consequence:
      "Invoices and payments land on the customer, not the job, so the job shows income of zero and every profit number for it is wrong.",
    fix: "Edit the job in QuickBooks and change billing from 'Bill with parent' to 'Bill this customer'.",
  },
  customer_missing_email: {
    code: "customer_missing_email",
    label: "Customer has no email address",
    entity: "customer",
    severity: "warning",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Sales > Sales form content (email is required to send an invoice)",
    plain: "There is no email on file for this customer, so we have no way to send them a bill.",
    consequence:
      "Invoices go out by hand or not at all, automatic payment reminders never fire, and we get paid later for no reason other than an empty field.",
    fix: "Add the customer's email in QuickBooks, or on their P5 customer record.",
  },
  customer_missing_address: {
    code: "customer_missing_address",
    label: "Customer has no billing address",
    entity: "customer",
    severity: "info",
    enforcement: "p5_only",
    plain: "No mailing address is on file for this customer.",
    consequence:
      "Anything that must be mailed - a formal notice, a lien document, a paper invoice - cannot be sent. Those are exactly the documents with legal deadlines attached.",
    fix: "Add the billing address in QuickBooks.",
  },
  customer_inactive_with_balance: {
    code: "customer_inactive_with_balance",
    label: "Customer was switched off while still owing money",
    entity: "customer",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "Someone marked this customer inactive while they still owed us money. Hiding a customer does not cancel their debt - it only stops the debt showing up.",
    consequence:
      "Money we are owed vanishes from the follow-up list, so nobody chases it until it is too old to collect.",
    fix: "Make the customer active again, collect or formally write off the balance, then deactivate.",
  },
  customer_possible_duplicate: {
    code: "customer_possible_duplicate",
    label: "Two customers look like the same person",
    entity: "customer",
    severity: "warning",
    enforcement: "qbo_blocks",
    plain:
      "Two customer records have nearly the same name. QuickBooks refuses names that match exactly, but near-misses like 'Smith Residence' and 'Smith Residence LLC' walk straight through.",
    consequence:
      "One customer's history gets cut in half. Their balance looks smaller than it is, and nobody can tell how much work we have really done for them.",
    fix: "Confirm they are the same. If so, ask an administrator to merge them - merging cannot be undone, so it is not a job to rush.",
  },
  qbo_project_not_in_p5: {
    code: "qbo_project_not_in_p5",
    label: "Job exists in QuickBooks but not in P5",
    entity: "project",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "Somebody created this job straight in QuickBooks instead of starting it in P5, so P5 does not know it exists.",
    consequence:
      "It has no budget, no cost codes and no compliance tracking. It will never appear in a job profit report, and nobody is watching whether it makes money.",
    fix: "Create the matching project in P5 and link it. If it was a mistake, make it inactive in QuickBooks.",
  },

  // -------------------------------------------------------------------------
  // Vendors and subcontractors
  // -------------------------------------------------------------------------
  vendor_no_profile: {
    code: "vendor_no_profile",
    label: "Vendor is not tracked in P5",
    entity: "vendor",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "This vendor exists in QuickBooks but has no P5 record, so nothing is watching their paperwork.",
    consequence:
      "Nobody is checking their insurance or their W-9. We can pay a subcontractor whose insurance lapsed months ago, and if someone gets hurt on our job, that becomes our problem.",
    fix: "Add the vendor in P5 under Vendors, which starts compliance tracking.",
  },
  vendor_1099_undecided: {
    code: "vendor_1099_undecided",
    label: "Nobody has decided whether this vendor gets a 1099",
    entity: "vendor",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "We have paid this vendor real money, but the box that decides whether they get a tax form at year end has never been set either way.",
    consequence:
      "Come January we either send a tax form to someone who should not get one, or miss one for someone who should. The penalty for a missing 1099 is charged per form.",
    fix: "Get their W-9. The tax classification printed on it decides the answer - do not guess it.",
  },
  vendor_1099_no_w9: {
    code: "vendor_1099_no_w9",
    label: "Vendor is past the 1099 amount with no W-9 on file",
    entity: "vendor",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "We have paid this vendor more than the amount that forces a tax form at year end, and we still do not have the form that tells us their tax number.",
    consequence:
      "We are required to file a 1099 for them and cannot, because we do not have their number. Chasing a W-9 in January, after the work is done and we hold no leverage, is far harder than collecting it today.",
    fix: "Request the W-9 now and put the vendor on payment hold until it arrives.",
  },
  vendor_1099_on_corporation: {
    code: "vendor_1099_on_corporation",
    label: "A corporation is flagged for 1099",
    entity: "vendor",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "This vendor is a corporation, and corporations almost never receive a 1099. Somebody ticked the box anyway, usually meaning to be careful.",
    consequence:
      "Ticking it to be safe is not safe. It invents a filing obligation that never existed and puts a tax form in the hands of a company that should not receive one.",
    fix: "Check the W-9. If it says C corporation or S corporation, untick 'Track payments for 1099'. Attorneys are the usual exception.",
  },
  vendor_missing_email: {
    code: "vendor_missing_email",
    label: "Vendor has no email address",
    entity: "vendor",
    severity: "info",
    enforcement: "p5_only",
    plain: "There is no email on file for this vendor.",
    consequence:
      "Purchase orders, subcontracts and their year-end tax form all have to be delivered by hand.",
    fix: "Add the vendor's email in QuickBooks or on their P5 vendor record.",
  },
  vendor_possible_duplicate: {
    code: "vendor_possible_duplicate",
    label: "Two vendors look like the same company",
    entity: "vendor",
    severity: "warning",
    enforcement: "qbo_blocks",
    plain:
      "Two vendor records have nearly the same name - the pair you get when one person types 'ABC Plumbing' and someone else types 'ABC Plumbing LLC'.",
    consequence:
      "Their payment history splits in two. Year-end tax form totals are wrong on both halves, and we cannot see how much we really spend with them.",
    fix: "Confirm they are the same company, then ask an administrator to merge them.",
  },
  vendor_inactive_with_balance: {
    code: "vendor_inactive_with_balance",
    label: "Vendor was switched off while we still owe them",
    entity: "vendor",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "This vendor was marked inactive while we still owed them money. Hiding them does not pay the bill.",
    consequence:
      "An unpaid bill drops off the payment list. The vendor eventually calls, or files a lien against our customer's house, and neither is a good day.",
    fix: "Reactivate the vendor, settle or correct the balance, then deactivate.",
  },

  // -------------------------------------------------------------------------
  // Invoices - money coming in
  // -------------------------------------------------------------------------
  invoice_no_project: {
    code: "invoice_no_project",
    label: "Invoice is not attached to a job",
    entity: "invoice",
    severity: "urgent",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Advanced > Projects, with Sales > Track expenses and items by customer",
    plain: "We billed somebody, but the invoice does not say which job the money is for.",
    consequence:
      "The income floats free of any job. That job then shows costs with no income against them, which makes a profitable job look like a loser.",
    fix: "Edit the invoice and set the customer to the correct job - the sub-customer, not the parent.",
  },
  invoice_on_parent_customer: {
    code: "invoice_on_parent_customer",
    label: "Invoice went to the customer instead of the job",
    entity: "invoice",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "The invoice is attached to the customer's main record rather than to the specific job. Right drawer, no folder.",
    consequence:
      "The customer's balance is right but the job's income is zero, so the job reads as a loss and every work-in-progress number for it is wrong.",
    fix: "Edit the invoice and change the customer to the job underneath them.",
  },
  invoice_no_due_date: {
    code: "invoice_no_due_date",
    label: "Invoice has no due date",
    entity: "invoice",
    severity: "warning",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Sales > Sales form content > Preferred invoice terms",
    plain:
      "The invoice never says when payment is due, almost always because no payment terms were chosen.",
    consequence:
      "Nothing can ever be counted as late, so this invoice never lands on an overdue list and no reminder is ever sent. It simply sits there.",
    fix: "Set payment terms on the invoice. Setting default terms in QuickBooks stops it happening again.",
  },
  invoice_zero_total: {
    code: "invoice_zero_total",
    label: "Invoice is for zero or a negative amount",
    entity: "invoice",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "This invoice asks for nothing, or for less than nothing. It is nearly always a draft saved by accident, or a refund entered as an invoice.",
    consequence:
      "It clutters the customer's history, and if it is a refund in disguise it pushes money the wrong direction through the books.",
    fix: "Correct the amount or void it. Real refunds belong on a credit memo, never on a negative invoice.",
  },
  invoice_exceeds_contract: {
    code: "invoice_exceeds_contract",
    label: "We have billed more than the contract allows",
    entity: "project",
    severity: "critical",
    enforcement: "p5_only",
    plain:
      "Add up everything invoiced on this job and it comes to more than the contract plus the change orders the customer approved.",
    consequence:
      "We are asking for money the customer never agreed to pay. They are entitled to refuse, and being caught over-billing on someone's home is the fastest way to lose the payment and the relationship together.",
    fix: "Stop billing this job. Either find the approved change order that was never entered, or credit the excess back.",
  },

  // -------------------------------------------------------------------------
  // Bills, purchase orders and commitments - money going out
  // -------------------------------------------------------------------------
  bill_no_project: {
    code: "bill_no_project",
    label: "Bill is not attached to a job",
    entity: "bill",
    severity: "urgent",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Expenses > Bills and expenses > Track expenses and items by customer",
    plain: "We owe somebody money and the bill does not say which job it was for.",
    consequence:
      "The cost lands on the company instead of the job. The job looks cheaper than it was, we under-bill the customer for it, and the gap comes straight out of profit.",
    fix: "Edit the bill and put the job in the Customer/Project column on every line.",
  },
  bill_marked_billable: {
    code: "bill_marked_billable",
    label: "Job cost is marked billable to the customer",
    entity: "bill",
    severity: "critical",
    enforcement: "p5_only",
    plain:
      "This cost is already covered by the job's contract price, but it is also flagged to be added onto the customer's next invoice.",
    consequence:
      "The customer gets charged twice for one thing - once inside the contract price and once as an add-on. Customers find this kind of mistake, and it costs far more in trust than in dollars.",
    fix: "Edit the bill and clear the Billable tick on every line. Costs on a fixed-price job are never billable.",
  },
  bill_no_due_date: {
    code: "bill_no_due_date",
    label: "Bill has no due date",
    entity: "bill",
    severity: "warning",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Expenses > Bills and expenses > Default bill payment terms",
    plain: "The bill does not say when it has to be paid.",
    consequence:
      "It never shows up as due, so it gets missed until the vendor calls. Late payments cost early-payment discounts, and with subcontractors they cost goodwill on the next job.",
    fix: "Set the terms on the bill. Setting default bill terms in QuickBooks prevents a repeat.",
  },
  bill_duplicate_number: {
    code: "bill_duplicate_number",
    label: "Same vendor invoice number entered twice",
    entity: "bill",
    severity: "urgent",
    enforcement: "qbo_setting",
    qboSetting: "Settings > Expenses > Bills and expenses > Warn if duplicate bill number is used",
    plain: "The vendor sent us one invoice, and it has been typed into QuickBooks twice.",
    consequence:
      "This is how a company pays the same bill twice. The job also carries double the cost, so its profit looks worse than it really is.",
    fix: "Compare the two. Void or delete the copy, keeping the one with the correct date and coding.",
  },
  bill_uncategorized: {
    code: "bill_uncategorized",
    label: "Cost was left in a catch-all account",
    entity: "bill",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "This cost was dropped into a catch-all account such as 'Uncategorized Expense' or 'Ask My Accountant' - the bookkeeping version of a junk drawer.",
    consequence:
      "It sits in no real category, so it is missing from job costs and probably not deducted correctly on the tax return.",
    fix: "Recode it to the correct expense account and cost code.",
  },
  bill_no_commitment: {
    code: "bill_no_commitment",
    label: "Large bill arrived with no purchase order behind it",
    entity: "bill",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "A big bill turned up for work nobody had written down in advance as a purchase order or a subcontract.",
    consequence:
      "We committed real money with no agreed price first. There is nothing to check the invoice against, so if the number is too high we have no way to prove it.",
    fix: "Find the purchase order or subcontract and link it. If none exists, get the scope and price in writing before paying.",
  },
  bill_exceeds_commitment: {
    code: "bill_exceeds_commitment",
    label: "Vendor has billed more than their contract",
    entity: "subcontract",
    severity: "critical",
    enforcement: "p5_only",
    plain:
      "This subcontractor's bills add up to more than the amount we agreed to pay them, including any approved changes.",
    consequence:
      "We are about to pay for work nobody authorized. Once it is paid the money is gone and the argument is unwinnable.",
    fix: "Hold the payment. Either sign a change order for the extra work or reject the overage in writing.",
  },
  bill_vendor_on_hold: {
    code: "bill_vendor_on_hold",
    label: "Open bill from a vendor on payment hold",
    entity: "bill",
    severity: "warning",
    enforcement: "p5_only",
    plain: "We owe this vendor money, but their paperwork is out of date so they are on hold.",
    consequence:
      "Ignore the hold and we pay a subcontractor whose insurance has expired - the single most expensive paperwork mistake available in construction.",
    fix: "Collect the missing document to clear the hold, or accept the hold and pay later. Do not pay around it.",
  },
  po_open_on_closed_job: {
    code: "po_open_on_closed_job",
    label: "Purchase order still open on a finished job",
    entity: "purchase_order",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "The job is finished, but this purchase order is still sitting open as though more work were coming.",
    consequence:
      "The job looks like it still has money to spend, so the cash forecast holds back money that will never be used and the job cannot be properly closed.",
    fix: "Close the purchase order. If work really is outstanding, reopen the job instead.",
  },
  subcontract_no_po: {
    code: "subcontract_no_po",
    label: "Subcontract was never recorded in QuickBooks",
    entity: "subcontract",
    severity: "warning",
    enforcement: "p5_only",
    plain:
      "We signed a subcontractor to a price, but that promise was never entered into QuickBooks as a purchase order.",
    consequence:
      "The money is committed but invisible. The job's remaining budget looks bigger than it is, so the same dollars can be promised twice.",
    fix: "Create the purchase order from the subcontract in P5, which records the commitment.",
  },
  subcontract_unexecuted: {
    code: "subcontract_unexecuted",
    label: "Work started on an unsigned subcontract",
    entity: "subcontract",
    severity: "urgent",
    enforcement: "p5_only",
    plain: "This subcontract is marked as under way, but no signature date was ever recorded.",
    consequence:
      "A crew is on site with nothing signed. Scope, price and insurance are all unenforceable, and any dispute comes down to one person's word against another's.",
    fix: "Get the signed subcontract and record the date, or stop the work until it is signed.",
  },

  // -------------------------------------------------------------------------
  // The connection itself
  // -------------------------------------------------------------------------
  sync_stale: {
    code: "sync_stale",
    label: "QuickBooks has not been read recently",
    entity: "connection",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "P5 has not successfully pulled data from QuickBooks in a long time, so every number on these screens is old.",
    consequence:
      "Decisions get made on stale figures. The cash number could be days out of date and nobody looking at it would know.",
    fix: "Open Setup > System health and reconnect QuickBooks.",
  },
  write_needs_review: {
    code: "write_needs_review",
    label: "A change to QuickBooks did not go through",
    entity: "connection",
    severity: "urgent",
    enforcement: "p5_only",
    plain:
      "P5 tried to create or update something in QuickBooks and it failed, so it was parked here rather than retried blindly.",
    consequence:
      "P5 and QuickBooks now disagree. Whatever P5 shows as done was never actually recorded, and retrying without looking risks creating it twice.",
    fix: "Open Setup > System health, read the failure reason, and finish the change by hand in QuickBooks.",
  },
} as const satisfies Record<string, AuditRule>;

export type RuleCode = keyof typeof RULES;

/** Every rule, for the Knowledge Center article and the audit page legend. */
export function allRules(): AuditRule[] {
  return Object.values(RULES);
}

/**
 * Rules QuickBooks can be made to enforce itself, with the switch that does it.
 * This is the checklist for the company file: everything here should be ON, so
 * that the rule is prevented rather than merely reported the next morning.
 */
export function qboEnforceableRules(): AuditRule[] {
  return allRules().filter((r) => r.enforcement === "qbo_setting");
}

/** Rules nothing but this scanner will ever catch. The permanent watch list. */
export function detectOnlyRules(): AuditRule[] {
  return allRules().filter((r) => r.enforcement === "p5_only");
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  urgent: 1,
  warning: 2,
  info: 3,
};

/** Most serious first. Ties keep catalogue order, which groups by entity. */
export function bySeverity<T extends { severity: AuditSeverity }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
