import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, initialPlaybackState } from '../shared/defaults.js';
import { PlaybackService } from './playback-service.js';
import type { MpvEndFileEvent } from './playback-lifecycle.js';

class FakeMpv extends EventEmitter {
  state = structuredClone(initialPlaybackState);
  setPostPlayPrompt = vi.fn(async () => undefined);
  setSkipPrompt = vi.fn(async () => undefined);
}

function subject() {
  const mpv = new FakeMpv();
  const jellyfin = new EventEmitter() as EventEmitter & {
    api: unknown;
  };
  jellyfin.api = undefined;
  const playback = new PlaybackService(
    jellyfin as never,
    mpv as never,
    { settings: structuredClone(defaultSettings) } as never
  );
  const active = {
    generation: 6,
    itemId: 'episode-1',
    seriesId: 'series-1',
    mediaSourceId: 'source-1',
    playSessionId: 'session-1',
    method: 'DirectPlay',
    loaded: true,
    started: false,
    stopped: false,
    initialAudioIndex: null,
    initialSubtitleIndex: null,
    playlistItemId: null,
    segments: [],
    dismissedSegmentIds: new Set<string>(),
    promptSegmentId: null,
    nextItem: { id: 'episode-2' },
    postPlayCanceled: false,
    playNextRequested: false
  };
  (playback as unknown as { active: typeof active }).active = active;
  mpv.state = {
    ...mpv.state,
    generation: active.generation,
    status: 'playing'
  };
  return { active, mpv, playback };
}

describe('PlaybackService end-file handling', () => {
  it('does not request the next episode after a playback error', () => {
    const { active, mpv, playback } = subject();
    const requests = vi.fn();
    playback.on('play-next-requested', requests);

    mpv.emit('end-file', {
      generation: active.generation,
      playlistEntryId: 3,
      reason: 'error',
      error: 'loading failed'
    } satisfies MpvEndFileEvent);

    expect(requests).not.toHaveBeenCalled();
    expect(active.stopped).toBe(true);
  });

  it('requests exactly one next episode after a normal EOF', () => {
    const { active, mpv, playback } = subject();
    const requests = vi.fn();
    playback.on('play-next-requested', requests);
    const event = {
      generation: active.generation,
      playlistEntryId: 3,
      reason: 'eof',
      error: null
    } satisfies MpvEndFileEvent;

    mpv.emit('end-file', event);
    mpv.emit('end-file', event);

    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'episode-2'
    }));
  });

  it('ignores an end event from the replaced playlist generation', () => {
    const { active, mpv, playback } = subject();
    const requests = vi.fn();
    playback.on('play-next-requested', requests);

    mpv.emit('end-file', {
      generation: active.generation - 1,
      playlistEntryId: 2,
      reason: 'eof',
      error: null
    } satisfies MpvEndFileEvent);

    expect(requests).not.toHaveBeenCalled();
    expect(active.stopped).toBe(false);
  });
});
