export const APP_NAME = 'JellyClient';
export const APP_VERSION = '0.4.2';
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
export type AudioOutputMode = 'pcm' | 'passthrough';

export interface AudioPassthroughSettings {
  ac3: boolean;
  eac3: boolean;
  truehd: boolean;
  dts: boolean;
  dtsHd: boolean;
}

export interface MpvAudioDevice {
  id: string;
  description: string;
}
export type CatalogSort =
  | 'SortName'
  | 'DateCreated'
  | 'PremiereDate'
  | 'ProductionYear'
  | 'CommunityRating'
  | 'Runtime';
export type CatalogFilter = 'all' | 'unplayed' | 'played' | 'favorite';

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

export type ServerAddress = Omit<ServerProfile, 'username'>;

export interface DiscoveredServer {
  id: string;
  name: string;
  address: string;
  endpointAddress: string | null;
}

export interface QuickConnectStartInput extends ServerAddress {
  rememberSession: boolean;
}

export interface QuickConnectRequest {
  secret: string;
  code: string;
  serverName: string;
  expiresAt: string;
}

export interface QuickConnectPollResult {
  status: 'pending' | 'authenticated' | 'expired';
  connection: ConnectionState | null;
}

export interface SeriesPlaybackPreference {
  audioLanguage: string | null;
  subtitleLanguage: string | null;
  subtitlesEnabled: boolean;
}

export interface PlayerSettings {
  mpvPath: string;
  hdrMode: HdrMode;
  gpuApi: GpuApi;
  hardwareDecoding: boolean;
  audioDevice: string;
  audioOutputMode: AudioOutputMode;
  audioPassthrough: AudioPassthroughSettings;
  alwaysOnTop: boolean;
  fullscreenOnPlay: boolean;
  autoEnableSubtitles: boolean;
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  preferForcedSubtitles: boolean;
  avoidSdhSubtitles: boolean;
  rememberSeriesPreferences: boolean;
  seriesPreferences: Record<string, SeriesPlaybackPreference>;
  playbackSpeed: number;
  subtitleDelaySeconds: number;
  audioDelaySeconds: number;
  autoSkipIntro: boolean;
  autoSkipOutro: boolean;
  autoPlayNext: boolean;
  nextEpisodeCountdownSeconds: number;
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

export interface MediaFormatInfo {
  resolution: string | null;
  videoRange: string | null;
  audio: string | null;
}

export interface MediaItem {
  id: string;
  name: string;
  type: string;
  seriesName: string | null;
  seriesId: string | null;
  seasonId: string | null;
  parentId: string | null;
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
  mediaFormat: MediaFormatInfo;
  imageUrl: string | null;
  backdropUrl: string | null;
}

export interface MediaChapter {
  name: string;
  startTicks: number;
  imageUrl: string | null;
}

export interface PlaybackTrackOption {
  index: number;
  type: 'audio' | 'subtitle';
  title: string;
  language: string | null;
  codec: string | null;
  channels: string | null;
  default: boolean;
  forced: boolean;
  hearingImpaired: boolean;
  external: boolean;
}

export interface PlaybackSourceOption {
  id: string;
  name: string;
  container: string | null;
  size: number | null;
  bitrate: number | null;
  resolution: string | null;
  videoCodec: string | null;
  videoRange: string | null;
  dolbyVisionProfile: number | null;
  audio: string | null;
  supportsDirectPlay: boolean;
  supportsDirectStream: boolean;
  audioTracks: PlaybackTrackOption[];
  subtitleTracks: PlaybackTrackOption[];
}

export interface TrickplayOption {
  mediaSourceId: string;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  intervalMs: number;
  tileUrlTemplate: string;
}

export interface HomePayload {
  libraries: LibraryView[];
  resume: MediaItem[];
  nextUp: MediaItem[];
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
  chapters: MediaChapter[];
  trickplay: TrickplayOption[];
  playbackSources: PlaybackSourceOption[];
  specialFeatures: MediaItem[];
  localTrailers: MediaItem[];
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
  audioRequestedDevice: string;
  audioDriver: string | null;
  audioOutputMode: AudioOutputMode;
  audioPassthroughCodecs: string[];
  audioPassthroughActive: boolean;
  audioFallbackReason: string | null;
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
  speed: number;
  subtitleDelaySeconds: number;
  audioDelaySeconds: number;
  chapters: MediaChapter[];
  trickplay: TrickplayOption[];
  currentChapterIndex: number | null;
  nextItem: MediaItem | null;
  postPlaySecondsRemaining: number | null;
  postPlayCanceled: boolean;
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
  sortBy?: CatalogSort | undefined;
  sortDescending?: boolean | undefined;
  filter?: CatalogFilter | undefined;
}

export interface PlayMediaInput {
  itemId: string;
  startPositionTicks: number;
  mediaSourceId: string | null;
  maxStreamingBitrate: number | null;
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
  | { type: 'catalog-changed'; data: { reason: 'library' } }
  | {
      type: 'notice';
      data: { level: 'info' | 'warning' | 'error'; message: string };
    };

export interface JellyClientApi {
  bootstrap(): Promise<AppBootstrap>;
  connect(input: ConnectionInput): Promise<ConnectionState>;
  discoverServers(): Promise<DiscoveredServer[]>;
  startQuickConnect(input: QuickConnectStartInput): Promise<QuickConnectRequest>;
  pollQuickConnect(secret: string): Promise<QuickConnectPollResult>;
  cancelQuickConnect(secret: string): Promise<void>;
  disconnect(): Promise<ConnectionState>;
  getHome(): Promise<HomePayload>;
  discardPlaybackProgress(itemId: string): Promise<HomePayload>;
  getItems(query: CatalogQuery): Promise<ItemsPage>;
  getItem(itemId: string): Promise<ItemDetails>;
  setFavorite(itemId: string, favorite: boolean): Promise<ItemDetails>;
  setPlayed(itemId: string, played: boolean): Promise<ItemDetails>;
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
      | { type: 'speed'; speed: number }
      | { type: 'subtitle-delay'; seconds: number }
      | { type: 'audio-delay'; seconds: number }
      | { type: 'chapter'; index: number }
      | { type: 'cancel-post-play' }
      | { type: 'play-next' }
      | { type: 'select-track'; trackType: 'audio' | 'subtitle'; id: number | null }
  ): Promise<PlaybackState>;
  copyDebugReport(report: string): Promise<void>;
  probeMpv(): Promise<MpvCapability>;
  listAudioDevices(): Promise<MpvAudioDevice[]>;
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
