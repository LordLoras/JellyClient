import type { VidaaPlaybackRequest } from '../src/jellyfin-types.js';

const VIDAA_AUDIO_CODECS = new Set([
  'ac3',
  'eac3',
  'truehd',
  'dts',
  'flac'
]);

export interface ResolvedVidaaAudioProfile {
  name: 'tv-speakers' | 'earc' | 'custom';
  codecs: string[];
  maxChannels: number;
}

export function resolvedAudioProfile(
  input: VidaaPlaybackRequest
): ResolvedVidaaAudioProfile {
  const name = input.audioProfile === 'earc' || input.audioProfile === 'custom'
    ? input.audioProfile
    : 'tv-speakers';
  const optional = name === 'tv-speakers'
    ? ['ac3', 'eac3']
    : name === 'earc'
      ? ['ac3', 'eac3', 'truehd', 'dts', 'flac']
      : (input.audioCodecs ?? []).filter((codec) => VIDAA_AUDIO_CODECS.has(codec));
  return {
    name,
    codecs: [...new Set(['aac', 'mp3', ...optional])],
    maxChannels: name === 'tv-speakers' ? 6 : 8
  };
}

export function deviceProfile(audio: ResolvedVidaaAudioProfile) {
  const audioCodecs = audio.codecs.join(',');
  return {
    Name: `JellyClient VIDAA · ${audio.name}`,
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    DirectPlayProfiles: [{
      Container: 'mp4,m4v,mov',
      VideoCodec: 'h264,hevc',
      AudioCodec: audioCodecs,
      Type: 'Video'
    }],
    TranscodingProfiles: [{
      Container: 'mp4',
      Type: 'Video',
      VideoCodec: 'h264,hevc',
      AudioCodec: audioCodecs,
      Protocol: 'http',
      Context: 'Streaming',
      CopyTimestamps: true,
      EnableSubtitlesInManifest: false,
      MaxAudioChannels: String(audio.maxChannels)
    }],
    SubtitleProfiles: [
      'srt', 'subrip', 'ass', 'ssa', 'webvtt', 'vtt'
    ].map((format) => ({ Format: format, Method: 'External' }))
  };
}
