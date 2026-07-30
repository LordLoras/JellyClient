/// <reference types="vite/client" />

import type { JellyClientApi } from '@shared/contracts.js';

declare global {
  interface Window {
    jellyClient: JellyClientApi;
  }
}

export {};
