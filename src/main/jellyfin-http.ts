import { net } from 'electron';
import axios from 'axios';

// Electron's stable releases still embed an affected Node Brotli decoder.
// Keep server-controlled responses on Chromium's network stack, including
// requests made by the SDK, rather than Node's HTTP or global fetch adapters.
export const jellyfinFetch: typeof fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.toString() : input, init);

export function createJellyfinHttpClient(timeout: number) {
  return axios.create({
    timeout,
    adapter: 'fetch',
    env: { fetch: jellyfinFetch }
  });
}
