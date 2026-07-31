import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, initialPlaybackState } from '../shared/defaults.js';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => 'C:\\JellyClient'
  }
}));

import { MpvService } from './mpv-service.js';

describe('MPV lifecycle events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses MPV file_error and leaves playback in an actionable error state', () => {
    const events = { emitClient: vi.fn() };
    const service = new MpvService(
      { settings: structuredClone(defaultSettings) } as never,
      events as never
    );
    const internal = service as unknown as {
      stateValue: typeof initialPlaybackState;
      playbackGenerations: {
        beginLoad(generation: number): void;
      };
      onMessage(message: Record<string, unknown>): void;
    };
    internal.stateValue = {
      ...structuredClone(initialPlaybackState),
      generation: 3,
      status: 'loading'
    };
    internal.playbackGenerations.beginLoad(3);
    internal.onMessage({ event: 'start-file', playlist_entry_id: 41 });

    let ended: unknown = null;
    service.on('end-file', (event) => {
      ended = event;
    });
    internal.onMessage({
      event: 'end-file',
      reason: 'error',
      playlist_entry_id: 41,
      file_error: 'loading failed'
    });

    expect(service.state.status).toBe('error');
    expect(service.state.error).toBe(
      'MPV could not play this item: loading failed'
    );
    expect(ended).toEqual({
      generation: 3,
      playlistEntryId: 41,
      reason: 'error',
      error: 'loading failed'
    });
    expect(events.emitClient).toHaveBeenCalledWith({
      type: 'notice',
      data: {
        level: 'error',
        message: 'MPV could not play this item: loading failed'
      }
    });
  });

  it('does not let an old replaced file stop the current generation', () => {
    const service = new MpvService(
      { settings: structuredClone(defaultSettings) } as never,
      { emitClient: vi.fn() } as never
    );
    const internal = service as unknown as {
      stateValue: typeof initialPlaybackState;
      playbackGenerations: {
        beginLoad(generation: number): void;
      };
      onMessage(message: Record<string, unknown>): void;
    };
    internal.stateValue = {
      ...structuredClone(initialPlaybackState),
      generation: 1,
      status: 'playing'
    };
    internal.playbackGenerations.beginLoad(1);
    internal.onMessage({ event: 'start-file', playlist_entry_id: 10 });
    internal.stateValue = {
      ...internal.stateValue,
      generation: 2,
      status: 'loading'
    };
    internal.playbackGenerations.beginLoad(2);

    internal.onMessage({
      event: 'end-file',
      reason: 'stop',
      playlist_entry_id: 10
    });

    expect(service.state.generation).toBe(2);
    expect(service.state.status).toBe('loading');
  });

  it('does not overwrite a fast asynchronous load failure with loading', async () => {
    const service = new MpvService(
      { settings: structuredClone(defaultSettings) } as never,
      { emitClient: vi.fn() } as never
    );
    const internal = service as unknown as {
      capabilityValue: {
        available: boolean;
        executablePath: string | null;
        version: string | null;
        error: string | null;
      };
      ensureRunning(path: string): Promise<void>;
      command(command: unknown[]): Promise<unknown>;
      onMessage(message: Record<string, unknown>): void;
    };
    internal.capabilityValue = {
      available: true,
      executablePath: 'C:\\mpv.exe',
      version: 'test',
      error: null
    };
    internal.ensureRunning = vi.fn(async () => undefined);
    internal.command = vi.fn(async (command: unknown[]) => {
      if (command[0] === 'loadfile') {
        internal.onMessage({ event: 'start-file', playlist_entry_id: 9 });
        internal.onMessage({
          event: 'end-file',
          reason: 'error',
          playlist_entry_id: 9,
          file_error: 'loading failed'
        });
      }
      return null;
    });

    const state = await service.load({
      url: 'https://example.invalid/video.mkv',
      authorizationHeader: 'MediaBrowser Client="test"',
      title: 'Test',
      startSeconds: 0,
      fullscreen: false,
      paused: false,
      externalSubtitle: null
    });

    expect(state.status).toBe('error');
    expect(state.error).toContain('loading failed');
  });
});
