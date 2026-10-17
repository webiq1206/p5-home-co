/** US dial links. Callers keep their own display text; the href is always E.164. */
export function phoneHref(value: string, scheme: 'tel' | 'sms' = 'tel'): string {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) throw new Error('Phone links use a 10-digit US number.');
  return `${scheme}:+1${national}`;
}
