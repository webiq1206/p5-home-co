"use server";

/**
 * Server actions for the finance panel.
 *
 * Every mutation re-checks the role gate (S168: enforce server-side), writes
 * a finance_audit row (S174), and holds/overrides always carry a reason
 * (S175: never create invisible bypasses).
 */

import { revalidatePath } from "next/cache";

import { getSessionUser, type SessionUser } from "../../lib/auth.ts";
import { query, queryOne } from "../../lib/db.ts";
import { runFinanceDaily } from "../../lib/finance/jobs.ts";
import { runQboSync } from "../../lib/finance/qbo/sync.ts";
import { buildMoneyRun, persistMoneyRun } from "../../lib/finance/money-run.ts";
import {
  loadFinanceSettings,
  saveFinanceSettings,
} from "../../lib/finance/settings.ts";

async function requireFinanceUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || (user.role !== "administrator" && user.role !== "manager")) {
    throw new Error("Finance access requires an administrator or manager session.");
  }
  return user;
}

async function audit(
  actorId: number,
  action: string,
  objectKind: string,
  objectId: string,
  previous: unknown,
  next: unknown,
  reason: string | null,
): Promise<void> {
  await query(
    `INSERT INTO finance_audit (actor_id, action, object_kind, object_id, previous, next, reason)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      actorId,
      action,
      objectKind,
      objectId,
      previous === undefined ? null : JSON.stringify(previous),
      next === undefined ? null : JSON.stringify(next),
      reason,
    ],
  );
}

// ---------------------------------------------------------------------------
// Attention items (S149)
// ---------------------------------------------------------------------------

export async function resolveAttentionItem(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!id || !resolution) throw new Error("A resolution note is required.");

  const prev = await queryOne<{ title: string }>(
    `SELECT title FROM attention_item WHERE id = $1`, [id],
  );
  await query(
    `UPDATE attention_item SET resolved_at = now(), resolved_by = $2, resolution = $3
     WHERE id = $1 AND resolved_at IS NULL`,
    [id, user.id, resolution],
  );
  await audit(user.id, "resolve", "attention_item", String(id), prev, { resolution }, resolution);
  revalidatePath("/admin/finance");
}

// ---------------------------------------------------------------------------
// Vendor holds (S105, S109)
// ---------------------------------------------------------------------------

export async function setVendorHold(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const vendorId = Number(formData.get("vendorId"));
  const hold = String(formData.get("hold")) === "true";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!vendorId) throw new Error("Vendor id is required.");
  if (hold && !reason) throw new Error("A hold requires a reason (S105).");
  if (!hold && !reason) throw new Error("Releasing a hold requires a reason (S175).");

  const prev = await queryOne<{ payment_hold: boolean; payment_hold_reason: string | null }>(
    `SELECT payment_hold, payment_hold_reason FROM vendor_profile WHERE id = $1`,
    [vendorId],
  );
  await query(
    `UPDATE vendor_profile SET payment_hold = $2, payment_hold_reason = $3, updated_at = now()
     WHERE id = $1`,
    [vendorId, hold, hold ? reason : null],
  );
  await audit(
    user.id,
    hold ? "payment_hold_set" : "payment_hold_released",
    "vendor_profile",
    String(vendorId),
    prev,
    { payment_hold: hold, reason },
    reason,
  );
  revalidatePath("/admin/finance/vendors");
}

export async function setVendorDocument(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const vendorId = Number(formData.get("vendorId"));
  const docType = String(formData.get("docType") ?? "");
  const status = String(formData.get("status") ?? "");
  const expiresOn = String(formData.get("expiresOn") ?? "") || null;
  if (!vendorId || !docType || !status) throw new Error("Vendor, document and status are required.");

  await query(
    `INSERT INTO vendor_document (vendor_id, doc_type, status, expires_on, updated_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (vendor_id, doc_type) DO UPDATE SET
       status = EXCLUDED.status, expires_on = EXCLUDED.expires_on,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [vendorId, docType, status, expiresOn, user.id],
  );
  await audit(user.id, "vendor_document_update", "vendor_document",
    `${vendorId}:${docType}`, null, { status, expiresOn }, null);
  revalidatePath("/admin/finance/vendors");
}

// ---------------------------------------------------------------------------
// Registries (S127, S130, S135)
// ---------------------------------------------------------------------------

export async function addSubscription(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const vendorName = String(formData.get("vendorName") ?? "").trim();
  const product = String(formData.get("product") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const cadence = String(formData.get("cadence") ?? "monthly");
  const nextRenewal = String(formData.get("nextRenewal") ?? "") || null;
  if (!vendorName || !product) throw new Error("Vendor and product are required.");

  await query(
    `INSERT INTO subscription_registry (vendor_name, product, amount, cadence, next_renewal)
     VALUES ($1,$2,$3,$4,$5)`,
    [vendorName, product, amount, cadence, nextRenewal],
  );
  await audit(user.id, "subscription_add", "subscription_registry", vendorName,
    null, { product, amount, cadence }, null);
  revalidatePath("/admin/finance/registries");
}

export async function addInsurancePolicy(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const policyType = String(formData.get("policyType") ?? "").trim();
  const carrier = String(formData.get("carrier") ?? "").trim();
  const expiresOn = String(formData.get("expiresOn") ?? "");
  const premium = Number(formData.get("premium") ?? 0) || null;
  if (!policyType || !carrier || !expiresOn) {
    throw new Error("Policy type, carrier and expiry are required.");
  }
  await query(
    `INSERT INTO insurance_policy (policy_type, carrier, expires_on, premium)
     VALUES ($1,$2,$3,$4)`,
    [policyType, carrier, expiresOn, premium],
  );
  await audit(user.id, "insurance_add", "insurance_policy", policyType,
    null, { carrier, expiresOn }, null);
  revalidatePath("/admin/finance/registries");
}

export async function addObligation(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const name = String(formData.get("name") ?? "").trim();
  const dueOn = String(formData.get("dueOn") ?? "");
  const recurrence = String(formData.get("recurrence") ?? "annual");
  if (!name || !dueOn) throw new Error("Name and due date are required.");
  await query(
    `INSERT INTO corporate_obligation (name, due_on, recurrence) VALUES ($1,$2,$3)`,
    [name, dueOn, recurrence],
  );
  await audit(user.id, "obligation_add", "corporate_obligation", name, null, { dueOn }, null);
  revalidatePath("/admin/finance/registries");
}

export async function completeObligation(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const id = Number(formData.get("id"));
  if (!id) throw new Error("Obligation id is required.");

  const row = await queryOne<{ name: string; due_on: string; recurrence: string }>(
    `UPDATE corporate_obligation SET completed_at = now()
     WHERE id = $1 RETURNING name, due_on::text, recurrence`,
    [id],
  );
  // Recurring obligations roll forward automatically (S135).
  if (row && row.recurrence !== "one_time") {
    const next = new Date(row.due_on);
    if (row.recurrence === "monthly") next.setMonth(next.getMonth() + 1);
    else if (row.recurrence === "quarterly") next.setMonth(next.getMonth() + 3);
    else next.setFullYear(next.getFullYear() + 1);
    await query(
      `INSERT INTO corporate_obligation (name, due_on, recurrence)
       VALUES ($1,$2,$3)`,
      [row.name, next.toISOString().slice(0, 10), row.recurrence],
    );
  }
  await audit(user.id, "obligation_complete", "corporate_obligation", String(id), null, row, null);
  revalidatePath("/admin/finance/registries");
}

// ---------------------------------------------------------------------------
// Settings (S106, S125, S140, S208)
// ---------------------------------------------------------------------------

export async function updateReserves(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  if (user.role !== "administrator") {
    throw new Error("Reserve policy is administrator-only (S168).");
  }
  const minimumOperatingReserve = Number(formData.get("minimumOperatingReserve") ?? 0);
  const confirmed = formData.get("confirmed") === "on";
  const taxRate = Number(formData.get("taxRate") ?? 30) / 100;
  const taxConfirmed = formData.get("taxConfirmed") === "on";

  const previous = await loadFinanceSettings();
  const next = await saveFinanceSettings(
    {
      reserves: {
        ...previous.reserves,
        minimumOperatingReserve,
        minimumOperatingReserveConfirmed: confirmed,
      },
      taxReserve: { rate: taxRate, rateConfirmedByCpa: taxConfirmed },
    },
    user.id,
  );
  await audit(user.id, "settings_update", "finance_settings", "reserves",
    { reserves: previous.reserves, taxReserve: previous.taxReserve },
    { reserves: next.reserves, taxReserve: next.taxReserve }, null);
  revalidatePath("/admin/finance/settings");
  revalidatePath("/admin/finance/money-run");
}

// ---------------------------------------------------------------------------
// Manual runs (S143, S155)
// ---------------------------------------------------------------------------

export async function syncNow(): Promise<void> {
  const user = await requireFinanceUser();
  const result = await runQboSync("manual");
  await audit(user.id, "qbo_sync_manual", "qbo_sync_run", result.status, null, result.counts, null);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/health");
}

export async function runDailyNow(): Promise<void> {
  const user = await requireFinanceUser();
  const summary = await runFinanceDaily("manual");
  await audit(user.id, "finance_daily_manual", "finance_job", summary.status, null, summary.steps, null);
  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/money-run");
  revalidatePath("/admin/finance/health");
}

export async function saveMoneyRunNow(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const kind = String(formData.get("kind") ?? "adhoc") as "preliminary" | "final" | "adhoc";
  const settings = await loadFinanceSettings();
  const run = await buildMoneyRun(settings);
  await persistMoneyRun(run, kind, user.id);
  await audit(user.id, "money_run_persist", "money_run", `${kind}:${run.coversDate}`,
    null, { safeCash: run.safeCash.safeCashAvailable, required: run.required.total }, null);
  revalidatePath("/admin/finance/money-run");
}

// ---------------------------------------------------------------------------
// Writing to QuickBooks (owner decision 2026-08-23)
//
// Administrators only: creating records in the company's books is a higher bar
// than reading them, and it is the action that can duplicate money if misused.
// The write layer's intent ledger makes a repeat click harmless, so these
// deliberately do not add their own guard rail on top of it.
// ---------------------------------------------------------------------------

async function requireAdministrator(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== "administrator") {
    throw new Error("Writing to QuickBooks requires an administrator session.");
  }
  return user;
}

export async function createVendorInQuickBooks(formData: FormData): Promise<void> {
  const user = await requireAdministrator();
  const vendorId = Number(formData.get("vendorId"));
  if (!Number.isFinite(vendorId)) throw new Error("A vendor is required.");

  const { ensureVendorInQbo } = await import("../../lib/finance/qbo/operations.ts");
  const result = await ensureVendorInQbo(vendorId, { requestedBy: user.id });

  await audit(
    user.id,
    result.created ? "qbo_vendor_created" : "qbo_vendor_linked",
    "vendor",
    String(vendorId),
    null,
    { qboId: result.qboId },
    null,
  );
  revalidatePath("/admin/finance/vendors");
}

export async function createProjectInQuickBooks(formData: FormData): Promise<void> {
  const user = await requireAdministrator();
  const projectId = Number(formData.get("projectId"));
  const parentCustomerQboId = String(formData.get("parentCustomerQboId") ?? "").trim();
  if (!Number.isFinite(projectId)) throw new Error("A project is required.");
  if (!parentCustomerQboId) {
    throw new Error("Choose the client this project belongs to; QuickBooks projects are sub-customers.");
  }

  const { ensureProjectInQbo } = await import("../../lib/finance/qbo/operations.ts");
  const result = await ensureProjectInQbo(projectId, {
    parentCustomerQboId,
    requestedBy: user.id,
  });

  await audit(
    user.id,
    result.created ? "qbo_project_created" : "qbo_project_linked",
    "project",
    String(projectId),
    null,
    { qboId: result.qboId, parentCustomerQboId },
    null,
  );
  revalidatePath("/admin/finance/projects");
}
