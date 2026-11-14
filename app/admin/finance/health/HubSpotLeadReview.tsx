import Link from 'next/link';
import { query } from '../../../lib/db.ts';
export default async function HubSpotLeadReview({ canCorrect = false }: { canCorrect?: boolean }) {
  let rows: { deal_id: string; reason: string; remote_contact_id: string | null }[];
  try {
    rows = await query('SELECT deal_id,reason,remote_contact_id FROM hubspot_lead_review WHERE released_at IS NULL ORDER BY confirmed_at,deal_id');
  } catch {
    return <section className="fin-section"><h2>HubSpot delivery review</h2><p>Delivery review is unavailable. Check migration 031 and database access. This is not an all-clear.</p></section>;
  }
  return <section className="fin-section"><h2>HubSpot delivery review</h2>
    <p>These leads remain visible while delivery waits for correction or confirmed restoration. No lead or contact is deleted.</p>
    {rows.length ? <ul>{rows.map(row=><li key={row.deal_id}>
      <Link style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }} href={`/admin/lead/${row.deal_id}`}>Review lead {row.deal_id}</Link>: {row.reason === 'invalid_email' ? <>
        HubSpot rejected the email. {canCorrect ? <Link style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }} href={`/admin/lead/${row.deal_id}/correct-email`}>Correct email</Link> : 'An administrator must correct the email.'}
      </> : <>
        The linked contact is archived. Review the existing contact in HubSpot; nothing is restored automatically. {row.remote_contact_id && <a style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }} href={`https://app.hubspot.com/contacts/247066159/record/0-1/${encodeURIComponent(row.remote_contact_id)}`}>Open HubSpot contact</a>}
      </>}
    </li>)}</ul> : <p>No open delivery-review holds. Other integration errors remain separate.</p>}
  </section>;
}
