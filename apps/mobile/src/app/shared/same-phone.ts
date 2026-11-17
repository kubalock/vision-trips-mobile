/** True when two phone numbers (or tel: links) ring the same line, ignoring spaces, punctuation and a +44 prefix. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const digits = (value: string | null | undefined) => (value ?? '').replace(/^tel:/i, '').trim().replace(/^\+44/, '0').replace(/\D/g, '');
  return Boolean(digits(a)) && digits(a) === digits(b);
}
