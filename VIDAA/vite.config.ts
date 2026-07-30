import {
  createReadStream,
  existsSync
} from 'node:fs';
import {
  readFile,
  stat,
  writeFile
} from 'node:fs/promises';
import type {
  IncomingMessage,
  ServerResponse
} from 'node:http';
import { networkInterfaces } from 'node:os';
import {
  extname,
  resolve
} from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import {
  defineConfig,
  type Plugin
} from 'vite';
import type {
  ExpectedSignal,
  ProbeConfig,
  ProbeSourceKind,
  StoredProbeSource
} from './src/types.js';

const PROBE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_CONFIG_PATH = resolve(PROBE_ROOT, 'probe-media.local.json');
const DEFAULT_FIRMWARE = 'v01.09.60V.Q0618';
const EXPECTED_SIGNALS = new Set<ExpectedSignal>([
  'SDR',
  'HDR10',
  'Dolby Vision P5',
  'Dolby Vision P8.1',
  'Other'
]);
const SOURCE_KINDS = new Set<ProbeSourceKind>(['file', 'url']);

const EMPTY_CONFIG: ProbeConfig = {
  version: 1,
  firmware: DEFAULT_FIRMWARE,
  sources: []
};

interface LoadedConfig {
  config: ProbeConfig;
  error: string | null;
}

function configPath(): string {
  const override = process.env.VIDAA_PROBE_CONFIG_PATH?.trim();
  return override ? resolve(override) : DEFAULT_CONFIG_PATH;
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? '';
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
}

function isPrivateLanAddress(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function text(
  response: ServerResponse,
  status: number,
  body: string
): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(body);
}

function lanUrls(request: IncomingMessage): string[] {
  const host = request.headers.host ?? 'localhost:4173';
  const port = host.includes(':') ? host.slice(host.lastIndexOf(':') + 1) : '4173';
  const networkAddresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) =>
      entry?.family === 'IPv4' &&
      !entry.internal &&
      !entry.address.startsWith('169.254.')
    )
    .map((entry) => entry!.address);
  const privateAddresses = networkAddresses.filter(isPrivateLanAddress);
  const addresses = privateAddresses.length > 0
    ? privateAddresses
    : networkAddresses;

  return [...new Set(addresses)]
    .map((address) => `http://${address}:${port}/`);
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().slice(0, maxLength)
    : '';
}

function sourceId(value: unknown, index: number): string {
  const cleaned = cleanString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `probe-source-${index + 1}`;
}

function parseConfig(input: unknown): ProbeConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('The probe configuration must be a JSON object.');
  }

  const candidate = input as {
    firmware?: unknown;
    sources?: unknown;
  };
  if (!Array.isArray(candidate.sources)) {
    throw new Error('The probe configuration must contain a sources array.');
  }

  const seenIds = new Set<string>();
  const sources: StoredProbeSource[] = candidate.sources
    .slice(0, 30)
    .map((source, index) => {
      if (!source || typeof source !== 'object') {
        throw new Error(`Source ${index + 1} is not valid.`);
      }
      const raw = source as Partial<StoredProbeSource>;
      let id = sourceId(raw.id || raw.label, index);
      while (seenIds.has(id)) id = `${id}-${index + 1}`;
      seenIds.add(id);

      const expected = EXPECTED_SIGNALS.has(raw.expected as ExpectedSignal)
        ? raw.expected as ExpectedSignal
        : 'Other';
      const kind = SOURCE_KINDS.has(raw.kind as ProbeSourceKind)
        ? raw.kind as ProbeSourceKind
        : 'file';

      return {
        id,
        label: cleanString(raw.label, 100) || `Test source ${index + 1}`,
        expected,
        kind,
        location: cleanString(raw.location, 4096),
        notes: cleanString(raw.notes, 300)
      };
    });

  return {
    version: 1,
    firmware: cleanString(candidate.firmware, 100) || DEFAULT_FIRMWARE,
    sources
  };
}

async function loadConfig(): Promise<LoadedConfig> {
  const path = configPath();
  if (!existsSync(path)) {
    return {
      config: structuredClone(EMPTY_CONFIG),
      error: null
    };
  }

  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return {
      config: parseConfig(parsed),
      error: null
    };
  } catch (error) {
    return {
      config: structuredClone(EMPTY_CONFIG),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 256 * 1024) {
        reject(new Error('Configuration payload is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Configuration payload is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

async function publicPayload(request: IncomingMessage) {
  const loaded = await loadConfig();
  const sources = await Promise.all(
    loaded.config.sources
      .filter((source) => source.location.length > 0)
      .map(async (source) => {
        if (source.kind === 'url') {
          let host: string | null = null;
          try {
            const parsed = new URL(source.location);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              host = parsed.host;
            }
          } catch {
            // A source can remain in setup while its URL is being edited.
          }
          const valid = host !== null;
          return {
            id: source.id,
            label: source.label,
            expected: source.expected,
            kind: source.kind,
            notes: source.notes,
            playbackUrl: valid ? source.location : null,
            available: valid,
            detail: host ?? 'Enter a complete http:// or https:// URL'
          };
        }

        let available = false;
        let detail = 'Local file is unavailable';
        try {
          const info = await stat(source.location);
          available = info.isFile();
          detail = available
            ? `${extname(source.location).slice(1).toUpperCase() || 'FILE'} · ${formatBytes(info.size)}`
            : 'Configured path is not a file';
        } catch {
          // The public response deliberately does not expose the PC file path.
        }

        return {
          id: source.id,
          label: source.label,
          expected: source.expected,
          kind: source.kind,
          notes: source.notes,
          playbackUrl: available
            ? `/__vidaa_probe_media/${encodeURIComponent(source.id)}`
            : null,
          available,
          detail
        };
      })
  );

  return {
    firmware: loaded.config.firmware,
    sources,
    lanUrls: lanUrls(request),
    configError: loaded.error
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    '.avi': 'video/x-msvideo',
    '.m2ts': 'video/mp2t',
    '.m4v': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.ts': 'video/mp2t',
    '.webm': 'video/webm'
  };
  return types[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  id: string
): Promise<void> {
  const loaded = await loadConfig();
  const source = loaded.config.sources.find((item) =>
    item.id === id && item.kind === 'file'
  );
  if (!source) {
    text(response, 404, 'Probe media source was not found.');
    return;
  }

  let info;
  try {
    info = await stat(source.location);
  } catch {
    text(response, 404, 'Configured media file is unavailable.');
    return;
  }
  if (!info.isFile()) {
    text(response, 404, 'Configured media path is not a file.');
    return;
  }

  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': contentType(source.location)
  };
  const range = request.headers.range;

  if (!range) {
    response.writeHead(200, {
      ...commonHeaders,
      'Content-Length': String(info.size)
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(source.location).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, {
      ...commonHeaders,
      'Content-Range': `bytes */${info.size}`
    });
    response.end();
    return;
  }

  const isSuffixRange = !match[1] && Boolean(match[2]);
  const suffixLength = isSuffixRange ? Number(match[2]) : 0;
  const requestedStart = match[1] ? Number(match[1]) : 0;
  const requestedEnd = match[2] && !isSuffixRange
    ? Number(match[2])
    : info.size - 1;
  const start = isSuffixRange
    ? Math.max(0, info.size - suffixLength)
    : Math.max(0, requestedStart);
  const end = Math.min(info.size - 1, requestedEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    response.writeHead(416, {
      ...commonHeaders,
      'Content-Range': `bytes */${info.size}`
    });
    response.end();
    return;
  }

  response.writeHead(206, {
    ...commonHeaders,
    'Content-Length': String(end - start + 1),
    'Content-Range': `bytes ${start}-${end}/${info.size}`
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(source.location, {
    start,
    end
  }).pipe(response);
}

function probeServerPlugin(): Plugin {
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void
  ) => {
    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost:4173'}`
    );

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Origin': '*'
      });
      response.end();
      return;
    }

    if (url.pathname === '/api/probe' && request.method === 'GET') {
      json(response, 200, await publicPayload(request));
      return;
    }

    if (url.pathname === '/api/probe/setup') {
      if (!isLoopback(request)) {
        text(response, 403, 'Probe setup is only available from this PC.');
        return;
      }

      if (request.method === 'GET') {
        const loaded = await loadConfig();
        json(response, 200, {
          ...loaded.config,
          configPath: configPath(),
          lanUrls: lanUrls(request),
          configError: loaded.error
        });
        return;
      }

      if (request.method === 'PUT') {
        try {
          const config = parseConfig(await requestBody(request));
          await writeFile(
            configPath(),
            `${JSON.stringify(config, null, 2)}\n`,
            'utf8'
          );
          json(response, 200, {
            ...config,
            configPath: configPath(),
            lanUrls: lanUrls(request),
            configError: null
          });
        } catch (error) {
          json(response, 400, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }
    }

    const mediaPrefix = '/__vidaa_probe_media/';
    if (
      url.pathname.startsWith(mediaPrefix) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      await serveMedia(
        request,
        response,
        decodeURIComponent(url.pathname.slice(mediaPrefix.length))
      );
      return;
    }

    next();
  };

  return {
    name: 'vidaa-probe-lan-server',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

export default defineConfig({
  root: PROBE_ROOT,
  base: './',
  plugins: [
    react(),
    probeServerPlugin()
  ],
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2018'
  }
});
