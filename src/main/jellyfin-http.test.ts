// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const { chromiumFetch } = vi.hoisted(() => ({ chromiumFetch: vi.fn() }));
vi.mock('electron', () => ({ net: { fetch: chromiumFetch } }));

import { createJellyfinHttpClient, jellyfinFetch } from './jellyfin-http.js';

afterEach(() => {
  vi.restoreAllMocks();
  chromiumFetch.mockReset();
});

describe('Jellyfin network transport', () => {
  it('sends SDK JSON requests through Chromium without using Node fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Node fetch must not run'));
    chromiumFetch.mockResolvedValue(new Response('{"Id":"fixture-user"}', {
      headers: { 'Content-Type': 'application/json' }
    }));
    const client = createJellyfinHttpClient(1000);
    const result = await client.get('https://jellyfin.example.test/Users/Me', {
      headers: { Authorization: 'fixture-token' }
    });
    expect(result.data).toEqual({ Id: 'fixture-user' });
    expect(chromiumFetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const call = chromiumFetch.mock.calls.at(0);
    expect(call).toBeDefined();
    const input = call?.[0] as Request;
    expect(input.headers.get('Authorization')).toBe('fixture-token');
  });

  it('uses the same Chromium transport for authenticated media', async () => {
    const response = new Response('fixture-image');
    chromiumFetch.mockResolvedValue(response);
    expect(await jellyfinFetch('https://jellyfin.example.test/image', {
      headers: { Authorization: 'fixture-token' }
    })).toBe(response);
    expect(chromiumFetch).toHaveBeenCalledWith('https://jellyfin.example.test/image', {
      headers: { Authorization: 'fixture-token' }
    });
  });
});
