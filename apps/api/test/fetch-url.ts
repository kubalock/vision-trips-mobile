/** The URL a mocked `fetch` was called with, whichever form it was passed in. */
export function fetchUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
