import type {
  VidaaPlaybackOptions,
  VidaaPlaybackRequest,
  VidaaTrackChoice
} from './jellyfin-types.js';

export type VidaaSubtitleSize = 'small' | 'standard' | 'large' | 'extra-large';
export type VidaaSubtitleColor = 'white' | 'yellow';
export type VidaaSubtitleBackground = 'shadow' | 'soft' | 'solid';
export type VidaaSubtitlePosition = 'lower' | 'higher';
export type VidaaControlTimeout = 0 | 3.5 | 6 | 10;
export type VidaaSeekSeconds = 10 | 30 | 60;

export interface VidaaPlayerSettings {
  version: 1;
  subtitlesEnabled: boolean;
  preferredSubtitleLanguage: string;
  preferredAudioLanguage: string;
  subtitleSize: VidaaSubtitleSize;
  subtitleColor: VidaaSubtitleColor;
  subtitleBackground: VidaaSubtitleBackground;
  subtitlePosition: VidaaSubtitlePosition;
  seekSeconds: VidaaSeekSeconds;
  controlTimeoutSeconds: VidaaControlTimeout;
}

export const DEFAULT_VIDAA_PLAYER_SETTINGS: VidaaPlayerSettings = {
  version: 1,
  subtitlesEnabled: true,
  preferredSubtitleLanguage: 'eng',
  preferredAudioLanguage: '',
  subtitleSize: 'standard',
  subtitleColor: 'white',
  subtitleBackground: 'shadow',
  subtitlePosition: 'lower',
  seekSeconds: 10,
  controlTimeoutSeconds: 3.5
};

const STORAGE_KEY = 'jellyclient-vidaa-player-settings-v1';
const SUBTITLE_SIZES = new Set<VidaaSubtitleSize>([
  'small',
  'standard',
  'large',
  'extra-large'
]);
const SUBTITLE_COLORS = new Set<VidaaSubtitleColor>(['white', 'yellow']);
const SUBTITLE_BACKGROUNDS = new Set<VidaaSubtitleBackground>([
  'shadow',
  'soft',
  'solid'
]);
const SUBTITLE_POSITIONS = new Set<VidaaSubtitlePosition>(['lower', 'higher']);
const SEEK_SECONDS = new Set<VidaaSeekSeconds>([10, 30, 60]);
const CONTROL_TIMEOUTS = new Set<VidaaControlTimeout>([0, 3.5, 6, 10]);

function language(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().toLowerCase().slice(0, 12);
}

export function parsePlayerSettings(value: unknown): VidaaPlayerSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_VIDAA_PLAYER_SETTINGS };
  }
  const candidate = value as Partial<VidaaPlayerSettings>;
  return {
    version: 1,
    subtitlesEnabled: typeof candidate.subtitlesEnabled === 'boolean'
      ? candidate.subtitlesEnabled
      : DEFAULT_VIDAA_PLAYER_SETTINGS.subtitlesEnabled,
    preferredSubtitleLanguage: language(
      candidate.preferredSubtitleLanguage,
      DEFAULT_VIDAA_PLAYER_SETTINGS.preferredSubtitleLanguage
    ),
    preferredAudioLanguage: language(
      candidate.preferredAudioLanguage,
      DEFAULT_VIDAA_PLAYER_SETTINGS.preferredAudioLanguage
    ),
    subtitleSize: SUBTITLE_SIZES.has(candidate.subtitleSize as VidaaSubtitleSize)
      ? candidate.subtitleSize as VidaaSubtitleSize
      : DEFAULT_VIDAA_PLAYER_SETTINGS.subtitleSize,
    subtitleColor: SUBTITLE_COLORS.has(candidate.subtitleColor as VidaaSubtitleColor)
      ? candidate.subtitleColor as VidaaSubtitleColor
      : DEFAULT_VIDAA_PLAYER_SETTINGS.subtitleColor,
    subtitleBackground: SUBTITLE_BACKGROUNDS.has(
      candidate.subtitleBackground as VidaaSubtitleBackground
    )
      ? candidate.subtitleBackground as VidaaSubtitleBackground
      : DEFAULT_VIDAA_PLAYER_SETTINGS.subtitleBackground,
    subtitlePosition: SUBTITLE_POSITIONS.has(
      candidate.subtitlePosition as VidaaSubtitlePosition
    )
      ? candidate.subtitlePosition as VidaaSubtitlePosition
      : DEFAULT_VIDAA_PLAYER_SETTINGS.subtitlePosition,
    seekSeconds: SEEK_SECONDS.has(candidate.seekSeconds as VidaaSeekSeconds)
      ? candidate.seekSeconds as VidaaSeekSeconds
      : DEFAULT_VIDAA_PLAYER_SETTINGS.seekSeconds,
    controlTimeoutSeconds: CONTROL_TIMEOUTS.has(
      candidate.controlTimeoutSeconds as VidaaControlTimeout
    )
      ? candidate.controlTimeoutSeconds as VidaaControlTimeout
      : DEFAULT_VIDAA_PLAYER_SETTINGS.controlTimeoutSeconds
  };
}

export function loadPlayerSettings(): VidaaPlayerSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored
      ? parsePlayerSettings(JSON.parse(stored) as unknown)
      : { ...DEFAULT_VIDAA_PLAYER_SETTINGS };
  } catch {
    return { ...DEFAULT_VIDAA_PLAYER_SETTINGS };
  }
}

export function savePlayerSettings(settings: VidaaPlayerSettings): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(parsePlayerSettings(settings))
  );
}

function normalizedLanguage(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function preferredTrackIndex(
  tracks: VidaaTrackChoice[],
  preferredLanguage: string,
  fallbackIndex: number | null
): number | null {
  const preferred = normalizedLanguage(preferredLanguage);
  if (preferred) {
    const languageTracks = tracks.filter((track) => {
      const trackLanguage = normalizedLanguage(track.language);
      return Boolean(trackLanguage) && (
        trackLanguage === preferred ||
        trackLanguage.startsWith(preferred) ||
        preferred.startsWith(trackLanguage)
      );
    });
    const match = languageTracks.find((track) => track.isForced) ??
      languageTracks.find((track) => track.isDefault) ??
      languageTracks[0];
    if (match) return match.index;
  }
  return tracks.some((track) => track.index === fallbackIndex)
    ? fallbackIndex
    : tracks.find((track) => track.isDefault)?.index ?? tracks[0]?.index ?? null;
}

export function preferredPlaybackTracks(
  options: VidaaPlaybackOptions,
  settings: VidaaPlayerSettings
): Pick<VidaaPlaybackRequest, 'audioStreamIndex' | 'subtitleStreamIndex'> {
  const textSubtitles = options.subtitleTracks.filter((track) => track.isText);
  return {
    audioStreamIndex: preferredTrackIndex(
      options.audioTracks,
      settings.preferredAudioLanguage,
      options.defaultAudioIndex
    ),
    subtitleStreamIndex: settings.subtitlesEnabled
      ? preferredTrackIndex(
        textSubtitles,
        settings.preferredSubtitleLanguage,
        options.defaultSubtitleIndex
      )
      : null
  };
}
