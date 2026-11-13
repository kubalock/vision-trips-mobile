/** Optional build-time allow-list, e.g. `ng build --define VISION_TRIP_LINK_HOSTS="'trips.example.com'"` (comma-separated). */
declare const VISION_TRIP_LINK_HOSTS: string | undefined;

const INVITATION = /^vt_[A-Za-z0-9_-]{32}$/;
/** Older signed links: `payload.signature`, both base64url. */
const LEGACY = /^[A-Za-z0-9_-]{2,2048}\.[A-Za-z0-9_-]{2,256}$/;
const TRIP_PATH = /\/trip\/([^/?#]+)\/?$/;

export type TripLink = { kind: 'invitation'; token: string } | { kind: 'legacy'; token: string };

/**
 * Reads a trip link handed to the app by the OS (Universal Link / App Link, warm or cold launch) or found in the
 * browser address bar. Only `https://<allowed host>/trip/<token>` is accepted (plain http only for local hosts), and
 * only a well-formed token is returned: anything else — another path, a query-string token, a custom scheme, an
 * unknown host — is ignored, so another app cannot push arbitrary input into the invitation flow.
 */
export function tripLinkFromUrl(url: string, allowedHosts: readonly string[] = configuredHosts()): TripLink | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) return null;
  if (parsed.username || parsed.password) return null;
  if (allowedHosts.length && !localHost && !allowedHosts.includes(parsed.hostname.toLowerCase())) return null;
  return tripLinkFromPath(parsed.pathname);
}

/** The token in a `/trip/<token>` path, if it is well formed. */
export function tripLinkFromPath(pathname: string): TripLink | null {
  const match = TRIP_PATH.exec(pathname);
  if (!match) return null;
  let token: string;
  try { token = decodeURIComponent(match[1]); } catch { return null; }
  if (INVITATION.test(token)) return { kind: 'invitation', token };
  if (LEGACY.test(token)) return { kind: 'legacy', token };
  return null;
}

function configuredHosts(): string[] {
  const value = typeof VISION_TRIP_LINK_HOSTS === 'string' ? VISION_TRIP_LINK_HOSTS : '';
  return value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
}
