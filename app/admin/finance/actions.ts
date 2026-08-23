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

// ---------------------------------------------------------------------------
// Subcontracts, assets and debt (S91-S98, S131-S138)
// ---------------------------------------------------------------------------

export async function addSubcontract(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const projectId = Number(formData.get("projectId"));
  const vendorId = Number(formData.get("vendorId"));
  const reference = String(formData.get("reference") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim();
  const amount = Number(formData.get("originalAmount") ?? 0);
  const retainage = Number(formData.get("retainagePct") ?? 0);

  if (!Number.isFinite(projectId) || !Number.isFinite(vendorId)) {
    throw new Error("A project and a vendor are both required.");
  }
  if (!reference || !scope) {
    throw new Error("A reference and a scope are required; a subcontract without scope cannot be checked against an invoice.");
  }

  await query(
    `INSERT INTO subcontract (project_id, vendor_id, reference, scope, original_amount, retainage_pct)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [projectId, vendorId, reference, scope, amount, retainage],
  );
  await audit(user.id, "subcontract_create", "subcontract", `${projectId}:${reference}`,
    null, { vendorId, amount, retainage }, null);
  revalidatePath("/admin/finance/subcontracts");
}

export async function addFixedAsset(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "other");
  const cost = Number(formData.get("cost") ?? 0);
  const acquiredOn = String(formData.get("acquiredOn") ?? "") || null;
  const plate = String(formData.get("plate") ?? "").trim() || null;
  const registrationExpires = String(formData.get("registrationExpires") ?? "") || null;

  if (!name) throw new Error("An asset name is required.");

  await query(
    `INSERT INTO fixed_asset (name, category, cost, acquired_on, plate, registration_expires)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [name, category, cost, acquiredOn, plate, registrationExpires],
  );
  await audit(user.id, "asset_create", "fixed_asset", name, null, { category, cost }, null);
  revalidatePath("/admin/finance/assets");
}

export async function addDebtInstrument(formData: FormData): Promise<void> {
  const user = await requireFinanceUser();
  const lender = String(formData.get("lender") ?? "").trim();
  const kind = String(formData.get("kind") ?? "loan");
  const currentBalance = Number(formData.get("currentBalance") ?? 0);
  const scheduledPayment = Number(formData.get("scheduledPayment") ?? 0) || null;
  const nextPaymentOn = String(formData.get("nextPaymentOn") ?? "") || null;
  const interestRate = Number(formData.get("interestRate") ?? 0) || null;

  if (!lender) throw new Error("A lender is required.");

  await query(
    `INSERT INTO debt_instrument
       (lender, kind, current_balance, scheduled_payment, next_payment_on, interest_rate)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [lender, kind, currentBalance, scheduledPayment, nextPaymentOn, interestRate],
  );
  await audit(user.id, "debt_create", "debt_instrument", lender,
    null, { kind, currentBalance }, null);
  revalidatePath("/admin/finance/assets");
}

// ---------------------------------------------------------------------------
// Owners (S193)
//
// Ownership is effective-dated rather than edited in place. Changing a split
// closes the current row and opens a new one, so last quarter's distribution
// can still be explained by the percentages that were in force at the time.
// Overwriting would silently rewrite history that money was moved on.
// ---------------------------------------------------------------------------

export async function addOwner(formData: FormData): Promise<void> {
  const user = await requireAdministrator();
  const label = String(formData.get("label") ?? "").trim();
  const ownership = Number(formData.get("ownershipPct") ?? 0);
  const distribution = Number(formData.get("distributionPct") ?? 0);
  const voting = Number(formData.get("votingPct") ?? 0);
  const weekly = Number(formData.get("weeklyCompensation") ?? 0);

  if (!label) throw new Error("An owner name is required.");
  for (const [name, value] of [
    ["Ownership", ownership],
    ["Distribution", distribution],
    ["Voting", voting],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${name} must be between 0 and 100.`);
    }
  }

  await query(
    `INSERT INTO owner_record
       (label, ownership_pct, distribution_pct, voting_pct, weekly_compensation)
     VALUES ($1,$2,$3,$4,$5)`,
    [label, ownership, distribution, voting, weekly],
  );
  await audit(user.id, "owner_create", "owner_record", label, null,
    { ownership, distribution, voting, weekly }, null);
  revalidatePath("/admin/finance/owners");
}

export async function reviseOwner(formData: FormData): Promise<void> {
  const user = await requireAdministrator();
  const ownerId = Number(formData.get("ownerId"));
  const ownership = Number(formData.get("ownershipPct") ?? 0);
  const distribution = Number(formData.get("distributionPct") ?? 0);
  const voting = Number(formData.get("votingPct") ?? 0);
  const weekly = Number(formData.get("weeklyCompensation") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isFinite(ownerId)) throw new Error("An owner is required.");
  if (!reason) {
    throw new Error("A reason is required: an ownership change is a legal event, not a typo fix.");
  }

  const current = await queryOne<{
    label: string; ownership_pct: string; distribution_pct: string;
    voting_pct: string; weekly_compensation: string;
  }>(
    `SELECT label, ownership_pct, distribution_pct, voting_pct, weekly_compensation
       FROM owner_record WHERE id = $1 AND effective_to IS NULL`,
    [ownerId],
  );
  if (!current) throw new Error("That owner record is not the current one.");

  // Close the old row today and open the new one, so history stays intact.
  await query(
    `UPDATE owner_record SET effective_to = CURRENT_DATE WHERE id = $1`,
    [ownerId],
  );
  await query(
    `INSERT INTO owner_record
       (label, ownership_pct, distribution_pct, voting_pct, weekly_compensation, effective_from)
     VALUES ($1,$2,$3,$4,$5, CURRENT_DATE)`,
    [current.label, ownership, distribution, voting, weekly],
  );

  await audit(
    user.id,
    "owner_revise",
    "owner_record",
    current.label,
    {
      ownership: Number(current.ownership_pct),
      distribution: Number(current.distribution_pct),
      voting: Number(current.voting_pct),
      weekly: Number(current.weekly_compensation),
    },
    { ownership, distribution, voting, weekly },
    reason,
  );
  revalidatePath("/admin/finance/owners");
}
