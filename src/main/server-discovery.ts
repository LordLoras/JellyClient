import { createSocket } from 'node:dgram';
import type { DiscoveredServer } from '@shared/contracts.js';

const DISCOVERY_PORT = 7_359;
const DISCOVERY_MESSAGE = Buffer.from('Who is JellyfinServer?', 'utf8');

interface DiscoveryPacket {
  Address?: unknown;
  Id?: unknown;
  Name?: unknown;
  EndpointAddress?: unknown;
}

export function parseDiscoveryPacket(
  packet: Buffer | string
): DiscoveredServer | null {
  try {
    const raw = JSON.parse(packet.toString()) as DiscoveryPacket;
    if (
      typeof raw.Address !== 'string' ||
      !/^https?:\/\//i.test(raw.Address) ||
      typeof raw.Id !== 'string' ||
      typeof raw.Name !== 'string'
    ) return null;
    return {
      id: raw.Id,
      name: raw.Name,
      address: raw.Address.replace(/\/$/, ''),
      endpointAddress:
        typeof raw.EndpointAddress === 'string'
          ? raw.EndpointAddress
          : null
    };
  } catch {
    return null;
  }
}

export function discoverJellyfinServers(
  timeoutMs = 1_500
): Promise<DiscoveredServer[]> {
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const servers = new Map<string, DiscoveredServer>();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // A bind failure can close the socket before discovery starts.
      }
      resolve([...servers.values()].sort((left, right) =>
        left.name.localeCompare(right.name)
      ));
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on('message', (packet) => {
      const server = parseDiscoveryPacket(packet);
      if (server) servers.set(server.id || server.address, server);
    });
    socket.on('error', () => {
      finish();
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        socket.send(
          DISCOVERY_MESSAGE,
          DISCOVERY_PORT,
          '255.255.255.255'
        );
      } catch {
        finish();
      }
    });
  });
}
