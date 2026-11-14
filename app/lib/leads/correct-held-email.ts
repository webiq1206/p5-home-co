/** Local correction only. Scheduled integration owns delivery and hold release. */
import { normalizeEmail } from './normalize.ts';
import { transaction } from '../db.ts';
import { emailFingerprint, validCorrectionEmail } from '../integrations/hubspot-lead-review.ts';
export type EmailCorrectionResult = { ok: boolean; message: string };
export type CorrectionActor = { id: number; role: string; isActive: boolean } | null;
const fail = (message: string): EmailCorrectionResult => ({ ok: false, message });
export async function correctHeldEmail(actor: CorrectionActor, input: { dealId: number; email: string; expectedFingerprint: string }): Promise<EmailCorrectionResult> {
  if (!actor || actor.role !== 'administrator' || !actor.isActive) return fail('Administrator access is required.');
  const email = validCorrectionEmail(input.email);
  if (!email) return fail('Use a valid email; at most 64 characters before @.');
  if (!Number.isSafeInteger(input.dealId) || input.dealId <= 0 || !/^[a-f0-9]{64}$/.test(input.expectedFingerprint)) return fail('Reload this lead before saving.');
  try {
    return await transaction(async client => {
      const auth = await client.query("SELECT id FROM app_user WHERE id=$1 AND role='administrator' AND is_active=TRUE AND COALESCE((to_jsonb(app_user)->>'scopes_only')::boolean,false)=FALSE FOR SHARE", [actor.id]);
      if (!auth.rows.length) return fail('Administrator access is required.');
      const found = await client.query<{ contact_id: string; email: string | null; fingerprint: string; lead_source: string; hubspot_contact_id: string | null }>(
        `SELECT c.id AS contact_id,c.email,r.input_fingerprint AS fingerprint,d.lead_source,c.hubspot_contact_id FROM deal d
         JOIN contact c ON c.id=d.contact_id JOIN hubspot_lead_review r ON r.deal_id=d.id
         WHERE d.id=$1 AND r.reason='invalid_email' AND r.released_at IS NULL FOR UPDATE OF d,c,r`, [input.dealId]);
      const row = found.rows[0];
      if (!row) return fail('No open rejected-email review exists for this lead.');
      const sentEmail = row.lead_source === 'Facebook Lead Ad' ? normalizeEmail(row.email) : row.email;
      if (row.fingerprint !== input.expectedFingerprint || emailFingerprint(sentEmail) !== input.expectedFingerprint) return fail('Contact or review changed. Reload before saving.');
      if (emailFingerprint(email) === row.fingerprint) return fail('Enter a corrected email, not the rejected address.');
      const linked = await client.query<{ busy: boolean }>('SELECT hubspot_sync_lease_until>now() AS busy FROM deal WHERE contact_id=$1 FOR UPDATE', [row.contact_id]);
      if (linked.rows.some(r => r.busy)) return fail('This contact is syncing. Wait briefly, then reload.');
      const duplicate = await client.query('SELECT id FROM contact WHERE id<>$1 AND (identity_key=$2 OR lower(btrim(email))=$3) LIMIT 1', [row.contact_id, `email:${email}`, email]);
      if (duplicate.rows.length) return fail('Email belongs to another contact. Review before saving.');
      await client.query('UPDATE contact SET email=$2,identity_key=$3,updated_at=now() WHERE id=$1', [row.contact_id,email,`email:${email}`]);
      await client.query(`INSERT INTO audit_log(user_id,record_type,record_id,action,previous_value,new_value,action_source)
        VALUES($1,'contact',$2,'rejected_email_corrected',$3::jsonb,$4::jsonb,'admin_ui')`,
        [actor.id,row.contact_id,JSON.stringify({ emailFingerprint: row.fingerprint }),JSON.stringify({ emailFingerprint: emailFingerprint(email), dealId: input.dealId })]);
      // Do not release holds, reset retries, change remote IDs or call a provider here.
      return { ok: true, message: 'Email saved locally. Scheduled sync will check the correction before retrying.' };
    });
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return fail('That email now belongs to another contact. Reload and review.');
    throw error;
  }
}
