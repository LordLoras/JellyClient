const HTTP_URL = /^https?:\/\//i;

/**
 * Resolve bridge-owned paths against the document base.
 */
export function bridgeUrl(path: string): string {
  if (HTTP_URL.test(path)) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, document.baseURI).toString();
}

export function pcUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.hostname = 'localhost';
  return url.toString();
}
