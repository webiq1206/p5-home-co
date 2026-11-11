/**
 * QuickBooks for the scope platform. Server only.
 *
 * Built on the existing finance integration: the same OAuth connection
 * (app/lib/finance/qbo/oauth.ts), the same retrying client, and the same
 * idempotent write ledger (qbo_write_intent), so a double tap, a retry after
 * a timeout or two employees pressing Create at once still produce one
 * customer and one estimate. Webhooks already mirror every Estimate change
 * into qbo_txn; the platform reads status from there and refreshes on demand.
 */

import { query, queryOne } from "../db.ts";
import { qboQueryAll, qboRequest } from "../finance/qbo/client.ts";
import { customerPayload } from "../finance/qbo/map.ts";
import { isQboConfigured, isQboConnected } from "../finance/qbo/oauth.ts";
import { upsertCustomer, type QboRow } from "../finance/qbo/sync.ts";
import { qboWrite } from "../finance/qbo/write.ts";
import { DIVISIONS } from "./divisions.ts";
import { buildEstimatePayload, compareEstimate, estimateStatus, type EstimatePayload } from "./estimate.ts";
import type { ItemKey, PricingResult, ScopeDoc, ScopeSettings } from "./types.ts";
import {
  applyEstimateStatus,
  estimateStatusError,
  insertEstimate,
  latestEstimate,
  logEvent,
  markEstimateDeleted,
  mirroredEstimate,
  recordRevision,
  setProjectState,
  type EstimateRow,
  type ProjectRow,
  type VersionRow,
} from "./store.ts";

export const P5_ITEMS: ItemKey[] = [
  "Direct Labor",
  "Subcontractor Work",
  "Project Materials",
  "Equipment and Rentals",
  "Permits and Fees",
  "Freight and Delivery",
  "Other Direct Cost",
  "Design and Preconstruction Services",
  "Handyman Service Work",
  "Cabinet Product",
  "Cabinet Installation",
  "Cabinet Freight and Delivery",
];

export const isSandbox = () => process.env.QBO_ENV === "sandbox";

export type QboState = {
  configured: boolean;
  connected: boolean;
  lastSuccess: Date | null;
  lastAttempt: Date | null;
  error: string | null;
};

export async function qboState(): Promise<QboState> {
  const configured = isQboConfigured();
  const connected = configured ? await isQboConnected().catch(() => false) : false;
  const health = await queryOne<{ last_success_at: Date | null; last_attempt_at: Date | null; last_error: string | null }>(
    `SELECT max(last_success_at) AS last_success_at, max(last_attempt_at) AS last_attempt_at,
            string_agg(last_error, '; ') FILTER (WHERE last_error IS NOT NULL) AS last_error
       FROM integration_health WHERE name IN ('quickbooks','quickbooks-webhooks')`,
  ).catch(() => null);
  return {
    configured,
    connected,
    lastSuccess: health?.last_success_at ?? null,
    lastAttempt: health?.last_attempt_at ?? null,
    error: health?.last_error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Items and the setup check
// ---------------------------------------------------------------------------

export async function syncItems(): Promise<number> {
  const rows = await qboQueryAll<QboRow>("Item");
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_item (qbo_id, name, fully_qualified_name, item_type, active, taxable, parent_qbo_id, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
       ON CONFLICT (qbo_id) DO UPDATE SET name = EXCLUDED.name, fully_qualified_name = EXCLUDED.fully_qualified_name,
         item_type = EXCLUDED.item_type, active = EXCLUDED.active, taxable = EXCLUDED.taxable,
         parent_qbo_id = EXCLUDED.parent_qbo_id, raw = EXCLUDED.raw, synced_at = now()`,
      [
        r.Id,
        String(r.Name ?? ""),
        typeof r.FullyQualifiedName === "string" ? r.FullyQualifiedName : null,
        typeof r.Type === "string" ? r.Type : null,
        r.Active !== false,
        typeof r.Taxable === "boolean" ? r.Taxable : null,
        (r.ParentRef as { value?: string } | undefined)?.value ?? null,
        JSON.stringify(r),
      ],
    );
  }
  return rows.length;
}

async function itemsFresh(): Promise<boolean> {
  const row = await queryOne<{ n: string; newest: Date | null }>("SELECT count(*) AS n, max(synced_at) AS newest FROM qbo_item");
  return Boolean(row && Number(row.n) > 0 && row.newest && Date.now() - new Date(row.newest).getTime() < 3_600_000);
}

export async function resolveItems(settings: ScopeSettings): Promise<{ ids: Partial<Record<ItemKey, string>>; missing: ItemKey[] }> {
  const rows = await query<{ qbo_id: string; name: string; active: boolean }>("SELECT qbo_id, name, active FROM qbo_item WHERE active");
  const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.qbo_id]));
  const ids: Partial<Record<ItemKey, string>> = {};
  const missing: ItemKey[] = [];
  for (const item of P5_ITEMS) {
    const id = settings.itemOverrides[item] || byName.get(item.toLowerCase());
    if (id) ids[item] = id;
    else missing.push(item);
  }
  return { ids, missing };
}

export type SetupCheck = {
  state: QboState;
  itemCount: number;
  items: { item: ItemKey; qboId: string | null }[];
  divisionLikeNames: string[];
  divisionComparison: { code: string; name: string; inQuickBooks: string | null }[];
  checkedAt: string;
  error: string | null;
};

/**
 * What the connected QuickBooks company actually contains, compared with what
 * the platform needs. Run by an administrator from Pricing setup.
 */
export async function setupCheck(settings: ScopeSettings): Promise<SetupCheck> {
  const state = await qboState();
  let error: string | null = null;
  if (state.connected) {
    try {
      await syncItems();
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const { ids } = await resolveItems(settings);
  const itemCount = Number((await queryOne<{ n: string }>("SELECT count(*) AS n FROM qbo_item"))?.n ?? 0);
  // Divisions could live as numbered items, categories or classes. Collect any
  // name that starts with a two-digit code so the owner can see what exists.
  const names = await query<{ name: string }>(
    `SELECT name FROM (
       SELECT coalesce(fully_qualified_name, name) AS name FROM qbo_item
       UNION SELECT name FROM qbo_class
     ) n WHERE name ~ '^[0-9]{2}([^0-9]|$)' ORDER BY name`,
  ).catch(() => [] as { name: string }[]);
  const divisionLikeNames = names.map((n) => n.name);
  return {
    state,
    itemCount,
    items: P5_ITEMS.map((item) => ({ item, qboId: ids[item] ?? null })),
    divisionLikeNames,
    divisionComparison: DIVISIONS.map((d) => ({
      ...d,
      inQuickBooks: divisionLikeNames.find((n) => n.startsWith(d.code)) ?? null,
    })),
    checkedAt: new Date().toISOString(),
    error,
  };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export type CustomerCandidate = {
  qboId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  reasons: string[];
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

async function refreshCustomersIfStale(): Promise<void> {
  const row = await queryOne<{ newest: Date | null }>("SELECT max(synced_at) AS newest FROM qbo_customer");
  if (row?.newest && Date.now() - new Date(row.newest).getTime() < 15 * 60_000) return;
  const rows = await qboQueryAll<QboRow>("Customer");
  for (const r of rows) await upsertCustomer(r);
}

/** Existing QuickBooks customers that may be this client. Never auto-links. */
export async function findCustomerCandidates(p: ProjectRow): Promise<CustomerCandidate[]> {
  if (await isQboConnected().catch(() => false)) await refreshCustomersIfStale().catch(() => undefined);
  const name = [p.client_first_name, p.client_last_name].filter(Boolean).join(" ").trim();
  const rows = await query<{ qbo_id: string; display_name: string; raw: Record<string, unknown> }>(
    `SELECT qbo_id, display_name, raw FROM qbo_customer
      WHERE active AND NOT is_project AND parent_qbo_id IS NULL
        AND (
          ($1 <> '' AND lower(raw->'PrimaryEmailAddr'->>'Address') = lower($1))
          OR ($2 <> '' AND right(regexp_replace(coalesce(raw->'PrimaryPhone'->>'FreeFormNumber',''), '[^0-9]', '', 'g'), 10) = $2)
          OR ($3 <> '' AND lower(display_name) = lower($3))
          OR ($4 <> '' AND lower(raw->>'FamilyName') = lower($4) AND lower(raw->>'GivenName') = lower($5))
          OR ($6 <> '' AND lower(raw->'BillAddr'->>'Line1') = lower($6))
        )
      LIMIT 10`,
    [p.client_email ?? "", digits(p.client_phone), name, p.client_last_name ?? "", p.client_first_name ?? "", (p.project_address ?? "").split(",")[0].trim()],
  ).catch(() => []);
  return rows.map((r) => {
    const raw = r.raw as { PrimaryEmailAddr?: { Address?: string }; PrimaryPhone?: { FreeFormNumber?: string }; BillAddr?: { Line1?: string; City?: string } };
    const email = raw.PrimaryEmailAddr?.Address ?? null;
    const phone = raw.PrimaryPhone?.FreeFormNumber ?? null;
    const reasons: string[] = [];
    if (email && p.client_email && email.toLowerCase() === p.client_email.toLowerCase()) reasons.push("same email");
    if (phone && digits(phone) === digits(p.client_phone) && digits(phone)) reasons.push("same phone");
    if (r.display_name.toLowerCase() === name.toLowerCase()) reasons.push("same name");
    if (raw.BillAddr?.Line1 && p.project_address?.toLowerCase().startsWith(raw.BillAddr.Line1.toLowerCase())) reasons.push("same address");
    return {
      qboId: r.qbo_id,
      displayName: r.display_name,
      email,
      phone,
      address: [raw.BillAddr?.Line1, raw.BillAddr?.City].filter(Boolean).join(", ") || null,
      reasons: reasons.length ? reasons : ["similar name"],
    };
  });
}

/**
 * QuickBooks requires a display name to be unique across customers, vendors
 * and employees, and only QuickBooks knows all three. On its duplicate-name
 * error (6240) the write is retried once with a distinguishing suffix.
 */
async function writeNamed(naturalKey: string, payload: Record<string, unknown>, suffix: string, userId: number) {
  try {
    return await qboWrite({ entity: "Customer", naturalKey, payload, requestedBy: userId });
  } catch (error) {
    if (!/Duplicate Name|6240/i.test((error as Error).message)) throw error;
    return qboWrite({ entity: "Customer", naturalKey, payload: { ...payload, DisplayName: `${String(payload.DisplayName).slice(0, 80)} (${suffix})` }, requestedBy: userId });
  }
}

/** Link an existing customer, or create one. Idempotent per project. */
export async function ensureCustomer(
  p: ProjectRow,
  choice: { qboId: string } | { create: true },
  userId: number,
): Promise<{ qboId: string; name: string }> {
  if ("qboId" in choice) {
    const row = await queryOne<{ display_name: string }>("SELECT display_name FROM qbo_customer WHERE qbo_id = $1", [choice.qboId]);
    if (!row) throw new Error("That QuickBooks customer was not found. Refresh and try again.");
    await setProjectState(p.id, { qbo_customer_id: choice.qboId, qbo_customer_name: row.display_name });
    await logEvent(p.id, "qbo-customer-linked", { qboId: choice.qboId }, userId);
    return { qboId: choice.qboId, name: row.display_name };
  }
  const base = [p.client_first_name, p.client_last_name].filter(Boolean).join(" ").trim();
  if (!base) throw new Error("Enter the client's first and last name first.");
  // QuickBooks display names must be unique across customers, vendors and employees.
  const taken = await queryOne("SELECT 1 FROM qbo_customer WHERE lower(display_name) = lower($1)", [base]);
  const street = (p.project_address ?? "").split(",")[0].trim();
  const displayName = taken ? `${base} (${street || `P5 scope ${p.id}`})` : base;
  const payload = {
    ...customerPayload({
      displayName,
      email: p.client_email,
      phone: p.client_phone,
      billingAddress: { line1: p.billing_address || p.project_address },
    }),
    GivenName: p.client_first_name ?? undefined,
    FamilyName: p.client_last_name ?? undefined,
    ...(p.project_address ? { ShipAddr: { Line1: p.project_address } } : {}),
  };
  const result = await writeNamed(`scope-platform-customer:${p.id}`, payload, street || `P5 ${p.id}`, userId);
  const name = String(result.raw.DisplayName ?? displayName);
  await setProjectState(p.id, { qbo_customer_id: result.qboId, qbo_customer_name: name });
  await logEvent(p.id, "qbo-customer-created", { qboId: result.qboId, reused: result.reused }, userId);
  return { qboId: result.qboId, name };
}

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export function privateNote(p: ProjectRow, v: VersionRow): string {
  return `Created by the P5 scope platform. Project ${p.id}, scope version ${v.version_no}. Internal costs and margins are kept in the platform, not on this estimate.`;
}

export async function buildPayloadFor(
  p: ProjectRow,
  v: VersionRow,
  pricing: PricingResult,
  doc: ScopeDoc,
  settings: ScopeSettings,
): Promise<{ payload: EstimatePayload | null; missingItems: ItemKey[] }> {
  if (!(await itemsFresh())) await syncItems().catch(() => undefined);
  const { ids, missing } = await resolveItems(settings);
  const needed = [...new Set(pricing.lines.filter((l) => !l.optional).map((l) => l.item))];
  const missingItems = needed.filter((i) => missing.includes(i));
  if (missingItems.length || !p.qbo_customer_id) return { payload: null, missingItems };
  return {
    payload: buildEstimatePayload({
      // Under the QuickBooks project when one is already linked, so project
      // reporting includes it; otherwise under the customer.
      customerId: p.qbo_project_id ?? p.qbo_customer_id,
      pricing,
      itemIds: ids as Record<ItemKey, string>,
      taxable: settings.taxableItems,
      email: p.client_email,
      billingAddress: p.billing_address,
      projectAddress: p.project_address,
      exclusions: doc.exclusions,
      privateNote: privateNote(p, v),
    }),
    missingItems,
  };
}

/**
 * Create the project's estimate, or revise it to the current scope version.
 * One QuickBooks estimate per project; the create is keyed by project, so no
 * number of taps or retries can make a second one.
 */
export async function createOrReviseEstimate(input: {
  project: ProjectRow;
  version: VersionRow;
  payload: EstimatePayload;
  userId: number;
  overwriteQuickBooksChanges?: boolean;
}): Promise<{ estimateId: number; qboId: string; revised: boolean; reused: boolean }> {
  const { project: p, version: v } = input;
  const existing = await latestEstimate(p.id);
  const replaced = existing?.txn_status === "Deleted";
  if (!existing || !existing.qbo_estimate_id || replaced) {
    // One estimate per project. Only when QuickBooks confirms the earlier one
    // was deleted does a new key (and so a new estimate) become possible.
    const generation = replaced ? `:after-${existing!.qbo_estimate_id}` : "";
    const result = await qboWrite({ entity: "Estimate", naturalKey: `scope-platform-estimate:${p.id}${generation}`, payload: input.payload, requestedBy: input.userId });
    const estimateId = await insertEstimate({ projectId: p.id, versionId: v.id, qboId: result.qboId, payload: input.payload, userId: input.userId });
    await applyEstimateStatus(estimateId, { raw: result.raw, source: "create", drift: compareEstimate(input.payload, result.raw as { Line?: unknown; TotalAmt?: number }) });
    await logEvent(p.id, "qbo-estimate-created", { qboId: result.qboId, version: v.version_no, reused: result.reused }, input.userId);
    return { estimateId, qboId: result.qboId, revised: false, reused: result.reused };
  }

  // Revision: read QuickBooks first so a change made there is never overwritten silently.
  const live = await fetchEstimate(existing.qbo_estimate_id).catch(async (error: Error) => {
    if (isGone(error)) await markEstimateDeleted(existing.id);
    throw isGone(error) ? new Error("This estimate was deleted in QuickBooks. Refresh, then create a new one.") : error;
  });
  const status = estimateStatus(live as never, true);
  if (status === "accepted" || status === "converted" || status === "closed" || status === "declined") {
    throw new Error("This estimate is no longer open in QuickBooks. Record further changes as a change order or a new estimate in QuickBooks.");
  }
  const drift = compareEstimate(existing.sent_payload as { Line: unknown }, live);
  if (drift.changed && !input.overwriteQuickBooksChanges) {
    await applyEstimateStatus(existing.id, { raw: live, source: "pre-revision", drift });
    throw new Error("The estimate was changed in QuickBooks since it was sent. Review the differences, then confirm to replace them.");
  }
  if (existing.version_id === v.id && !drift.changed) {
    // Same scope version, nothing changed in QuickBooks: a repeat tap, not a revision.
    await applyEstimateStatus(existing.id, { raw: live, source: "refresh", drift });
    return { estimateId: existing.id, qboId: existing.qbo_estimate_id, revised: false, reused: true };
  }
  // Sparse update: the lines given replace all lines, and every field not sent
  // (estimate number, dates, terms, anything set in QuickBooks) is left alone.
  // The customer and the sent / not sent flag stay whatever QuickBooks has.
  const { EmailStatus: _email, CustomerRef: _customer, ...changes } = input.payload;
  void _email;
  const payload = {
    ...changes,
    CustomerRef: (live.CustomerRef as { value: string } | undefined) ?? _customer,
    Id: existing.qbo_estimate_id,
    SyncToken: String(live.SyncToken ?? ""),
    sparse: true as const,
  };
  const result = await qboWrite({
    entity: "Estimate",
    operation: "update",
    naturalKey: `scope-platform-estimate:${p.id}:revision:${v.id}:${String(live.SyncToken ?? "")}`,
    payload,
    requestedBy: input.userId,
  });
  await recordRevision(existing.id, v.id, input.payload);
  await applyEstimateStatus(existing.id, { raw: result.raw, source: "revision", drift: compareEstimate(input.payload, result.raw as { Line?: unknown; TotalAmt?: number }) });
  await logEvent(p.id, "qbo-estimate-revised", { qboId: existing.qbo_estimate_id, version: v.version_no }, input.userId);
  return { estimateId: existing.id, qboId: existing.qbo_estimate_id, revised: true, reused: result.reused };
}

async function fetchEstimate(qboId: string): Promise<Record<string, unknown> & { SyncToken?: string; Line?: unknown; TotalAmt?: number }> {
  const res = await qboRequest<{ Estimate?: Record<string, unknown> }>(`/estimate/${encodeURIComponent(qboId)}`);
  if (!res.Estimate) throw new Error("QuickBooks returned no estimate.");
  return res.Estimate as Record<string, unknown> & { SyncToken?: string };
}

/** QuickBooks answers a deleted or never-existing object with error 610, "Object Not Found". */
function isGone(error: Error): boolean {
  return /QBO 400/.test(error.message) && /Object Not Found|"code":"610"/i.test(error.message);
}

/** Live refresh from QuickBooks. Failure is recorded and shown, never hidden. */
export async function refreshEstimate(e: EstimateRow): Promise<void> {
  if (!e.qbo_estimate_id || e.txn_status === "Deleted") return;
  try {
    const raw = await fetchEstimate(e.qbo_estimate_id);
    await applyEstimateStatus(e.id, { raw, source: "refresh", drift: compareEstimate(e.sent_payload as { Line: unknown }, raw) });
  } catch (error) {
    if (isGone(error as Error)) {
      await markEstimateDeleted(e.id);
      return;
    }
    await estimateStatusError(e.id, (error as Error).message);
    throw error;
  }
}

/**
 * Fold in what the webhook already delivered. Cheap (no QuickBooks call), so
 * it runs on every page view; this is how changes made in QuickBooks show up
 * without anyone pressing refresh.
 */
export async function applyMirroredStatus(e: EstimateRow): Promise<boolean> {
  if (!e.qbo_estimate_id || e.txn_status === "Deleted") return false;
  const mirror = await mirroredEstimate(e.qbo_estimate_id).catch(() => null);
  if (!mirror) return false;
  const token = String((mirror.raw as { SyncToken?: string }).SyncToken ?? "");
  if (token && token === e.sync_token) return false;
  if (e.last_synced_at && new Date(mirror.synced_at) <= new Date(e.last_synced_at)) return false;
  await applyEstimateStatus(e.id, { raw: mirror.raw, source: "webhook", drift: compareEstimate(e.sent_payload as { Line: unknown }, mirror.raw) });
  return true;
}

// ---------------------------------------------------------------------------
// QuickBooks projects
// ---------------------------------------------------------------------------

export async function customerProjects(customerId: string, refresh: boolean): Promise<{ qboId: string; name: string; isProject: boolean }[]> {
  if (refresh) {
    const rows = await qboQueryAll<QboRow>("Customer");
    for (const r of rows) await upsertCustomer(r);
  }
  const rows = await query<{ qbo_id: string; display_name: string; is_project: boolean }>(
    "SELECT qbo_id, display_name, is_project FROM qbo_customer WHERE parent_qbo_id = $1 AND active ORDER BY display_name",
    [customerId],
  );
  return rows.map((r) => ({ qboId: r.qbo_id, name: r.display_name, isProject: r.is_project }));
}

export async function linkProject(p: ProjectRow, qboId: string, userId: number): Promise<void> {
  const row = await queryOne<{ display_name: string; parent_qbo_id: string | null }>(
    "SELECT display_name, parent_qbo_id FROM qbo_customer WHERE qbo_id = $1",
    [qboId],
  );
  if (!row || row.parent_qbo_id !== p.qbo_customer_id) throw new Error("That QuickBooks project does not belong to this customer.");
  await setProjectState(p.id, { qbo_project_id: qboId, qbo_project_name: row.display_name, qbo_project_linked_by: userId });
  await logEvent(p.id, "qbo-project-linked", { qboId }, userId);
}

/**
 * Ask QuickBooks to create the project. The accounting API models a project as
 * a sub-customer; whether QuickBooks treats it as a Project is read back from
 * its IsProject flag and reported truthfully.
 */
export async function createProjectInQbo(p: ProjectRow, userId: number): Promise<{ qboId: string; isProject: boolean }> {
  if (!p.qbo_customer_id) throw new Error("Link the QuickBooks customer first.");
  const name = (p.title || p.project_address || `Project ${p.id}`).slice(0, 90);
  const result = await writeNamed(
    `scope-platform-project:${p.id}`,
    customerPayload({ displayName: name, parentQboId: p.qbo_customer_id, isProject: true, billingAddress: { line1: p.project_address } }),
    p.client_last_name || `P5 ${p.id}`,
    userId,
  );
  const isProject = result.raw.IsProject === true;
  await setProjectState(p.id, { qbo_project_id: result.qboId, qbo_project_name: String(result.raw.DisplayName ?? name), qbo_project_linked_by: userId });
  await logEvent(p.id, "qbo-project-created", { qboId: result.qboId, isProject }, userId);
  return { qboId: result.qboId, isProject };
}

export async function projectIsProject(qboId: string | null): Promise<boolean | null> {
  if (!qboId) return null;
  const row = await queryOne<{ is_project: boolean }>("SELECT is_project FROM qbo_customer WHERE qbo_id = $1", [qboId]);
  return row ? row.is_project : null;
}
