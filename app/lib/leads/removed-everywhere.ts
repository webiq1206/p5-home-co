/**
 * Deletions carry across HubSpot and QuickBooks (owner decision, 17 November 2026).
 *
 * Spam and junk are deleted by hand in whichever system the team happens to
 * be in. Deleting it in one place removes it from the other:
 *
 *   HubSpot deal deleted   ->  the lead's QuickBooks estimates are deleted and
 *                              the QuickBooks customer is made inactive.
 *   QuickBooks estimate    ->  the HubSpot deal (and a contact with no other
 *   deleted                    deal) is deleted and the lead is closed here.
 *
 * QuickBooks is the accounting record, so the rules are deliberately narrow:
 *   - Only an estimate that is unsent, or sent and not yet answered, is
 *     deleted. Accepted, invoiced or paid work is never touched from here.
 *   - A customer is only made inactive when nothing else is on it in
 *     QuickBooks and no other project here uses it. QuickBooks itself has no
 *     customer delete.
 *   - A deal the team MERGED in HubSpot is not a deletion; the lead is moved
 *     to the surviving deal (see hubspot-removed.ts).
 *   - Deleting a QuickBooks estimate only removes the HubSpot deal when it was
 *     the lead's last estimate, the lead is not won, and either nobody has
 *     worked the lead yet or the QuickBooks customer was removed too. An
 *     estimate deleted to be redone on a live lead leaves HubSpot alone.
 *   - Only estimates that came from the websites (the guided estimator, a
 *     request form's planning range, the document estimator) are linked to a
 *     lead, so only those carry. The link is read in estimate-links.ts.
 *
 * `CROSS_SYSTEM_DELETE=off` turns all of it off. Every step is on the lead's
 * audit trail and the scope project's event log.
 */
import { query, queryOne } from "../db.ts";
import { customersOfRemovedProjects, leadsForProject, projectsForLead, queryLeadLinks } from "./estimate-links.ts";

const NO_EMPLOYEE = null as unknown as number;
export const REMOVED_IN_QUICKBOOKS = "Removed in QuickBooks";

export function crossSystemDeleteEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.CROSS_SYSTEM_DELETE ?? "").trim().toLowerCase() !== "off";
}

/** Estimate states that are still only a proposal. Anything else is accounting history. */
const DELETABLE = new Set(["created_unsent", "sent", "declined", "closed", "deleted", "not_created", "unavailable"]);

type Outcome = { removed: string[]; kept: string[]; pending: string | null };

async function audit(dealId: number, action: string, detail: unknown, succeeded = true, error: string | null = null): Promise<void> {
  await query(
    `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value,succeeded,error)
     VALUES ('deal',$1,$2,'integration','quickbooks',$3::jsonb,$4,$5)`,
    [String(dealId), action, JSON.stringify(detail), succeeded, error],
  );
}

/**
 * Make a QuickBooks customer inactive when nothing is left on it. "Nothing"
 * is checked in QuickBooks itself, not in a local copy: any estimate, invoice,
 * sales receipt, payment, credit memo or refund, or any active sub-customer
 * or project, keeps the customer.
 */
export async function deactivateCustomerIfUnused(qboCustomerId: string): Promise<"deactivated" | "kept" | "already-inactive"> {
  const { qboQueryAll, qboRequest } = await import("../finance/qbo/client.ts");
  const stillUsed = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM scope_project WHERE qbo_customer_id = $1 AND deleted_at IS NULL",
    [qboCustomerId],
  );
  if (stillUsed?.n) return "kept";
  const id = qboCustomerId.replace(/'/g, "");
  for (const entity of ["Estimate", "Invoice", "SalesReceipt", "Payment", "CreditMemo", "RefundReceipt"]) {
    const rows = await qboQueryAll<{ Id: string }>(entity, `CustomerRef = '${id}'`);
    if (rows.length) return "kept";
  }
  // QuickBooks will not filter customers on ParentRef (the query is refused),
  // so the active customers are read and the parent is matched here.
  const active = await qboQueryAll<{ Id: string; ParentRef?: { value?: string } }>("Customer", "Active = true");
  if (active.some((customer) => customer.Id !== id && customer.ParentRef?.value === id)) return "kept";
  const current = await qboRequest<{ Customer?: { Id: string; SyncToken: string; Active?: boolean; Balance?: number } }>(`/customer/${encodeURIComponent(id)}`);
  if (!current.Customer) return "kept";
  if (current.Customer.Active === false) return "already-inactive";
  if (Number(current.Customer.Balance ?? 0) !== 0) return "kept";
  await qboRequest("/customer", {
    method: "POST",
    body: JSON.stringify({ Id: current.Customer.Id, SyncToken: current.Customer.SyncToken, sparse: true, Active: false }),
  });
  return "deactivated";
}

/**
 * The HubSpot deal for this lead was deleted. Remove what the estimator put in
 * QuickBooks for it. Safe to call again: a project already removed is skipped,
 * and one that must be kept is noted once and left alone.
 */
export async function removeLeadFromQuickBooks(dealId: number): Promise<Outcome> {
  const outcome: Outcome = { removed: [], kept: [], pending: null };
  if (!crossSystemDeleteEnabled()) return outcome;
  const projectIds = await projectsForLead(dealId);
  // Customers of projects already removed: a check that could not finish the
  // first time is made again on the retry.
  const earlier = await customersOfRemovedProjects(dealId);
  if (!projectIds.length && !earlier.length) return outcome;

  const { isQboConnected } = await import("../finance/qbo/oauth.ts");
  if (!(await isQboConnected().catch(() => false))) {
    outcome.pending = "QuickBooks is not connected.";
    await markPending(dealId, outcome.pending);
    return outcome;
  }
  const scopes = await import("../scopes/qbo.ts");
  const store = await import("../scopes/store.ts");
  const { estimateStatus } = await import("../scopes/estimate.ts");
  const customers = new Set<string>(earlier);

  for (const projectId of projectIds) {
    const project = await store.getProject(projectId);
    if (!project) continue;
    try {
      const estimate = await store.latestEstimate(projectId);
      if (estimate?.qbo_estimate_id && estimate.txn_status !== "Deleted") {
        // Read the estimate as QuickBooks has it now, not a stored copy: the
        // decision to delete rests on it. (Not refreshEstimate: that also acts
        // on an accepted estimate, which is the last thing wanted here.)
        const status = await liveEstimateStatus(estimate.qbo_estimate_id, estimateStatus);
        if (!DELETABLE.has(status)) {
          // Accepted, invoiced or paid: accounting history. Keep it, say so once.
          outcome.kept.push(`estimate${estimate.doc_number ? ` #${estimate.doc_number}` : ""} (${status})`);
          await store.logEvent(projectId, "kept-after-hubspot-removal", { status, docNumber: estimate.doc_number }, NO_EMPLOYEE);
          continue;
        }
      }
      const result = await scopes.deleteProjectEverywhere(project, NO_EMPLOYEE);
      outcome.removed.push(...result.removed.map((item) => `${item} (project ${projectId})`));
      if (project.qbo_customer_id) customers.add(project.qbo_customer_id);
    } catch (error) {
      outcome.pending = (error as Error).message.slice(0, 300);
    }
  }

  for (const customerId of customers) {
    try {
      const result = await deactivateCustomerIfUnused(customerId);
      if (result === "deactivated") outcome.removed.push(`customer ${customerId} (made inactive)`);
      else if (result === "kept") outcome.kept.push(`customer ${customerId} (has other records)`);
    } catch (error) {
      outcome.pending = (error as Error).message.slice(0, 300);
    }
  }

  if (outcome.pending) await markPending(dealId, outcome.pending);
  else await clearPending(dealId);
  if (outcome.removed.length || outcome.kept.length) {
    await audit(dealId, "quickbooks_removed_with_hubspot_deal", { removed: outcome.removed, kept: outcome.kept });
  }
  return outcome;
}

/** The estimate's state in QuickBooks right now. Gone there reads as "deleted"; any other error is thrown. */
async function liveEstimateStatus(qboEstimateId: string, estimateStatus: (raw: never, exists: boolean) => string): Promise<string> {
  const { qboRequest } = await import("../finance/qbo/client.ts");
  try {
    const res = await qboRequest<{ Estimate?: Record<string, unknown> }>(`/estimate/${encodeURIComponent(qboEstimateId)}`);
    if (!res.Estimate) throw new Error("QuickBooks returned no estimate.");
    return estimateStatus(res.Estimate as never, true);
  } catch (error) {
    if (/QBO 400/.test((error as Error).message) && /Object Not Found|"code":"610"/i.test((error as Error).message)) return "deleted";
    throw error;
  }
}

/** A cleanup that could not finish is remembered on the audit trail and retried by `settleRemovedLeads`. */
async function markPending(dealId: number, reason: string): Promise<void> {
  await audit(dealId, "quickbooks_cleanup_pending", { reason }, false, reason);
}
async function clearPending(dealId: number): Promise<void> {
  await query(
    `UPDATE audit_log SET succeeded = TRUE WHERE record_type='deal' AND record_id=$1
       AND action='quickbooks_cleanup_pending' AND succeeded = FALSE`,
    [String(dealId)],
  );
}

/**
 * Retry QuickBooks cleanups that could not finish (QuickBooks disconnected or
 * busy). One attempt per lead every six hours, a few leads per pass, and only
 * for a fortnight: after that a person can remove it by hand.
 */
export async function settleRemovedLeads(limit = 5): Promise<{ attempted: number; finished: number }> {
  if (!crossSystemDeleteEnabled()) return { attempted: 0, finished: 0 };
  const rows = await query<{ deal_id: string }>(
    `SELECT record_id AS deal_id FROM audit_log
      WHERE record_type='deal' AND action='quickbooks_cleanup_pending'
      GROUP BY record_id
     HAVING bool_or(NOT succeeded) AND max(occurred_at) < now() - interval '6 hours'
        AND min(occurred_at) > now() - interval '14 days'
      ORDER BY max(occurred_at) LIMIT $1`,
    [limit],
  );
  let finished = 0;
  for (const row of rows) {
    const outcome = await removeLeadFromQuickBooks(Number(row.deal_id)).catch((error) => ({ removed: [], kept: [], pending: (error as Error).message }));
    if (!outcome.pending) finished++;
  }
  return { attempted: rows.length, finished };
}

type LeadRow = {
  id: number; stage: string; hubspot_deal_id: string | null; hubspot_contact_id: string | null;
  first_attempt_at: Date | null; first_two_way_at: Date | null; appointment_at: Date | null;
};

/**
 * An estimate was deleted in QuickBooks by a person (never called for a
 * deletion this platform made itself). Decide whether that removes the lead
 * from HubSpot, and do it.
 */
export async function onQuickBooksEstimateRemoved(projectId: number): Promise<"removed" | "kept" | "ignored"> {
  if (!crossSystemDeleteEnabled()) return "ignored";
  const links = await leadsForProject(projectId);
  if (!links.length) return "ignored"; // Not an estimate from the websites.
  const store = await import("../scopes/store.ts");
  let result: "removed" | "kept" | "ignored" = "ignored";

  for (const dealId of links) {
    const lead = await queryOne<LeadRow>(
      `SELECT d.id::int AS id, d.stage, d.hubspot_deal_id, c.hubspot_contact_id,
              d.first_attempt_at, d.first_two_way_at, d.appointment_at
         FROM deal d JOIN contact c ON c.id = d.contact_id WHERE d.id = $1`,
      [dealId],
    );
    if (!lead || lead.stage === "Closed Won" || lead.stage === "Closed Lost") continue;

    // Another estimate for this lead is still live in QuickBooks: the lead stands.
    const others = await queryLeadLinks<{ id: number }>(
      (links) => `SELECT DISTINCT sp.id::int AS id FROM ${links} l JOIN scope_project sp ON sp.id = l.project_id
        WHERE l.deal_id = $1 AND sp.deleted_at IS NULL AND sp.id <> $2
          AND EXISTS (SELECT 1 FROM scope_estimate se WHERE se.project_id = sp.id AND se.qbo_estimate_id IS NOT NULL
                        AND se.txn_status IS DISTINCT FROM 'Deleted')`,
      [dealId, projectId],
    );
    if (others.length) { result = result === "removed" ? result : "kept"; continue; }

    // A lead someone is working is not junk just because its estimate was
    // deleted (it may be being redone). It goes only if nobody has touched it,
    // or the QuickBooks customer was removed as well.
    const untouched = lead.stage === "New Lead" && !lead.first_attempt_at && !lead.first_two_way_at && !lead.appointment_at;
    const project = await store.getProject(projectId, true);
    const customerGone = project?.qbo_customer_id ? await quickBooksCustomerGone(project.qbo_customer_id) : false;
    if (!untouched && !customerGone) {
      await store.logEvent(projectId, "estimate-deleted-lead-kept", { dealId, reason: "The lead is being worked and its QuickBooks customer is still active." }, NO_EMPLOYEE);
      result = result === "removed" ? result : "kept";
      continue;
    }

    const removed: string[] = [];
    const hubspot = await import("../integrations/hubspot-removed.ts");
    if (lead.hubspot_deal_id) {
      if (await hubspot.archiveInHubSpot("deals", lead.hubspot_deal_id)) removed.push("HubSpot deal");
    }
    if (lead.hubspot_contact_id && !(await hubspot.contactHasOtherDeals(lead.hubspot_contact_id))) {
      if (await hubspot.archiveInHubSpot("contacts", lead.hubspot_contact_id)) removed.push("HubSpot contact");
    }
    await hubspot.closeRemovedLead(dealId, REMOVED_IN_QUICKBOOKS, "quickbooks_estimate_removed", { projectId, removed, hubspotDealId: lead.hubspot_deal_id });
    // The scope projects behind the lead leave the list too; nothing is erased.
    for (const id of await projectsForLead(dealId)) {
      await store.markProjectDeleted(id, null, "The estimate was deleted in QuickBooks, so the lead was removed.");
      await store.logEvent(id, "project-deleted", { removed, reason: "estimate deleted in QuickBooks" }, NO_EMPLOYEE);
    }
    if (project?.qbo_customer_id && !customerGone) {
      const outcome = await deactivateCustomerIfUnused(project.qbo_customer_id).catch(() => "kept" as const);
      if (outcome === "deactivated") removed.push("QuickBooks customer (made inactive)");
    }
    result = "removed";
  }
  return result;
}

/** Inactive (QuickBooks' "deleted") or gone altogether. An error reading it is not proof. */
async function quickBooksCustomerGone(qboCustomerId: string): Promise<boolean> {
  try {
    const { qboRequest } = await import("../finance/qbo/client.ts");
    const current = await qboRequest<{ Customer?: { Active?: boolean } }>(`/customer/${encodeURIComponent(qboCustomerId)}`);
    return current.Customer?.Active === false;
  } catch (error) {
    return /QBO 400/.test((error as Error).message) && /Object Not Found|"code":"610"/i.test((error as Error).message);
  }
}

