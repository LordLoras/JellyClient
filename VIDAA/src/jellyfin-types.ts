import type { SkipSegment } from '../../src/shared/skip-segments.js';
import type {
  VidaaAudioCodec,
  VidaaAudioProfile
} from './player-settings.js';

export interface VidaaJellyfinSession {
  connected: boolean;
  baseUrl: string | null;
  serverName: string | null;
  serverVersion: string | null;
  userName: string | null;
  error: string | null;
}

export interface VidaaMediaFormat {
  resolution: string | null;
  videoRange: string | null;
  audio: string | null;
}

export interface VidaaMediaItem {
  id: string;
  name: string;
  type: string;
  seriesName: string | null;
  seriesId: string | null;
  indexLabel: string | null;
  productionYear: number | null;
  overview: string | null;
  runtimeTicks: number | null;
  playbackPositionTicks: number;
  playedPercentage: number;
  canPlay: boolean;
  isFolder: boolean;
  imageUrl: string | null;
  backdropUrl: string | null;
  mediaFormat: VidaaMediaFormat;
}

export interface VidaaChapter {
  name: string;
  startTicks: number;
}

export interface VidaaLibrary {
  id: string;
  name: string;
  collectionType: string | null;
  imageUrl: string | null;
}

export interface VidaaHomePayload {
  libraries: VidaaLibrary[];
  resume: VidaaMediaItem[];
  nextUp: VidaaMediaItem[];
  latest: VidaaMediaItem[];
}

export interface VidaaItemsPage {
  items: VidaaMediaItem[];
  totalRecordCount: number;
}

export interface VidaaTrackChoice {
  index: number;
  type: 'audio' | 'subtitle';
  language: string | null;
  title: string;
  codec: string | null;
  channels: number | null;
  channelLayout: string | null;
  isDefault: boolean;
  isForced: boolean;
  isExternal: boolean;
  isText: boolean;
}

export interface VidaaPlaybackSource {
  id: string;
  name: string;
  container: string | null;
  resolution: string | null;
  videoRange: string | null;
  videoCodec: string | null;
  supportsDirectPlay: boolean;
  supportsDirectStream: boolean;
  audioTracks: VidaaTrackChoice[];
  subtitleTracks: VidaaTrackChoice[];
  defaultAudioIndex: number | null;
  defaultSubtitleIndex: number | null;
}

export interface VidaaPlaybackOptions {
  item: VidaaMediaItem;
  sources: VidaaPlaybackSource[];
  mediaSourceId: string;
  container: string | null;
  audioTracks: VidaaTrackChoice[];
  subtitleTracks: VidaaTrackChoice[];
  defaultAudioIndex: number | null;
  defaultSubtitleIndex: number | null;
  chapters: VidaaChapter[];
  nextItem: VidaaMediaItem | null;
}

export interface VidaaPlaybackRequest {
  mediaSourceId: string;
  startPositionTicks: number;
  audioStreamIndex: number | null;
  subtitleStreamIndex: number | null;
  maxStreamingBitrate?: number | null;
  audioProfile?: VidaaAudioProfile;
  audioCodecs?: VidaaAudioCodec[];
}

export type VidaaPlayMethod =
  | 'DirectPlay'
  | 'DirectStream'
  | 'Transcode';

export interface VidaaPlaybackPlan {
  item: VidaaMediaItem;
  mediaUrl: string;
  subtitleUrl: string | null;
  subtitleLanguage: string | null;
  subtitleLabel: string | null;
  audioStreamIndex: number | null;
  subtitleStreamIndex: number | null;
  segments: SkipSegment[];
  chapters: VidaaChapter[];
  nextItem: VidaaMediaItem | null;
  playSessionId: string;
  mediaSourceId: string;
  playMethod: VidaaPlayMethod;
  videoIsCopy: boolean;
  container: string | null;
  videoCodec: string | null;
  videoRange: string | null;
  audioCodec: string | null;
  audioOutputCodec: string | null;
  audioLayout: string | null;
  audioIsCopy: boolean;
  audioProfile: VidaaAudioProfile;
  startPositionSeconds: number;
}

export interface VidaaPlaybackReport {
  event: 'start' | 'progress' | 'stop';
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  playMethod: VidaaPlayMethod;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  muted: boolean;
  volume: number;
}

export interface VidaaBridgeError {
  error: string;
}
