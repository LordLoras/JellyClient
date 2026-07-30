const HTTP_URL = /^https?:\/\//i;

/**
 * Resolve bridge-owned paths against the document base. The port-80 TV shell
 * points its base at the local bridge on 4173, while normal development stays
 * on the current origin.
 */
export function bridgeUrl(path: string): string {
  if (HTTP_URL.test(path)) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, document.baseURI).toString();
}
