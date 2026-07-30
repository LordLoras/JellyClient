import type {
  AppSettings,
  ConnectionState,
  PlaybackDiagnostics,
  PlaybackState,
  SyncPlayState
} from './contracts.js';

export const defaultSettings: AppSettings = {
  player: {
    mpvPath: '',
    hdrMode: 'auto',
    gpuApi: 'd3d11',
    hardwareDecoding: true,
    alwaysOnTop: false,
    fullscreenOnPlay: true,
    autoEnableSubtitles: true,
    preferredSubtitleLanguage: 'eng'
  },
  syncPlay: {
    autoJoinUnambiguousCast: true,
    softCorrectionThresholdMs: 80,
    hardSeekThresholdMs: 500
  }
};

export const initialConnectionState: ConnectionState = {
  status: 'signed-out',
  profile: null,
  server: null,
  user: null,
  tokenStoredSecurely: false,
  error: null
};

export const initialPlaybackDiagnostics: PlaybackDiagnostics = {
  deliveryMode: 'Unknown',
  container: null,
  sourceBitrate: null,
  videoCodec: null,
  videoProfile: null,
  videoBitDepth: null,
  audioCodec: null,
  audioChannels: null,
  audioSampleRate: null,
  videoParams: null,
  sourcePixelFormat: null,
  mediaColorPrimaries: null,
  mediaColorTransfer: null,
  mediaColorMatrix: null,
  colorPrimaries: null,
  colorTransfer: null,
  colorMatrix: null,
  colorLevels: null,
  lightType: null,
  masteringMinLuminance: null,
  masteringMaxLuminance: null,
  maxCll: null,
  maxFall: null,
  outputPrimaries: null,
  outputTransfer: null,
  outputMatrix: null,
  outputLevels: null,
  outputPixelFormat: null,
  outputMinLuminance: null,
  outputMaxLuminance: null,
  displayNames: [],
  displayFps: 0,
  hdrMode: 'auto',
  gpuApi: 'd3d11',
  gpuContext: 'd3d11',
  targetPolicy: 'Automatic display target',
  colorHint: null,
  colorHintMode: null,
  toneMapping: null,
  currentVo: null,
  hwdec: null,
  audioOutputFormat: null,
  audioOutputChannels: null,
  audioOutputSampleRate: null,
  cacheDurationSeconds: 0,
  droppedFrames: 0,
  mpvVersion: null,
  reason: null
};

export const initialPlaybackState: PlaybackState = {
  status: 'idle',
  generation: 0,
  item: null,
  positionSeconds: 0,
  durationSeconds: 0,
  paused: true,
  buffering: false,
  volume: 100,
  muted: false,
  fullscreen: false,
  tracks: [],
  error: null,
  diagnostics: initialPlaybackDiagnostics
};

export const initialSyncPlayState: SyncPlayState = {
  membership: 'not-joined',
  currentGroup: null,
  groups: [],
  groupQueueItemId: null,
  playlistItemId: null,
  clockOffsetMs: 0,
  roundTripMs: 0,
  driftMs: 0,
  error: null
};
