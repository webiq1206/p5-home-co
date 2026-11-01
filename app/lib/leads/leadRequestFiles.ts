/**
 * Storing files sent with P5's own quote form (lead_request_file, Postgres).
 *
 * The browser saves the lead first and then sends each file on its own, so a
 * slow or failed upload can never cost the lead. Storing is idempotent per
 * lead: the same bytes sent twice (a retry) are kept once.
 *
 * Every stored file has an admin-gated link (/api/admin/lead-files?id=N, sign
 * in required, coordinators see only their own leads). That link is what the
 * team email and HubSpot carry; the bytes never leave P5.
 */

import { SYNTHETIC_ESTIMATOR_FORM } from "./synthetic-qa.ts";
import { transaction } from "../db.ts";
import { MAX_SHORT_REQUEST_FILES, SHORT_REQUEST_FILE_ERRORS, type StoredLeadFile } from "./shortRequestFiles.ts";

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://p5homeco.com").replace(/\/+$/, "");
}

export function leadFileAdminUrl(fileId: number | string): string {
  return `${appBaseUrl()}/api/admin/lead-files?id=${fileId}`;
}

export type StoreOutcome =
  | { name: string; status: "stored" | "already_stored"; id: number }
  | { name: string; status: "rejected"; error: string };

export async function storeLeadRequestFiles(dealId: number, files: readonly StoredLeadFile[]): Promise<StoreOutcome[]> {
  if (!files.length) return [];
  return transaction(async (client) => {
    // Lock the deal so two parallel uploads cannot both pass the count check.
    const deal = await client.query<{ original_form: string | null }>(
      "SELECT original_form FROM deal WHERE id = $1 FOR UPDATE",
      [dealId],
    );
    if (!deal.rows.length) return files.map((file) => ({ name: file.fileName, status: "rejected" as const, error: "That request was not found." }));
    const existing = await client.query<{ id: string; sha256: string }>(
      "SELECT id, sha256 FROM lead_request_file WHERE deal_id = $1",
      [dealId],
    );
    const bySha = new Map(existing.rows.map((row) => [row.sha256, Number(row.id)]));
    let count = existing.rows.length;
    const outcomes: StoreOutcome[] = [];
    const added: string[] = [];
    for (const file of files) {
      const known = bySha.get(file.sha256);
      if (known) {
        outcomes.push({ name: file.fileName, status: "already_stored", id: known });
        continue;
      }
      if (count >= MAX_SHORT_REQUEST_FILES) {
        outcomes.push({ name: file.fileName, status: "rejected", error: SHORT_REQUEST_FILE_ERRORS.count });
        continue;
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO lead_request_file (deal_id, file_name, mime_type, size_bytes, sha256, data)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dealId, file.fileName, file.mimeType, file.sizeBytes, file.sha256, file.data],
      );
      const id = Number(rows[0].id);
      bySha.set(file.sha256, id);
      count += 1;
      added.push(file.fileName);
      outcomes.push({ name: file.fileName, status: "stored", id });
    }
    if (added.length) {
      await client.query(
        `INSERT INTO activity (deal_id, kind, body, is_human_attempt, is_two_way)
         VALUES ($1, 'note', $2, FALSE, FALSE)`,
        [dealId, `Short request included ${added.length} file(s): ${added.join(", ")}.`],
      );
      // HubSpot's description lists every file link, so the deal is re-sent.
      if (deal.rows[0].original_form !== SYNTHETIC_ESTIMATOR_FORM) {
        await client.query("UPDATE deal SET integration_sync_status = 'pending', updated_at = now() WHERE id = $1", [dealId]);
      }
    }
    return outcomes;
  });
}
