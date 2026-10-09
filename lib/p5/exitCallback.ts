/** US callback numbers, normalized without silently truncating an extension. */
export function callbackPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\+?[\d\s().-]{7,30}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null;
}

export const EXIT_CALLBACK_FLOW = 'p5-exit';
export const EXIT_OFFER_SESSION_KEY = 'p5-exit-offer-v1';

/** No scope text, contact fields, filenames, tokens or query parameters. */
export function callbackContext(draft: {id: string; revision: number; answers: {service?: string}}): string {
  const id = /^[a-f0-9-]{16,64}$/i.test(draft.id) ? draft.id : 'unavailable';
  const service = draft.answers.service?.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'not selected';
  return `Explicit request for a phone call about this project; no marketing consent. Draft: ${id}. Saved revision: ${Number.isSafeInteger(draft.revision) ? draft.revision : 0}. Service: ${service}. This is a callback request, not a completed quote submission.`;
}
