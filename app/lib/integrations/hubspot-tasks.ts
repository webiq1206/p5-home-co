/** Durable HubSpot action tasks. Never retry an ambiguous task creation. */
import { query, transaction } from "../db.ts";
import { loadSettings } from "../leads/settings.ts";
import { actionResolvesIncident, type RemoteDeal } from "../notifications/incidents.ts";

class TaskApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`HubSpot task request failed (HTTP ${status || "network/timeout"}).`);
    this.status = status;
  }
}

export async function requestHubSpotTaskApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TaskApiError(0);
  }
  if (!response.ok) throw new TaskApiError(response.status);
  return await response.json() as T;
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
  if (found.total > 1) throw new Error("Multiple tasks share the incident key; manager review required.");
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
  const rows = await query<Incident>(
    `SELECT i.*, d.hubspot_deal_id, d.brand, d.name, c.hubspot_contact_id
     FROM lead_alert_incident i JOIN deal d ON d.id=i.deal_id
     JOIN contact c ON c.id=d.contact_id
     WHERE i.task_completed_at IS NULL AND
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
    if (!type) throw new Error(`HubSpot task-to-${to} association is unavailable.`);
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
    if (!fallback) throw new Error("No active HubSpot manager owner configured for lead tasks.");
    return fallback.id;
  }

  for (const row of rows) {
    summary.considered++;
    try {
      await query("UPDATE lead_alert_incident SET last_checked_at=$2 WHERE id=$1", [row.id, now]);
      if (!row.hubspot_deal_id || !row.hubspot_contact_id) {
        throw new Error("Waiting for this lead's HubSpot contact and deal sync.");
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
          throw new Error("Task creation outcome is uncertain; awaiting recovery by incident key.");
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
        throw new Error("Task creation outcome is uncertain; awaiting recovery by incident key.");
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
        if (!task.id) throw new Error("HubSpot did not return a task ID; creation outcome is uncertain.");
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
      await query("UPDATE lead_alert_incident SET last_error=$2 WHERE id=$1", [row.id, (error as Error).message]);
    }
  }
  await query(
    `INSERT INTO integration_health (name,state,last_attempt_at,last_success_at,last_error,records_processed)
     VALUES ('hubspot_tasks',$1,$2,$3,$4,$5)
     ON CONFLICT (name) DO UPDATE SET state=EXCLUDED.state,last_attempt_at=EXCLUDED.last_attempt_at,
       last_success_at=COALESCE(EXCLUDED.last_success_at,integration_health.last_success_at),
       last_error=EXCLUDED.last_error,records_processed=EXCLUDED.records_processed,updated_at=now()`,
    [summary.failed ? "failed" : "connected", now, summary.failed ? null : now,
      summary.failed ? `${summary.failed} lead task(s) could not sync. Check the HubSpot connection. An uncertain task delivery needs review before another task can be created.` : null, summary.considered],
  );
  return summary;
}
