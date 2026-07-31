import {
  describe,
  expect,
  it
} from 'vitest';
import type {
  VidaaPlaybackOptions,
  VidaaTrackChoice
} from './jellyfin-types.js';
import {
  DEFAULT_VIDAA_PLAYER_SETTINGS,
  parsePlayerSettings,
  preferredPlaybackTracks
} from './player-settings.js';

function track(
  index: number,
  type: VidaaTrackChoice['type'],
  language: string,
  flags: Partial<VidaaTrackChoice> = {}
): VidaaTrackChoice {
  return {
    index,
    type,
    language,
    title: `${language} ${type}`,
    codec: type === 'audio' ? 'aac' : 'srt',
    channels: type === 'audio' ? 2 : null,
    channelLayout: type === 'audio' ? 'stereo' : null,
    isDefault: false,
    isForced: false,
    isExternal: false,
    isText: true,
    ...flags
  };
}

const options: VidaaPlaybackOptions = {
  item: {
    id: 'item',
    name: 'Episode',
    type: 'Episode',
    seriesName: 'Series',
    seriesId: 'series',
    indexLabel: 'S01 E01',
    productionYear: 2026,
    overview: null,
    runtimeTicks: null,
    playbackPositionTicks: 0,
    playedPercentage: 0,
    canPlay: true,
    isFolder: false,
    imageUrl: null,
    backdropUrl: null,
    mediaFormat: {
      resolution: '4K',
      videoRange: 'HDR10',
      audio: '5.1'
    }
  },
  sources: [],
  mediaSourceId: 'source',
  container: 'mkv',
  audioTracks: [
    track(1, 'audio', 'jpn', { isDefault: true }),
    track(2, 'audio', 'eng')
  ],
  subtitleTracks: [
    track(3, 'subtitle', 'eng'),
    track(4, 'subtitle', 'bul', { isForced: true })
  ],
  defaultAudioIndex: 1,
  defaultSubtitleIndex: 3,
  chapters: [],
  nextItem: null
};

describe('VIDAA player settings', () => {
  it('falls back safely when stored settings are malformed', () => {
    expect(parsePlayerSettings({ subtitleSize: 'enormous', seekSeconds: 17 }))
      .toEqual(DEFAULT_VIDAA_PLAYER_SETTINGS);
  });

  it('selects preferred audio and subtitle languages', () => {
    expect(preferredPlaybackTracks(options, {
      ...DEFAULT_VIDAA_PLAYER_SETTINGS,
      preferredAudioLanguage: 'eng',
      preferredSubtitleLanguage: 'bul'
    })).toEqual({
      audioStreamIndex: 2,
      subtitleStreamIndex: 4
    });
  });

  it('starts with subtitles off when requested', () => {
    expect(preferredPlaybackTracks(options, {
      ...DEFAULT_VIDAA_PLAYER_SETTINGS,
      subtitlesEnabled: false
    }).subtitleStreamIndex).toBeNull();
  });

  it('does not treat an unknown track language as a preference match', () => {
    const tracks = [
      track(8, 'audio', '', { isDefault: true }),
      track(9, 'audio', 'eng')
    ];
    const withUnknownDefault = {
      ...options,
      audioTracks: tracks,
      defaultAudioIndex: 8
    };
    expect(preferredPlaybackTracks(withUnknownDefault, {
      ...DEFAULT_VIDAA_PLAYER_SETTINGS,
      preferredAudioLanguage: 'eng'
    }).audioStreamIndex).toBe(9);
  });
});
