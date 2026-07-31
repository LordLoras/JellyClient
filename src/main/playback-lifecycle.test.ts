import { describe, expect, it } from 'vitest';
import {
  MpvPlaybackGenerationTracker,
  shouldAutomaticallyAdvance,
  type MpvEndFileEvent
} from './playback-lifecycle.js';

const eof: MpvEndFileEvent = {
  generation: 4,
  playlistEntryId: 12,
  reason: 'eof',
  error: null
};

const ready = {
  generation: 4,
  loaded: true,
  stopped: false,
  hasNextItem: true,
  postPlayCanceled: false,
  playNextRequested: false
};

describe('automatic next-episode guard', () => {
  it('advances only after the current, successfully loaded file reaches EOF', () => {
    expect(shouldAutomaticallyAdvance(eof, ready, true)).toBe(true);
  });

  it.each(['error', 'stop', 'quit', 'redirect', 'unknown'])(
    'does not advance after MPV reason %s',
    (reason) => {
      expect(shouldAutomaticallyAdvance({ ...eof, reason }, ready, true)).toBe(false);
    }
  );

  it('does not advance a file that never loaded', () => {
    expect(shouldAutomaticallyAdvance(eof, { ...ready, loaded: false }, true))
      .toBe(false);
  });

  it('does not advance for a stale playback generation', () => {
    expect(shouldAutomaticallyAdvance(
      { ...eof, generation: ready.generation - 1 },
      ready,
      true
    )).toBe(false);
  });

  it('honors cancellation, duplicate, stopped, disabled, and no-next guards', () => {
    expect(shouldAutomaticallyAdvance(eof, { ...ready, postPlayCanceled: true }, true)).toBe(false);
    expect(shouldAutomaticallyAdvance(eof, { ...ready, playNextRequested: true }, true)).toBe(false);
    expect(shouldAutomaticallyAdvance(eof, { ...ready, stopped: true }, true)).toBe(false);
    expect(shouldAutomaticallyAdvance(eof, { ...ready, hasNextItem: false }, true)).toBe(false);
    expect(shouldAutomaticallyAdvance(eof, ready, false)).toBe(false);
  });
});

describe('MPV playlist generation tracking', () => {
  it('keeps a replaced file end event attached to the old generation', () => {
    const tracker = new MpvPlaybackGenerationTracker();
    tracker.beginLoad(1);
    expect(tracker.start(10, 1)).toEqual({
      generation: 1,
      playlistEntryId: 10
    });

    tracker.beginLoad(2);
    expect(tracker.end(10, 2)).toEqual({
      generation: 1,
      playlistEntryId: 10
    });
    expect(tracker.start(11, 2)).toEqual({
      generation: 2,
      playlistEntryId: 11
    });
  });

  it('clears an abandoned pending load', () => {
    const tracker = new MpvPlaybackGenerationTracker();
    tracker.beginLoad(7);
    tracker.abandonLoad(7);
    expect(tracker.start(22, 8)).toEqual({
      generation: 8,
      playlistEntryId: 22
    });
  });
});
