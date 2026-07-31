import {
  describe,
  expect,
  it
} from 'vitest';
import {
  deviceProfile,
  resolvedAudioProfile
} from './audio-profile.js';

const request = {
  mediaSourceId: 'source',
  startPositionTicks: 0,
  audioStreamIndex: 1,
  subtitleStreamIndex: null
};

describe('VIDAA audio negotiation profile', () => {
  it('keeps the television profile conservative', () => {
    expect(resolvedAudioProfile(request)).toEqual({
      name: 'tv-speakers',
      codecs: ['aac', 'mp3', 'ac3', 'eac3'],
      maxChannels: 6
    });
  });

  it('advertises lossless formats for the eARC profile', () => {
    const audio = resolvedAudioProfile({
      ...request,
      audioProfile: 'earc'
    });
    expect(audio.maxChannels).toBe(8);
    expect(audio.codecs).toContain('truehd');
    expect(audio.codecs).toContain('dts');
    expect(deviceProfile(audio).DirectPlayProfiles[0]?.AudioCodec)
      .toContain('truehd');
  });

  it('ignores unknown codecs supplied to the bridge', () => {
    expect(resolvedAudioProfile({
      ...request,
      audioProfile: 'custom',
      audioCodecs: ['eac3', 'truehd', 'unsupported' as 'ac3']
    }).codecs).toEqual(['aac', 'mp3', 'eac3', 'truehd']);
  });
});
