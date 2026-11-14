import { HubSpotDiagnosticError } from './hubspot-diagnostics.ts';
/** Evidence only: an archive is not a lost sale, resolved incident or permission to recreate. */
import { query, isMissingRelation } from '../db.ts';
export type ArchiveTarget = { type: 'tasks' | 'deals'; id: string };
export function archiveTarget(path: string, method = 'GET'): ArchiveTarget | null {
  if (method !== 'GET' || /(?:[?&])archived=true(?:&|$)/.test(path)) return null;
  const match = /^\/crm\/v3\/objects\/(tasks|deals)\/([^/?]+)(?:\?|$)/.exec(path);
  return match ? { type: match[1] as ArchiveTarget['type'], id: decodeURIComponent(match[2]) } : null;
}
export async function archiveReviewHeld(target: ArchiveTarget): Promise<boolean> {
  try {
  const rows = await query<{ held: boolean }>(`SELECT next_check_at>now() AS held FROM hubspot_archive_review
    WHERE object_type=$1 AND remote_id=$2 AND restored_at IS NULL`, [target.type,target.id]);
  return rows[0]?.held === true;
  } catch(error) { if (isMissingRelation(error)) return false; throw error; }
}
export async function confirmArchiveReview(target: ArchiveTarget): Promise<void> {
  try {
  await query(`INSERT INTO hubspot_archive_review(object_type,remote_id) VALUES($1,$2)
    ON CONFLICT(object_type,remote_id) DO UPDATE SET confirmed_at=now(),last_checked_at=now(),
      next_check_at=now()+interval '24 hours',restored_at=NULL`,[target.type,target.id]);
  } catch(error) { if (isMissingRelation(error)) throw new HubSpotDiagnosticError("archive_review_persistence_unavailable"); throw error; }
}
export async function releaseRestoredArchive(target: ArchiveTarget): Promise<void> {
  try {
  await query(`UPDATE hubspot_archive_review SET restored_at=now(),last_checked_at=now()
    WHERE object_type=$1 AND remote_id=$2 AND restored_at IS NULL`,[target.type,target.id]);
  } catch(error) { if (!isMissingRelation(error)) throw error; }
}
export async function openArchiveReviewCount(): Promise<number | null> {
  try {
  const [row] = await query<{ count: string }>('SELECT count(*)::text AS count FROM hubspot_archive_review WHERE restored_at IS NULL');
  return Number(row.count);
  } catch(error) { if (isMissingRelation(error)) return null; throw error; }
}
