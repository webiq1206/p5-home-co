/** Dial links. Callers keep their own display text.
 * 10 digits are a US number (`+1`). 11 digits starting with 1 keep that country code.
 * A leading `+` with 8–15 digits is kept. Anything else is no link. */
export function phoneHref(value: string, scheme: 'tel' | 'sms' = 'tel'): string {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `${scheme}:+${digits}`;
  if (digits.length === 10) return `${scheme}:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `${scheme}:+${digits}`;
  return '';
}
