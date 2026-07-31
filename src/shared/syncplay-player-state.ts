import type { PlaybackState } from './contracts.js';

const READY_STATUSES = new Set<PlaybackState['status']>([
  'paused',
  'playing'
]);

const LOADING_STATUSES = new Set<PlaybackState['status']>([
  'starting',
  'loading',
  'buffering'
]);

export function isSyncPlayPlayerReady(
  playback: PlaybackState,
  ipcConnected: boolean,
  mediaLoaded: boolean,
  expectedItemId?: string | null
): boolean {
  return (
    ipcConnected &&
    mediaLoaded &&
    Boolean(playback.item) &&
    (!expectedItemId || playback.item?.id === expectedItemId) &&
    READY_STATUSES.has(playback.status)
  );
}

export function isSyncPlayPlayerLoading(playback: PlaybackState): boolean {
  return Boolean(playback.item) && LOADING_STATUSES.has(playback.status);
}

export function syncPlayCommandMatchesPlaylist(
  commandPlaylistItemId: string | null | undefined,
  currentPlaylistItemId: string | null
): boolean {
  return (
    !commandPlaylistItemId ||
    commandPlaylistItemId === currentPlaylistItemId
  );
}
