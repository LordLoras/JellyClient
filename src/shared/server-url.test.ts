import { describe, expect, it } from 'vitest';
import {
  buildServerUrl,
  normalizeBasePath
} from './server-url.js';

describe('server URL construction', () => {
  it('builds the default Jellyfin LAN URL', () => {
    expect(buildServerUrl({
      protocol: 'http',
      host: '192.168.1.20',
      port: 8096,
      basePath: '',
      username: 'viewer',
      displayName: 'Home'
    })).toBe('http://192.168.1.20:8096');
  });

  it('normalizes a reverse-proxy base path', () => {
    expect(normalizeBasePath('///jellyfin/')).toBe('/jellyfin');
  });

  it('brackets IPv6 addresses', () => {
    expect(buildServerUrl({
      protocol: 'https',
      host: '2001:db8::1',
      port: 443,
      basePath: '/media',
      username: 'viewer',
      displayName: 'Home'
    })).toBe('https://[2001:db8::1]/media');
  });
});
