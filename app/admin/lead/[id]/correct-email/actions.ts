'use server';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '../../../../lib/auth.ts';
import { correctHeldEmail, type EmailCorrectionResult } from '../../../../lib/leads/correct-held-email.ts';
export async function correctEmailAction(_previous: EmailCorrectionResult | null, form: FormData): Promise<EmailCorrectionResult> {
  const actor = await getSessionUser();
  if (!actor || actor.role !== 'administrator' || !actor.isActive) return { ok: false, message: 'Administrator access is required.' };
  const dealId = Number(form.get('dealId'));
  const email = form.get('email'); const expectedFingerprint = form.get('expectedFingerprint');
  if (typeof email !== 'string' || typeof expectedFingerprint !== 'string') return { ok: false, message: 'Reload this lead before saving.' };
  try {
    const result = await correctHeldEmail(actor, { dealId, email, expectedFingerprint });
    if (result.ok) { revalidatePath(`/admin/lead/${dealId}`); revalidatePath('/admin/finance/health'); }
    return result;
  } catch {
    return { ok: false, message: 'Could not confirm the save. Reload this lead before trying again.' };
  }
}
