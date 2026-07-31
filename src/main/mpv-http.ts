export function mpvAuthorizationHeaderField(value: string): string {
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();
  if (!normalized) {
    throw new Error('The Jellyfin authorization header is missing.');
  }
  return /^authorization\s*:/i.test(normalized)
    ? normalized
    : `Authorization: ${normalized}`;
}
