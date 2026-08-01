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
  syncPlayBuffering: vi.fn(async () => undefined),
  syncPlayJoinGroup: vi.fn(async () => undefined),
  syncPlayPing: vi.fn(async () => undefined),
  syncPlayGetGroups: vi.fn(async () => ({
    data: [{
      GroupId: 'group-1',
      GroupName: 'Movie night',
      State: 'Playing',
      Participants: ['One', 'Two']
    }]
  }))
}));

const timeApi = vi.hoisted(() => ({
  getUtcTime: vi.fn(async () => ({
    data: {
      RequestReceptionTime: new Date(Date.now()).toISOString(),
      ResponseTransmissionTime: new Date(Date.now()).toISOString()
    }
  }))
}));

vi.mock('@jellyfin/sdk/lib/utils/api/sync-play-api.js', () => ({
  getSyncPlayApi: () => syncApi
}));

vi.mock('@jellyfin/sdk/lib/utils/api/time-sync-api.js', () => ({
  getTimeSyncApi: () => timeApi
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
      pauseValue?: boolean | null,
      seekTargetSeconds?: number | null
    ): void;
    processCommand(command: Record<string, unknown>): void;
    processQueue(queue: Record<string, unknown>): Promise<void>;
    confirmJoined(group: NonNullable<typeof initialSyncPlayState.currentGroup>): void;
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

  it('does not discard a different user seek during remote-seek suppression', async () => {
    const { internal, mpv } = subject();
    internal.suppressNativeControlRelay('seek', 750, null, 75);
    mpv.state.positionSeconds = 75;
    mpv.emit('seek');
    await vi.advanceTimersByTimeAsync(100);
    expect(syncApi.syncPlaySeek).not.toHaveBeenCalled();

    mpv.state.positionSeconds = 120;
    mpv.emit('seek');
    await vi.advanceTimersByTimeAsync(100);

    expect(syncApi.syncPlaySeek).toHaveBeenCalledWith({
      seekRequestDto: { PositionTicks: 1_200_000_000 }
    });
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

  it('reannounces membership and player readiness during a manual resync', async () => {
    const { service } = subject();

    const state = await service.resync();

    expect(syncApi.syncPlayJoinGroup).toHaveBeenCalledWith({
      joinGroupRequestDto: { GroupId: 'group-1' }
    });
    expect(timeApi.getUtcTime).toHaveBeenCalledTimes(8);
    expect(syncApi.syncPlayBuffering).toHaveBeenCalledOnce();
    expect(syncApi.syncPlayReady).toHaveBeenCalledOnce();
    expect(state.membership).toBe('joined');
    expect(state.error).toBeNull();
  });

  it('checks local readiness, room state, and clock quality without rejoining', async () => {
    const { service } = subject();

    const state = await service.checkRoom();

    expect(timeApi.getUtcTime).toHaveBeenCalledTimes(5);
    expect(syncApi.syncPlayGetGroups).toHaveBeenCalledOnce();
    expect(syncApi.syncPlayJoinGroup).not.toHaveBeenCalled();
    expect(state.roomCheck).toMatchObject({
      status: 'ready',
      localReady: true,
      itemMatched: true,
      serverState: 'Playing'
    });
    expect(state.roomCheck.checkedAt).not.toBeNull();
    expect(state.error).toBeNull();
  });

  it('refreshes the server clock periodically while the room stays joined', async () => {
    const { internal, service } = subject();
    internal.confirmJoined(internal.stateValue.currentGroup!);
    timeApi.getUtcTime.mockClear();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(timeApi.getUtcTime).toHaveBeenCalledTimes(3);
    service.reset();
  });

  it('reports when the local player is the part still loading', async () => {
    const { mpv, service } = subject();
    mpv.isMediaLoaded = false;
    mpv.state = {
      ...mpv.state,
      item: null,
      status: 'loading',
      paused: true
    };
    mpv.emit('state', mpv.state);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.state.roomCheck).toMatchObject({
      status: 'waiting',
      localReady: false,
      itemMatched: false,
      playerStatus: 'loading'
    });
  });

  it('continuously corrects hard drift after the initial start window', async () => {
    const { internal, mpv, playback } = subject();
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
    await vi.advanceTimersByTimeAsync(1_000);
    playback.seekLocal.mockClear();

    mpv.state = {
      ...mpv.state,
      paused: false,
      status: 'playing',
      positionSeconds: 10.2
    };
    await vi.advanceTimersByTimeAsync(2_100);
    mpv.emit('state', mpv.state);
    await vi.advanceTimersByTimeAsync(0);

    expect(playback.seekLocal).toHaveBeenCalledWith(expect.any(Number));
    const lastSeek = (
      playback.seekLocal.mock.calls as unknown as Array<[number]>
    ).at(-1)?.[0] ?? 0;
    expect(lastSeek).toBeGreaterThan(12.5);
  });

  it('gently corrects smaller ongoing drift instead of waiting for a hard seek', async () => {
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
    await vi.advanceTimersByTimeAsync(1_000);
    mpv.setSpeed.mockClear();

    mpv.state = {
      ...mpv.state,
      paused: false,
      status: 'playing'
    };
    await vi.advanceTimersByTimeAsync(2_100);
    mpv.state.positionSeconds = 13.3;
    mpv.emit('state', mpv.state);
    await vi.advanceTimersByTimeAsync(0);

    expect(mpv.setSpeed).toHaveBeenCalledWith(0.98);
    expect(service.state.roomCheck).toMatchObject({
      status: 'correcting',
      automaticCorrections: 1,
      lastCorrectionKind: 'speed'
    });
  });

  it('keeps only the newest command across randomized rapid command bursts', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      vi.clearAllMocks();
      const { internal, playback, service } = subject();
      const timestamp = new Date(Date.now()).toISOString();
      let value = seed;
      for (let index = 0; index < 24; index += 1) {
        value = (value * 16_807) % 2_147_483_647;
        const command = ['Pause', 'Unpause', 'Seek'][value % 3]!;
        internal.processCommand({
          Command: command,
          GroupId: 'group-1',
          PlaylistItemId: 'playlist-1',
          PositionTicks: (index + 1) * 10_000_000,
          When: timestamp,
          EmittedAt: timestamp
        });
      }
      internal.processCommand({
        Command: 'Seek',
        GroupId: 'group-1',
        PlaylistItemId: 'playlist-1',
        PositionTicks: 777_000_000,
        When: timestamp,
        EmittedAt: timestamp
      });
      await vi.advanceTimersByTimeAsync(1_600);

      expect(playback.seekLocal).toHaveBeenLastCalledWith(77.7);
      expect(service.state.membership).toBe('joined');
      expect(service.state.error).toBeNull();
    }
  });

  it('continues serializing controls after a transient request failure', async () => {
    const { service } = subject();
    syncApi.syncPlaySeek.mockRejectedValueOnce(new Error('temporary failure'));

    await expect(service.action({
      type: 'seek',
      positionTicks: 250_000_000
    })).rejects.toThrow('temporary failure');
    await service.action({ type: 'pause' });

    expect(syncApi.syncPlayPause).toHaveBeenCalledOnce();
    expect(service.state.membership).toBe('joined');
  });
});
