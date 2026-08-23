/**
 * Needs Your Attention (S149): the central exception queue.
 *
 * The scanner derives every open item from current data on each run and
 * upserts by (kind, subject_key), so items appear when a condition starts,
 * update while it persists, and auto-resolve when it stops - nothing critical
 * depends on someone remembering to look (S212-50), and reminders stop on
 * resolution automatically (S200).
 */

import { query } from "../db.ts";
import { daysUntil } from "./compliance.ts";
import type { FinanceSettings } from "./settings.ts";
import { openInvoices } from "./reporting.ts";

export type Severity = "info" | "warning" | "urgent" | "critical";

export type AttentionCandidate = {
  kind: string;
  subjectKey: string;
  severity: Severity;
  title: string;
  detail: string;
  amount?: number | null;
  entityUrl?: string | null;
  dueOn?: string | null;          // ISO date
  recommendedAction?: string | null;
};

async function upsert(item: AttentionCandidate): Promise<void> {
  await query(
    `INSERT INTO attention_item
       (kind, subject_key, severity, title, detail, amount, entity_url, due_on, recommended_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (kind, subject_key) WHERE resolved_at IS NULL
     DO UPDATE SET severity=EXCLUDED.severity, title=EXCLUDED.title,
       detail=EXCLUDED.detail, amount=EXCLUDED.amount, due_on=EXCLUDED.due_on,
       recommended_action=EXCLUDED.recommended_action, updated_at=now()`,
    [
      item.kind,
      item.subjectKey,
      item.severity,
      item.title,
      item.detail,
      item.amount ?? null,
      item.entityUrl ?? null,
      item.dueOn ?? null,
      item.recommendedAction ?? null,
    ],
  );
}

/** Auto-resolve open items of a kind whose subject no longer qualifies. */
async function resolveStale(kind: string, liveKeys: string[]): Promise<void> {
  await query(
    `UPDATE attention_item
     SET resolved_at = now(), resolution = 'Condition cleared automatically.'
     WHERE kind = $1 AND resolved_at IS NULL AND NOT (subject_key = ANY($2::text[]))`,
    [kind, liveKeys],
  );
}

// ---------------------------------------------------------------------------
// Individual scanners. Each returns the live subject keys it produced.
// ---------------------------------------------------------------------------

async function scanVendorDocuments(
  today: Date,
  settings: FinanceSettings,
): Promise<void> {
  const rows = await query<{
    vendor_id: string;
    display_name: string;
    doc_type: string;
    status: string;
    expires_on: string | null;
  }>(
    `SELECT d.vendor_id, v.display_name, d.doc_type, d.status, d.expires_on::text
     FROM vendor_document d
     JOIN vendor_profile v ON v.id = d.vendor_id
     WHERE d.required AND v.active AND d.status <> 'waived'`,
  );
  const keys: string[] = [];
  for (const r of rows) {
    const key = `vendor:${r.vendor_id}:${r.doc_type}`;
    const expires = r.expires_on ? new Date(r.expires_on) : null;
    const days = expires ? daysUntil(today, expires) : null;

    if (r.status === "expired" || (days !== null && days < 0)) {
      keys.push(key);
      await upsert({
        kind: "vendor_doc",
        subjectKey: key,
        severity: "critical",
        title: `${r.display_name}: ${r.doc_type} expired`,
        detail: `A required compliance document has expired. Payments to this vendor are on hold until it is renewed and verified (S89).`,
        dueOn: r.expires_on,
        recommendedAction: "Request the renewed document and verify it.",
      });
    } else if (r.status === "missing" || r.status === "requested") {
      keys.push(key);
      await upsert({
        kind: "vendor_doc",
        subjectKey: key,
        severity: r.doc_type === "W-9" ? "urgent" : "warning",
        title: `${r.display_name}: ${r.doc_type} ${r.status}`,
        detail:
          r.doc_type === "W-9"
            ? "Missing required W-9 puts payments on hold (S83)."
            : "Required onboarding document is not on file (S87).",
        recommendedAction: "Request the document from the vendor.",
      });
    } else if (
      days !== null &&
      days >= 0 &&
      days <= Math.max(...settings.complianceReminderDays)
    ) {
      keys.push(key);
      await upsert({
        kind: "vendor_doc",
        subjectKey: key,
        severity: days <= 7 ? "urgent" : "warning",
        title: `${r.display_name}: ${r.doc_type} expires in ${days} day${days === 1 ? "" : "s"}`,
        detail: "Expiring compliance document; renewal needed before expiry to avoid a payment hold (S89).",
        dueOn: r.expires_on,
        recommendedAction: "Request the renewal certificate now.",
      });
    }
  }
  await resolveStale("vendor_doc", keys);
}

async function scanLienWaivers(): Promise<void> {
  const rows = await query<{
    id: string;
    waiver_type: string;
    status: string;
    display_name: string;
    p5_id: string;
    amount: string | null;
  }>(
    `SELECT w.id, w.waiver_type, w.status, v.display_name, p.p5_id, w.amount
     FROM lien_waiver w
     JOIN vendor_profile v ON v.id = w.vendor_id
     JOIN p5_project p ON p.id = w.project_id
     WHERE w.status NOT IN ('accepted','rejected')`,
  );
  const keys: string[] = [];
  for (const r of rows) {
    const key = `waiver:${r.id}`;
    keys.push(key);
    const conditional = r.waiver_type.startsWith("Conditional");
    await upsert({
      kind: "lien_waiver",
      subjectKey: key,
      severity: conditional ? "urgent" : "warning",
      title: `${r.display_name}: ${r.waiver_type} waiver ${r.status} (${r.p5_id})`,
      detail: conditional
        ? "Payment cannot proceed until the conditional waiver is accepted (S96)."
        : "Post-payment documentation outstanding until the unconditional waiver arrives (S96).",
      amount: r.amount ? Number(r.amount) : null,
      recommendedAction: conditional
        ? "Collect and review the conditional waiver before releasing payment."
        : "Chase the unconditional waiver now that payment has cleared.",
    });
  }
  await resolveStale("lien_waiver", keys);
}

async function scanOverdueAr(): Promise<void> {
  const invoices = await openInvoices();
  const today = new Date();
  const keys: string[] = [];
  for (const inv of invoices) {
    if (!inv.dueDate) continue;
    const overdueDays = -daysUntil(today, new Date(inv.dueDate));
    if (overdueDays <= 0) continue;
    const key = `invoice:${inv.qboId}`;
    keys.push(key);
    await upsert({
      kind: "ar_overdue",
      subjectKey: key,
      severity: overdueDays > 14 ? "urgent" : "warning",
      title: `Invoice ${inv.docNumber ?? inv.qboId} overdue ${overdueDays}d — ${inv.counterparty ?? "customer"}`,
      detail: "Past-due material AR requires attention (S75). Overdue AR is never counted as cash (S139).",
      amount: inv.openBalance,
      dueOn: inv.dueDate,
      recommendedAction: "Send a reminder or call the client.",
    });
  }
  await resolveStale("ar_overdue", keys);
}

async function scanRegistries(today: Date, settings: FinanceSettings): Promise<void> {
  // Subscriptions (S129)
  const subs = await query<{
    id: string; vendor_name: string; product: string;
    next_renewal: string | null; cancellation_deadline: string | null;
    amount: string; cadence: string;
  }>(
    `SELECT id, vendor_name, product, next_renewal::text, cancellation_deadline::text, amount, cadence
     FROM subscription_registry WHERE active`,
  );
  const subKeys: string[] = [];
  for (const s of subs) {
    const target = s.cancellation_deadline ?? s.next_renewal;
    if (!target) continue;
    const days = daysUntil(today, new Date(target));
    if (days < 0 || days > Math.max(...settings.subscriptionAlertDays)) continue;
    const key = `subscription:${s.id}`;
    subKeys.push(key);
    await upsert({
      kind: "subscription_renewal",
      subjectKey: key,
      severity: days <= 30 ? "warning" : "info",
      title: `${s.vendor_name} ${s.product} renews in ${days} day${days === 1 ? "" : "s"}`,
      detail: s.cancellation_deadline
        ? "Cancellation deadline approaching - decide before auto-renew (S129)."
        : "Subscription renewal approaching (S129).",
      amount: Number(s.amount),
      dueOn: target,
      recommendedAction: "Review usage and decide: keep, downgrade or cancel.",
    });
  }
  await resolveStale("subscription_renewal", subKeys);

  // Insurance (S130)
  const policies = await query<{
    id: string; policy_type: string; carrier: string; expires_on: string;
  }>(`SELECT id, policy_type, carrier, expires_on::text FROM insurance_policy WHERE active`);
  const insKeys: string[] = [];
  for (const p of policies) {
    const days = daysUntil(today, new Date(p.expires_on));
    if (days < 0 || days > Math.max(...settings.insuranceAlertDays)) {
      if (days < 0) {
        const key = `insurance:${p.id}`;
        insKeys.push(key);
        await upsert({
          kind: "insurance_expiry",
          subjectKey: key,
          severity: "critical",
          title: `${p.policy_type} (${p.carrier}) has EXPIRED`,
          detail: "Company insurance policy lapsed - operating uninsured is a critical exposure (S130).",
          dueOn: p.expires_on,
          recommendedAction: "Contact the broker immediately.",
        });
      }
      continue;
    }
    const key = `insurance:${p.id}`;
    insKeys.push(key);
    await upsert({
      kind: "insurance_expiry",
      subjectKey: key,
      severity: days <= 14 ? "urgent" : "warning",
      title: `${p.policy_type} (${p.carrier}) expires in ${days} day${days === 1 ? "" : "s"}`,
      detail: "Company insurance renewal approaching (S130).",
      dueOn: p.expires_on,
      recommendedAction: "Confirm renewal terms with the broker.",
    });
  }
  await resolveStale("insurance_expiry", insKeys);

  // Corporate compliance calendar (S135)
  const obligations = await query<{ id: string; name: string; due_on: string }>(
    `SELECT id, name, due_on::text FROM corporate_obligation WHERE completed_at IS NULL`,
  );
  const obKeys: string[] = [];
  for (const o of obligations) {
    const days = daysUntil(today, new Date(o.due_on));
    if (days > 30) continue;
    const key = `obligation:${o.id}`;
    obKeys.push(key);
    await upsert({
      kind: "corporate_compliance",
      subjectKey: key,
      severity: days < 0 ? "critical" : days <= 7 ? "urgent" : "warning",
      title:
        days < 0
          ? `${o.name} is ${-days} day${days === -1 ? "" : "s"} OVERDUE`
          : `${o.name} due in ${days} day${days === 1 ? "" : "s"}`,
      detail: "Corporate compliance obligation from the master calendar (S135).",
      dueOn: o.due_on,
      recommendedAction: "Complete the filing/renewal and mark it done.",
    });
  }
  await resolveStale("corporate_compliance", obKeys);
}

async function scanStaleForecasts(today: Date, settings: FinanceSettings): Promise<void> {
  const rows = await query<{ id: string; p5_id: string; name: string; etc_updated_at: Date | null }>(
    `SELECT id, p5_id, name, etc_updated_at FROM p5_project WHERE status = 'Active'`,
  );
  const keys: string[] = [];
  for (const r of rows) {
    const age = r.etc_updated_at
      ? (today.getTime() - new Date(r.etc_updated_at).getTime()) / 86_400_000
      : Infinity;
    if (age <= settings.forecastStaleDays) continue;
    const key = `project:${r.id}`;
    keys.push(key);
    await upsert({
      kind: "forecast_stale",
      subjectKey: key,
      severity: "warning",
      title: `Forecast update required: ${r.p5_id} ${r.name}`,
      detail: "The estimate-to-complete is stale; the projection cannot be shown as current (S49).",
      entityUrl: `/admin/finance/projects/${r.id}`,
      recommendedAction: "Review costs and update the ETC.",
    });
  }
  await resolveStale("forecast_stale", keys);
}

async function scanIntegrationHealth(): Promise<void> {
  const rows = await query<{ name: string; state: string; last_error: string | null }>(
    `SELECT name, state, last_error FROM integration_health WHERE state IN ('degraded','failed')`,
  );
  const keys: string[] = [];
  for (const r of rows) {
    const key = `integration:${r.name}`;
    keys.push(key);
    await upsert({
      kind: "integration_failure",
      subjectKey: key,
      severity: "critical",
      title: `Integration ${r.name} is ${r.state}`,
      detail: r.last_error ?? "Integration reported a failure (S176: no silent failures).",
      entityUrl: "/admin/finance/health",
      recommendedAction: "Open Automation Health and investigate.",
    });
  }
  await resolveStale("integration_failure", keys);
}

async function scanPendingDecisions(settings: FinanceSettings): Promise<void> {
  const keys: string[] = [];
  if (!settings.reserves.minimumOperatingReserveConfirmed) {
    keys.push("setting:minimumOperatingReserve");
    await upsert({
      kind: "decision_pending",
      subjectKey: "setting:minimumOperatingReserve",
      severity: "warning",
      title: "Owner decision required: minimum operating reserve",
      detail: "Safe Cash is computed with a provisional reserve of $" +
        settings.reserves.minimumOperatingReserve.toLocaleString() +
        " until ownership confirms the number (S208, S140).",
      entityUrl: "/admin/finance/settings",
      recommendedAction: "Set and confirm the reserve in Settings.",
    });
  }
  if (!settings.taxReserve.rateConfirmedByCpa) {
    keys.push("setting:taxReserveRate");
    await upsert({
      kind: "decision_pending",
      subjectKey: "setting:taxReserveRate",
      severity: "warning",
      title: "CPA approval required: tax reserve methodology",
      detail: `Tax reserve uses a provisional ${Math.round(settings.taxReserve.rate * 100)}% rate until the CPA confirms the methodology (S125).`,
      entityUrl: "/admin/finance/settings",
      recommendedAction: "Confirm the rate with the CPA, then mark it confirmed.",
    });
  }
  await resolveStale("decision_pending", keys);
}

async function scanPortalSubmissions(): Promise<void> {
  const rows = await query<{
    id: string; kind: string; reference: string | null; contact_name: string; scope: string | null;
  }>(
    `SELECT s.id, s.kind, s.reference, c.full_name AS contact_name,
            v.display_name AS scope
     FROM portal_submission s
     JOIN portal_contact c ON c.id = s.contact_id
     LEFT JOIN vendor_profile v ON v.id = c.vendor_id
     WHERE s.reviewed_at IS NULL`,
  );
  const keys: string[] = [];
  for (const r of rows) {
    const key = `submission:${r.id}`;
    keys.push(key);
    await upsert({
      kind: "portal_submission",
      subjectKey: key,
      severity: "warning",
      title: `Portal: ${r.scope ?? r.contact_name} sent a ${r.kind.replaceAll("_", " ")}${r.reference ? ` (${r.reference})` : ""}`,
      detail: "A vendor submitted something through the portal; nothing important lives only in an inbox (S99).",
      entityUrl: "/admin/finance/portal",
      recommendedAction: "Review it on the Portal page.",
    });
  }
  await resolveStale("portal_submission", keys);
}

// ---------------------------------------------------------------------------

export async function runAttentionScan(settings: FinanceSettings): Promise<number> {
  const today = new Date();
  await scanVendorDocuments(today, settings);
  await scanLienWaivers();
  await scanOverdueAr();
  await scanRegistries(today, settings);
  await scanStaleForecasts(today, settings);
  await scanIntegrationHealth();
  await scanPendingDecisions(settings);
  await scanPortalSubmissions();
  const row = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM attention_item WHERE resolved_at IS NULL`,
  );
  return Number(row[0]?.n ?? 0);
}
