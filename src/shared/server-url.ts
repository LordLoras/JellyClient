import type { ServerProfile } from './contracts.js';

export function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
export function buildServerUrl(profile: ServerProfile): string {
  const host = profile.host.trim().replace(/^\[|\]$/g, '');
  const bracketedHost = host.includes(':') ? `[${host}]` : host;
  const defaultPort =
    (profile.protocol === 'http' && profile.port === 80) ||
    (profile.protocol === 'https' && profile.port === 443);
  const port = defaultPort ? '' : `:${profile.port}`;
  return `${profile.protocol}://${bracketedHost}${port}${normalizeBasePath(profile.basePath)}`;
}
