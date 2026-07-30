import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto.js';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream.js';
import type { MediaFormatInfo } from '@shared/contracts.js';

export function mediaFormatForItem(item: BaseItemDto): MediaFormatInfo {
  const source = item.MediaSources?.find(
    (candidate) => (candidate.MediaStreams?.length ?? 0) > 0
  );
  const streams: MediaStream[] =
    source?.MediaStreams ?? item.MediaStreams ?? [];
  const video = preferredStream(streams, 'Video');
  const audio =
    streams.find(
      (stream) =>
        stream.Type === 'Audio' &&
        stream.Index === source?.DefaultAudioStreamIndex
    ) ??
    preferredStream(streams, 'Audio');

  return {
    resolution: resolutionLabel(video),
    videoRange: videoRangeLabel(video),
    audio: audioLabel(audio)
  };
}

function preferredStream(
  streams: MediaStream[],
  type: 'Video' | 'Audio'
): MediaStream | undefined {
  return (
    streams.find((stream) => stream.Type === type && stream.IsDefault) ??
    streams.find((stream) => stream.Type === type)
  );
}

function resolutionLabel(stream: MediaStream | undefined): string | null {
  const width = stream?.Width ?? 0;
  const height = stream?.Height ?? 0;
  if (width >= 3_800 || height >= 2_000) return '4K';
  if (width >= 2_500 || height >= 1_400) return '1440p';
  if (width >= 1_850 || height >= 1_000) return '1080p';
  if (width >= 1_200 || height >= 700) return '720p';
  if (height > 0) return `${height}p`;
  return null;
}

function videoRangeLabel(stream: MediaStream | undefined): string | null {
  if (!stream) return null;
  const range = `${stream.VideoRangeType ?? stream.VideoRange ?? ''}`
    .replaceAll(/[^a-z0-9+]/gi, '')
    .toUpperCase();
  const dolbyVision =
    stream.DvProfile != null ||
    range.includes('DOVI') ||
    /dolby\s*vision/i.test(stream.VideoDoViTitle ?? '');
  if (dolbyVision) return 'Dolby Vision';
  if (stream.Hdr10PlusPresentFlag || range.includes('HDR10PLUS')) {
    return 'HDR10+';
  }
  if (
    range.includes('HDR10') ||
    /^(pq|smpte2084)$/i.test(stream.ColorTransfer ?? '')
  ) {
    return 'HDR10';
  }
  if (range.includes('HLG') || /arib-std-b67/i.test(stream.ColorTransfer ?? '')) {
    return 'HLG';
  }
  return null;
}

function audioLabel(stream: MediaStream | undefined): string | null {
  if (!stream) return null;
  const descriptor = [
    stream.AudioSpatialFormat,
    stream.DisplayTitle,
    stream.Title,
    stream.Profile,
    stream.Codec
  ].filter(Boolean).join(' ');
  if (/dolby\s*atmos|dolbyatmos|\batmos\b/i.test(descriptor)) {
    return 'Dolby Atmos';
  }
  if (/dts[\s:-]*x|\bdtsx\b/i.test(descriptor)) return 'DTS:X';

  const channels = stream.Channels ?? 0;
  if (channels >= 8) return '7.1';
  if (channels >= 6) return '5.1';
  if (channels > 2) return `${channels} ch`;
  if (channels === 2) return 'Stereo';
  if (channels === 1) return 'Mono';

  const layout = stream.ChannelLayout ?? stream.DisplayTitle ?? '';
  if (/\b7\.1\b/.test(layout)) return '7.1';
  if (/\b5\.1\b/.test(layout)) return '5.1';
  if (/\bstereo\b/i.test(layout)) return 'Stereo';
  if (/\bmono\b/i.test(layout)) return 'Mono';
  return null;
}
