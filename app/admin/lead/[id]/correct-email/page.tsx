import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getSessionUser } from '../../../../lib/auth.ts';
import { query, isMissingRelation } from '../../../../lib/db.ts';
import EmailCorrectionForm from './EmailCorrectionForm.tsx';
import './correction.css';
export const dynamic = 'force-dynamic';
export default async function CorrectEmailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !user.isActive) redirect('/admin/login');
  if (user.role !== 'administrator') notFound();
  const { id } = await params; const dealId = Number(id);
  if (!Number.isSafeInteger(dealId) || dealId<=0) notFound();
  let unavailable = false;
  let rows: { email: string | null; fingerprint: string; linked: string }[];
  try {
    rows = await query(`SELECT c.email,r.input_fingerprint AS fingerprint,
      (SELECT count(*)::text FROM deal sibling WHERE sibling.contact_id=c.id) AS linked
      FROM deal d JOIN contact c ON c.id=d.contact_id JOIN hubspot_lead_review r ON r.deal_id=d.id
      WHERE d.id=$1 AND r.reason='invalid_email' AND r.released_at IS NULL`, [dealId]);
  } catch(error) { if (!isMissingRelation(error)) throw error; unavailable=true; rows=[]; }
  const row=rows[0];
  return <main className="admin-main correction-main">
    <Link href={`/admin/lead/${dealId}`} className="correction-back">Back to lead {dealId}</Link>
    <h1>Correct email</h1>
    {row ? <><p>Save locally for the next scheduled HubSpot retry.</p>
      {Number(row.linked)>1 && <p>Updates all {row.linked} linked leads.</p>}
      <EmailCorrectionForm dealId={dealId} email={row.email ?? ''} fingerprint={row.fingerprint} />
    </> : <p>{unavailable ? "Review data is unavailable. Check migration 031 before correcting this contact." : "No open rejected-email review is available. Return to the lead or check integration health."}</p>}
  </main>;
}
