import {
  describe,
  expect,
  it
} from 'vitest';
import {
  codecRequestsPassthrough,
  isPassthroughOutputFormat,
  mpvPassthroughCodecs,
  parseMpvAudioDevices
} from './audio-output.js';

describe('MPV audio output helpers', () => {
  it('parses the Windows device list without duplicate endpoints', () => {
    const output = [
      'List of detected audio devices:',
      "  'auto' (Autoselect device)",
      "  'wasapi/{speaker}' (Speakers (Realtek Audio))",
      "  'wasapi/{tv}' (HISENSE (AMD HDMI Audio))",
      "  'wasapi/{tv}' (HISENSE duplicate)"
    ].join('\r\n');

    expect(parseMpvAudioDevices(output)).toEqual([
      { id: 'auto', description: 'Autoselect device' },
      { id: 'wasapi/{speaker}', description: 'Speakers (Realtek Audio)' },
      { id: 'wasapi/{tv}', description: 'HISENSE (AMD HDMI Audio)' }
    ]);
  });

  it('uses DTS-HD instead of a duplicate DTS core request', () => {
    expect(mpvPassthroughCodecs({
      ac3: true,
      eac3: true,
      truehd: true,
      dts: true,
      dtsHd: true
    })).toEqual(['ac3', 'eac3', 'truehd', 'dts-hd']);
  });

  it('matches source codec aliases and identifies bitstream output', () => {
    const settings = {
      ac3: false,
      eac3: true,
      truehd: true,
      dts: false,
      dtsHd: true
    };
    expect(codecRequestsPassthrough('E-AC-3', settings)).toBe(true);
    expect(codecRequestsPassthrough('DCA', settings)).toBe(true);
    expect(codecRequestsPassthrough('AAC', settings)).toBe(false);
    expect(isPassthroughOutputFormat('spdif-eac3')).toBe(true);
    expect(isPassthroughOutputFormat('float')).toBe(false);
  });
});
