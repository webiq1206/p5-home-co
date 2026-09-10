import { transaction } from "../db.ts";
import type { DealEvaluation, DealSnapshot, RuleFinding } from "../leads/rules.ts";

export type IncidentPlan = {
  family: string;
  anchor: string;
  title: string;
  reason: string;
  tier: string;
  kinds: string[];
};

const RANK: Record<string, number> = { none: 0, owner: 1, owner_manager: 2, critical: 3, administrator: 4 };

function condition(f: RuleFinding, d: DealSnapshot): [string, string, string] {
  const received = d.receivedAt.toISOString();
  if (["sla_breach", "response_ceiling_breached"].includes(f.kind) ||
      (!d.firstAttemptAt && ["next_action_overdue", "stale_deal"].includes(f.kind))) {
    return ["first_response", received, "Respond to new inquiry"];
  }
  if (f.kind === "client_reply_unanswered") {
    return ["client_reply", d.clientWaitingSince?.toISOString() ?? received, "Reply to customer"];
  }
  if (f.kind === "next_action_overdue") {
    return ["next_action", JSON.stringify([d.nextActionAt?.toISOString(), d.nextAction]), "Complete promised follow-up"];
  }
  if (["stale_deal", "estimate_awaiting_followup", "decision_pending_idle"].includes(f.kind)) {
    return ["stale_followup", (d.lastActivityAt ?? d.receivedAt).toISOString(), "Follow up on inactive deal"];
  }
  const titles: Record<string, string> = {
    missing_owner: "Assign a lead owner",
    missing_next_action: "Set the next action and due date",
    appointment_unconfirmed: "Confirm the appointment date",
    closed_lost_missing_reason: "Record the closed-lost reason",
  };
  return [f.kind, f.kind, titles[f.kind] ?? "Review lead issue"];
}

/** Elapsed time, wording and severity changes never create another task. */
export function planIncidents(e: DealEvaluation, d: DealSnapshot): IncidentPlan[] {
  const groups = new Map<string, IncidentPlan>();
  for (const f of e.findings) {
    if (/^(handoff|quickbooks)_/.test(f.kind)) continue;
    const [family, anchor, title] = condition(f, d);
    const current = groups.get(family);
    if (current) {
      current.kinds.push(f.kind);
      if ((RANK[f.tier] ?? 0) > (RANK[current.tier] ?? 0)) current.tier = f.tier;
      current.reason += `\n${f.reason}`;
    } else {
      groups.set(family, { family, anchor, title, reason: f.reason, tier: f.tier, kinds: [f.kind] });
    }
  }
  return [...groups.values()];
}

/** Reuse an acknowledged incident until its condition clears or its anchor changes. */
export async function reconcileIncidents(e: DealEvaluation, d: DealSnapshot): Promise<void> {
  const plans = planIncidents(e, d);
  await transaction(async (client) => {
    // Serialize reconciliation for a deal even if a watchdog lease expires.
    await client.query("SELECT id FROM deal WHERE id=$1 FOR UPDATE", [e.dealId]);
    const { rows } = await client.query<{ id: string; family: string; anchor: string }>(
      "SELECT id, family, anchor FROM lead_alert_incident WHERE deal_id=$1 AND resolved_at IS NULL",
      [e.dealId],
    );
    for (const row of rows) {
      if (!plans.some((p) => p.family === row.family && p.anchor === row.anchor)) {
        await client.query("UPDATE lead_alert_incident SET resolved_at=now() WHERE id=$1", [row.id]);
      }
    }
    for (const p of plans) {
      const { rows: incidents } = await client.query<{ id: string; acknowledged_at: Date | null }>(
        `INSERT INTO lead_alert_incident (deal_id,family,anchor,title,reason,tier)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (deal_id,family) WHERE resolved_at IS NULL DO UPDATE
           SET title=EXCLUDED.title, reason=EXCLUDED.reason, tier=EXCLUDED.tier
         RETURNING id, acknowledged_at`,
        [e.dealId, p.family, p.anchor, p.title, p.reason, p.tier],
      );
      await client.query(
        `UPDATE alert SET incident_id=$3,
           acknowledged_at=COALESCE(acknowledged_at,$4)
         WHERE deal_id=$1 AND kind=ANY($2::text[]) AND resolved_at IS NULL`,
        [e.dealId, p.kinds, incidents[0].id, incidents[0].acknowledged_at],
      );
    }
  });
}

export type RemoteDeal = Record<string, string | null | undefined>;

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/** Only explicit CRM outcomes satisfy a condition; task completion is handled separately. */
export function actionResolvesIncident(
  family: string, anchor: string, deal: RemoteDeal, now: Date,
): boolean {
  if (deal.dealstage === "closedwon" ||
      (deal.dealstage === "closedlost" && family !== "closed_lost_missing_reason")) return true;
  if (family === "first_response") {
    const attempted = dateValue(deal.p5_first_attempt_at);
    const received = dateValue(anchor);
    return attempted !== null && received !== null && attempted >= received && attempted <= now.getTime();
  }
  if (family === "missing_owner") return Boolean(deal.hubspot_owner_id);
  if (family === "missing_next_action" || family === "next_action") {
    const due = dateValue(deal.p5_next_action_at);
    return Boolean(deal.p5_next_action?.trim()) && due !== null && due > now.getTime();
  }
  if (family === "appointment_unconfirmed") return dateValue(deal.p5_appointment_at) !== null;
  if (family === "closed_lost_missing_reason") return Boolean(deal.closed_lost_reason?.trim());
  return false;
}
