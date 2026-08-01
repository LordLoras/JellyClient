import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, initialPlaybackState, initialSyncPlayState } from '../shared/defaults.js';
import { RemoteCommandService } from './remote-command-service.js';

function subject(joined = false) {
  const socket = new EventEmitter();
  const playback = {
    play: vi.fn(async () => initialPlaybackState),
    playLocal: vi.fn(async () => initialPlaybackState),
    pauseLocal: vi.fn(async () => initialPlaybackState),
    stopLocal: vi.fn(async () => initialPlaybackState),
    seekLocal: vi.fn(async () => initialPlaybackState)
  };
  const syncPlay = {
    state: {
      ...structuredClone(initialSyncPlayState),
      membership: joined ? 'joined' : 'not-joined',
      currentGroup: joined ? {
        id: 'group-1',
        name: 'Room',
        state: 'Playing',
        participants: []
      } : null
    },
    action: vi.fn(async () => initialSyncPlayState),
    startItem: vi.fn(async () => initialSyncPlayState),
    listGroups: vi.fn(async () => initialSyncPlayState),
    join: vi.fn(async () => initialSyncPlayState)
  };
  const mpv = {
    state: {
      ...structuredClone(initialPlaybackState),
      paused: false,
      tracks: []
    },
    setVolume: vi.fn(async () => initialPlaybackState),
    setMuted: vi.fn(async () => initialPlaybackState),
    setFullscreen: vi.fn(async () => initialPlaybackState),
    selectTrack: vi.fn(async () => initialPlaybackState)
  };
  const events = { emitClient: vi.fn() };
  new RemoteCommandService(
    socket as never,
    playback as never,
    syncPlay as never,
    mpv as never,
    { settings: structuredClone(defaultSettings) } as never,
    events as never
  );
  return { events, mpv, playback, socket, syncPlay };
}

describe('Jellyfin remote control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies browser and phone seeks to local MPV playback', async () => {
    const { playback, socket } = subject();
    socket.emit('Playstate', {
      Command: 'Seek',
      SeekPositionTicks: 125_000_000
    });

    await vi.waitFor(() => {
      expect(playback.seekLocal).toHaveBeenCalledWith(12.5);
    });
  });

  it('routes remote transport controls through the joined SyncPlay room', async () => {
    const { socket, syncPlay } = subject(true);
    socket.emit('Playstate', {
      Command: 'Seek',
      SeekPositionTicks: 420_000_000
    });

    await vi.waitFor(() => {
      expect(syncPlay.action).toHaveBeenCalledWith({
        type: 'seek',
        positionTicks: 420_000_000
      });
    });
  });

  it('starts a title sent with Play On from another Jellyfin client', async () => {
    const { playback, socket } = subject();
    socket.emit('Play', {
      ItemIds: ['movie-1'],
      PlayCommand: 'PlayNow',
      StartPositionTicks: 300_000_000,
      AudioStreamIndex: 2,
      SubtitleStreamIndex: 4
    });

    await vi.waitFor(() => {
      expect(playback.play).toHaveBeenCalledWith({
        itemId: 'movie-1',
        startPositionTicks: 300_000_000,
        mediaSourceId: null,
        maxStreamingBitrate: null,
        audioStreamIndex: 2,
        subtitleStreamIndex: 4
      });
    });
  });
});
