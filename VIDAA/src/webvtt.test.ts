import {
  describe,
  expect,
  it
} from 'vitest';
import {
  parseWebVtt,
  subtitleAtTime
} from './webvtt.js';

describe('VIDAA WebVTT overlay', () => {
  it('parses cue identifiers, settings, markup, and entities', () => {
    const cues = parseWebVtt(`WEBVTT

cue-one
00:00:01.000 --> 00:00:03.500 align:center
<i>Hello &amp; welcome</i>
second line

00:03,500 --> 00:04,000
Bye`);

    expect(cues).toEqual([
      {
        start: 1,
        end: 3.5,
        text: 'Hello & welcome\nsecond line'
      },
      {
        start: 3.5,
        end: 4,
        text: 'Bye'
      }
    ]);
  });

  it('returns every cue active at the playback position', () => {
    const cues = [
      { start: 1, end: 3, text: 'First speaker' },
      { start: 2, end: 4, text: 'Second speaker' }
    ];

    expect(subtitleAtTime(cues, 2.5)).toBe('First speaker\nSecond speaker');
    expect(subtitleAtTime(cues, 4)).toBe('');
  });
});
