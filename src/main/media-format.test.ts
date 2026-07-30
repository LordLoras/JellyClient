import {
  describe,
  expect,
  it
} from 'vitest';
import { mediaFormatForItem } from './media-format.js';

describe('Jellyfin source media labels', () => {
  it('describes 4K HDR10 video with the default 5.1 audio stream', () => {
    expect(mediaFormatForItem({
      MediaSources: [
        {
          DefaultAudioStreamIndex: 2,
          MediaStreams: [
            {
              Type: 'Video',
              Index: 0,
              Width: 3840,
              Height: 1606,
              VideoRangeType: 'HDR10',
              ColorTransfer: 'smpte2084'
            },
            {
              Type: 'Audio',
              Index: 1,
              Channels: 2
            },
            {
              Type: 'Audio',
              Index: 2,
              Channels: 6,
              IsDefault: true
            }
          ]
        }
      ]
    })).toEqual({
      resolution: '4K',
      videoRange: 'HDR10',
      audio: '5.1'
    });
  });

  it('prioritizes Dolby Vision and Atmos source metadata', () => {
    expect(mediaFormatForItem({
      MediaSources: [
        {
          MediaStreams: [
            {
              Type: 'Video',
              Width: 1920,
              Height: 1080,
              VideoRangeType: 'DOVIWithHDR10',
              DvProfile: 8
            },
            {
              Type: 'Audio',
              Channels: 8,
              AudioSpatialFormat: 'DolbyAtmos'
            }
          ]
        }
      ]
    })).toEqual({
      resolution: '1080p',
      videoRange: 'Dolby Vision',
      audio: 'Dolby Atmos'
    });
  });

  it('does not invent labels when Jellyfin omits media streams', () => {
    expect(mediaFormatForItem({})).toEqual({
      resolution: null,
      videoRange: null,
      audio: null
    });
  });
});
