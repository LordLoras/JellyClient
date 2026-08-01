import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { MediaSegmentType } from '@jellyfin/sdk/lib/generated-client/models/media-segment-type.js';
import { defaultSettings, initialPlaybackState } from '../shared/defaults.js';
import type { PlaybackState } from '../shared/contracts.js';
import type { SkipSegment } from '../shared/skip-segments.js';
import { PlaybackService } from './playback-service.js';
import type { MpvEndFileEvent } from './playback-lifecycle.js';

class FakeMpv extends EventEmitter {
  state = structuredClone(initialPlaybackState);
  isMediaLoaded = true;
  setPostPlayPrompt = vi.fn(async () => undefined);
  setSkipPrompt = vi.fn(async () => undefined);
}

function subject() {
  const mpv = new FakeMpv();
  const settings = structuredClone(defaultSettings);
  const jellyfin = new EventEmitter() as EventEmitter & {
    api: unknown;
  };
  jellyfin.api = undefined;
  const playback = new PlaybackService(
    jellyfin as never,
    mpv as never,
    { settings } as never
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
    segments: [] as SkipSegment[],
    dismissedSegmentIds: new Set<string>(),
    promptSegmentId: null as string | null,
    promptStartedAtSeconds: null as number | null,
    promptDurationSeconds: 0,
    nextItem: { id: 'episode-2' } as PlaybackState['nextItem'],
    postPlayCanceled: false,
    playNextRequested: false
  };
  (playback as unknown as { active: typeof active }).active = active;
  mpv.state = {
    ...mpv.state,
    generation: active.generation,
    status: 'playing'
  };
  return { active, mpv, playback, settings };
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

describe('PlaybackService ending skips', () => {
  it('starts the next episode instead of seeking to the exact end of the file', () => {
    const { active, mpv, playback } = subject();
    const nextRequests = vi.fn();
    const seekRequests = vi.fn();
    playback.on('play-next-requested', nextRequests);
    playback.on('segment-skip-requested', seekRequests);
    active.segments = [{
      id: 'outro-1',
      type: MediaSegmentType.Outro,
      startTicks: 900_000_000,
      endTicks: 1_000_000_000
    }];
    active.promptSegmentId = 'outro-1';
    mpv.state.durationSeconds = 100;

    mpv.emit('skip-segment');

    expect(nextRequests).toHaveBeenCalledOnce();
    expect(seekRequests).not.toHaveBeenCalled();
  });

  it('keeps an ending seek inside the loaded file when there is no next item', () => {
    const { active, mpv, playback } = subject();
    const seekRequests = vi.fn();
    playback.on('segment-skip-requested', seekRequests);
    active.nextItem = null;
    active.segments = [{
      id: 'outro-1',
      type: MediaSegmentType.Outro,
      startTicks: 900_000_000,
      endTicks: 1_000_000_000
    }];
    active.promptSegmentId = 'outro-1';
    mpv.state.durationSeconds = 100;

    mpv.emit('skip-segment');

    expect(seekRequests).toHaveBeenCalledWith({
      itemId: 'episode-1',
      targetSeconds: 99.75
    });
  });
});

describe('PlaybackService segment prompts', () => {
  it('shows an opening intro immediately with the configured shortcut', () => {
    const { active, mpv, playback, settings } = subject();
    settings.player.skipSegmentKey = 'F4';
    active.segments = [{
      id: 'intro-1',
      type: MediaSegmentType.Intro,
      startTicks: 20_000_000,
      endTicks: 300_000_000
    }];
    mpv.state.positionSeconds = 0;

    mpv.emit('state', mpv.state);

    expect(mpv.setSkipPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: 'Skip Intro',
        shortcut: 'F4',
        secondsRemaining: 15,
        automatic: false
      })
    );
    expect(active.promptSegmentId).toBe('intro-1');
    expect(playback.state.positionSeconds).toBe(0);
  });

  it('counts down before automatically skipping instead of skipping immediately', () => {
    const { active, mpv, playback, settings } = subject();
    const seekRequests = vi.fn();
    settings.player.autoSkipIntro = true;
    playback.on('segment-skip-requested', seekRequests);
    active.segments = [{
      id: 'intro-1',
      type: MediaSegmentType.Intro,
      startTicks: 0,
      endTicks: 300_000_000
    }];

    mpv.state.positionSeconds = 0;
    mpv.emit('state', mpv.state);
    expect(seekRequests).not.toHaveBeenCalled();
    expect(mpv.setSkipPrompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ automatic: true, secondsRemaining: 15 })
    );

    mpv.state.positionSeconds = 15;
    mpv.emit('state', mpv.state);
    expect(seekRequests).toHaveBeenCalledWith({
      itemId: 'episode-1',
      targetSeconds: 30
    });
  });
});
