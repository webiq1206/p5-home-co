import { normalizeEmail } from '../leads/normalize.ts';
import { createHash } from 'node:crypto';
import { query, transaction } from '../db.ts';
export type LeadReviewReason = 'invalid_email' | 'archived_contact';
/** Accept only structured provider validation for the email property. Never match arbitrary message substrings. */
export function providerRejectedEmail(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const value=body as {errors?: unknown; message?: unknown};
  if (Array.isArray(value.errors) && value.errors.some(item=>{
    if (!item || typeof item!=='object') return false;
    const error=item as {code?:unknown;context?:{propertyName?:unknown}};
    return error.code==='INVALID_EMAIL' && Array.isArray(error.context?.propertyName) && error.context.propertyName.includes('email');
  })) return true;
  const prefix='Property values were not valid: ';
  if (typeof value.message!=='string' || !value.message.startsWith(prefix)) return false;
  try {
    const details: unknown=JSON.parse(value.message.slice(prefix.length));
    return Array.isArray(details) && details.some(item=>item && typeof item==='object' && item.isValid===false && item.error==='INVALID_EMAIL' && item.name==='email');
  } catch { return false; }
}
export class HubSpotLeadReviewError extends Error {
  readonly reason: LeadReviewReason;
  readonly contactId: string | null;
  constructor(reason: LeadReviewReason, contactId: string | null = null) {
    super(`HubSpot review required: ${reason}. Original lead and references preserved.`);
    this.reason = reason; this.contactId = contactId;
  }
}
export function validCorrectionEmail(raw: string | null): string | null {
  const email = normalizeEmail(raw);
  if (!email || email.length > 254 || email.split('@')[0].length > 64) return null;
  return email;
}
export const emailFingerprint = (email: string | null) => createHash('sha256').update(JSON.stringify(email)).digest('hex');
export async function holdLeadReview(dealId: number, error: HubSpotLeadReviewError, email: string | null) {
  await query(`INSERT INTO hubspot_lead_review(deal_id,reason,input_fingerprint,remote_contact_id,next_check_at)
    VALUES($1,$2,$3,$4,now()+interval '24 hours') ON CONFLICT(deal_id) DO UPDATE SET
    reason=EXCLUDED.reason,input_fingerprint=EXCLUDED.input_fingerprint,remote_contact_id=EXCLUDED.remote_contact_id,
    confirmed_at=now(),last_checked_at=now(),next_check_at=EXCLUDED.next_check_at,released_at=NULL`,
    [dealId,error.reason,error.reason==='invalid_email'?emailFingerprint(email):null,error.contactId]);
}
export async function heldLeadReview(dealId: number, email: string | null): Promise<boolean> {
  const [row] = await query<{reason: LeadReviewReason; input_fingerprint: string | null}>(
    'SELECT reason,input_fingerprint FROM hubspot_lead_review WHERE deal_id=$1 AND released_at IS NULL',[dealId]);
  if (!row) return false;
  if (row.reason==='invalid_email' && validCorrectionEmail(email) && row.input_fingerprint!==emailFingerprint(email)) {
    return !(await releaseLeadReview(dealId, "invalid_email", row.input_fingerprint));
  }
  return true;
}
async function releaseLeadReview(dealId: number, reason: LeadReviewReason, expected: string | null) {
  return transaction(async client => {
    // Lock the current linkage as well as the review transition. An old restored
    // contact must never release a hold after someone relinks the local lead.
    const source=await client.query<{hubspot_contact_id:string|null;email:string|null;lead_source:string}>(
      `SELECT c.hubspot_contact_id,c.email,d.lead_source FROM deal d JOIN contact c ON c.id=d.contact_id
       WHERE d.id=$1 FOR UPDATE OF d,c`,[dealId]);
    const current=source.rows[0];
    if (!current) return false;
    if (reason==='archived_contact' && current.hubspot_contact_id!==expected) return false;
    if (reason==='invalid_email') {
      const email=current.lead_source==='Facebook Lead Ad'?normalizeEmail(current.email):current.email;
      if (!validCorrectionEmail(email) || emailFingerprint(email)===expected) return false;
    }
    const released=await client.query(`UPDATE hubspot_lead_review SET released_at=now(),last_checked_at=now()
      WHERE deal_id=$1 AND released_at IS NULL AND reason=$2
        AND CASE WHEN reason='invalid_email' THEN input_fingerprint ELSE remote_contact_id END IS NOT DISTINCT FROM $3
      RETURNING deal_id`,[dealId,reason,expected]);
    if (!released.rows.length) return false;
    // Both changes commit together; neither can survive a failed second update.
    await client.query('UPDATE lead_hubspot_retry SET next_attempt_at=now() WHERE deal_id=$1',[dealId]);
    return true;
  });
}
export async function recheckLeadReviews(readContact: (id: string)=>Promise<{archived?: boolean}>) {
  const rows = await query<{deal_id: string;reason: LeadReviewReason;remote_contact_id: string|null;email: string|null;lead_source: string;due: boolean}>(
    `SELECT r.deal_id,r.reason,r.remote_contact_id,c.email,d.lead_source,r.next_check_at<=now() AS due
     FROM hubspot_lead_review r JOIN deal d ON d.id=r.deal_id JOIN contact c ON c.id=d.contact_id
     WHERE r.released_at IS NULL ORDER BY r.last_checked_at,r.deal_id LIMIT 25`);
  const contacts = new Map<string, Promise<{archived?: boolean}>>();
  for (const row of rows) {
    try {
      if (row.reason==='invalid_email') await heldLeadReview(Number(row.deal_id),row.lead_source==='Facebook Lead Ad'?normalizeEmail(row.email):row.email);
      else if (row.due && row.remote_contact_id) {
        let reading=contacts.get(row.remote_contact_id);
        if (!reading) { reading=readContact(row.remote_contact_id); contacts.set(row.remote_contact_id,reading); }
        const contact=await reading;
        if (contact.archived===false) await releaseLeadReview(Number(row.deal_id), "archived_contact", row.remote_contact_id);
      }
    } catch { /* Absence or unavailable access never proves a restored contact. */ }
    finally {
      await query(`UPDATE hubspot_lead_review SET last_checked_at=now(),
        next_check_at=CASE WHEN reason='archived_contact' AND $2 THEN now()+interval '24 hours' ELSE next_check_at END
        WHERE deal_id=$1`,[row.deal_id,row.due]);
    }
  }
}
export async function openLeadReviewCount() {
  const [row]=await query<{count:string}>('SELECT count(*)::text AS count FROM hubspot_lead_review WHERE released_at IS NULL');
  return Number(row.count);
}
