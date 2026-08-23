/**
 * QuickBooks data-quality monitor (S214).
 *
 * The problem this solves: QuickBooks will happily accept a bill with no job on
 * it, an invoice booked to the parent customer instead of the job, or a
 * subcontractor with no W-9. Nothing breaks that day. It breaks in March, when
 * the job costs are wrong, the 1099s are late, and nobody can reconstruct what
 * happened.
 *
 * So this is the standing inspection. It reads what is actually in QuickBooks,
 * compares it against how P5 has agreed to work, and produces a finding for
 * every record that is set up wrong or missing something.
 *
 * PURE by design: no database, no network. A snapshot goes in and findings come
 * out, so every rule is testable without a QuickBooks connection. The scanner
 * that gathers the snapshot and files the findings lives in audit-scan.ts.
 *
 * The explanations live in audit-rules.ts, deliberately apart from the checks,
 * because the same words have to serve the audit page, the alert email and the
 * Knowledge Center.
 */

import {
  RULES,
  type AuditRule,
  type AuditSeverity,
} from "./audit-rules.ts";

export * from "./audit-rules.ts";

export type AuditFinding = {
  rule: AuditRule;
  /** Identifier of the offending record, unique within its entity type. */
  entityId: string;
  entityName: string;
  /** This specific instance - names, numbers, dates. Never a restatement of the rule. */
  detail: string;
  amount?: number | null;
  /** Deep link into the P5 panel, when one exists. */
  entityUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Snapshot: the shape the scanner hands in. Deliberately plain data.
// ---------------------------------------------------------------------------

export type CustomerRecord = {
  qboId: string;
  displayName: string;
  parentQboId: string | null;
  isProject: boolean;
  billWithParent: boolean;
  active: boolean;
  balance: number;
  email: string | null;
  billingAddress: string | null;
};

export type VendorRecord = {
  qboId: string;
  displayName: string;
  active: boolean;
  balance: number;
  /** null means nobody has decided yet - which is itself a finding. */
  vendor1099: boolean | null;
  email: string | null;
  w9OnFile: boolean;
  /** Tax classification from the W-9, when we have one. */
  taxClassification: string | null;
  /** Total paid in the current calendar year, for the 1099 threshold. */
  paidThisYear: number;
  /** True when P5 has a vendor_profile for this QuickBooks vendor. */
  trackedInP5: boolean;
  paymentHold: boolean;
};

export type TxnRecord = {
  qboId: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  customerQboId: string | null;
  vendorQboId: string | null;
  /** Bills: true when any line is marked billable back to a customer. */
  hasBillableLine?: boolean;
  /** Bills: true when any line sits in a catch-all account. */
  hasUncategorizedLine?: boolean;
  /** Purchase orders only: Open | Closed. */
  poStatus?: string | null;
  /** The vendor's own invoice number, for duplicate detection. */
  vendorDocNumber?: string | null;
  /** True when the bill is linked to a purchase order or subcontract. */
  hasCommitment?: boolean;
};

export type ProjectRecord = {
  id: string;
  p5Id: string;
  name: string;
  status: string;
  qboCustomerId: string | null;
  contractAmount: number;
  approvedChangeOrders: number;
};

export type SubcontractRecord = {
  id: string;
  reference: string;
  projectP5Id: string;
  vendorName: string;
  status: string;
  originalAmount: number;
  approvedChanges: number;
  billedToDate: number;
  qboPurchaseOrderId: string | null;
  executedOn: string | null;
};

export type AuditSnapshot = {
  /** ISO date the scan represents. */
  today: string;
  /** S86: the 1099 reporting threshold. Never hardcoded at a call site. */
  form1099Threshold: number;
  /** Bills at or above this are checked for a matching commitment. */
  commitmentThreshold: number;
  /** A sync older than this many hours is stale. */
  staleSyncHours: number;
  customers: CustomerRecord[];
  vendors: VendorRecord[];
  invoices: TxnRecord[];
  bills: TxnRecord[];
  purchaseOrders: TxnRecord[];
  projects: ProjectRecord[];
  subcontracts: SubcontractRecord[];
  /** Hours since the last successful QuickBooks sync; null when never synced. */
  hoursSinceSync: number | null;
  /** Writes that failed and were parked for a human (qbo_write_intent). */
  unresolvedWrites: { id: string; entity: string; reason: string }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Names reduced to their comparable core, so near-duplicates collide.
 *
 * Strips punctuation, collapses spaces, lowercases, and drops the entity
 * suffixes people add inconsistently. "ABC Plumbing" and "ABC Plumbing, LLC"
 * both become "abc plumbing" - which is the whole point, since QuickBooks
 * already blocks the exact matches and these are what get through.
 */
const ENTITY_SUFFIXES = new Set([
  "llc", "l.l.c", "inc", "incorporated", "co", "corp", "corporation",
  "ltd", "limited", "lp", "llp", "pllc", "pc", "company",
]);

export function nameKey(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[.,'"&/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((w) => w && !ENTITY_SUFFIXES.has(w));
  return words.join(" ");
}

/** Groups by comparable name and returns only the groups with more than one member. */
function duplicateGroups<T>(items: T[], name: (t: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = nameKey(name(item));
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Classifications on a W-9 that mean "do not send a 1099". */
function isCorporation(classification: string | null): boolean {
  if (!classification) return false;
  const c = classification.toLowerCase();
  if (c.includes("llc") && !c.includes("corp")) return false;
  return c.includes("c corp") || c.includes("s corp") || c.includes("corporation");
}

/** Statuses where a job is done and should not be accruing new commitments. */
const FINISHED_STATUSES = new Set(["Closeout", "Warranty", "Closed", "Cancelled"]);

/** Statuses where a subcontractor is, or should be, actually working. */
const WORKING_STATUSES = new Set(["in_progress", "complete"]);

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export function auditQbo(snapshot: AuditSnapshot): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const add = (
    rule: AuditRule,
    entityId: string,
    entityName: string,
    detail: string,
    extra?: { amount?: number | null; entityUrl?: string | null },
  ) => {
    findings.push({
      rule,
      entityId,
      entityName,
      detail,
      amount: extra?.amount ?? null,
      entityUrl: extra?.entityUrl ?? null,
    });
  };

  const customerById = new Map(snapshot.customers.map((c) => [c.qboId, c]));
  const projectByQboId = new Map(
    snapshot.projects
      .filter((p) => p.qboCustomerId)
      .map((p) => [p.qboCustomerId as string, p]),
  );

  // -- Connection ----------------------------------------------------------
  // Checked first and reported plainly, because everything below it is only as
  // trustworthy as the data the sync brought in.
  if (snapshot.hoursSinceSync === null) {
    add(RULES.sync_stale, "connection", "QuickBooks", "No successful sync has ever completed.");
  } else if (snapshot.hoursSinceSync > snapshot.staleSyncHours) {
    add(
      RULES.sync_stale,
      "connection",
      "QuickBooks",
      `Last successful sync was ${Math.floor(snapshot.hoursSinceSync)} hours ago.`,
    );
  }

  for (const write of snapshot.unresolvedWrites) {
    add(
      RULES.write_needs_review,
      write.id,
      write.entity,
      `A ${write.entity} write failed and is waiting for a person: ${write.reason}`,
      { entityUrl: "/admin/finance/health" },
    );
  }

  // -- Projects ------------------------------------------------------------
  for (const project of snapshot.projects) {
    const url = `/admin/finance/projects/${project.id}`;

    if (!project.qboCustomerId) {
      add(
        RULES.project_not_linked,
        project.id,
        `${project.p5Id} ${project.name}`,
        `Status is ${project.status}, and no QuickBooks customer is linked.`,
        { entityUrl: url },
      );
      continue; // Everything below needs the QuickBooks record to exist.
    }

    const customer = customerById.get(project.qboCustomerId);
    if (!customer) continue; // Sync gap, not a setup error; sync_stale covers it.

    if (!customer.parentQboId) {
      add(
        RULES.project_not_sub_customer,
        project.id,
        `${project.p5Id} ${project.name}`,
        `"${customer.displayName}" sits at the top level in QuickBooks instead of under the customer who hired us.`,
        { entityUrl: url },
      );
    }

    if (customer.parentQboId && customer.billWithParent) {
      add(
        RULES.project_bills_with_parent,
        project.id,
        `${project.p5Id} ${project.name}`,
        `"${customer.displayName}" is set to bill with its parent, so invoices will not stay on this job.`,
        { entityUrl: url },
      );
    }

    // Over-billing: everything invoiced against the job, versus what the
    // customer has actually agreed to pay.
    const billed = snapshot.invoices
      .filter((i) => i.customerQboId === project.qboCustomerId)
      .reduce((sum, i) => sum + i.total, 0);
    const allowed = project.contractAmount + project.approvedChangeOrders;
    if (allowed > 0 && billed > allowed) {
      add(
        RULES.invoice_exceeds_contract,
        project.id,
        `${project.p5Id} ${project.name}`,
        `Billed ${money(billed)} against an approved contract value of ${money(allowed)}.`,
        { amount: billed - allowed, entityUrl: url },
      );
    }
  }

  // Jobs someone created straight in QuickBooks, which P5 knows nothing about.
  for (const customer of snapshot.customers) {
    if (!customer.active) continue;
    const looksLikeJob = customer.isProject || customer.parentQboId !== null;
    if (looksLikeJob && !projectByQboId.has(customer.qboId)) {
      add(
        RULES.qbo_project_not_in_p5,
        customer.qboId,
        customer.displayName,
        "This job is in QuickBooks with no matching P5 project, so it has no budget and no cost tracking.",
      );
    }
  }

  // -- Customers -----------------------------------------------------------
  for (const customer of snapshot.customers) {
    // Sub-customers inherit contact details from the parent, so a missing email
    // on a job is not a real gap - only a top-level customer needs its own.
    const isTopLevel = customer.parentQboId === null;

    if (customer.active && isTopLevel && !customer.email) {
      add(
        RULES.customer_missing_email,
        customer.qboId,
        customer.displayName,
        "No email address, so invoices and reminders cannot be sent automatically.",
      );
    }

    if (customer.active && isTopLevel && !customer.billingAddress) {
      add(
        RULES.customer_missing_address,
        customer.qboId,
        customer.displayName,
        "No billing address on file.",
      );
    }

    if (!customer.active && customer.balance > 0) {
      add(
        RULES.customer_inactive_with_balance,
        customer.qboId,
        customer.displayName,
        `Marked inactive while still owing ${money(customer.balance)}.`,
        { amount: customer.balance },
      );
    }
  }

  for (const group of duplicateGroups(
    snapshot.customers.filter((c) => c.active && c.parentQboId === null),
    (c) => c.displayName,
  )) {
    const names = group.map((c) => `"${c.displayName}"`).join(" and ");
    for (const customer of group) {
      add(
        RULES.customer_possible_duplicate,
        customer.qboId,
        customer.displayName,
        `${names} reduce to the same name once punctuation and company suffixes are removed.`,
      );
    }
  }

  // -- Vendors -------------------------------------------------------------
  for (const vendor of snapshot.vendors) {
    if (vendor.active && !vendor.trackedInP5) {
      add(
        RULES.vendor_no_profile,
        vendor.qboId,
        vendor.displayName,
        "In QuickBooks but not in P5, so no W-9 or insurance tracking is running.",
        { entityUrl: "/admin/finance/vendors" },
      );
    }

    // Paid real money with the 1099 question never answered either way.
    if (vendor.active && vendor.paidThisYear > 0 && vendor.vendor1099 === null) {
      add(
        RULES.vendor_1099_undecided,
        vendor.qboId,
        vendor.displayName,
        `Paid ${money(vendor.paidThisYear)} this year with the 1099 setting never decided.`,
        { amount: vendor.paidThisYear, entityUrl: "/admin/finance/tax" },
      );
    }

    // Past the threshold with no W-9: a filing obligation we cannot meet.
    if (
      vendor.paidThisYear >= snapshot.form1099Threshold &&
      !vendor.w9OnFile &&
      vendor.vendor1099 !== false
    ) {
      add(
        RULES.vendor_1099_no_w9,
        vendor.qboId,
        vendor.displayName,
        `Paid ${money(vendor.paidThisYear)} this year, over the ${money(snapshot.form1099Threshold)} threshold, with no W-9 on file.`,
        { amount: vendor.paidThisYear, entityUrl: "/admin/finance/tax" },
      );
    }

    if (vendor.vendor1099 === true && isCorporation(vendor.taxClassification)) {
      add(
        RULES.vendor_1099_on_corporation,
        vendor.qboId,
        vendor.displayName,
        `The W-9 says ${vendor.taxClassification}, but the vendor is flagged to receive a 1099.`,
        { entityUrl: "/admin/finance/tax" },
      );
    }

    if (vendor.active && !vendor.email) {
      add(
        RULES.vendor_missing_email,
        vendor.qboId,
        vendor.displayName,
        "No email address, so purchase orders and tax forms must be delivered by hand.",
      );
    }

    if (!vendor.active && vendor.balance > 0) {
      add(
        RULES.vendor_inactive_with_balance,
        vendor.qboId,
        vendor.displayName,
        `Marked inactive while we still owe ${money(vendor.balance)}.`,
        { amount: vendor.balance },
      );
    }
  }

  for (const group of duplicateGroups(
    snapshot.vendors.filter((v) => v.active),
    (v) => v.displayName,
  )) {
    const names = group.map((v) => `"${v.displayName}"`).join(" and ");
    for (const vendor of group) {
      add(
        RULES.vendor_possible_duplicate,
        vendor.qboId,
        vendor.displayName,
        `${names} reduce to the same name once punctuation and company suffixes are removed.`,
      );
    }
  }

  // -- Invoices ------------------------------------------------------------
  for (const invoice of snapshot.invoices) {
    const label = invoice.docNumber ? `Invoice ${invoice.docNumber}` : "Invoice (no number)";

    if (!invoice.customerQboId) {
      add(
        RULES.invoice_no_project,
        invoice.qboId,
        label,
        `${money(invoice.total)} billed with no customer or job on the invoice.`,
        { amount: invoice.total },
      );
    } else {
      // Booked to a real customer, but to the drawer instead of the folder.
      const customer = customerById.get(invoice.customerQboId);
      const hasJobsBeneath = snapshot.customers.some(
        (c) => c.parentQboId === invoice.customerQboId,
      );
      if (customer && customer.parentQboId === null && hasJobsBeneath) {
        add(
          RULES.invoice_on_parent_customer,
          invoice.qboId,
          label,
          `Billed to "${customer.displayName}" rather than to one of the jobs underneath them.`,
          { amount: invoice.total },
        );
      }
    }

    if (!invoice.dueDate && invoice.balance > 0) {
      add(
        RULES.invoice_no_due_date,
        invoice.qboId,
        label,
        `${money(invoice.balance)} outstanding with no due date, so it can never be counted as late.`,
        { amount: invoice.balance },
      );
    }

    if (invoice.total <= 0) {
      add(
        RULES.invoice_zero_total,
        invoice.qboId,
        label,
        `Total is ${money(invoice.total)}.`,
        { amount: invoice.total },
      );
    }
  }

  // -- Bills ---------------------------------------------------------------
  const vendorById = new Map(snapshot.vendors.map((v) => [v.qboId, v]));

  for (const bill of snapshot.bills) {
    const vendor = bill.vendorQboId ? vendorById.get(bill.vendorQboId) : undefined;
    const label = vendor
      ? `${vendor.displayName} bill ${bill.vendorDocNumber ?? bill.docNumber ?? "(no number)"}`
      : `Bill ${bill.docNumber ?? "(no number)"}`;

    if (!bill.customerQboId) {
      add(
        RULES.bill_no_project,
        bill.qboId,
        label,
        `${money(bill.total)} of cost with no job on it, so it lands on the company instead.`,
        { amount: bill.total },
      );
    }

    if (bill.hasBillableLine && bill.customerQboId) {
      add(
        RULES.bill_marked_billable,
        bill.qboId,
        label,
        `${money(bill.total)} of job cost is flagged billable, which would charge the customer a second time.`,
        { amount: bill.total },
      );
    }

    if (!bill.dueDate && bill.balance > 0) {
      add(
        RULES.bill_no_due_date,
        bill.qboId,
        label,
        `${money(bill.balance)} owed with no due date, so it will never appear as due.`,
        { amount: bill.balance },
      );
    }

    if (bill.hasUncategorizedLine) {
      add(
        RULES.bill_uncategorized,
        bill.qboId,
        label,
        `${money(bill.total)} sits in a catch-all account instead of a real cost category.`,
        { amount: bill.total },
      );
    }

    if (
      bill.total >= snapshot.commitmentThreshold &&
      bill.hasCommitment === false &&
      bill.customerQboId
    ) {
      add(
        RULES.bill_no_commitment,
        bill.qboId,
        label,
        `${money(bill.total)} billed with no purchase order or subcontract agreed beforehand.`,
        { amount: bill.total },
      );
    }

    if (vendor?.paymentHold && bill.balance > 0) {
      add(
        RULES.bill_vendor_on_hold,
        bill.qboId,
        label,
        `${money(bill.balance)} open to a vendor on payment hold.`,
        { amount: bill.balance, entityUrl: "/admin/finance/vendors" },
      );
    }
  }

  // Same vendor, same invoice number, twice. The classic double payment.
  const byVendorAndNumber = new Map<string, TxnRecord[]>();
  for (const bill of snapshot.bills) {
    if (!bill.vendorQboId || !bill.vendorDocNumber) continue;
    const key = `${bill.vendorQboId}::${bill.vendorDocNumber.trim().toLowerCase()}`;
    const bucket = byVendorAndNumber.get(key);
    if (bucket) bucket.push(bill);
    else byVendorAndNumber.set(key, [bill]);
  }
  for (const bills of byVendorAndNumber.values()) {
    if (bills.length < 2) continue;
    const vendor = vendorById.get(bills[0].vendorQboId as string);
    const total = bills.reduce((sum, b) => sum + b.total, 0);
    for (const bill of bills) {
      add(
        RULES.bill_duplicate_number,
        bill.qboId,
        `${vendor?.displayName ?? "Vendor"} bill ${bill.vendorDocNumber}`,
        `${bills.length} bills share vendor invoice number "${bill.vendorDocNumber}", totalling ${money(total)}.`,
        { amount: bill.total },
      );
    }
  }

  // -- Purchase orders -----------------------------------------------------
  const projectStatusByQboId = new Map(
    snapshot.projects
      .filter((p) => p.qboCustomerId)
      .map((p) => [p.qboCustomerId as string, p]),
  );

  for (const po of snapshot.purchaseOrders) {
    if ((po.poStatus ?? "Open") !== "Open") continue;
    if (!po.customerQboId) continue;
    const project = projectStatusByQboId.get(po.customerQboId);
    if (project && FINISHED_STATUSES.has(project.status)) {
      add(
        RULES.po_open_on_closed_job,
        po.qboId,
        `PO ${po.docNumber ?? po.qboId}`,
        `Still open for ${money(po.total)} on ${project.p5Id}, which is ${project.status}.`,
        { amount: po.total, entityUrl: `/admin/finance/projects/${project.id}` },
      );
    }
  }

  // -- Subcontracts --------------------------------------------------------
  for (const sub of snapshot.subcontracts) {
    const label = `${sub.reference} - ${sub.vendorName}`;
    const url = `/admin/finance/subcontracts/${sub.id}`;

    if (sub.status !== "draft" && !sub.qboPurchaseOrderId) {
      add(
        RULES.subcontract_no_po,
        sub.id,
        label,
        `${money(sub.originalAmount)} committed on ${sub.projectP5Id} with nothing recorded in QuickBooks.`,
        { amount: sub.originalAmount, entityUrl: url },
      );
    }

    if (WORKING_STATUSES.has(sub.status) && !sub.executedOn) {
      add(
        RULES.subcontract_unexecuted,
        sub.id,
        label,
        `Status is ${sub.status.replace("_", " ")} but no signature date was ever recorded.`,
        { amount: sub.originalAmount, entityUrl: url },
      );
    }

    const committed = sub.originalAmount + sub.approvedChanges;
    if (sub.billedToDate > committed) {
      add(
        RULES.bill_exceeds_commitment,
        sub.id,
        label,
        `Billed ${money(sub.billedToDate)} against a commitment of ${money(committed)}.`,
        { amount: sub.billedToDate - committed, entityUrl: url },
      );
    }
  }

  // Most serious first, so the top of the list is the part worth reading.
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.rule.severity] - SEVERITY_ORDER[b.rule.severity],
  );
}

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  urgent: 1,
  warning: 2,
  info: 3,
};

/** Counts by severity, for the badge on Today and the subject line of the email. */
export function summariseFindings(
  findings: AuditFinding[],
): Record<AuditSeverity, number> & { total: number } {
  const counts = { critical: 0, urgent: 0, warning: 0, info: 0, total: 0 };
  for (const f of findings) {
    counts[f.rule.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * The dedupe key for a finding, matching attention_item.subject_key.
 *
 * Built from the rule and the record, never from the wording, so an item stays
 * the same item when the amounts in its detail line move.
 */
export function findingKey(finding: AuditFinding): string {
  return `${finding.rule.entity}:${finding.entityId}`;
}
