import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackState } from '../shared/contracts.js';
import { defaultSettings, initialPlaybackState, initialSyncPlayState } from '../shared/defaults.js';

const syncApi = vi.hoisted(() => ({
  syncPlayPause: vi.fn(async () => undefined),
  syncPlayUnpause: vi.fn(async () => undefined),
  syncPlaySeek: vi.fn(async () => undefined),
  syncPlayStop: vi.fn(async () => undefined),
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
    play: vi.fn(async () => mpv.state),
    playLocal: vi.fn(async () => mpv.state),
    pauseLocal: vi.fn(async () => mpv.state),
    seekLocal: vi.fn(async () => mpv.state),
    stopLocal: vi.fn(async () => mpv.state),
    setPlaylistItemId: vi.fn()
  };
  const events = { emitClient: vi.fn() };
  const service = new SyncPlayService(
    jellyfin as never,
    socket as never,
    playback as never,
    mpv as never,
    { settings: structuredClone(defaultSettings) } as never,
    events as never
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
    processCommand(command: Record<string, unknown>): void;
    processQueue(queue: Record<string, unknown>): Promise<void>;
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
  return { events, internal, mpv, playback, service };
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

  it('keeps the room joined when MPV takes longer than the readiness window', async () => {
    const { events, internal, mpv, service } = subject();
    mpv.isMediaLoaded = false;
    mpv.state = {
      ...mpv.state,
      item: null,
      status: 'loading',
      paused: true
    };

    const loading = internal.processQueue({
      PlayingItemIndex: 0,
      Playlist: [{ ItemId: 'episode-2', PlaylistItemId: 'playlist-2' }],
      StartPositionTicks: 0
    });
    await vi.advanceTimersByTimeAsync(15_050);
    await loading;

    expect(service.state.membership).toBe('joined');
    expect(service.state.error).toBeNull();
    expect(events.emitClient).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notice',
        data: expect.objectContaining({ level: 'warning' })
      })
    );
  });

  it('does not start a second MPV load for a repeated queue update', async () => {
    const { internal, mpv, playback } = subject();
    mpv.isMediaLoaded = false;
    mpv.state = {
      ...mpv.state,
      item: null,
      status: 'loading',
      paused: true
    };
    const queue = {
      PlayingItemIndex: 0,
      Playlist: [{ ItemId: 'episode-2', PlaylistItemId: 'playlist-2' }],
      StartPositionTicks: 0
    };

    const first = internal.processQueue(queue);
    await vi.advanceTimersByTimeAsync(0);
    await internal.processQueue(queue);

    expect(playback.play).toHaveBeenCalledOnce();

    mpv.isMediaLoaded = true;
    mpv.state = {
      ...mpv.state,
      item: { id: 'episode-2' } as never,
      status: 'paused',
      paused: true
    };
    await vi.advanceTimersByTimeAsync(25);
    await first;
  });

  it('accepts distinct rapid commands with the same server timestamp', async () => {
    const { internal, playback } = subject();
    const now = new Date(Date.now()).toISOString();

    internal.processCommand({
      Command: 'Pause',
      GroupId: 'group-1',
      PlaylistItemId: 'playlist-1',
      PositionTicks: 300_000_000,
      When: now,
      EmittedAt: now
    });
    internal.processCommand({
      Command: 'Seek',
      GroupId: 'group-1',
      PlaylistItemId: 'playlist-1',
      PositionTicks: 600_000_000,
      When: now,
      EmittedAt: now
    });
    await vi.advanceTimersByTimeAsync(1_600);

    expect(playback.seekLocal).toHaveBeenCalledWith(60);
  });

  it('reports drift measured after playback starts instead of a stale pre-play value', async () => {
    const { internal, mpv, service } = subject();
    mpv.state = { ...mpv.state, positionSeconds: 10, paused: true };
    const now = new Date(Date.now()).toISOString();

    internal.processCommand({
      Command: 'Unpause',
      GroupId: 'group-1',
      PlaylistItemId: 'playlist-1',
      PositionTicks: 100_000_000,
      When: now,
      EmittedAt: now
    });
    await vi.advanceTimersByTimeAsync(0);
    mpv.state = { ...mpv.state, paused: false, status: 'playing' };
    await vi.advanceTimersByTimeAsync(2_000);
    mpv.emit('state', mpv.state);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.state.driftMs).toBeLessThan(-1_900);
  });

  it('retries the latest command after MPV becomes ready without rejoining', async () => {
    const { internal, mpv, playback, service } = subject();
    mpv.isMediaLoaded = false;
    mpv.state = {
      ...mpv.state,
      item: null,
      status: 'loading',
      paused: true
    };
    const now = new Date(Date.now()).toISOString();

    internal.processCommand({
      Command: 'Unpause',
      GroupId: 'group-1',
      PlaylistItemId: 'playlist-1',
      PositionTicks: 300_000_000,
      When: now,
      EmittedAt: now
    });
    await vi.advanceTimersByTimeAsync(15_050);

    expect(playback.playLocal).not.toHaveBeenCalled();
    expect(service.state.membership).toBe('joined');

    mpv.isMediaLoaded = true;
    mpv.state = {
      ...mpv.state,
      item: { id: 'episode-1' } as never,
      status: 'paused',
      paused: true
    };
    mpv.emit('state', mpv.state);
    await vi.advanceTimersByTimeAsync(0);

    expect(playback.playLocal).toHaveBeenCalledOnce();
    expect(service.state.membership).toBe('joined');
  });
});
