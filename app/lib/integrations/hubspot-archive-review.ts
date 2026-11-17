/**
 * Which HubSpot deal or task a read was for, so a 404 can be checked against
 * HubSpot's archive (a record the team deleted).
 *
 * This file used to hold "archive reviews": every deleted deal or task was
 * kept as an open review and reported as an integration failure until it was
 * restored in HubSpot. That rule is retired (owner, 17 November 2026): deleting
 * spam in HubSpot is routine. Deletions are now mirrored, see hubspot-removed.ts,
 * which also settles any review rows the old rule left in `hubspot_archive_review`.
 */
export type ArchiveTarget = { type: 'tasks' | 'deals'; id: string };
export function archiveTarget(path: string, method = 'GET'): ArchiveTarget | null {
  if (method !== 'GET' || /(?:[?&])archived=true(?:&|$)/.test(path)) return null;
  const match = /^\/crm\/v3\/objects\/(tasks|deals)\/([^/?]+)(?:\?|$)/.exec(path);
  return match ? { type: match[1] as ArchiveTarget['type'], id: decodeURIComponent(match[2]) } : null;
}
