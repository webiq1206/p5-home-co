/**
 * The link between a lead and the scope projects the websites made for it.
 *
 * Two kinds of estimate come from the websites, and each links to its lead in
 * its own place:
 *
 *   guided estimator   guided_estimate (scope_project_id, lead_deal_id)
 *   site estimate      scope_project.lead_deal_id (a request form's planning
 *                      range, or the document estimator; see site-estimate.ts)
 *
 * Everything that crosses between a lead and its QuickBooks estimates (the
 * deletion rules in removed-everywhere.ts, the stage rules in
 * stage-alignment.ts) reads the link here, so both kinds follow the same
 * rules. A project nobody linked to a lead (one a person started in the scope
 * platform) is in neither place and is left alone, as before.
 *
 * `scope_project.lead_deal_id` arrives with migration 032. Until a database
 * has it, the guided link alone is read, which is exactly what ran before.
 */
import { query } from "../db.ts";

/** Every (project, lead) pair, from both places. For use as `FROM ${LEAD_PROJECT_LINKS} l`. */
const BOTH_LINKS = `(
  SELECT ge.scope_project_id AS project_id, ge.lead_deal_id AS deal_id
    FROM guided_estimate ge WHERE ge.scope_project_id IS NOT NULL AND ge.lead_deal_id IS NOT NULL
  UNION
  SELECT sp.id AS project_id, sp.lead_deal_id AS deal_id
    FROM scope_project sp WHERE sp.lead_deal_id IS NOT NULL
)`;
const GUIDED_LINKS = `(
  SELECT ge.scope_project_id AS project_id, ge.lead_deal_id AS deal_id
    FROM guided_estimate ge WHERE ge.scope_project_id IS NOT NULL AND ge.lead_deal_id IS NOT NULL
)`;

/** Set when a database answered that it has no `scope_project.lead_deal_id` yet; looked at again after a minute. */
let guidedOnlyUntil = 0;

function columnMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === "42703" || /column .* does not exist/i.test(e.message ?? "")) && /lead_deal_id/.test(e.message ?? ""));
}

/**
 * Run a query over the lead links. `sql` receives the links as a sub-select
 * to put after FROM or inside EXISTS. Never interpolate a value into it.
 */
export async function queryLeadLinks<T extends Record<string, unknown>>(sql: (links: string) => string, params: readonly unknown[] = []): Promise<T[]> {
  if (Date.now() < guidedOnlyUntil) return query<T>(sql(GUIDED_LINKS), params);
  try {
    return await query<T>(sql(BOTH_LINKS), params);
  } catch (error) {
    if (!columnMissing(error)) throw error;
    guidedOnlyUntil = Date.now() + 60_000;
    console.error("[estimate-links] scope_project.lead_deal_id is missing (migration 032 not applied); reading guided estimates only.");
    return query<T>(sql(GUIDED_LINKS), params);
  }
}

/** Live scope projects the websites made for this lead. */
export async function projectsForLead(dealId: number): Promise<number[]> {
  const rows = await queryLeadLinks<{ id: number }>(
    (links) => `SELECT DISTINCT sp.id::int AS id FROM ${links} l JOIN scope_project sp ON sp.id = l.project_id
                 WHERE l.deal_id = $1 AND sp.deleted_at IS NULL ORDER BY 1`,
    [dealId],
  );
  return rows.map((row) => row.id);
}

/**
 * The leads behind one scope project (in practice one). Empty when the
 * project did not come from a website. `live` leaves out a removed project.
 */
export async function leadsForProject(projectId: number, options: { live?: boolean } = {}): Promise<number[]> {
  const rows = await queryLeadLinks<{ deal_id: number }>(
    (links) => `SELECT DISTINCT l.deal_id::int AS deal_id FROM ${links} l JOIN scope_project sp ON sp.id = l.project_id
                 WHERE l.project_id = $1${options.live ? " AND sp.deleted_at IS NULL" : ""} ORDER BY 1`,
    [projectId],
  );
  return rows.map((row) => row.deal_id);
}

/** The lead behind one scope project, or null when it did not come from a website. */
export async function leadForProject(projectId: number): Promise<number | null> {
  return (await leadsForProject(projectId))[0] ?? null;
}

/**
 * QuickBooks customers behind the lead's REMOVED website projects: a customer
 * whose check could not finish the first time is looked at again on the
 * retry, when its projects are already gone.
 */
export async function customersOfRemovedProjects(dealId: number): Promise<string[]> {
  const rows = await queryLeadLinks<{ id: string }>(
    (links) => `SELECT DISTINCT sp.qbo_customer_id AS id FROM ${links} l JOIN scope_project sp ON sp.id = l.project_id
                 WHERE l.deal_id = $1 AND sp.qbo_customer_id IS NOT NULL AND sp.deleted_at IS NOT NULL ORDER BY 1`,
    [dealId],
  );
  return rows.map((row) => row.id);
}

export type LeadEstimate = {
  projectId: number;
  title: string;
  /** "online-estimator" for the guided estimator, "site-estimate" for a request form or the document estimator. */
  source: string | null;
  qboEstimateId: string | null;
  docNumber: string | null;
  total: number | null;
  txnStatus: string | null;
  emailStatus: string | null;
  invoiced: boolean;
};

/** The lead's live website estimates, for the lead page: the project, and its current QuickBooks estimate if it has one. */
export async function estimatesForLead(dealId: number): Promise<LeadEstimate[]> {
  const rows = await queryLeadLinks<{
    project_id: number; title: string; source: string | null; qbo_estimate_id: string | null;
    doc_number: string | null; total: string | null; txn_status: string | null; email_status: string | null; linked_invoice: string | null;
  }>(
    (links) => `SELECT sp.id::int AS project_id, sp.title, v.source, e.qbo_estimate_id, e.doc_number, e.total::text AS total, e.txn_status, e.email_status, e.linked_invoice
                  FROM scope_project sp
                  LEFT JOIN scope_version v ON v.id = sp.current_version_id
                  LEFT JOIN LATERAL (
                    SELECT * FROM scope_estimate se WHERE se.project_id = sp.id ORDER BY se.created_at DESC, se.id DESC LIMIT 1
                  ) e ON true
                 WHERE sp.deleted_at IS NULL AND sp.id IN (SELECT l.project_id FROM ${links} l WHERE l.deal_id = $1)
                 ORDER BY sp.id`,
    [dealId],
  );
  return rows.map((row) => ({
    projectId: row.project_id,
    title: row.title,
    source: row.source,
    qboEstimateId: row.qbo_estimate_id,
    docNumber: row.doc_number,
    total: row.total === null ? null : Number(row.total),
    txnStatus: row.txn_status,
    emailStatus: row.email_status,
    invoiced: Boolean(row.linked_invoice),
  }));
}

/** One line for the lead page: where the estimate came from, its number, total and state. The total is the customer's price. */
export function describeLeadEstimate(estimate: LeadEstimate): string {
  const origin = estimate.source === "site-estimate" ? "Website estimate" : estimate.source === "online-estimator" ? "Instant estimate" : "Estimate";
  if (!estimate.qboEstimateId) return `${origin} · not in QuickBooks yet`;
  const state =
    estimate.txnStatus === "Deleted" ? "deleted in QuickBooks"
    : estimate.invoiced ? "invoiced"
    : estimate.txnStatus === "Accepted" ? "accepted"
    : estimate.txnStatus === "Rejected" ? "declined"
    : estimate.txnStatus === "Closed" ? "closed"
    : estimate.emailStatus === "EmailSent" ? "sent, awaiting response"
    : "in QuickBooks, not sent";
  const total = estimate.total === null ? "" : ` · $${estimate.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${origin}${estimate.docNumber ? ` ${estimate.docNumber}` : ""}${total} · ${state}`;
}
