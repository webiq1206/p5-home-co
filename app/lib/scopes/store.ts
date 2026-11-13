/**
 * Database access for the scope platform. Server only.
 *
 * Nothing here deletes: versions, answers, assets, estimates and QuickBooks
 * snapshots accumulate, and archive is a timestamp.
 */

import { query, queryOne, transaction } from "../db.ts";
import type { PricingResult, ScopeDoc, ScopeSettings, ScopeStatusName } from "./types.ts";
import { DEFAULT_SCOPE_SETTINGS } from "./types.ts";
import type { Proposal } from "./merge.ts";
import { projectTitle } from "./naming.ts";

/** A public property record for the project address. Every value is unverified until someone confirms it. */
export type PropertyRecord = {
  source: string;
  /** Finished floor area: ground, upper, and finished lower, basement and attic. */
  livingSqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  yearBuilt?: number | null;
  yearRemodeled?: number | null;
  propertyType?: string | null;
  design?: string | null;
  quality?: string | null;
  condition?: string | null;
  foundation?: string | null;
  framing?: string | null;
  exterior?: string | null;
  roof?: string | null;
  rooms?: number | null;
  carportSqft?: number | null;
  utilities?: string | null;
  groundFloorSqft?: number | null;
  upperFloorSqft?: number | null;
  lowerFinishedSqft?: number | null;
  lowerUnfinishedSqft?: number | null;
  basementFinishedSqft?: number | null;
  basementUnfinishedSqft?: number | null;
  atticFinishedSqft?: number | null;
  atticUnfinishedSqft?: number | null;
  garageSqft?: number | null;
  porchSqft?: number | null;
  deckSqft?: number | null;
  deckCovered?: boolean | null;
  patioSqft?: number | null;
  patioCovered?: boolean | null;
  poolSqft?: number | null;
  outbuildingSqft?: number | null;
  fireplaces?: number | null;
  heating?: string | null;
  cooling?: string | null;
  lotSqft?: number | null;
  zoning?: string | null;
  subdivision?: string | null;
  parcel?: string | null;
  /** Set when the parcel has more than one building; the figures are for the largest. */
  buildings?: number | null;
  lookedUpAt: string;
};

export type ProjectRow = {
  id: number;
  title: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  project_address: string | null;
  billing_address: string | null;
  service: string;
  finish_tier: string;
  scope_status: ScopeStatusName;
  current_version_id: number | null;
  pending_proposal: Proposal | null;
  processing_state: string;
  processing_note: string | null;
  processing_started_at: Date | null;
  qbo_customer_id: string | null;
  qbo_customer_name: string | null;
  qbo_project_id: string | null;
  qbo_project_name: string | null;
  qbo_project_linked_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  /** The public record found for the address, or null when none was found. */
  property: PropertyRecord | null;
  /** The address the property record was looked up for, so it is looked up once per address. */
  property_checked_for: string | null;
  hubspot_contact_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AssetRow = {
  id: number;
  project_id: number;
  client_key: string;
  kind: "recording" | "note" | "document" | "photo" | "quote" | "text";
  label: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  recording_id: string | null;
  segment_index: number | null;
  offset_seconds: number;
  duration_seconds: number | null;
  body_text: string | null;
  transcript: { segments: { start: number; end: number; text: string }[]; text: string; approximate?: boolean } | null;
  state: "stored" | "transcribing" | "ready" | "failed";
  error: string | null;
  used_in_version: number | null;
  created_at: Date;
};

export type VersionRow = {
  id: number;
  project_id: number;
  version_no: number;
  source: string;
  note: string | null;
  doc: ScopeDoc;
  pricing: PricingResult | null;
  created_by: number | null;
  created_at: Date;
};

export type EstimateRow = {
  id: number;
  project_id: number;
  version_id: number;
  qbo_estimate_id: string | null;
  doc_number: string | null;
  sync_token: string | null;
  txn_status: string | null;
  email_status: string | null;
  accepted_by: string | null;
  accepted_date: string | null;
  linked_invoice: string | null;
  total: string | null;
  sent_payload: Record<string, unknown>;
  qbo_snapshot: Record<string, unknown> | null;
  drift: { changed: boolean; details: string[]; sentTotal: number; currentTotal: number } | null;
  status_error: string | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const PROJECT_COLS = `id::int, title, client_first_name, client_last_name, client_email, client_phone,
  project_address, billing_address, service, finish_tier, scope_status, current_version_id::int,
  pending_proposal, processing_state, processing_note, processing_started_at, qbo_customer_id,
  qbo_customer_name, qbo_project_id, qbo_project_name, qbo_project_linked_at, archived_at, deleted_at, property, property_checked_for, hubspot_contact_id, created_at, updated_at`;

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

export async function loadScopeSettings(): Promise<ScopeSettings> {
  const row = await queryOne<{ value: Partial<ScopeSettings> }>("SELECT value FROM scope_settings WHERE id = 1");
  return { ...DEFAULT_SCOPE_SETTINGS, ...(row?.value ?? {}) };
}

export async function saveScopeSettings(value: ScopeSettings, userId: number): Promise<void> {
  await query(
    `INSERT INTO scope_settings (id, value, updated_by) VALUES (1, $1::jsonb, $2)
     ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(value), userId],
  );
}

// --------------------------------------------------------------------------
// Projects
// --------------------------------------------------------------------------

export type ListFilter = {
  q?: string;
  scope?: ScopeStatusName | "";
  estimate?: string;
  archived?: boolean;
  sort?: "updated" | "client" | "created";
};

export type ListRow = ProjectRow & {
  estimate_qbo_id: string | null;
  estimate_raw: Record<string, unknown> | null;
  estimate_error: string | null;
  estimate_total: string | null;
  estimate_invoices: { count: number; total: number; balance: number } | null;
};

export async function listProjects(f: ListFilter): Promise<ListRow[]> {
  const where: string[] = ["p.deleted_at IS NULL", f.archived ? "p.archived_at IS NOT NULL" : "p.archived_at IS NULL"];
  const params: unknown[] = [];
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().replace(/[%_]/g, "")}%`);
    const i = params.length;
    where.push(`(p.title ILIKE $${i} OR p.project_address ILIKE $${i} OR p.client_email ILIKE $${i}
      OR concat_ws(' ', p.client_first_name, p.client_last_name) ILIKE $${i} OR p.qbo_customer_name ILIKE $${i})`);
  }
  if (f.scope) {
    params.push(f.scope);
    where.push(`p.scope_status = $${params.length}`);
  }
  const order =
    f.sort === "client"
      ? "lower(coalesce(p.client_last_name, p.client_first_name, p.title)), p.updated_at DESC"
      : f.sort === "created"
        ? "p.created_at DESC"
        : "p.updated_at DESC";
  return query<ListRow>(
    `SELECT ${PROJECT_COLS.replace(/(^|,\s*)([a-z_]+)/g, "$1p.$2")},
            e.qbo_estimate_id AS estimate_qbo_id,
            CASE WHEN e.txn_status IS DISTINCT FROM 'Deleted' AND t.synced_at IS NOT NULL
                      AND (e.last_synced_at IS NULL OR t.synced_at > e.last_synced_at)
                 THEN t.raw ELSE e.qbo_snapshot END AS estimate_raw,
            e.status_error AS estimate_error,
            e.total::text AS estimate_total,
            (SELECT json_build_object('count', count(*)::int, 'total', coalesce(sum(i.total), 0)::float8, 'balance', coalesce(sum(i.balance), 0)::float8)
               FROM qbo_txn i
              WHERE i.txn_type = 'Invoice'
                AND i.qbo_id IN (SELECT x->>'TxnId' FROM jsonb_array_elements(
                      CASE WHEN jsonb_typeof(e.qbo_snapshot->'LinkedTxn') = 'array' THEN e.qbo_snapshot->'LinkedTxn' ELSE '[]'::jsonb END) x
                     WHERE x->>'TxnType' = 'Invoice')) AS estimate_invoices
       FROM scope_project p
       LEFT JOIN LATERAL (
         SELECT * FROM scope_estimate se WHERE se.project_id = p.id ORDER BY se.created_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN qbo_txn t ON t.txn_type = 'Estimate' AND t.qbo_id = e.qbo_estimate_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${order}
      LIMIT 500`,
    params,
  );
}

export async function createProject(userId: number, fields: Partial<ProjectRow>): Promise<number> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO scope_project (title, client_first_name, client_last_name, project_address, service, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      fields.title ?? "",
      fields.client_first_name ?? null,
      fields.client_last_name ?? null,
      fields.project_address ?? null,
      fields.service ?? "remodel",
      userId,
    ],
  );
  const id = Number(row!.id);
  await syncProjectTitle(id);
  await logEvent(id, "created", null, userId);
  return id;
}

/** A deleted project is gone for every screen; pass includeDeleted only to finish cleaning one up. */
export async function getProject(id: number, includeDeleted = false): Promise<ProjectRow | null> {
  return queryOne<ProjectRow>(`SELECT ${PROJECT_COLS} FROM scope_project WHERE id = $1${includeDeleted ? "" : " AND deleted_at IS NULL"}`, [id]);
}

export async function markProjectDeleted(id: number, userId: number | null, note: string): Promise<void> {
  await query("UPDATE scope_project SET deleted_at = now(), deleted_by = $2, delete_note = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL", [id, userId, note.slice(0, 500)]);
}

export async function setProjectProperty(id: number, property: PropertyRecord | null, checkedFor: string): Promise<void> {
  await query("UPDATE scope_project SET property = $2::jsonb, property_checked_for = $3, updated_at = now() WHERE id = $1", [id, property === null ? null : JSON.stringify(property), checkedFor]);
}

export async function setHubSpotContact(id: number, contactId: string | null): Promise<void> {
  await query("UPDATE scope_project SET hubspot_contact_id = $2 WHERE id = $1", [id, contactId]);
}

// --------------------------------------------------------------------------
// Files sent to QuickBooks and HubSpot
// --------------------------------------------------------------------------

export type SyncTarget = "quickbooks" | "hubspot";
export type AssetSyncRow = { asset_id: number; target: SyncTarget; status: "pending" | "sent" | "failed" | "skipped" | "removed"; remote_id: string | null; parent_id: string | null; error: string | null; attempts: number };

export async function listAssetSync(projectId: number): Promise<AssetSyncRow[]> {
  return query<AssetSyncRow>(
    `SELECT s.asset_id::int, s.target, s.status, s.remote_id, s.parent_id, s.error, s.attempts
       FROM scope_asset_sync s JOIN scope_asset a ON a.id = s.asset_id WHERE a.project_id = $1`,
    [projectId],
  );
}

export async function saveAssetSync(assetId: number, target: SyncTarget, r: { status: AssetSyncRow["status"]; remoteId?: string | null; parentId?: string | null; error?: string | null }): Promise<void> {
  await query(
    `INSERT INTO scope_asset_sync (asset_id, target, status, remote_id, parent_id, error, attempts)
     VALUES ($1,$2,$3,$4,$5,$6,1)
     ON CONFLICT (asset_id, target) DO UPDATE SET status = EXCLUDED.status,
       remote_id = coalesce(EXCLUDED.remote_id, scope_asset_sync.remote_id),
       parent_id = coalesce(EXCLUDED.parent_id, scope_asset_sync.parent_id),
       error = EXCLUDED.error, attempts = scope_asset_sync.attempts + 1, updated_at = now()`,
    [assetId, target, r.status, r.remoteId ?? null, r.parentId ?? null, r.error ? r.error.slice(0, 400) : null],
  );
}

const EDITABLE = [
  "client_first_name",
  "client_last_name",
  "client_email",
  "client_phone",
  "project_address",
  "billing_address",
  "service",
  "finish_tier",
] as const;
export type EditableField = (typeof EDITABLE)[number];

export async function updateProjectFields(
  id: number,
  fields: Partial<Record<EditableField, string | null>>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const k of EDITABLE) {
    if (!(k in fields)) continue;
    params.push(fields[k] === "" ? null : fields[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return;
  await query(`UPDATE scope_project SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  await syncProjectTitle(id);
}

/**
 * Keep the stored project name equal to the derived one (last name, street,
 * type of project). Called after anything that can change those facts.
 */
export async function syncProjectTitle(id: number): Promise<void> {
  const p = await queryOne<{ title: string; client_last_name: string | null; project_address: string | null; service: string }>(
    "SELECT title, client_last_name, project_address, service FROM scope_project WHERE id = $1",
    [id],
  );
  if (!p) return;
  const title = projectTitle({ lastName: p.client_last_name, address: p.project_address, service: p.service });
  if (title !== p.title) await query("UPDATE scope_project SET title = $2 WHERE id = $1", [id, title]);
}

export async function setProjectState(
  id: number,
  state: Partial<{
    scope_status: ScopeStatusName;
    pending_proposal: Proposal | null;
    processing_state: string;
    processing_note: string | null;
    qbo_customer_id: string | null;
    qbo_customer_name: string | null;
    qbo_project_id: string | null;
    qbo_project_name: string | null;
    qbo_project_linked_by: number | null;
    archived: boolean;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown, cast = "") => {
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (state.scope_status) set("scope_status", state.scope_status);
  if ("pending_proposal" in state) set("pending_proposal", state.pending_proposal ? JSON.stringify(state.pending_proposal) : null, "::jsonb");
  if (state.processing_state) {
    set("processing_state", state.processing_state);
    sets.push(state.processing_state === "idle" ? "processing_started_at = NULL" : "processing_started_at = now()");
  }
  if ("processing_note" in state) set("processing_note", state.processing_note);
  if ("qbo_customer_id" in state) set("qbo_customer_id", state.qbo_customer_id);
  if ("qbo_customer_name" in state) set("qbo_customer_name", state.qbo_customer_name);
  if ("qbo_project_id" in state) {
    set("qbo_project_id", state.qbo_project_id);
    sets.push(state.qbo_project_id ? "qbo_project_linked_at = now()" : "qbo_project_linked_at = NULL");
  }
  if ("qbo_project_name" in state) set("qbo_project_name", state.qbo_project_name);
  if ("qbo_project_linked_by" in state) set("qbo_project_linked_by", state.qbo_project_linked_by);
  if ("archived" in state) sets.push(state.archived ? "archived_at = now()" : "archived_at = NULL");
  if (!sets.length) return;
  await query(`UPDATE scope_project SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
}

/**
 * Claim the processing lock. Returns false when another run is active. A run
 * older than 15 minutes is treated as abandoned (a dropped request) and taken over.
 */
export async function claimProcessing(id: number, note: string): Promise<boolean> {
  const rows = await query(
    `UPDATE scope_project
        SET processing_state = 'running', processing_note = $2, processing_started_at = now()
      WHERE id = $1 AND (processing_state <> 'running' OR processing_started_at < now() - interval '15 minutes')
      RETURNING id`,
    [id, note],
  );
  return rows.length > 0;
}

// --------------------------------------------------------------------------
// Assets
// --------------------------------------------------------------------------

const ASSET_COLS = `id::int, project_id::int, client_key, kind, label, file_name, mime_type, size_bytes::int,
  recording_id, segment_index, offset_seconds::float8 AS offset_seconds, duration_seconds::float8 AS duration_seconds,
  body_text, transcript, state, error, used_in_version::int, created_at`;

export async function insertAsset(a: {
  projectId: number;
  clientKey: string;
  kind: AssetRow["kind"];
  label: string;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  sha256?: string | null;
  bucket?: string | null;
  key?: string | null;
  data?: Buffer | null;
  recordingId?: string | null;
  segmentIndex?: number | null;
  offsetSeconds?: number;
  durationSeconds?: number | null;
  bodyText?: string | null;
  state?: AssetRow["state"];
  userId: number;
}): Promise<{ asset: AssetRow; duplicate: boolean }> {
  const inserted = await queryOne<AssetRow>(
    `INSERT INTO scope_asset (project_id, client_key, kind, label, file_name, mime_type, size_bytes, sha256,
        storage_bucket, storage_key, data, recording_id, segment_index, offset_seconds, duration_seconds,
        body_text, state, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (project_id, client_key) DO NOTHING
     RETURNING ${ASSET_COLS}`,
    [
      a.projectId,
      a.clientKey,
      a.kind,
      a.label,
      a.fileName ?? null,
      a.mimeType ?? null,
      a.size ?? null,
      a.sha256 ?? null,
      a.bucket ?? null,
      a.key ?? null,
      a.data ?? null,
      a.recordingId ?? null,
      a.segmentIndex ?? null,
      a.offsetSeconds ?? 0,
      a.durationSeconds ?? null,
      a.bodyText ?? null,
      a.state ?? "stored",
      a.userId,
    ],
  );
  if (inserted) {
    await query("UPDATE scope_project SET updated_at = now() WHERE id = $1", [a.projectId]);
    return { asset: inserted, duplicate: false };
  }
  const existing = await queryOne<AssetRow>(
    `SELECT ${ASSET_COLS} FROM scope_asset WHERE project_id = $1 AND client_key = $2`,
    [a.projectId, a.clientKey],
  );
  return { asset: existing!, duplicate: true };
}

export async function listAssets(projectId: number): Promise<AssetRow[]> {
  return query<AssetRow>(`SELECT ${ASSET_COLS} FROM scope_asset WHERE project_id = $1 ORDER BY created_at, id`, [projectId]);
}

export async function assetStorage(
  projectId: number,
  assetId: number,
): Promise<{ data: Buffer | null; storage_bucket: string | null; storage_key: string | null; mime_type: string | null; file_name: string | null; sha256: string | null; size_bytes: string | null } | null> {
  return queryOne(
    `SELECT data, storage_bucket, storage_key, mime_type, file_name, sha256, size_bytes
       FROM scope_asset WHERE project_id = $1 AND id = $2`,
    [projectId, assetId],
  );
}

export async function updateAsset(
  id: number,
  patch: Partial<{ state: AssetRow["state"]; error: string | null; transcript: AssetRow["transcript"]; body_text: string | null; duration_seconds: number | null; used_in_version: number }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, v] of Object.entries(patch)) {
    params.push(k === "transcript" ? JSON.stringify(v) : v);
    sets.push(`${k} = $${params.length}${k === "transcript" ? "::jsonb" : ""}`);
  }
  if (sets.length) await query(`UPDATE scope_asset SET ${sets.join(", ")} WHERE id = $1`, params);
}

// --------------------------------------------------------------------------
// Versions
// --------------------------------------------------------------------------

const VERSION_COLS = "id::int, project_id::int, version_no, source, note, doc, pricing, created_by::int, created_at";

export async function currentVersion(project: ProjectRow): Promise<VersionRow | null> {
  if (!project.current_version_id) return null;
  return queryOne<VersionRow>(`SELECT ${VERSION_COLS} FROM scope_version WHERE id = $1`, [project.current_version_id]);
}

export async function getVersion(projectId: number, id: number): Promise<VersionRow | null> {
  return queryOne<VersionRow>(`SELECT ${VERSION_COLS} FROM scope_version WHERE project_id = $1 AND id = $2`, [projectId, id]);
}

export async function listVersions(projectId: number): Promise<Omit<VersionRow, "doc" | "pricing">[]> {
  return query(
    `SELECT id::int, project_id::int, version_no, source, note, created_by::int, created_at
       FROM scope_version WHERE project_id = $1 ORDER BY version_no DESC`,
    [projectId],
  );
}

export async function saveVersion(input: {
  projectId: number;
  doc: ScopeDoc;
  pricing: PricingResult;
  source: string;
  note?: string | null;
  status: ScopeStatusName;
  userId: number | null;
  clearProposal?: boolean;
}): Promise<VersionRow> {
  return transaction(async (client) => {
    // Serialize version numbering per project.
    await client.query("SELECT id FROM scope_project WHERE id = $1 FOR UPDATE", [input.projectId]);
    const next = await client.query<{ n: number }>(
      "SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM scope_version WHERE project_id = $1",
      [input.projectId],
    );
    const res = await client.query<VersionRow>(
      `INSERT INTO scope_version (project_id, version_no, source, note, doc, pricing, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7) RETURNING ${VERSION_COLS}`,
      [input.projectId, next.rows[0].n, input.source, input.note ?? null, JSON.stringify(input.doc), JSON.stringify(input.pricing), input.userId],
    );
    const v = res.rows[0];
    await client.query(
      `UPDATE scope_project SET current_version_id = $2, scope_status = $3, updated_at = now()
         ${input.clearProposal ? ", pending_proposal = NULL" : ""}
        WHERE id = $1`,
      [input.projectId, v.id, input.status],
    );
    return v;
  });
}

// --------------------------------------------------------------------------
// Answers
// --------------------------------------------------------------------------

export async function listAnswers(projectId: number): Promise<{ question_key: string; status: "answered" | "deferred"; answer: unknown }[]> {
  return query("SELECT question_key, status, answer FROM scope_answer WHERE project_id = $1", [projectId]);
}

export async function saveAnswer(projectId: number, key: string, status: "answered" | "deferred", answer: unknown, assetId: number | null, userId: number): Promise<void> {
  await query(
    `INSERT INTO scope_answer (project_id, question_key, status, answer, asset_id, answered_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (project_id, question_key) DO UPDATE SET
       status = EXCLUDED.status, answer = EXCLUDED.answer, asset_id = EXCLUDED.asset_id,
       answered_by = EXCLUDED.answered_by, answered_at = now()`,
    [projectId, key, status, JSON.stringify(answer ?? null), assetId, userId],
  );
}

/** Acknowledgements that apply to every project (e.g. cost book age). */
export async function globalAcknowledgements(): Promise<Set<string>> {
  const rows = await query<{ question_key: string }>(
    "SELECT DISTINCT question_key FROM scope_answer WHERE question_key LIKE 'price-age:%' AND status = 'answered' AND answer->>'value' = 'true'",
  );
  return new Set(rows.map((r) => r.question_key));
}

// --------------------------------------------------------------------------
// Estimates
// --------------------------------------------------------------------------

const ESTIMATE_COLS = `id::int, project_id::int, version_id::int, qbo_estimate_id, doc_number, sync_token, txn_status,
  email_status, accepted_by, accepted_date, linked_invoice, total::text, sent_payload, qbo_snapshot, drift,
  status_error, last_synced_at, created_at, updated_at`;

export async function latestEstimate(projectId: number): Promise<EstimateRow | null> {
  return queryOne<EstimateRow>(
    `SELECT ${ESTIMATE_COLS} FROM scope_estimate WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
}

export async function insertEstimate(e: {
  projectId: number;
  versionId: number;
  qboId: string;
  payload: Record<string, unknown>;
  userId: number;
}): Promise<number> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO scope_estimate (project_id, version_id, qbo_estimate_id, sent_payload, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (qbo_estimate_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [e.projectId, e.versionId, e.qboId, JSON.stringify(e.payload), e.userId],
  );
  return Number(row!.id);
}

export async function recordRevision(estimateId: number, versionId: number, payload: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE scope_estimate SET version_id = $2, sent_payload = $3::jsonb, drift = NULL, updated_at = now() WHERE id = $1`,
    [estimateId, versionId, JSON.stringify(payload)],
  );
}

export async function applyEstimateStatus(
  estimateId: number,
  s: {
    raw: Record<string, unknown>;
    source: string;
    drift: EstimateRow["drift"];
  },
): Promise<void> {
  const r = s.raw as Record<string, unknown> & { LinkedTxn?: { TxnId: string; TxnType: string }[] };
  const invoice = r.LinkedTxn?.find((t) => t.TxnType === "Invoice")?.TxnId ?? null;
  await query(
    `UPDATE scope_estimate SET sync_token = $2, txn_status = $3, email_status = $4, accepted_by = $5,
        accepted_date = $6, linked_invoice = $7, total = $8, doc_number = $9, qbo_snapshot = $10::jsonb,
        drift = $11::jsonb, status_error = NULL, last_synced_at = now(), updated_at = now()
      WHERE id = $1`,
    [
      estimateId,
      r.SyncToken ?? null,
      r.TxnStatus ?? null,
      r.EmailStatus ?? null,
      r.AcceptedBy ?? null,
      r.AcceptedDate ?? null,
      invoice,
      typeof r.TotalAmt === "number" ? r.TotalAmt : null,
      r.DocNumber ?? null,
      JSON.stringify(r),
      s.drift ? JSON.stringify(s.drift) : null,
    ],
  );
  await query(
    `INSERT INTO scope_estimate_snapshot (estimate_id, sync_token, source, raw)
     VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (estimate_id, sync_token) DO NOTHING`,
    [estimateId, r.SyncToken ?? null, s.source, JSON.stringify(r)],
  );
}

export async function estimateStatusError(estimateId: number, error: string): Promise<void> {
  await query("UPDATE scope_estimate SET status_error = $2, updated_at = now() WHERE id = $1", [estimateId, error.slice(0, 500)]);
}

/** QuickBooks confirmed the estimate no longer exists. History and snapshots are kept. */
export async function markEstimateDeleted(estimateId: number): Promise<void> {
  await query(
    `UPDATE scope_estimate
        SET txn_status = 'Deleted', status_error = NULL, last_synced_at = now(), updated_at = now(),
            qbo_snapshot = coalesce(qbo_snapshot, '{}'::jsonb) || '{"TxnStatus":"Deleted"}'::jsonb
      WHERE id = $1`,
    [estimateId],
  );
}

export async function estimateSnapshots(estimateId: number): Promise<{ sync_token: string | null; source: string; captured_at: Date; total: number | null }[]> {
  return query(
    `SELECT sync_token, source, captured_at, (raw->>'TotalAmt')::float8 AS total
       FROM scope_estimate_snapshot WHERE estimate_id = $1 ORDER BY captured_at DESC`,
    [estimateId],
  );
}

/** What QuickBooks has invoiced against an estimate and what is still owed, from the mirrored invoices. */
export async function linkedInvoices(snapshot: unknown): Promise<{ count: number; total: number; balance: number }> {
  const linked = (snapshot as { LinkedTxn?: { TxnId?: string; TxnType?: string }[] } | null)?.LinkedTxn;
  const ids = Array.isArray(linked) ? linked.filter((t) => t.TxnType === "Invoice" && t.TxnId).map((t) => String(t.TxnId)) : [];
  if (!ids.length) return { count: 0, total: 0, balance: 0 };
  const row = await queryOne<{ count: number; total: number; balance: number }>(
    `SELECT count(*)::int AS count, coalesce(sum(total), 0)::float8 AS total, coalesce(sum(balance), 0)::float8 AS balance
       FROM qbo_txn WHERE txn_type = 'Invoice' AND qbo_id = ANY($1::text[])`,
    [ids],
  );
  return row ?? { count: 0, total: 0, balance: 0 };
}

export async function estimateByQboId(qboId: string): Promise<EstimateRow | null> {
  return queryOne<EstimateRow>(`SELECT ${ESTIMATE_COLS} FROM scope_estimate WHERE qbo_estimate_id = $1 ORDER BY created_at DESC LIMIT 1`, [qboId]);
}

/** QuickBooks' own copy of the estimate, as delivered by the webhook or daily sync. */
export async function mirroredEstimate(qboId: string): Promise<{ raw: Record<string, unknown>; synced_at: Date } | null> {
  return queryOne("SELECT raw, synced_at FROM qbo_txn WHERE txn_type = 'Estimate' AND qbo_id = $1", [qboId]);
}

// --------------------------------------------------------------------------
// Large uploads (sent in pieces) and sheet-by-sheet reading
// --------------------------------------------------------------------------

export async function assetByClientKey(projectId: number, clientKey: string): Promise<AssetRow | null> {
  return queryOne<AssetRow>(`SELECT ${ASSET_COLS} FROM scope_asset WHERE project_id = $1 AND client_key = $2`, [projectId, clientKey]);
}

export async function saveUploadPart(projectId: number, uploadKey: string, part: number, data: Buffer): Promise<void> {
  await query(
    `INSERT INTO scope_upload_part (project_id, upload_key, part, data) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, upload_key, part) DO NOTHING`,
    [projectId, uploadKey, part, data],
  );
}

export async function uploadPartCount(projectId: number, uploadKey: string): Promise<number> {
  const row = await queryOne<{ n: number }>("SELECT count(*)::int AS n FROM scope_upload_part WHERE project_id = $1 AND upload_key = $2", [projectId, uploadKey]);
  return row?.n ?? 0;
}

/** The pieces in order. Read one at a time so a large file never needs two copies in memory per piece. */
export async function readUploadPart(projectId: number, uploadKey: string, part: number): Promise<Buffer | null> {
  const row = await queryOne<{ data: Buffer }>("SELECT data FROM scope_upload_part WHERE project_id = $1 AND upload_key = $2 AND part = $3", [projectId, uploadKey, part]);
  return row ? Buffer.from(row.data) : null;
}

export async function clearUploadParts(projectId: number, uploadKey: string): Promise<void> {
  await query("DELETE FROM scope_upload_part WHERE project_id = $1 AND upload_key = $2", [projectId, uploadKey]);
  // Pieces of uploads abandoned more than a day ago.
  await query("DELETE FROM scope_upload_part WHERE created_at < now() - interval '1 day'").catch(() => undefined);
}

export type SheetRow = { page: number; notes: string | null; error: string | null };

export async function listSheets(assetId: number): Promise<SheetRow[]> {
  return query<SheetRow>("SELECT page, notes, error FROM scope_sheet WHERE asset_id = $1 ORDER BY page", [assetId]);
}

export async function saveSheet(assetId: number, page: number, notes: string | null, error: string | null): Promise<void> {
  await query(
    `INSERT INTO scope_sheet (asset_id, page, notes, error) VALUES ($1,$2,$3,$4)
     ON CONFLICT (asset_id, page) DO UPDATE SET notes = EXCLUDED.notes, error = EXCLUDED.error, read_at = now()`,
    [assetId, page, notes, error],
  );
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------

export async function logEvent(projectId: number, kind: string, detail: unknown, actor: number | null): Promise<void> {
  await query(`INSERT INTO scope_event (project_id, kind, detail, actor) VALUES ($1,$2,$3::jsonb,$4)`, [
    projectId,
    kind,
    detail === null ? null : JSON.stringify(detail),
    actor,
  ]);
}

export async function listEvents(projectId: number): Promise<{ kind: string; detail: unknown; created_at: Date; actor_name: string | null }[]> {
  return query(
    `SELECT e.kind, e.detail, e.created_at, u.full_name AS actor_name
       FROM scope_event e LEFT JOIN app_user u ON u.id = e.actor
      WHERE e.project_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
    [projectId],
  );
}
