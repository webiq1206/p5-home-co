import { archiveTarget, archiveReviewHeld, confirmArchiveReview, releaseRestoredArchive, openArchiveReviewCount } from "./hubspot-archive-review.ts";
/** Durable HubSpot action tasks. Never retry an ambiguous task creation. */
import { query, transaction, isMissingRelation } from "../db.ts";
import { loadSettings } from "../leads/settings.ts";
import { actionResolvesIncident, type RemoteDeal } from "../notifications/incidents.ts";
import { ensureP5HubSpotPortal } from "./hubspot-portal.ts";

import { HubSpotDiagnosticError, hubSpotRequestOperation, type HubSpotOperation, countHubSpotFailure, hubSpotFailureSummary, type HubSpotFailureCode } from "./hubspot-diagnostics.ts";

class TaskApiError extends HubSpotDiagnosticError {
  status: number;
  constructor(status: number, operation: HubSpotOperation) {
    super(status ? `${operation}:http_${status}` : `${operation}:network_or_timeout`);
    this.status = status;
  }
}

export async function requestHubSpotTaskApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const operation = hubSpotRequestOperation(path, init.method ?? "GET");
  const target = archiveTarget(path, init.method ?? "GET");
  if (target && await archiveReviewHeld(target)) {
    throw new HubSpotDiagnosticError(`${operation}:archived_record_review_required`);
  }
  // Never read or write any portal but P5's (hubspot-portal.ts).
  try {
    await ensureP5HubSpotPortal(process.env.HUBSPOT_TOKEN ?? "");
  } catch {
    throw new HubSpotDiagnosticError(`${operation}:portal_verification`);
  }
  let response: Response;
  try {
    response = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TaskApiError(0, operation);
  }
  if (!response.ok) {
    // A missing linked object may be deliberately archived. Only an exact-ID,
    // read-only archived lookup can establish that; never infer a lifecycle
    // outcome, clear references, restore it or create a replacement.
    const archivedLookup = /(?:[?&])archived=true(?:&|$)/.test(path);
    if (response.status === 404 && !archivedLookup &&
        (operation === "task_read" || operation === "deal_read")) {
      const archived = await requestHubSpotTaskApi<{ archived?: boolean }>(
        `${path}${path.includes("?") ? "&" : "?"}archived=true`,
      );
      if (archived.archived === true && target) {
        await confirmArchiveReview(target);
        throw new HubSpotDiagnosticError(`${operation}:archived_record_review_required`);
      }
    }
    throw new TaskApiError(response.status, operation);
  }
  let body: T;
  try { body = await response.json() as T; }
  catch { throw new HubSpotDiagnosticError(`${operation}:invalid_response`); }
  if (target && body && typeof body === "object" && "archived" in body && body.archived === false) {
    await releaseRestoredArchive(target);
  }
  return body;
}

/** Fair, bounded read-only recovery checks, even if the original lead left the active queue. */
async function recheckArchivedReferences(): Promise<void> {
  let due: { object_type: string; remote_id: string }[];
  try {
    due = await query(`SELECT object_type,remote_id FROM hubspot_archive_review
      WHERE restored_at IS NULL AND next_check_at<=now() ORDER BY next_check_at,object_type,remote_id LIMIT 5`);
  } catch (error) { if (isMissingRelation(error)) return; throw error; }
  for (const row of due) {
    try {
      await requestHubSpotTaskApi(`/crm/v3/objects/${row.object_type}/${encodeURIComponent(row.remote_id)}?properties=hs_object_id`);
    } catch {
      // Unknown missing, denied or unavailable is not evidence of restoration.
      // Retain the explicit review hold and bound further attempts.
    } finally {
      await query(`UPDATE hubspot_archive_review SET last_checked_at=now(),next_check_at=now()+interval '24 hours'
        WHERE object_type=$1 AND remote_id=$2 AND restored_at IS NULL`, [row.object_type,row.remote_id]);
    }
  }
}

const request = requestHubSpotTaskApi;

function safeNotes(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

type Task = { id: string; properties: { hs_task_status?: string } };
type Incident = {
  id: string; deal_id: string; family: string; anchor: string;
  title: string; reason: string; tier: string; opened_at: string;
  resolved_at: string | null; acknowledged_at: string | null;
  hubspot_task_id: string | null; task_subject: string | null;
  create_attempted_at: string | null;
  hubspot_deal_id: string | null; hubspot_contact_id: string | null;
  brand: string; name: string;
};

export type TaskSyncSummary = { considered: number; created: number; completed: number; failed: number; skipped: number };

const DEAL_PROPERTIES = [
  "dealstage", "hubspot_owner_id", "p5_first_attempt_at", "p5_next_action",
  "p5_next_action_at", "p5_appointment_at", "closed_lost_reason",
];

async function acknowledge(id: string, source: string): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `UPDATE lead_alert_incident SET acknowledged_at=COALESCE(acknowledged_at,now()),
       acknowledgement_source=COALESCE(acknowledgement_source,$2), last_error=NULL WHERE id=$1`,
      [id, source],
    );
    await client.query(
      "UPDATE alert SET acknowledged_at=COALESCE(acknowledged_at,now()) WHERE incident_id=$1 AND resolved_at IS NULL",
      [id],
    );
  });
}

async function findTask(subject: string): Promise<Task | null> {
  const found = await request<{ total: number; results: Task[] }>("/crm/v3/objects/tasks/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "hs_task_subject", operator: "EQ", value: subject }] }],
      properties: ["hs_task_status"], limit: 2,
    }),
  });
  if (found.total > 1) throw new HubSpotDiagnosticError("duplicate_incident_tasks");
  return found.results[0] ?? null;
}

/**
 * Covers every brand in the shared intake ledger. Existing tasks retain manager
 * ownership, notes, dates and status. Only a resolved issue completes a task.
 */
export async function syncHubSpotAlertTasks(now = new Date(), limit = 25): Promise<TaskSyncSummary> {
  const summary: TaskSyncSummary = { considered: 0, created: 0, completed: 0, failed: 0, skipped: 0 };
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !process.env.HUBSPOT_TOKEN) {
    return { ...summary, skipped: 1 };
  }
  await recheckArchivedReferences();
  const rows = await query<Incident>(
    `SELECT i.*, d.hubspot_deal_id, d.brand, d.name, c.hubspot_contact_id
     FROM lead_alert_incident i JOIN deal d ON d.id=i.deal_id
     JOIN contact c ON c.id=d.contact_id
     WHERE d.original_form IS DISTINCT FROM 'p5-estimator-synthetic-qa' AND i.task_completed_at IS NULL AND
       (i.resolved_at IS NULL OR i.hubspot_task_id IS NOT NULL OR i.create_attempted_at IS NOT NULL)
     ORDER BY i.last_checked_at ASC NULLS FIRST, i.id LIMIT $1`,
    [limit],
  );
  // Round-robin selection ensures persistent issues cannot starve later leads.
  const deals = new Map<string, RemoteDeal>();
  let owners: { id: string; email?: string; archived?: boolean }[] | undefined;
  const associationTypes = new Map<string, number>();
  async function associationType(to: string): Promise<number> {
    if (associationTypes.has(to)) return associationTypes.get(to)!;
    const labels = await request<{ results: { category: string; typeId: number; label: string | null }[] }>(
      `/crm/v4/associations/tasks/${to}/labels`,
    );
    const type = labels.results.find((r) => r.category === "HUBSPOT_DEFINED" && r.label === null);
    if (!type) throw new HubSpotDiagnosticError("missing_association_type");
    associationTypes.set(to, type.typeId);
    return type.typeId;
  }
  async function ownerId(deal: RemoteDeal): Promise<string> {
    if (!owners) {
      owners = [];
      let after: string | undefined;
      do {
        const page = await request<{
          results: { id: string; email?: string; archived?: boolean }[];
          paging?: { next?: { after: string } };
        }>(`/crm/v3/owners/?archived=false&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        owners.push(...page.results.filter((o) => !o.archived));
        after = page.paging?.next?.after;
      } while (after);
    }
    const assigned = owners.find((o) => o.id === deal.hubspot_owner_id);
    if (assigned) return assigned.id;
    const configured = process.env.HUBSPOT_TASK_OWNER_ID;
    const mailbox = settings.brandEmailAliases["P5 Home Co"]?.address.toLowerCase();
    const fallback = configured
      ? owners.find((o) => o.id === configured)
      : owners.find((o) => o.email?.toLowerCase() === mailbox);
    if (!fallback) throw new HubSpotDiagnosticError("missing_task_owner");
    return fallback.id;
  }

  const failures = new Map<HubSpotFailureCode, number>();
  for (const row of rows) {
    summary.considered++;
    try {
      await query("UPDATE lead_alert_incident SET last_checked_at=$2 WHERE id=$1", [row.id, now]);
      if (!row.hubspot_deal_id || !row.hubspot_contact_id) {
        throw new HubSpotDiagnosticError("waiting_for_lead_sync");
      }
      // A confirmed held deal cannot be acted on. Avoid task reads/searches
      // until the independent read-only rechecker verifies restoration.
      if (await archiveReviewHeld({ type: "deals", id: row.hubspot_deal_id })) {
        throw new HubSpotDiagnosticError("deal_read:archived_record_review_required");
      }
      // The subject is immutable and stored before any create attempt. The
      // incident ID is a recovery key when a response is lost after creation.
      const subject = row.task_subject ?? `P5 action ${row.id}: ${row.title} | ${row.brand} | ${row.name}`.slice(0, 250);
      await query("UPDATE lead_alert_incident SET task_subject=COALESCE(task_subject,$2) WHERE id=$1", [row.id, subject]);
      let task = row.hubspot_task_id
        ? await request<Task>(`/crm/v3/objects/tasks/${encodeURIComponent(row.hubspot_task_id)}?properties=hs_task_status`)
        : await findTask(subject);
      if (task) {
        await query("UPDATE lead_alert_incident SET hubspot_task_id=$2 WHERE id=$1", [row.id, task.id]);
      }
      if (task?.properties.hs_task_status === "COMPLETED") {
        await acknowledge(row.id, "hubspot_task_completed");
        await query("UPDATE lead_alert_incident SET task_completed_at=now(),last_error=NULL WHERE id=$1", [row.id]);
        summary.completed++;
        continue;
      }

      let remote = deals.get(row.hubspot_deal_id);
      if (!remote) {
        remote = (await request<{ properties: RemoteDeal }>(
          `/crm/v3/objects/deals/${encodeURIComponent(row.hubspot_deal_id)}?properties=${DEAL_PROPERTIES.join(",")}`,
        )).properties;
        deals.set(row.hubspot_deal_id, remote);
      }
      const acted = actionResolvesIncident(row.family, row.anchor, remote, now);
      if (row.resolved_at || row.acknowledged_at || acted) {
        if (acted) await acknowledge(row.id, "hubspot_deal_action");
        if (task) {
          await request(`/crm/v3/objects/tasks/${encodeURIComponent(task.id)}`, {
            method: "PATCH", body: JSON.stringify({ properties: { hs_task_status: "COMPLETED" } }),
          });
        } else if (row.create_attempted_at) {
          // A lost create response must still be reconciled, even if the lead
          // was handled meanwhile. Never create a replacement to find it.
          throw new HubSpotDiagnosticError("uncertain_task_creation");
        }
        await query("UPDATE lead_alert_incident SET task_completed_at=now(),last_error=NULL WHERE id=$1", [row.id]);
        summary.completed++;
        continue;
      }
      if (task) {
        await query("UPDATE lead_alert_incident SET last_error=NULL WHERE id=$1", [row.id]);
        summary.skipped++;
        continue;
      }
      if (row.create_attempted_at) {
        throw new HubSpotDiagnosticError("uncertain_task_creation");
      }
      const assignedTo = await ownerId(remote);
      const associations = [
        { to: { id: row.hubspot_deal_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: await associationType("deals") }] },
        { to: { id: row.hubspot_contact_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: await associationType("contacts") }] },
      ];
      const claimed = await query(
        `UPDATE lead_alert_incident SET create_attempted_at=now() WHERE id=$1
         AND create_attempted_at IS NULL AND hubspot_task_id IS NULL
         AND resolved_at IS NULL AND acknowledged_at IS NULL RETURNING id`, [row.id],
      );
      if (!claimed.length) { summary.skipped++; continue; }
      try {
        const base = (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
        task = await request<Task>("/crm/v3/objects/tasks", {
          method: "POST",
          body: JSON.stringify({
            properties: {
              hs_task_subject: subject,
              hs_task_body: safeNotes(`${row.brand}\n${row.reason}\n\n${base}/admin/lead/${row.deal_id}\n\nRecord the outcome and next action in HubSpot, then complete this task. Completing it acknowledges this issue without inventing a customer contact.`),
              hs_task_status: "NOT_STARTED", hs_task_type: "TODO",
              hs_task_priority: ["critical", "administrator"].includes(row.tier) ? "HIGH" : "MEDIUM",
              hs_timestamp: new Date(row.opened_at).toISOString(), hubspot_owner_id: assignedTo,
            },
            associations,
          }),
        });
        if (!task.id) throw new HubSpotDiagnosticError("uncertain_task_creation");
        await query("UPDATE lead_alert_incident SET hubspot_task_id=$2,last_error=NULL WHERE id=$1", [row.id, task.id]);
        summary.created++;
      } catch (error) {
        // Only a definitive rejection permits another POST. Network errors,
        // timeouts and server failures may already have created the task.
        if (error instanceof TaskApiError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
          await query("UPDATE lead_alert_incident SET create_attempted_at=NULL WHERE id=$1 AND hubspot_task_id IS NULL", [row.id]);
        }
        throw error;
      }
    } catch (error) {
      summary.failed++;
      await query("UPDATE lead_alert_incident SET last_error=$2 WHERE id=$1", [row.id, countHubSpotFailure(failures, error)]);
    }
  }
  const archiveReviews = await openArchiveReviewCount();
  await query(
    `INSERT INTO integration_health (name,state,last_attempt_at,last_success_at,last_error,records_processed)
     VALUES ('hubspot_tasks',$1,$2,$3,$4,$5)
     ON CONFLICT (name) DO UPDATE SET state=EXCLUDED.state,last_attempt_at=EXCLUDED.last_attempt_at,
       last_success_at=COALESCE(EXCLUDED.last_success_at,integration_health.last_success_at),
       last_error=EXCLUDED.last_error,records_processed=EXCLUDED.records_processed,updated_at=now()`,
    [summary.failed || archiveReviews !== 0 ? "failed" : "connected", now, summary.failed || archiveReviews !== 0 ? null : now,
      summary.failed ? `${summary.failed} lead task(s) could not sync. ${hubSpotFailureSummary(failures)}. Review the listed categories before further task creation.` : archiveReviews === null ? "Archive review unavailable: apply migration 030; coverage unverified." : archiveReviews ? `${archiveReviews} archived HubSpot reference(s) need review. No automatic restoration or replacement.` : null, summary.considered],
  );
  return summary;
}
