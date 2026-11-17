/**
 * Small formatting rules shared by the API and the app, so a masked email, a terminal or a points count reads the
 * same everywhere. Pure functions, no dependencies.
 */

/**
 * An email with only its first and last letter shown, and a fixed-length mask so the length isn't revealed:
 * "d•••a@yahoo.com". Very short names show the first letter only. Returns null for anything that isn't an email.
 */
export function maskEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const chars = [...local];
  return chars.length >= 3 ? `${chars[0]}•••${chars[chars.length - 1]}@${domain}` : `${chars[0]}•••@${domain}`;
}

/** "···876": the last three characters of a passport or licence number; null when there is nothing to show. */
export function maskDocumentNumber(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9]/g, '');
  return cleaned.length >= 4 ? `···${cleaned.slice(-3).toUpperCase()}` : null;
}

const NAMED_TERMINALS = ['north', 'south', 'east', 'west', 'international', 'domestic', 'main', 'central'];

/**
 * One style for terminals however they were typed: "5", "T5", "t 5", "Terminal 5" → "T5"; "2a", "Terminal 2A" → "T2A";
 * "North", "North Terminal" → "North". Anything else (long text, sentences) → null, so a note is never shown as a
 * terminal.
 */
export function normalizeTerminal(value: unknown): string | null {
  const text = (Array.isArray(value) ? value[0] : value);
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const raw = String(text).trim().replace(/\s+/g, ' ');
  if (!raw || raw.length > 24) return null;
  const numbered = /^(?:t(?:erminal|ml)?\.?\s*)?(\d{1,2}[a-z]?)$/i.exec(raw);
  if (numbered) return `T${numbered[1]!.toUpperCase()}`;
  const named = /^(?:terminal\s+)?([a-z]+)(?:\s+terminal)?$/i.exec(raw);
  if (named && NAMED_TERMINALS.includes(named[1]!.toLowerCase())) return named[1]!.charAt(0).toUpperCase() + named[1]!.slice(1).toLowerCase();
  return null;
}

/**
 * A terminal mentioned in an element's own text ("check in at Terminal 3", "arrives Terminal 1"). Only used when the
 * booking has no explicit terminal field; returns null when the text is ambiguous (two different terminals).
 */
export function terminalFromNotes(text: string | null | undefined, direction: 'departure' | 'arrival'): string | null {
  if (!text) return null;
  const pattern = direction === 'departure'
    ? /\b(?:check(?:-|\s)?in(?:\s+(?:at|in))?|depart(?:s|ing|ure)?(?:\s+(?:from|at))?|from)\s+terminal\s+([0-9]{1,2}[a-z]?|[a-z]+)\b/gi
    : /\b(?:arriv(?:es|ing|al)?(?:\s+(?:at|in|into))?|lands?(?:\s+(?:at|in))?|into)\s+terminal\s+([0-9]{1,2}[a-z]?|[a-z]+)\b/gi;
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const terminal = normalizeTerminal(match[1]);
    if (terminal) found.add(terminal);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** "1 point", "2,500 points". */
export function formatPoints(points: number): string {
  return `${new Intl.NumberFormat('en-GB').format(points)} ${Math.abs(points) === 1 ? 'point' : 'points'}`;
}

/** True when the passport expires before six months after the return (or departure) date, or is already expired. */
export function passportExpiresTooSoon(expiry: string | null | undefined, returnDate: string | null | undefined, today = new Date()): boolean {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}/.test(expiry)) return false;
  const reference = returnDate && /^\d{4}-\d{2}-\d{2}/.test(returnDate) ? new Date(`${returnDate.slice(0, 10)}T00:00:00Z`) : today;
  const limit = new Date(reference);
  limit.setUTCMonth(limit.getUTCMonth() + 6);
  return new Date(`${expiry.slice(0, 10)}T00:00:00Z`).getTime() < limit.getTime();
}
