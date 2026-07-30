export const APP_NAME = 'JellyClient';
export const APP_VERSION = '0.1.3';
export const TICKS_PER_SECOND = 10_000_000;

export type ConnectionStatus =
  | 'signed-out'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type PlaybackStatus =
  | 'idle'
  | 'starting'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'error';

export type HdrMode = 'auto' | 'passthrough' | 'tone-map';
export type GpuApi = 'd3d11' | 'vulkan';

export interface ServerProfile {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  basePath: string;
  username: string;
  displayName: string;
}

export interface ConnectionInput extends ServerProfile {
  password: string;
  rememberSession: boolean;
}

export interface PlayerSettings {
  mpvPath: string;
  hdrMode: HdrMode;
  gpuApi: GpuApi;
  hardwareDecoding: boolean;
  alwaysOnTop: boolean;
  fullscreenOnPlay: boolean;
  autoEnableSubtitles: boolean;
  preferredSubtitleLanguage: string;
}

export interface SyncPlaySettings {
  autoJoinUnambiguousCast: boolean;
  softCorrectionThresholdMs: number;
  hardSeekThresholdMs: number;
}

export interface AppSettings {
  player: PlayerSettings;
  syncPlay: SyncPlaySettings;
}

export interface UserSummary {
  id: string;
  name: string;
  primaryImageTag: string | null;
}

export interface ServerSummary {
  id: string;
  name: string;
  version: string;
  baseUrl: string;
}

export interface ConnectionState {
  status: ConnectionStatus;
  profile: ServerProfile | null;
  server: ServerSummary | null;
  user: UserSummary | null;
  tokenStoredSecurely: boolean;
  error: string | null;
}

export interface LibraryView {
  id: string;
  name: string;
  collectionType: string | null;
  imageUrl: string | null;
}

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  seriesName: string | null;
  productionYear: number | null;
  indexLabel: string | null;
  overview: string | null;
  tagline: string | null;
  communityRating: number | null;
  officialRating: string | null;
  runtimeTicks: number | null;
  playbackPositionTicks: number;
  playedPercentage: number;
  isPlayed: boolean;
  isFavorite: boolean;
  isFolder: boolean;
  canPlay: boolean;
  imageUrl: string | null;
  backdropUrl: string | null;
}

export interface HomePayload {
  libraries: LibraryView[];
  resume: MediaItem[];
  latest: MediaItem[];
}

export interface ItemsPage {
  items: MediaItem[];
  startIndex: number;
  totalRecordCount: number;
}

export interface ItemDetails extends MediaItem {
  genres: string[];
  studios: string[];
  people: Array<{
    id: string;
    name: string;
    role: string | null;
    type: string | null;
    imageUrl: string | null;
  }>;
  childCount: number;
}

export interface TrackInfo {
  id: number;
  ffIndex: number | null;
  type: 'audio' | 'subtitle';
  title: string;
  language: string | null;
  codec: string | null;
  selected: boolean;
  default: boolean;
  external: boolean;
  forced: boolean;
}

export interface PlaybackDiagnostics {
  deliveryMode: 'DirectPlay' | 'DirectStream' | 'Transcode' | 'Unknown';
  container: string | null;
  sourceBitrate: number | null;
  videoCodec: string | null;
  videoProfile: string | null;
  videoBitDepth: number | null;
  audioCodec: string | null;
  audioChannels: string | null;
  audioSampleRate: number | null;
  videoParams: string | null;
  sourcePixelFormat: string | null;
  mediaColorPrimaries: string | null;
  mediaColorTransfer: string | null;
  mediaColorMatrix: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorMatrix: string | null;
  colorLevels: string | null;
  lightType: string | null;
  masteringMinLuminance: number | null;
  masteringMaxLuminance: number | null;
  maxCll: number | null;
  maxFall: number | null;
  outputPrimaries: string | null;
  outputTransfer: string | null;
  outputMatrix: string | null;
  outputLevels: string | null;
  outputPixelFormat: string | null;
  outputMinLuminance: number | null;
  outputMaxLuminance: number | null;
  displayNames: string[];
  displayFps: number;
  hdrMode: HdrMode;
  gpuApi: GpuApi;
  gpuContext: string;
  targetPolicy: string;
  colorHint: string | null;
  colorHintMode: string | null;
  toneMapping: string | null;
  currentVo: string | null;
  hwdec: string | null;
  audioOutputFormat: string | null;
  audioOutputChannels: string | null;
  audioOutputSampleRate: number | null;
  cacheDurationSeconds: number;
  droppedFrames: number;
  mpvVersion: string | null;
  reason: string | null;
}

export interface PlaybackState {
  status: PlaybackStatus;
  generation: number;
  item: MediaItem | null;
  positionSeconds: number;
  durationSeconds: number;
  paused: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  fullscreen: boolean;
  tracks: TrackInfo[];
  error: string | null;
  diagnostics: PlaybackDiagnostics;
}

export interface MpvCapability {
  available: boolean;
  executablePath: string | null;
  version: string | null;
  error: string | null;
}

export interface SyncPlayGroup {
  id: string;
  name: string;
  state: string;
  participants: string[];
}

export interface SyncPlayState {
  membership: 'not-joined' | 'joining' | 'joined' | 'leaving' | 'error';
  currentGroup: SyncPlayGroup | null;
  groups: SyncPlayGroup[];
  groupQueueItemId: string | null;
  playlistItemId: string | null;
  clockOffsetMs: number;
  roundTripMs: number;
  driftMs: number;
  error: string | null;
}

export interface AppBootstrap {
  configPath: string;
  connection: ConnectionState;
  settings: AppSettings;
  mpv: MpvCapability;
  playback: PlaybackState;
  syncPlay: SyncPlayState;
}

export interface CatalogQuery {
  parentId: string | null;
  searchTerm: string;
  startIndex: number;
  limit: number;
  includeItemTypes: string[];
}

export interface PlayMediaInput {
  itemId: string;
  startPositionTicks: number;
  audioStreamIndex: number | null;
  subtitleStreamIndex: number | null;
}

export interface WatchTogetherInput {
  itemId: string;
  startPositionTicks: number;
  groupName: string;
}

export type ClientEvent =
  | { type: 'connection'; data: ConnectionState }
  | { type: 'playback'; data: PlaybackState }
  | { type: 'syncplay'; data: SyncPlayState }
  | {
      type: 'notice';
      data: { level: 'info' | 'warning' | 'error'; message: string };
    };

export interface JellyClientApi {
  bootstrap(): Promise<AppBootstrap>;
  connect(input: ConnectionInput): Promise<ConnectionState>;
  disconnect(): Promise<ConnectionState>;
  getHome(): Promise<HomePayload>;
  getItems(query: CatalogQuery): Promise<ItemsPage>;
  getItem(itemId: string): Promise<ItemDetails>;
  play(input: PlayMediaInput): Promise<PlaybackState>;
  playbackAction(
    action:
      | { type: 'play' }
      | { type: 'pause' }
      | { type: 'stop' }
      | { type: 'seek'; positionSeconds: number }
      | { type: 'volume'; volume: number }
      | { type: 'mute'; muted: boolean }
      | { type: 'fullscreen'; fullscreen: boolean }
      | { type: 'toggle-stats' }
      | { type: 'select-track'; trackType: 'audio' | 'subtitle'; id: number | null }
  ): Promise<PlaybackState>;
  copyDebugReport(report: string): Promise<void>;
  probeMpv(): Promise<MpvCapability>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  chooseMpv(): Promise<MpvCapability>;
  openConfigFolder(): Promise<void>;
  listSyncPlayGroups(): Promise<SyncPlayState>;
  createSyncPlayGroup(name: string): Promise<SyncPlayState>;
  joinSyncPlayGroup(groupId: string): Promise<SyncPlayState>;
  leaveSyncPlayGroup(): Promise<SyncPlayState>;
  watchTogether(input: WatchTogetherInput): Promise<SyncPlayState>;
  syncPlayAction(
    action:
      | { type: 'play' }
      | { type: 'pause' }
      | { type: 'stop' }
      | { type: 'seek'; positionTicks: number }
  ): Promise<SyncPlayState>;
  subscribe(listener: (event: ClientEvent) => void): () => void;
}
