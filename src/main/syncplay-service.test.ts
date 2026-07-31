import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackState } from '../shared/contracts.js';
import { defaultSettings, initialPlaybackState, initialSyncPlayState } from '../shared/defaults.js';

const syncApi = vi.hoisted(() => ({
  syncPlayPause: vi.fn(async () => undefined),
  syncPlayUnpause: vi.fn(async () => undefined),
  syncPlaySeek: vi.fn(async () => undefined),
  syncPlayReady: vi.fn(async () => undefined),
  syncPlayBuffering: vi.fn(async () => undefined)
}));

vi.mock('@jellyfin/sdk/lib/utils/api/sync-play-api.js', () => ({
  getSyncPlayApi: () => syncApi
}));

import { SyncPlayService } from './syncplay-service.js';

class FakeMpv extends EventEmitter {
  state: PlaybackState = {
    ...structuredClone(initialPlaybackState),
    item: { id: 'episode-1' } as never,
    generation: 2,
    status: 'playing',
    paused: false,
    positionSeconds: 30
  };
  isConnected = true;
  isMediaLoaded = true;
  setSpeed = vi.fn(async () => this.state);
}

function subject() {
  const jellyfin = new EventEmitter() as EventEmitter & { api: unknown };
  jellyfin.api = {};
  const socket = new EventEmitter() as EventEmitter & {
    waitUntilConnected(): Promise<void>;
  };
  socket.waitUntilConnected = vi.fn(async () => undefined);
  const mpv = new FakeMpv();
  const playback = {
    playLocal: vi.fn(async () => mpv.state),
    pauseLocal: vi.fn(async () => mpv.state),
    seekLocal: vi.fn(async () => mpv.state),
    stopLocal: vi.fn(async () => mpv.state)
  };
  const service = new SyncPlayService(
    jellyfin as never,
    socket as never,
    playback as never,
    mpv as never,
    { settings: structuredClone(defaultSettings) } as never,
    { emitClient: vi.fn() } as never
  );
  const internal = service as unknown as {
    stateValue: typeof initialSyncPlayState;
    lastBuffering: boolean | null;
    lastObservedPaused: boolean;
    suppressNativeControlRelay(
      type: 'pause' | 'seek' | 'both',
      durationMs?: number,
      pauseValue?: boolean | null
    ): void;
  };
  internal.stateValue = {
    ...structuredClone(initialSyncPlayState),
    membership: 'joined',
    currentGroup: {
      id: 'group-1',
      name: 'Movie night',
      state: 'Playing',
      participants: ['One', 'Two']
    },
    groupQueueItemId: 'episode-1',
    playlistItemId: 'playlist-1'
  };
  internal.lastBuffering = false;
  return { internal, mpv, service };
}

describe('SyncPlay native MPV controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('relays a seek performed in the MPV window to Jellyfin', async () => {
    const { mpv } = subject();
    mpv.state.positionSeconds = 48.5;

    mpv.emit('seek');
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlaySeek).toHaveBeenCalledWith({
      seekRequestDto: { PositionTicks: 485_000_000 }
    });
  });

  it('relays a local seek even if buffering already moved the room to waiting', async () => {
    const { internal, mpv } = subject();
    internal.stateValue.currentGroup!.state = 'Waiting';
    mpv.state.positionSeconds = 60;

    mpv.emit('seek');
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlaySeek).toHaveBeenCalledWith({
      seekRequestDto: { PositionTicks: 600_000_000 }
    });
  });

  it('relays a pause performed in the MPV window to Jellyfin', async () => {
    const { mpv } = subject();
    mpv.state = {
      ...mpv.state,
      status: 'paused',
      paused: true
    };

    mpv.emit('state', mpv.state);
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlayPause).toHaveBeenCalledOnce();
  });

  it('does not echo a remote command back into the room', async () => {
    const { internal, mpv } = subject();
    internal.suppressNativeControlRelay('seek');
    mpv.state.positionSeconds = 75;

    mpv.emit('seek');
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlaySeek).not.toHaveBeenCalled();
  });

  it('suppresses only the pause value produced by the remote command', async () => {
    const { internal, mpv } = subject();
    internal.suppressNativeControlRelay('pause', 750, true);
    mpv.state = { ...mpv.state, status: 'paused', paused: true };

    mpv.emit('state', mpv.state);
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlayPause).not.toHaveBeenCalled();

    internal.lastObservedPaused = true;
    mpv.state = { ...mpv.state, status: 'playing', paused: false };
    mpv.emit('state', mpv.state);
    await vi.runAllTimersAsync();

    expect(syncApi.syncPlayUnpause).toHaveBeenCalledOnce();
  });
});
