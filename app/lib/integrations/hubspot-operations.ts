/** Read manager actions before evaluating alerts or pushing pending P5 changes. */
import { query, transaction } from "../db.ts";
import { loadSettings } from "../leads/settings.ts";
import { STAGE_BY_ID } from "./hubspot-map.ts";
import { requestHubSpotTaskApi } from "./hubspot-tasks.ts";

const PROPERTIES = [
  "dealstage", "hubspot_owner_id", "p5_first_attempt_at", "p5_first_two_way_at",
  "p5_next_action", "p5_next_action_at", "p5_appointment_at", "closed_lost_reason",
];

function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(/^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(d.getTime())) throw new Error("HubSpot returned an invalid action date.");
  return d;
}

export async function pullHubSpotLeadActions(now = new Date(), limit = 25): Promise<{ read: number; failed: number }> {
  const settings = await loadSettings();
  if (!settings.featureFlags.hubspotIntegrationEnabled || !process.env.HUBSPOT_TOKEN) return { read: 0, failed: 0 };
  const rows = await query<{ id: string; hubspot_deal_id: string; revision: string }>(
    `SELECT id,hubspot_deal_id,updated_at::text AS revision FROM deal
     WHERE hubspot_deal_id IS NOT NULL AND integration_sync_status='synced'
       AND (stage NOT IN ('Closed Won','Closed Lost') OR closed_at > now()-interval '7 days')
     ORDER BY last_hubspot_read_at ASC NULLS FIRST,id LIMIT $1`, [limit],
  );
  let read = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      // Advance the read cursor even for failures, so one inaccessible record
      // cannot starve other websites. This does not mark the request successful.
      await query("UPDATE deal SET last_hubspot_read_at=$2 WHERE id=$1", [row.id, now]);
      const { properties: p } = await requestHubSpotTaskApi<{ properties: Record<string, string | null> }>(
        `/crm/v3/objects/deals/${encodeURIComponent(row.hubspot_deal_id)}?properties=${PROPERTIES.join(",")}`,
      );
      const stage = STAGE_BY_ID[p.dealstage ?? ""];
      if (!stage) throw new Error("HubSpot deal stage is not mapped; no local operational data changed.");
      // Only requested properties actually returned by HubSpot are applied.
      // An omitted/unavailable property must never erase a local value.
      const patch: Record<string, unknown> = { stage };
      const fields: Record<string, string> = {
        p5_first_attempt_at: "first_attempt_at", p5_first_two_way_at: "first_two_way_at",
        p5_next_action_at: "next_action_at", p5_appointment_at: "appointment_at",
        p5_next_action: "next_action", closed_lost_reason: "closed_lost_reason",
      };
      for (const [remote, local] of Object.entries(fields)) {
        if (!Object.hasOwn(p, remote)) continue;
        patch[local] = remote.endsWith("_at") ? date(p[remote]) : p[remote]?.trim() || null;
        if (["first_attempt_at", "first_two_way_at"].includes(local) &&
            patch[local] instanceof Date && (patch[local] as Date).getTime() > now.getTime()) {
          throw new Error("HubSpot contact activity is dated in the future; no local action changed.");
        }
      }
      if (Object.hasOwn(p, "hubspot_owner_id")) {
        if (!p.hubspot_owner_id) patch.owner_user_id = null;
        else {
          const owners = await query<{ id: string }>("SELECT id FROM app_user WHERE is_active AND hubspot_owner_id=$1", [p.hubspot_owner_id]);
          if (owners.length === 1) patch.owner_user_id = Number(owners[0].id);
        }
      }
      await transaction(async (client) => {
        const entries = Object.entries(patch);
        const values = entries.map(([, v]) => v);
        // Column names come exclusively from the fixed map above. Compare the
        // read revision so an intervening local human action always wins.
        const sets = entries.map(([key], i) => `${key}=$${i + 1}`).join(",");
        const changed = entries.map(([key], i) => `${key} IS DISTINCT FROM $${i + 1}`).join(" OR ");
        const result = await client.query(
          `UPDATE deal SET ${sets},updated_at=now(),
             closed_at=CASE WHEN $${values.length + 1} THEN COALESCE(closed_at,now()) ELSE NULL END
           WHERE id=$${values.length + 2} AND integration_sync_status='synced'
             AND updated_at=$${values.length + 3}::timestamptz
             AND (${changed}) RETURNING id`,
          [...values, stage === "Closed Won" || stage === "Closed Lost", row.id, row.revision],
        );
        if (!result.rowCount) return;
        await client.query(
          `INSERT INTO audit_log (record_type,record_id,action,action_source,integration_source,new_value)
           VALUES ('deal',$1,'hubspot_actions_read','integration','hubspot',$2::jsonb)`,
          [row.id, JSON.stringify({ fields: Object.keys(patch) })],
        );
      });
      read++;
    } catch {
      failed++;
    }
  }
  await query(
    `INSERT INTO integration_health (name,state,last_attempt_at,last_success_at,last_error,records_processed)
     VALUES ('hubspot_actions',$1,$2,$3,$4,$5)
     ON CONFLICT (name) DO UPDATE SET state=EXCLUDED.state,last_attempt_at=EXCLUDED.last_attempt_at,
       last_success_at=COALESCE(EXCLUDED.last_success_at,integration_health.last_success_at),
       last_error=EXCLUDED.last_error,records_processed=EXCLUDED.records_processed,updated_at=now()`,
    [failed ? "failed" : "connected", now, failed ? null : now,
      failed ? `${failed} HubSpot action read(s) failed; check API access, dates and stage mapping.` : null, read],
  );
  return { read, failed };
}
