import { describe, expect, it } from 'vitest';
import type { MediaItem } from './contracts.js';
import {
  isSyncPlayPlayerLoading,
  isSyncPlayPlayerReady,
  syncPlayCommandMatchesPlaylist
} from './syncplay-player-state.js';
import { initialPlaybackState } from './defaults.js';

describe('SyncPlay player readiness', () => {
  const item: MediaItem = {
    id: 'movie-1',
    name: 'Test movie',
    type: 'Movie',
    seriesName: null,
    seriesId: null,
    seasonId: null,
    parentId: null,
    indexLabel: null,
    overview: null,
    tagline: null,
    productionYear: null,
    communityRating: null,
    officialRating: null,
    runtimeTicks: null,
    playbackPositionTicks: 0,
    playedPercentage: 0,
    isPlayed: false,
    isFavorite: false,
    isFolder: false,
    canPlay: true,
    mediaFormat: {
      resolution: null,
      videoRange: null,
      audio: null
    },
    imageUrl: null,
    backdropUrl: null
  };

  it('does not report ready when metadata exists but IPC is disconnected', () => {
    const playback = {
      ...structuredClone(initialPlaybackState),
      item,
      status: 'stopped' as const
    };

    expect(isSyncPlayPlayerReady(playback, false, item.id)).toBe(false);
  });

  it('does not report ready while MPV is starting or loading', () => {
    const starting = {
      ...structuredClone(initialPlaybackState),
      item,
      status: 'starting' as const
    };
    const loading = {
      ...starting,
      status: 'loading' as const
    };

    expect(isSyncPlayPlayerReady(starting, true, item.id)).toBe(false);
    expect(isSyncPlayPlayerReady(loading, true, item.id)).toBe(false);
    expect(isSyncPlayPlayerLoading(starting)).toBe(true);
    expect(isSyncPlayPlayerLoading(loading)).toBe(true);
  });

  it('reports ready only for a loaded matching item with live IPC', () => {
    const playback = {
      ...structuredClone(initialPlaybackState),
      item,
      status: 'paused' as const
    };

    expect(isSyncPlayPlayerReady(playback, true, item.id)).toBe(true);
    expect(isSyncPlayPlayerReady(playback, true, 'movie-2')).toBe(false);
    expect(isSyncPlayPlayerReady(playback, false, item.id)).toBe(false);
  });

  it('rejects commands for a missing or different playlist item', () => {
    expect(syncPlayCommandMatchesPlaylist('playlist-1', null)).toBe(false);
    expect(
      syncPlayCommandMatchesPlaylist('playlist-1', 'playlist-2')
    ).toBe(false);
    expect(
      syncPlayCommandMatchesPlaylist('playlist-1', 'playlist-1')
    ).toBe(true);
    expect(syncPlayCommandMatchesPlaylist(undefined, null)).toBe(true);
  });
});
