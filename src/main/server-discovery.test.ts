import {
  describe,
  expect,
  it
} from 'vitest';
import { parseDiscoveryPacket } from './server-discovery.js';

describe('Jellyfin server discovery packets', () => {
  it('maps a valid server announcement', () => {
    expect(parseDiscoveryPacket(JSON.stringify({
      Address: 'http://192.168.1.20:8096/',
      Id: 'server-1',
      Name: 'Living Room',
      EndpointAddress: '192.168.1.20'
    }))).toEqual({
      address: 'http://192.168.1.20:8096',
      endpointAddress: '192.168.1.20',
      id: 'server-1',
      name: 'Living Room'
    });
  });

  it('ignores malformed and non-http announcements', () => {
    expect(parseDiscoveryPacket('{broken')).toBeNull();
    expect(parseDiscoveryPacket(JSON.stringify({
      Address: 'file:///server',
      Id: 'server-1',
      Name: 'Bad'
    }))).toBeNull();
  });
});
