/**
 * Everything the workspace screen shows for one project, in one JSON payload.
 * Server only. Internal costs are included because only employees reach it;
 * nothing here is ever sent to a customer.
 */

import { compute, currentDoc } from "./engine.ts";
import { ESTIMATE_STATUS_LABEL, estimateStatus, qboWebUrl, type EstimateStatusName } from "./estimate.ts";
import { applyMirroredStatus, isSandbox, projectIsProject, qboState } from "./qbo.ts";
import {
  estimateSnapshots,
  getProject,
  latestEstimate,
  linkedInvoices,
  listAssetSync,
  listAssets,
  listEvents,
  listVersions,
  loadScopeSettings,
  setProjectState,
  syncProjectTitle,
  type ProjectRow,
} from "./store.ts";
import type { ScopeUser } from "../auth.ts";
import { can } from "../leads/permissions.ts";
import { isHubSpotConfigured, syncsToOtherSystems } from "./filesync.ts";
import type { Change } from "./merge.ts";
import { anyCountyLoaded } from "./county/index.ts";
import { ensureProperty, propertyRows } from "./property.ts";
import type { PricingResult, Question, ScopeDoc, ScopeSettings } from "./types.ts";

export type WorkspaceAsset = {
  id: number;
  kind: string;
  label: string;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  recordingId: string | null;
  segmentIndex: number | null;
  offsetSeconds: number;
  durationSeconds: number | null;
  state: string;
  error: string | null;
  bodyText: string | null;
  transcript: { start: number; end: number; text: string }[] | null;
  transcriptApproximate: boolean;
  usedInVersion: number | null;
  createdAt: string;
  /** Where this file has been copied to. Empty for recordings and notes, which stay here. */
  copies: { target: "quickbooks" | "hubspot"; status: string; error: string | null }[];
};

export type Workspace = {
  project: Omit<ProjectRow, "pending_proposal" | "processing_started_at" | "qbo_project_linked_at" | "archived_at" | "created_at" | "updated_at"> & {
    archived: boolean;
    updatedAt: string;
    processingSince: string | null;
    qboProjectLinkedAt: string | null;
    qboProjectIsProject: boolean | null;
  };
  assets: WorkspaceAsset[];
  /** The public record for the address. Unverified until confirmed on site. */
  property: { source: string; rows: [string, string][]; lookedUpAt: string } | null;
  propertyLookup: { configured: boolean; checked: boolean };
  hubspot: { configured: boolean; contactLinked: boolean };
  versions: { id: number; versionNo: number; source: string; note: string | null; createdAt: string }[];
  version: { id: number; versionNo: number; createdAt: string } | null;
  doc: ScopeDoc;
  /** internal is false for scopes-only accounts: cost and margin are withheld. */
  viewer: { internal: boolean; canManagePricing: boolean };
  pricing: PricingResult;
  questions: Question[];
  readiness: { status: string; blocking: number; blockers: string[] };
  proposal: { changes: Change[]; createdAt: string; sourceIds: number[] } | null;
  estimate: null | {
    id: number;
    qboId: string | null;
    docNumber: string | null;
    status: EstimateStatusName;
    statusLabel: string;
    total: number | null;
    versionId: number;
    versionNo: number | null;
    acceptedBy: string | null;
    acceptedDate: string | null;
    /** Sent to this address through QuickBooks, when QuickBooks reports it. */
    sentTo: string | null;
    invoiced: { count: number; total: number; balance: number } | null;
    url: string | null;
    drift: { changed: boolean; details: string[] } | null;
    lastSyncedAt: string | null;
    error: string | null;
    stale: boolean;
    snapshots: { syncToken: string | null; source: string; capturedAt: string; total: number | null }[];
  };
  qbo: { configured: boolean; connected: boolean; lastSuccess: string | null; error: string | null; sandbox: boolean };
  settings: Pick<ScopeSettings, "laborRate" | "laborLoadedCost">;
  events: { kind: string; detail: unknown; at: string; who: string | null }[];
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function loadWorkspace(projectId: number, viewer: Pick<ScopeUser, "scopesOnly"> & Partial<ScopeUser>): Promise<Workspace | null> {
  const internal = !viewer.scopesOnly;
  // Projects created before names were standardized pick up the derived name here.
  await syncProjectTitle(projectId);
  let project = await getProject(projectId);
  if (!project) return null;
  // The address is looked up once; a slow or failed lookup never holds the page.
  await Promise.race([ensureProperty(project).catch(() => false), new Promise((r) => setTimeout(r, 5000))]);
  const settings = await loadScopeSettings();
  const { version, doc } = await currentDoc(project);
  const computed = await compute(project, doc, settings);
  if (version && computed.readiness.status !== project.scope_status) {
    await setProjectState(projectId, { scope_status: computed.readiness.status });
  }

  let estimate = await latestEstimate(projectId);
  if (estimate && (await applyMirroredStatus(estimate).catch(() => false))) estimate = await latestEstimate(projectId);
  const sync = await listAssetSync(projectId);
  const [assets, versions, events, state, snapshots, isProject] = await Promise.all([
    listAssets(projectId),
    listVersions(projectId),
    listEvents(projectId),
    qboState(),
    estimate ? estimateSnapshots(estimate.id) : Promise.resolve([]),
    projectIsProject(project.qbo_project_id),
  ]);
  project = (await getProject(projectId))!;
  const invoices = estimate ? await linkedInvoices(estimate.qbo_snapshot) : null;
  const status = estimate ? estimateStatus(estimate.qbo_snapshot as never, true, invoices) : "not_created";
  const {
    pending_proposal,
    processing_started_at,
    qbo_project_linked_at,
    archived_at,
    created_at,
    updated_at,
    ...rest
  } = project;
  void created_at;

  return {
    project: {
      ...rest,
      archived: Boolean(archived_at),
      updatedAt: iso(updated_at)!,
      processingSince: iso(processing_started_at),
      qboProjectLinkedAt: iso(qbo_project_linked_at),
      qboProjectIsProject: isProject,
    },
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      label: a.label,
      fileName: a.file_name,
      mimeType: a.mime_type,
      size: a.size_bytes,
      recordingId: a.recording_id,
      segmentIndex: a.segment_index,
      offsetSeconds: Number(a.offset_seconds) || 0,
      durationSeconds: a.duration_seconds === null ? null : Number(a.duration_seconds),
      state: a.state,
      error: a.error,
      bodyText: a.body_text,
      transcript: a.transcript?.segments ?? null,
      transcriptApproximate: Boolean(a.transcript?.approximate),
      usedInVersion: a.used_in_version,
      createdAt: iso(a.created_at)!,
      copies: syncsToOtherSystems(a)
        ? (["quickbooks", "hubspot"] as const).map((target) => {
            const row = sync.find((x) => x.asset_id === a.id && x.target === target);
            return { target, status: row?.status ?? "pending", error: row?.error ?? null };
          })
        : [],
    })),
    property: project.property ? { source: project.property.source, rows: propertyRows(project.property), lookedUpAt: project.property.lookedUpAt } : null,
    propertyLookup: { configured: await anyCountyLoaded().catch(() => false), checked: Boolean(project.property_checked_for) },
    hubspot: { configured: isHubSpotConfigured(), contactLinked: Boolean(project.hubspot_contact_id) },
    versions: versions.map((v) => ({ id: v.id, versionNo: v.version_no, source: v.source, note: v.note, createdAt: iso(v.created_at)! })),
    version: version ? { id: version.id, versionNo: version.version_no, createdAt: iso(version.created_at)! } : null,
    doc: computed.doc,
    viewer: { internal, canManagePricing: internal && Boolean(viewer.role) && can(viewer.role!, "manage_settings") },
    // Internal cost, margin and markup never leave the server for a scopes-only account.
    pricing: internal
      ? computed.pricing
      : {
          ...computed.pricing,
          lines: computed.pricing.lines.map((l) => ({ ...l, unitCost: null, cost: null })),
          totals: { ...computed.pricing.totals, baseCost: null, margin: null, profit: null, costGaps: undefined },
          policy: { ...computed.pricing.policy, overheadRate: 0, profitRate: 0, contingencyRate: 0 },
        },
    questions: computed.questions,
    readiness: computed.readiness,
    proposal: pending_proposal ? { changes: pending_proposal.changes, createdAt: pending_proposal.createdAt, sourceIds: pending_proposal.sourceIds ?? [] } : null,
    estimate: estimate
      ? {
          id: estimate.id,
          qboId: estimate.qbo_estimate_id,
          docNumber: estimate.doc_number,
          status,
          statusLabel: ESTIMATE_STATUS_LABEL[status],
          total: estimate.total === null ? null : Number(estimate.total),
          versionId: estimate.version_id,
          versionNo: versions.find((v) => v.id === estimate!.version_id)?.version_no ?? null,
          acceptedBy: estimate.accepted_by,
          acceptedDate: estimate.accepted_date,
          sentTo: estimate.email_status === "EmailSent" ? (((estimate.qbo_snapshot as { BillEmail?: { Address?: string } } | null)?.BillEmail?.Address) ?? null) : null,
          invoiced: invoices && invoices.count ? invoices : null,
          url: estimate.qbo_estimate_id ? qboWebUrl("estimate", estimate.qbo_estimate_id, isSandbox()) : null,
          drift: estimate.drift ? { changed: estimate.drift.changed, details: estimate.drift.details } : null,
          lastSyncedAt: iso(estimate.last_synced_at),
          error: estimate.status_error,
          stale: status !== "deleted" && (!estimate.last_synced_at || Date.now() - new Date(estimate.last_synced_at).getTime() > 15 * 60_000),
          snapshots: snapshots.map((s) => ({ syncToken: s.sync_token, source: s.source, capturedAt: iso(s.captured_at)!, total: s.total })),
        }
      : null,
    qbo: { configured: state.configured, connected: state.connected, lastSuccess: iso(state.lastSuccess), error: state.error, sandbox: isSandbox() },
    settings: { laborRate: settings.laborRate, laborLoadedCost: internal ? settings.laborLoadedCost : null },
    events: events.map((e) => ({ kind: e.kind, detail: e.detail, at: iso(e.created_at)!, who: e.actor_name })),
  };
}
