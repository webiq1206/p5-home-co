import Link from 'next/link';
import { query } from '../../../lib/db.ts';

function reviewTime(value: string): string {
  return new Date(value).toLocaleString('en-US', { timeZone: 'America/Boise', timeZoneName: 'short' });
}

export default async function HubSpotArchiveReview() {
  let rows: { object_type: string; remote_id: string; next_check_at: string; confirmed_at: string; last_checked_at: string; deal_id: string | null }[];
  try {
    rows = await query(`SELECT r.object_type,r.remote_id,r.next_check_at,r.confirmed_at,r.last_checked_at,d.id::text AS deal_id
      FROM hubspot_archive_review r LEFT JOIN deal d ON
      (r.object_type='deals' AND d.hubspot_deal_id=r.remote_id) OR
      (r.object_type='tasks' AND EXISTS (SELECT 1 FROM lead_alert_incident i WHERE i.deal_id=d.id AND i.hubspot_task_id=r.remote_id))
      WHERE r.restored_at IS NULL ORDER BY r.object_type,r.remote_id,d.id`);
  } catch {
    return <section className="fin-section"><h2>HubSpot archive review</h2><p>Review records unavailable. Check the database and archive-review migration; this is not an all-clear.</p></section>;
  }
  return <section className="fin-section"><h2>HubSpot archive review</h2>
    <p>Confirmed archived counterparts are held for review, not resolved or deleted locally. No automatic restoration, replacement or task completion. Read-only restoration checks run when due. All times use America/Boise. Test and non-test records are not dismissed automatically.</p>
    {rows.length ? <ul>{rows.map(r=><li key={`${r.object_type}:${r.remote_id}:${r.deal_id}`}>
      {r.object_type} {r.remote_id}: {r.deal_id ? <Link style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }} href={`/admin/lead/${r.deal_id}`}>Review local lead {r.deal_id}</Link> : 'Local reference not found; review required'}. Last confirmed {reviewTime(r.confirmed_at)}. Last checked {reviewTime(r.last_checked_at)}. Next check {reviewTime(r.next_check_at)}.
    </li>)}</ul> : <p>No open confirmed-archive holds. Other integration errors remain separate.</p>}
  </section>;
}
