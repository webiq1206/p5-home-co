/**
 * Keeping a project's files in QuickBooks and HubSpot. Server only.
 *
 * Plans, documents, photos and quotes added to a project are copied to:
 *   QuickBooks - attached to the estimate once there is one, otherwise to the
 *                customer, and linked to the estimate when it is created.
 *   HubSpot    - uploaded as a private file and pinned to the client's contact
 *                record in a note. The contact is found by email; one is never
 *                created here, because contacts belong to the lead pipeline.
 *
 * Recordings of client conversations and typed notes stay in this platform.
 * Each file is sent once per destination (scope_asset_sync). A failure is
 * recorded with its reason and retried the next time the sync runs.
 */

import { getFreshAccessToken, qboApiHost } from "../finance/qbo/oauth.ts";
import { ensureP5HubSpotPortal } from "../integrations/hubspot-portal.ts";
import { classify, readBytes } from "./files.ts";
import {
  assetStorage,
  getProject,
  latestEstimate,
  listAssetSync,
  listAssets,
  saveAssetSync,
  setHubSpotContact,
  type AssetRow,
  type AssetSyncRow,
  type ProjectRow,
} from "./store.ts";

/** QuickBooks refuses attachments over 100 MB. */
const QBO_MAX_BYTES = 100 * 1024 * 1024;
const MINOR_VERSION = "75";

export function syncsToOtherSystems(a: Pick<AssetRow, "kind" | "file_name" | "mime_type">): boolean {
  if (!["document", "photo", "quote"].includes(a.kind)) return false;
  return classify(a.file_name ?? "", a.mime_type ?? "") !== "audio";
}

export function isHubSpotConfigured(): boolean {
  return Boolean(process.env.HUBSPOT_TOKEN);
}

// ---------------------------------------------------------------------------
// QuickBooks
// ---------------------------------------------------------------------------

type Ref = { type: "Estimate" | "Customer"; value: string };

async function qboFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const conn = await getFreshAccessToken();
  if (!conn) throw new Error("QuickBooks is not connected.");
  const res = await fetch(`${qboApiHost()}/v3/company/${conn.realmId}${path}${path.includes("?") ? "&" : "?"}minorversion=${MINOR_VERSION}`, {
    ...init,
    headers: { Authorization: `Bearer ${conn.accessToken}`, Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`QuickBooks ${res.status}: ${body.slice(0, 240)}`);
  return JSON.parse(body) as Record<string, unknown>;
}

/** Where a project's files belong in QuickBooks right now. */
export function qboParent(p: Pick<ProjectRow, "qbo_customer_id" | "qbo_project_id">, estimateId: string | null): Ref | null {
  if (estimateId) return { type: "Estimate", value: estimateId };
  const customer = p.qbo_project_id ?? p.qbo_customer_id;
  return customer ? { type: "Customer", value: customer } : null;
}

async function qboUpload(name: string, mime: string, data: Buffer, ref: Ref): Promise<string> {
  const form = new FormData();
  form.append(
    "file_metadata_01",
    new Blob([JSON.stringify({ AttachableRef: [{ EntityRef: ref, IncludeOnSend: false }], FileName: name, ContentType: mime })], { type: "application/json" }),
    "metadata.json",
  );
  form.append("file_content_01", new Blob([new Uint8Array(data)], { type: mime }), name);
  const out = (await qboFetch("/upload", { method: "POST", body: form })) as {
    AttachableResponse?: { Attachable?: { Id?: string }; Fault?: { Error?: { Message?: string; Detail?: string }[] } }[];
  };
  const first = out.AttachableResponse?.[0];
  if (!first?.Attachable?.Id) throw new Error(first?.Fault?.Error?.[0]?.Detail || first?.Fault?.Error?.[0]?.Message || "QuickBooks did not accept the file.");
  return first.Attachable.Id;
}

/** Add the estimate to a file that was attached to the customer before the estimate existed. */
async function qboLink(attachableId: string, refs: Ref[]): Promise<void> {
  const current = (await qboFetch(`/attachable/${encodeURIComponent(attachableId)}`, { method: "GET" })) as { Attachable?: Record<string, unknown> };
  if (!current.Attachable) throw new Error("The QuickBooks attachment no longer exists.");
  await qboFetch("/attachable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...current.Attachable, AttachableRef: refs.map((EntityRef) => ({ EntityRef, IncludeOnSend: false })) }),
  });
}

export async function qboRemoveAttachment(attachableId: string): Promise<void> {
  const current = (await qboFetch(`/attachable/${encodeURIComponent(attachableId)}`, { method: "GET" }).catch(() => null)) as { Attachable?: { Id: string; SyncToken: string } } | null;
  if (!current?.Attachable) return;
  await qboFetch("/attachable?operation=delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Id: current.Attachable.Id, SyncToken: current.Attachable.SyncToken }),
  });
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------

async function hubspot(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const token = process.env.HUBSPOT_TOKEN ?? "";
  // Never read or write any portal but P5's.
  await ensureP5HubSpotPortal(token);
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.text();
  if (!res.ok) {
    const missing = res.status === 403 ? " The HubSpot private app needs the Files and CRM notes permissions." : "";
    throw new Error(`HubSpot ${res.status}: ${body.slice(0, 200)}${missing}`);
  }
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

const json = { "Content-Type": "application/json" };

/** The client's contact, by email. Null when HubSpot has no such contact. */
export async function findHubSpotContact(email: string | null): Promise<string | null> {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return null;
  const out = (await hubspot("/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value }] }], properties: ["email"], limit: 1 }),
  })) as { results?: { id: string }[] };
  return out.results?.[0]?.id ?? null;
}

async function hubspotUpload(name: string, mime: string, data: Buffer, folder: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: mime }), name);
  form.append("folderPath", folder);
  form.append("options", JSON.stringify({ access: "PRIVATE", overwrite: false }));
  const out = (await hubspot("/files/v3/files", { method: "POST", body: form })) as { id?: string };
  if (!out.id) throw new Error("HubSpot did not accept the file.");
  return out.id;
}

/** Pin an uploaded file to the contact's timeline. Returns the note's id. */
async function hubspotNote(contactId: string, fileId: string, text: string): Promise<string> {
  const out = (await hubspot("/crm/v3/objects/notes", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: text, hs_attachment_ids: fileId },
      // 202 is HubSpot's own note-to-contact association.
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
    }),
  })) as { id?: string };
  return out.id ?? "";
}

const safe = (s: string) => s.replace(/[<>&]/g, " ").slice(0, 200);
const folderName = (p: ProjectRow) => `/P5 Scopes/${(p.title || `Project ${p.id}`).replace(/[\\/:*?"<>|]/g, " ").slice(0, 80)}`;

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------

export type SyncSummary = { quickbooks: { sent: number; failed: number; waiting: number }; hubspot: { sent: number; failed: number; waiting: number }; notes: string[] };

/**
 * Send every file that has not been sent, and link files to the estimate once
 * it exists. Safe to run at any time and any number of times.
 */
export async function syncProjectFiles(projectId: number, opts: { deadline?: number } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { quickbooks: { sent: 0, failed: 0, waiting: 0 }, hubspot: { sent: 0, failed: 0, waiting: 0 }, notes: [] };
  let p = await getProject(projectId);
  if (!p) return summary;
  const deadline = opts.deadline ?? Date.now() + 200_000;
  const assets = (await listAssets(projectId)).filter(syncsToOtherSystems);
  if (!assets.length) return summary;
  const done = new Map<string, AssetSyncRow>((await listAssetSync(projectId)).map((s) => [`${s.asset_id}:${s.target}`, s]));
  const estimate = await latestEstimate(projectId);
  const estimateId = estimate?.qbo_estimate_id && estimate.txn_status !== "Deleted" ? estimate.qbo_estimate_id : null;

  const qboOn = Boolean(await getFreshAccessToken().catch(() => null));
  const parent = qboParent(p, estimateId);
  if (!qboOn) summary.notes.push("QuickBooks is not connected.");
  else if (!parent) summary.notes.push("Files go to QuickBooks once the customer is chosen.");

  let contact = p.hubspot_contact_id;
  if (isHubSpotConfigured() && !contact) {
    try {
      contact = await findHubSpotContact(p.client_email);
      if (contact) {
        await setHubSpotContact(p.id, contact);
        p = { ...p, hubspot_contact_id: contact };
      } else {
        summary.notes.push(p.client_email ? `HubSpot has no contact with the email ${p.client_email}.` : "Files go to HubSpot once the client's email is saved.");
      }
    } catch (e) {
      summary.notes.push((e as Error).message);
    }
  }
  if (!isHubSpotConfigured()) summary.notes.push("HubSpot is not connected.");

  for (const a of assets) {
    if (Date.now() > deadline) {
      summary.notes.push("More files are still to be sent.");
      break;
    }
    const name = (a.file_name || a.label || `file-${a.id}`).slice(0, 180);
    const mime = a.mime_type || "application/octet-stream";
    let data: Buffer | null = null;
    const bytes = async () => (data ??= await readBytes((await assetStorage(projectId, a.id))!));

    // QuickBooks
    const q = done.get(`${a.id}:quickbooks`);
    if (qboOn && parent) {
      try {
        if (q?.status === "sent" && q.remote_id) {
          // Attached to the customer before the estimate existed: add the estimate.
          if (estimateId && q.parent_id !== `Estimate:${estimateId}`) {
            const customer = p.qbo_project_id ?? p.qbo_customer_id;
            await qboLink(q.remote_id, [{ type: "Estimate", value: estimateId }, ...(customer ? [{ type: "Customer" as const, value: customer }] : [])]);
            await saveAssetSync(a.id, "quickbooks", { status: "sent", parentId: `Estimate:${estimateId}` });
          }
        } else if (q?.status !== "skipped" && q?.status !== "removed") {
          if ((a.size_bytes ?? 0) > QBO_MAX_BYTES) {
            await saveAssetSync(a.id, "quickbooks", { status: "skipped", error: "Over QuickBooks' 100 MB attachment limit." });
          } else {
            const id = await qboUpload(name, mime, await bytes(), parent);
            await saveAssetSync(a.id, "quickbooks", { status: "sent", remoteId: id, parentId: `${parent.type}:${parent.value}` });
            summary.quickbooks.sent++;
          }
        }
      } catch (e) {
        summary.quickbooks.failed++;
        await saveAssetSync(a.id, "quickbooks", { status: q?.status === "sent" ? "sent" : "failed", error: (e as Error).message });
      }
    } else if (q?.status !== "sent") summary.quickbooks.waiting++;

    // HubSpot
    const h = done.get(`${a.id}:hubspot`);
    if (isHubSpotConfigured() && contact) {
      if (h?.status !== "sent" && h?.status !== "skipped") {
        try {
          const fileId = h?.remote_id ?? (await hubspotUpload(name, mime, await bytes(), folderName(p)));
          // Record the upload first, so a failed note never uploads the file twice.
          await saveAssetSync(a.id, "hubspot", { status: "pending", remoteId: fileId });
          const what = a.kind === "photo" ? "Photo" : a.kind === "quote" ? "Quote" : "Document";
          await hubspotNote(contact, fileId, `${what} added in P5 Scopes for ${safe(p.title || "this project")}: ${safe(name)}`);
          await saveAssetSync(a.id, "hubspot", { status: "sent", remoteId: fileId, parentId: contact });
          summary.hubspot.sent++;
        } catch (e) {
          summary.hubspot.failed++;
          await saveAssetSync(a.id, "hubspot", { status: "failed", error: (e as Error).message });
        }
      }
    } else if (h?.status !== "sent") summary.hubspot.waiting++;
  }
  return summary;
}
