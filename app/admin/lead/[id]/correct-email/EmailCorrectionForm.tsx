'use client';
import { useActionState } from 'react';
import { correctEmailAction } from './actions.ts';
export default function EmailCorrectionForm({ dealId, email, fingerprint }: { dealId: number; email: string; fingerprint: string }) {
  const [state, action, pending] = useActionState(correctEmailAction, null);
  if (state?.ok) return <p role="status" className="correction-message">{state.message}</p>;
  return <form action={action} className="correction-form">
    <input type="hidden" name="dealId" value={dealId} /><input type="hidden" name="expectedFingerprint" value={fingerprint} />
    <label htmlFor="corrected-email">Correct email</label>
    <input id="corrected-email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={email} required maxLength={254} aria-describedby="email-help email-result" aria-invalid={state && !state.ok ? true : undefined} />
    <p id="email-help">Use a verified address. IDs stay unchanged. No message is sent.</p>
    <p id="email-result" role="status" aria-live="polite">{state?.message ?? ''}</p>
    <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save corrected email'}</button>
  </form>;
}
