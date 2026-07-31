import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import {
  coalesceSkipSegments,
  validSkipSegment,
  type SkipSegment
} from '../../src/shared/skip-segments.js';
import type {
  VidaaHomePayload,
  VidaaJellyfinSession,
  VidaaItemsPage,
  VidaaLibrary,
  VidaaMediaItem,
  VidaaPlaybackOptions,
  VidaaPlaybackPlan,
  VidaaPlaybackReport,
  VidaaPlaybackRequest,
  VidaaPlaybackSource,
  VidaaPlayMethod,
  VidaaTrackChoice
} from '../src/jellyfin-types.js';
import {
  deviceProfile,
  resolvedAudioProfile
} from './audio-profile.js';

const VIDAA_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_SESSION_PATH = resolve(VIDAA_ROOT, 'jellyfin.local.json');
const CLIENT_NAME = 'JellyClient VIDAA';
const CLIENT_VERSION = '1.0.0';
const TICKS_PER_SECOND = 10_000_000;
const TEXT_SUBTITLE_CODECS = new Set([
  'ass',
  'mov_text',
  'ssa',
  'srt',
  'subrip',
  'text',
  'tx3g',
  'webvtt',
  'vtt'
]);
const VIDEO_COPY_SAFE_TRANSCODE_REASONS = new Set([
  'AudioBitDepthNotSupported',
  'AudioBitrateNotSupported',
  'AudioChannelsNotSupported',
  'AudioCodecNotSupported',
  'AudioProfileNotSupported',
  'AudioSampleRateNotSupported',
  'ContainerNotSupported',
  'SecondaryAudioNotSupported',
  'SubtitleCodecNotSupported'
]);

interface StoredSession {
  version: 1;
  deviceId: string;
  baseUrl: string;
  accessToken: string;
  userId: string;
  serverId: string;
  serverName: string;
  serverVersion: string;
  userName: string;
}

interface RawMediaStream {
  Index?: number;
  Type?: string;
  Codec?: string | null;
  Language?: string | null;
  Title?: string | null;
  DisplayTitle?: string | null;
  Channels?: number | null;
  ChannelLayout?: string | null;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  Width?: number | null;
  Height?: number | null;
  BitDepth?: number | null;
  VideoRange?: string | null;
  VideoRangeType?: string | null;
  ColorTransfer?: string | null;
  ColorPrimaries?: string | null;
}

interface RawMediaSource {
  Id?: string;
  Name?: string | null;
  Container?: string | null;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingContainer?: string | null;
  TranscodingUrl?: string | null;
  TranscodingReasons?: string[];
  LiveStreamId?: string | null;
  DefaultAudioStreamIndex?: number | null;
  DefaultSubtitleStreamIndex?: number | null;
  MediaStreams?: RawMediaStream[];
}

interface RawMediaSegment {
  Id?: string | null;
  Type?: string | null;
  StartTicks?: number | null;
  EndTicks?: number | null;
}

interface RawItem {
  Id?: string;
  Name?: string | null;
  Type?: string | null;
  SeriesName?: string | null;
  SeriesId?: string | null;
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
  ProductionYear?: number | null;
  Overview?: string | null;
  RunTimeTicks?: number | null;
  IsFolder?: boolean;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  MediaSources?: RawMediaSource[];
  Chapters?: Array<{
    Name?: string | null;
    StartPositionTicks?: number | null;
  }>;
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
  };
}

interface Ticket {
  upstreamUrl: string;
  expiresAt: number;
}

interface PendingQuickConnect {
  baseUrl: string;
  deviceId: string;
  secret: string;
  code: string;
  expiresAt: number;
  system: { Id?: string; ServerName?: string; Version?: string };
}

const tickets = new Map<string, Ticket>();
const pendingQuickConnect = new Map<string, PendingQuickConnect>();

function sessionPath(): string {
  const override = process.env.VIDAA_JELLYFIN_CONFIG_PATH?.trim();
  return override ? resolve(override) : DEFAULT_SESSION_PATH;
}

function cleanBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter the Jellyfin server URL.');
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The Jellyfin URL must use http:// or https://.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function isLoopback(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? '';
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function text(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(body);
}

async function bodyJson(request: IncomingMessage): Promise<unknown> {
  return await new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function clientAuthorization(deviceId: string, token = ''): string {
  const fields = [
    `Client="${CLIENT_NAME}"`,
    'Device="Hisense VIDAA"',
    `DeviceId="${deviceId}"`,
    `Version="${CLIENT_VERSION}"`
  ];
  if (token) fields.push(`Token="${token}"`);
  return `MediaBrowser ${fields.join(', ')}`;
}

async function loadSession(): Promise<StoredSession | null> {
  const path = sessionPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<StoredSession>;
    if (
      raw.version !== 1 ||
      typeof raw.deviceId !== 'string' ||
      typeof raw.baseUrl !== 'string' ||
      typeof raw.accessToken !== 'string' ||
      typeof raw.userId !== 'string'
    ) return null;
    return {
      version: 1,
      deviceId: raw.deviceId,
      baseUrl: cleanBaseUrl(raw.baseUrl),
      accessToken: raw.accessToken,
      userId: raw.userId,
      serverId: raw.serverId ?? '',
      serverName: raw.serverName ?? 'Jellyfin',
      serverVersion: raw.serverVersion ?? 'unknown',
      userName: raw.userName ?? 'Jellyfin user'
    };
  } catch {
    return null;
  }
}

async function saveSession(session: StoredSession): Promise<void> {
  await writeFile(sessionPath(), `${JSON.stringify(session, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function publicSession(session: StoredSession | null, error: string | null = null): VidaaJellyfinSession {
  return {
    connected: Boolean(session),
    baseUrl: session?.baseUrl ?? null,
    serverName: session?.serverName ?? null,
    serverVersion: session?.serverVersion ?? null,
    userName: session?.userName ?? null,
    error
  };
}

async function jellyfinFetch(
  session: StoredSession,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl.replace(/^\//, ''), `${session.baseUrl}/`);
  const base = new URL(`${session.baseUrl}/`);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('Jellyfin returned an unsafe cross-server URL.');
  }
  url.searchParams.delete('api_key');
  const headers = new Headers(init.headers);
  headers.set('Authorization', clientAuthorization(session.deviceId, session.accessToken));
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // The status code remains useful when Jellyfin closes the body early.
    }
    throw new Error(`Jellyfin returned ${response.status}${detail ? `: ${detail}` : '.'}`);
  }
  return response;
}

async function jellyfinJson<T>(
  session: StoredSession,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await jellyfinFetch(session, path, init);
  return await response.json() as T;
}

function firstVideo(item: RawItem): RawMediaStream | undefined {
  return item.MediaSources?.flatMap((source) => source.MediaStreams ?? [])
    .find((stream) => stream.Type === 'Video');
}

function firstAudio(item: RawItem): RawMediaStream | undefined {
  return item.MediaSources?.flatMap((source) => source.MediaStreams ?? [])
    .find((stream) => stream.Type === 'Audio');
}

function videoRange(video: RawMediaStream | undefined): string | null {
  const declared = video?.VideoRangeType ?? video?.VideoRange;
  const normalized = declared?.toLowerCase() ?? '';
  if (normalized.includes('dovi') || normalized.includes('dolby')) {
    return 'Dolby Vision';
  }
  if (normalized.includes('hdr10plus')) return 'HDR10+';
  if (normalized.includes('hdr10') || normalized === 'hdr') return 'HDR10';
  if (normalized.includes('hlg')) return 'HLG';
  if (normalized === 'sdr') return 'SDR';
  if (declared) return declared;
  if (video?.ColorTransfer?.toLowerCase() === 'smpte2084') return 'HDR10';
  return null;
}

function mapItem(item: RawItem): VidaaMediaItem {
  const id = item.Id ?? '';
  const video = firstVideo(item);
  const audio = firstAudio(item);
  const imageTag = item.ImageTags?.Primary;
  const backdropTag = item.BackdropImageTags?.[0];
  const isEpisode = item.Type === 'Episode';
  const height = video?.Height ?? null;
  const resolution = height
    ? height >= 2160 ? '4K' : height >= 1080 ? '1080p' : `${height}p`
    : null;
  const audioLabel = audio?.Codec
    ? `${audio.Codec.toUpperCase()}${audio.ChannelLayout ? ` ${audio.ChannelLayout}` : ''}`
    : null;
  return {
    id,
    name: item.Name ?? 'Untitled',
    type: item.Type ?? 'Unknown',
    seriesName: item.SeriesName ?? null,
    seriesId: item.SeriesId ?? null,
    indexLabel: isEpisode
      ? `S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')} E${String(item.IndexNumber ?? 0).padStart(2, '0')}`
      : null,
    productionYear: item.ProductionYear ?? null,
    overview: item.Overview ?? null,
    runtimeTicks: item.RunTimeTicks ?? null,
    playbackPositionTicks: item.UserData?.PlaybackPositionTicks ?? 0,
    playedPercentage: item.UserData?.PlayedPercentage ?? 0,
    canPlay: item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video',
    isFolder: Boolean(item.IsFolder),
    imageUrl: id && imageTag
      ? `/api/vidaa/images/${encodeURIComponent(id)}/Primary?tag=${encodeURIComponent(imageTag)}&maxWidth=700`
      : null,
    backdropUrl: id && backdropTag
      ? `/api/vidaa/images/${encodeURIComponent(id)}/Backdrop?tag=${encodeURIComponent(backdropTag)}&maxWidth=1600`
      : null,
    mediaFormat: {
      resolution,
      videoRange: videoRange(video),
      audio: audioLabel
    }
  };
}

function itemFields(): string {
  return [
    'Overview',
    'PrimaryImageAspectRatio',
    'MediaStreams',
    'MediaSources',
    'Chapters',
    'ParentId'
  ].join(',');
}

function uniqueItems(items: RawItem[]): RawItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.Id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function home(session: StoredSession): Promise<VidaaHomePayload> {
  const fields = encodeURIComponent(itemFields());
  const user = encodeURIComponent(session.userId);
  const [views, resume, nextUp, latest] = await Promise.all([
    jellyfinJson<{ Items?: RawItem[] }>(session, `/Users/${user}/Views`),
    jellyfinJson<{ Items?: RawItem[] }>(
      session,
      `/Users/${user}/Items/Resume?Limit=18&MediaTypes=Video&Fields=${fields}&EnableImages=true&EnableUserData=true&ExcludeActiveSessions=true`
    ),
    jellyfinJson<{ Items?: RawItem[] }>(
      session,
      `/Shows/NextUp?UserId=${user}&Limit=24&Fields=${fields}&EnableImages=true&EnableUserData=true&EnableTotalRecordCount=false&EnableResumable=false&EnableRewatching=false`
    ),
    jellyfinJson<RawItem[]>(
      session,
      `/Users/${user}/Items/Latest?Limit=30&IncludeItemTypes=Movie,Episode,Series&Fields=${fields}&EnableImages=true&EnableUserData=true&GroupItems=true`
    )
  ]);
  const libraries: VidaaLibrary[] = (views.Items ?? []).map((item) => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Library',
    collectionType: null,
    imageUrl: item.Id && item.ImageTags?.Primary
      ? `/api/vidaa/images/${encodeURIComponent(item.Id)}/Primary?tag=${encodeURIComponent(item.ImageTags.Primary)}&maxWidth=700`
      : null
  }));
  return {
    libraries,
    resume: uniqueItems(resume.Items ?? []).map(mapItem),
    nextUp: uniqueItems(nextUp.Items ?? []).map(mapItem),
    latest: uniqueItems(latest).map(mapItem)
  };
}

async function browseItems(
  session: StoredSession,
  parentId: string | null,
  searchTerm: string
): Promise<VidaaItemsPage> {
  const params = new URLSearchParams({
    UserId: session.userId,
    StartIndex: '0',
    Limit: '200',
    Fields: itemFields(),
    EnableImages: 'true',
    EnableUserData: 'true',
    EnableTotalRecordCount: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending'
  });
  if (parentId) params.set('ParentId', parentId);
  if (searchTerm) {
    params.set('SearchTerm', searchTerm);
    params.set('Recursive', 'true');
    params.set('IncludeItemTypes', 'Movie,Series,Season,Episode,Video,BoxSet');
  }
  const result = await jellyfinJson<{
    Items?: RawItem[];
    TotalRecordCount?: number;
  }>(session, `/Items?${params.toString()}`);
  const items = uniqueItems(result.Items ?? []).filter((item) =>
    Boolean(item.Id) && (
      Boolean(item.IsFolder) ||
      item.Type === 'Movie' ||
      item.Type === 'Episode' ||
      item.Type === 'Video' ||
      item.Type === 'Series' ||
      item.Type === 'Season' ||
      item.Type === 'BoxSet'
    )
  );
  return {
    items: items.map(mapItem),
    totalRecordCount: result.TotalRecordCount ?? items.length
  };
}

function mapTrack(stream: RawMediaStream): VidaaTrackChoice | null {
  if (typeof stream.Index !== 'number') return null;
  const type = stream.Type === 'Audio'
    ? 'audio'
    : stream.Type === 'Subtitle'
      ? 'subtitle'
      : null;
  if (!type) return null;
  const codec = stream.Codec?.toLowerCase() ?? null;
  return {
    index: stream.Index,
    type,
    language: stream.Language ?? null,
    title: stream.DisplayTitle ?? stream.Title ?? stream.Language ?? `${type} ${stream.Index}`,
    codec,
    channels: stream.Channels ?? null,
    channelLayout: stream.ChannelLayout ?? null,
    isDefault: Boolean(stream.IsDefault),
    isForced: Boolean(stream.IsForced),
    isExternal: Boolean(stream.IsExternal),
    isText: type === 'audio' || (codec !== null && TEXT_SUBTITLE_CODECS.has(codec))
  };
}

function preferredEnglish(tracks: VidaaTrackChoice[]): number | null {
  return tracks.find((track) =>
    track.language?.toLowerCase() === 'eng' && track.isForced
  )?.index ?? tracks.find((track) =>
    track.language?.toLowerCase() === 'eng' && track.isDefault
  )?.index ?? tracks.find((track) =>
    track.language?.toLowerCase() === 'eng'
  )?.index ?? tracks.find((track) => track.isDefault)?.index ?? tracks[0]?.index ?? null;
}

async function playbackOptions(
  session: StoredSession,
  itemId: string
): Promise<VidaaPlaybackOptions> {
  const user = encodeURIComponent(session.userId);
  const discovery = await jellyfinJson<{ MediaSources?: RawMediaSource[] }>(
    session,
    `/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${user}`
  );
  const source = discovery.MediaSources?.find((candidate) => candidate.SupportsDirectPlay) ??
    discovery.MediaSources?.[0];
  if (!source?.Id) throw new Error('Jellyfin did not return a media source.');
  const rawItem = await jellyfinJson<RawItem>(
    session,
    `/Users/${user}/Items/${encodeURIComponent(itemId)}?Fields=${encodeURIComponent(itemFields())}`
  );
  const sources = (discovery.MediaSources ?? []).flatMap((candidate) => {
    if (!candidate.Id) return [];
    const tracks = (candidate.MediaStreams ?? [])
      .map(mapTrack)
      .filter((track): track is VidaaTrackChoice => Boolean(track));
    const audioTracks = tracks.filter((track) => track.type === 'audio');
    const subtitleTracks = tracks.filter((track) => track.type === 'subtitle');
    const video = candidate.MediaStreams?.find((stream) => stream.Type === 'Video');
    const height = video?.Height ?? null;
    return [{
      id: candidate.Id,
      name: candidate.Name?.trim() || `Version ${candidate.Id.slice(0, 6)}`,
      container: candidate.Container ?? null,
      resolution: height ? height >= 2160 ? '4K' : height >= 1080 ? '1080p' : `${height}p` : null,
      videoRange: videoRange(video),
      videoCodec: video?.Codec ?? null,
      supportsDirectPlay: Boolean(candidate.SupportsDirectPlay),
      supportsDirectStream: Boolean(candidate.SupportsDirectStream),
      audioTracks,
      subtitleTracks,
      defaultAudioIndex: candidate.DefaultAudioStreamIndex ??
        audioTracks.find((track) => track.isDefault)?.index ??
        audioTracks[0]?.index ?? null,
      defaultSubtitleIndex: preferredEnglish(
        subtitleTracks.filter((track) => track.isText)
      )
    } satisfies VidaaPlaybackSource];
  });
  const selected = sources.find((candidate) => candidate.id === source.Id)!;
  const nextItem = await nextEpisode(session, rawItem);
  return {
    item: mapItem(rawItem),
    sources,
    mediaSourceId: source.Id,
    container: selected.container,
    audioTracks: selected.audioTracks,
    subtitleTracks: selected.subtitleTracks,
    defaultAudioIndex: selected.defaultAudioIndex,
    defaultSubtitleIndex: selected.defaultSubtitleIndex,
    chapters: (rawItem.Chapters ?? []).map((chapter, index) => ({
      name: chapter.Name?.trim() || `Chapter ${index + 1}`,
      startTicks: chapter.StartPositionTicks ?? 0
    })),
    nextItem
  };
}

async function nextEpisode(
  session: StoredSession,
  item: RawItem
): Promise<VidaaMediaItem | null> {
  if (item.Type !== 'Episode' || !item.SeriesId || !item.Id) return null;
  try {
    const response = await jellyfinJson<{ Items?: RawItem[] }>(
      session,
      `/Shows/${encodeURIComponent(item.SeriesId)}/Episodes?UserId=${encodeURIComponent(session.userId)}&Fields=${encodeURIComponent(itemFields())}&EnableImages=true&EnableUserData=true&SortBy=SortName`
    );
    const episodes = response.Items ?? [];
    const index = episodes.findIndex((episode) => episode.Id === item.Id);
    return index >= 0 && episodes[index + 1] ? mapItem(episodes[index + 1]!) : null;
  } catch {
    return null;
  }
}

async function mediaSegments(
  session: StoredSession,
  itemId: string
): Promise<SkipSegment[]> {
  try {
    const response = await jellyfinJson<{ Items?: RawMediaSegment[] }>(
      session,
      `/MediaSegments/${encodeURIComponent(itemId)}?includeSegmentTypes=Intro&includeSegmentTypes=Outro`
    );
    return coalesceSkipSegments(
      (response.Items ?? []).flatMap((segment) => {
        const normalized = validSkipSegment(
          segment.Id,
          segment.Type,
          segment.StartTicks,
          segment.EndTicks
        );
        return normalized ? [normalized] : [];
      })
    );
  } catch {
    return [];
  }
}

function playMethod(source: RawMediaSource): VidaaPlayMethod {
  if (source.SupportsDirectPlay) return 'DirectPlay';
  if (source.SupportsDirectStream) return 'DirectStream';
  return 'Transcode';
}

function queryValue(url: URL, names: string[]): string | null {
  for (const [key, value] of url.searchParams) {
    if (names.some((name) => key.toLowerCase() === name.toLowerCase())) return value;
  }
  return null;
}

function transcodeReasons(source: RawMediaSource, upstream: URL): string[] {
  const reported = source.TranscodingReasons ?? [];
  const encoded = queryValue(upstream, ['TranscodeReasons']);
  return [
    ...reported,
    ...(encoded?.split(',') ?? [])
  ]
    .map((reason) => reason.trim())
    .filter(Boolean)
    .filter((reason, index, reasons) => reasons.indexOf(reason) === index);
}

function canCopyVideo(
  source: RawMediaSource,
  upstream: URL,
  method: VidaaPlayMethod
): boolean {
  if (method !== 'Transcode') return true;
  const reasons = transcodeReasons(source, upstream);
  return reasons.length > 0 &&
    reasons.every((reason) => VIDEO_COPY_SAFE_TRANSCODE_REASONS.has(reason));
}

function isHdr(video: RawMediaStream | undefined): boolean {
  const range = `${video?.VideoRangeType ?? ''} ${video?.VideoRange ?? ''}`.toLowerCase();
  return video?.ColorTransfer?.toLowerCase() === 'smpte2084' ||
    range.includes('hdr') ||
    range.includes('dovi') ||
    range.includes('dolby');
}

async function planPlayback(
  session: StoredSession,
  itemId: string,
  input: VidaaPlaybackRequest
): Promise<VidaaPlaybackPlan> {
  const [options, segments] = await Promise.all([
    playbackOptions(session, itemId),
    mediaSegments(session, itemId)
  ]);
  const selectedSubtitle = options.subtitleTracks.find(
    (track) => track.index === input.subtitleStreamIndex
  );
  if (selectedSubtitle && !selectedSubtitle.isText) {
    throw new Error('Bitmap subtitles are not yet available in the VIDAA overlay. Choose subtitles off or a text/ASS track for this test.');
  }
  const user = encodeURIComponent(session.userId);
  const audioProfile = resolvedAudioProfile(input);
  const playback = await jellyfinJson<{
    MediaSources?: RawMediaSource[];
    PlaySessionId?: string;
    ErrorCode?: string;
  }>(session, `/Items/${encodeURIComponent(itemId)}/PlaybackInfo?UserId=${user}`, {
    method: 'POST',
    body: JSON.stringify({
      UserId: session.userId,
      MediaSourceId: input.mediaSourceId,
      StartTimeTicks: input.startPositionTicks,
      AudioStreamIndex: input.audioStreamIndex,
      SubtitleStreamIndex: null,
      MaxStreamingBitrate: input.maxStreamingBitrate ?? 120_000_000,
      MaxAudioChannels: audioProfile.maxChannels,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      DeviceProfile: deviceProfile(audioProfile)
    })
  });
  const source = playback.MediaSources?.find((candidate) =>
    candidate.Id === input.mediaSourceId
  ) ?? playback.MediaSources?.[0];
  if (!source?.Id) {
    throw new Error(`Jellyfin did not return a playable source${playback.ErrorCode ? `: ${playback.ErrorCode}` : '.'}`);
  }
  const method = playMethod(source);
  const playSessionId = playback.PlaySessionId ?? '';
  let upstream: URL;
  if (method === 'DirectPlay') {
    upstream = new URL(
      `Videos/${encodeURIComponent(itemId)}/stream`,
      `${session.baseUrl}/`
    );
    upstream.searchParams.set('static', 'true');
    upstream.searchParams.set('MediaSourceId', source.Id);
    if (playSessionId) upstream.searchParams.set('PlaySessionId', playSessionId);
  } else {
    if (!source.TranscodingUrl) throw new Error('Jellyfin returned no remux/transcode URL.');
    upstream = /^https?:\/\//i.test(source.TranscodingUrl)
      ? new URL(source.TranscodingUrl)
      : new URL(source.TranscodingUrl.replace(/^\//, ''), `${session.baseUrl}/`);
  }
  upstream.searchParams.delete('api_key');
  const videoIsCopy = canCopyVideo(source, upstream, method);
  const effectiveMethod: VidaaPlayMethod = videoIsCopy && method === 'Transcode'
    ? 'DirectStream'
    : method;
  const video = source.MediaStreams?.find((stream) => stream.Type === 'Video');
  if (isHdr(video) && !videoIsCopy) {
    const selectedVideoCodec = queryValue(upstream, ['VideoCodec', 'vcodec']);
    const reasons = transcodeReasons(source, upstream).join(', ') || 'not reported';
    const requestedAudioCodec = queryValue(upstream, ['AudioCodec', 'acodec']);
    const requestedContainer = queryValue(upstream, ['Container']);
    throw new Error(
      'Jellyfin selected video transcoding for HDR/Dolby Vision. ' +
      `Playback was stopped to prevent tone mapping or loss of Dolby Vision metadata ` +
      `(${effectiveMethod}; direct stream: ${Boolean(source.SupportsDirectStream)}; ` +
      `container: ${requestedContainer ?? source.Container ?? 'unspecified'}; ` +
      `requested video codec: ${selectedVideoCodec ?? 'unspecified'}; ` +
      `requested audio codec: ${requestedAudioCodec ?? 'unspecified'}; ` +
      `reasons: ${reasons}).`
    );
  }
  const audio = source.MediaStreams?.find((stream) =>
    stream.Type === 'Audio' && (
      input.audioStreamIndex === null || stream.Index === input.audioStreamIndex
    )
  );
  const requestedAudioCodec = queryValue(upstream, ['AudioCodec', 'acodec']);
  const audioReasons = transcodeReasons(source, upstream).filter((reason) =>
    reason.toLowerCase().startsWith('audio') ||
    reason === 'SecondaryAudioNotSupported'
  );
  const sourceAudioCodec = audio?.Codec?.toLowerCase() ?? null;
  const negotiatedAudioCodec = requestedAudioCodec?.toLowerCase() ?? null;
  const audioIsCopy = method === 'DirectPlay' ||
    negotiatedAudioCodec === 'copy' ||
    (
      audioReasons.length === 0 &&
      Boolean(sourceAudioCodec) &&
      (!negotiatedAudioCodec || negotiatedAudioCodec === sourceAudioCodec)
    );
  const ticket = randomUUID();
  tickets.set(ticket, {
    upstreamUrl: upstream.toString(),
    expiresAt: Date.now() + 12 * 60 * 60 * 1000
  });
  const subtitleUrl = selectedSubtitle
    ? `/api/vidaa/subtitles/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id)}/${selectedSubtitle.index}.vtt`
    : null;
  return {
    item: options.item,
    mediaUrl: `/api/vidaa/media/${ticket}`,
    subtitleUrl,
    subtitleLanguage: selectedSubtitle?.language ?? null,
    subtitleLabel: selectedSubtitle?.title ?? null,
    audioStreamIndex: input.audioStreamIndex,
    subtitleStreamIndex: selectedSubtitle?.index ?? null,
    segments,
    chapters: options.chapters,
    nextItem: options.nextItem,
    playSessionId,
    mediaSourceId: source.Id,
    playMethod: effectiveMethod,
    videoIsCopy,
    container: method === 'DirectPlay'
      ? source.Container ?? null
      : source.TranscodingContainer ??
        queryValue(upstream, ['Container']) ??
        source.Container ??
        null,
    videoCodec: video?.Codec ?? null,
    videoRange: videoRange(video),
    audioCodec: audio?.Codec ?? null,
    audioOutputCodec:
      audioIsCopy || negotiatedAudioCodec === 'copy'
        ? audio?.Codec ?? null
        : requestedAudioCodec ?? audio?.Codec ?? null,
    audioLayout: audio?.ChannelLayout ?? null,
    audioIsCopy,
    audioProfile: audioProfile.name,
    startPositionSeconds: input.startPositionTicks / TICKS_PER_SECOND
  };
}

async function proxy(
  session: StoredSession,
  request: IncomingMessage,
  response: ServerResponse,
  upstreamUrl: string,
  cacheImages = false
): Promise<void> {
  const headers = new Headers();
  const range = request.headers.range;
  if (range) headers.set('Range', range);
  const upstream = await jellyfinFetch(session, upstreamUrl, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers
  });
  const forwarded: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': cacheImages ? 'public, max-age=86400' : 'no-store'
  };
  for (const name of [
    'accept-ranges',
    'content-length',
    'content-range',
    'content-type',
    'etag',
    'last-modified'
  ]) {
    const value = upstream.headers.get(name);
    if (value) forwarded[name] = value;
  }
  response.writeHead(upstream.status, forwarded);
  if (request.method === 'HEAD' || !upstream.body) {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body as never).pipe(response);
}

async function report(session: StoredSession, input: VidaaPlaybackReport): Promise<void> {
  const common = {
    ItemId: input.itemId,
    MediaSourceId: input.mediaSourceId,
    PlaySessionId: input.playSessionId,
    PositionTicks: Math.max(0, Math.round(input.positionSeconds * TICKS_PER_SECOND)),
    IsPaused: input.paused,
    IsMuted: input.muted,
    VolumeLevel: Math.max(0, Math.min(100, Math.round(input.volume))),
    CanSeek: true,
    PlayMethod: input.playMethod
  };
  const path = input.event === 'start'
    ? '/Sessions/Playing'
    : input.event === 'progress'
      ? '/Sessions/Playing/Progress'
      : '/Sessions/Playing/Stopped';
  await jellyfinFetch(session, path, {
    method: 'POST',
    body: JSON.stringify(input.event === 'stop'
      ? { ...common, Failed: Boolean(input.failed) }
      : common)
  });
}

async function authenticate(input: unknown): Promise<StoredSession> {
  if (!input || typeof input !== 'object') throw new Error('Connection details are missing.');
  const candidate = input as { baseUrl?: unknown; username?: unknown; password?: unknown };
  const baseUrl = cleanBaseUrl(candidate.baseUrl);
  const username = typeof candidate.username === 'string' ? candidate.username.trim() : '';
  const password = typeof candidate.password === 'string' ? candidate.password : '';
  if (!username) throw new Error('Enter the Jellyfin username.');
  const deviceId = randomUUID();
  const authorization = clientAuthorization(deviceId);
  const [systemResponse, authResponse] = await Promise.all([
    fetch(`${baseUrl}/System/Info/Public`, { headers: { Authorization: authorization } }),
    fetch(`${baseUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Username: username, Pw: password })
    })
  ]);
  if (!systemResponse.ok) throw new Error(`Could not reach Jellyfin (${systemResponse.status}).`);
  if (!authResponse.ok) throw new Error(`Jellyfin sign-in failed (${authResponse.status}).`);
  const system = await systemResponse.json() as { Id?: string; ServerName?: string; Version?: string };
  const auth = await authResponse.json() as {
    AccessToken?: string;
    ServerId?: string;
    User?: { Id?: string; Name?: string };
  };
  if (!auth.AccessToken || !auth.User?.Id) throw new Error('Jellyfin returned an incomplete session.');
  return {
    version: 1,
    deviceId,
    baseUrl,
    accessToken: auth.AccessToken,
    userId: auth.User.Id,
    serverId: auth.ServerId ?? system.Id ?? '',
    serverName: system.ServerName ?? 'Jellyfin',
    serverVersion: system.Version ?? 'unknown',
    userName: auth.User.Name ?? username
  };
}

async function startQuickConnect(input: unknown): Promise<{
  status: 'pending';
  secret: string;
  code: string;
  serverName: string;
}> {
  const candidate = input as { baseUrl?: unknown };
  const baseUrl = cleanBaseUrl(candidate?.baseUrl);
  const deviceId = randomUUID();
  const headers = { Authorization: clientAuthorization(deviceId) };
  const [systemResponse, enabledResponse] = await Promise.all([
    fetch(`${baseUrl}/System/Info/Public`, { headers }),
    fetch(`${baseUrl}/QuickConnect/Enabled`, { headers })
  ]);
  if (!systemResponse.ok) throw new Error(`Could not reach Jellyfin (${systemResponse.status}).`);
  if (!enabledResponse.ok || !(await enabledResponse.json() as boolean)) {
    throw new Error('Quick Connect is disabled on this Jellyfin server.');
  }
  const system = await systemResponse.json() as PendingQuickConnect['system'];
  const initiation = await fetch(`${baseUrl}/QuickConnect/Initiate`, {
    method: 'POST',
    headers
  });
  if (!initiation.ok) throw new Error(`Quick Connect could not start (${initiation.status}).`);
  const request = await initiation.json() as { Secret?: string; Code?: string };
  if (!request.Secret || !request.Code) {
    throw new Error('Jellyfin returned an incomplete Quick Connect request.');
  }
  const pending: PendingQuickConnect = {
    baseUrl,
    deviceId,
    secret: request.Secret,
    code: request.Code,
    expiresAt: Date.now() + 5 * 60_000,
    system
  };
  pendingQuickConnect.set(pending.secret, pending);
  return {
    status: 'pending',
    secret: pending.secret,
    code: pending.code,
    serverName: system.ServerName ?? 'Jellyfin'
  };
}

async function pollQuickConnect(secret: string): Promise<{
  status: 'pending' | 'connected' | 'expired';
  session: VidaaJellyfinSession | null;
}> {
  const pending = pendingQuickConnect.get(secret);
  if (!pending || Date.now() >= pending.expiresAt) {
    pendingQuickConnect.delete(secret);
    return { status: 'expired', session: null };
  }
  const headers = { Authorization: clientAuthorization(pending.deviceId) };
  const stateResponse = await fetch(
    `${pending.baseUrl}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`,
    { headers }
  );
  if (!stateResponse.ok) throw new Error(`Quick Connect polling failed (${stateResponse.status}).`);
  const state = await stateResponse.json() as { Authenticated?: boolean };
  if (!state.Authenticated) return { status: 'pending', session: null };
  const authResponse = await fetch(
    `${pending.baseUrl}/Users/AuthenticateWithQuickConnect`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ Secret: secret })
    }
  );
  if (!authResponse.ok) {
    throw new Error(`Quick Connect sign-in failed (${authResponse.status}).`);
  }
  const auth = await authResponse.json() as {
    AccessToken?: string;
    ServerId?: string;
    User?: { Id?: string; Name?: string };
  };
  if (!auth.AccessToken || !auth.User?.Id) {
    throw new Error('Jellyfin returned an incomplete Quick Connect session.');
  }
  const session: StoredSession = {
    version: 1,
    deviceId: pending.deviceId,
    baseUrl: pending.baseUrl,
    accessToken: auth.AccessToken,
    userId: auth.User.Id,
    serverId: auth.ServerId ?? pending.system.Id ?? '',
    serverName: pending.system.ServerName ?? 'Jellyfin',
    serverVersion: pending.system.Version ?? 'unknown',
    userName: auth.User.Name ?? 'Jellyfin user'
  };
  await saveSession(session);
  pendingQuickConnect.delete(secret);
  return { status: 'connected', session: publicSession(session) };
}

function middleware() {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void
  ) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/vidaa/')) {
      next();
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Origin': '*'
      });
      response.end();
      return;
    }
    try {
      if (url.pathname === '/api/vidaa/quick-connect') {
        if (!isLoopback(request)) {
          text(response, 403, 'Quick Connect setup is only available from this PC.');
          return;
        }
        if (request.method === 'POST') {
          json(response, 200, await startQuickConnect(await bodyJson(request)));
          return;
        }
        if (request.method === 'GET') {
          const secret = url.searchParams.get('secret') ?? '';
          json(response, 200, await pollQuickConnect(secret));
          return;
        }
      }
      if (url.pathname === '/api/vidaa/session') {
        if (request.method === 'GET') {
          json(response, 200, publicSession(await loadSession()));
          return;
        }
        if (!isLoopback(request)) {
          text(response, 403, 'Jellyfin setup is only available from this PC.');
          return;
        }
        if (request.method === 'POST') {
          const session = await authenticate(await bodyJson(request));
          await saveSession(session);
          json(response, 200, publicSession(session));
          return;
        }
        if (request.method === 'DELETE') {
          await rm(sessionPath(), { force: true });
          json(response, 200, publicSession(null));
          return;
        }
      }
      const session = await loadSession();
      if (!session) {
        json(response, 401, { error: 'Connect Jellyfin from the PC setup page first.' });
        return;
      }
      if (url.pathname === '/api/vidaa/home' && request.method === 'GET') {
        json(response, 200, await home(session));
        return;
      }
      if (url.pathname === '/api/vidaa/items' && request.method === 'GET') {
        json(response, 200, await browseItems(
          session,
          url.searchParams.get('parentId'),
          url.searchParams.get('searchTerm')?.trim().slice(0, 200) ?? ''
        ));
        return;
      }
      const optionsMatch = /^\/api\/vidaa\/items\/([^/]+)\/playback-options$/.exec(url.pathname);
      if (optionsMatch && request.method === 'GET') {
        json(response, 200, await playbackOptions(session, decodeURIComponent(optionsMatch[1]!)));
        return;
      }
      const playMatch = /^\/api\/vidaa\/items\/([^/]+)\/play$/.exec(url.pathname);
      if (playMatch && request.method === 'POST') {
        json(response, 200, await planPlayback(
          session,
          decodeURIComponent(playMatch[1]!),
          await bodyJson(request) as VidaaPlaybackRequest
        ));
        return;
      }
      if (url.pathname === '/api/vidaa/playback/report' && request.method === 'POST') {
        await report(session, await bodyJson(request) as VidaaPlaybackReport);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      const mediaMatch = /^\/api\/vidaa\/media\/([^/]+)$/.exec(url.pathname);
      if (mediaMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        const ticket = tickets.get(mediaMatch[1]!);
        if (!ticket || ticket.expiresAt < Date.now()) {
          text(response, 404, 'Playback ticket expired. Start the item again.');
          return;
        }
        await proxy(session, request, response, ticket.upstreamUrl);
        return;
      }
      const imageMatch = /^\/api\/vidaa\/images\/([^/]+)\/(Primary|Backdrop)$/.exec(url.pathname);
      if (imageMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        const params = new URLSearchParams();
        params.set('maxWidth', url.searchParams.get('maxWidth') ?? '900');
        params.set('quality', '90');
        const tag = url.searchParams.get('tag');
        if (tag) params.set('tag', tag);
        await proxy(
          session,
          request,
          response,
          `/Items/${encodeURIComponent(decodeURIComponent(imageMatch[1]!))}/Images/${imageMatch[2]}?${params}`,
          true
        );
        return;
      }
      const subtitleMatch = /^\/api\/vidaa\/subtitles\/([^/]+)\/([^/]+)\/(\d+)\.vtt$/.exec(url.pathname);
      if (subtitleMatch && request.method === 'GET') {
        const path = `/Videos/${encodeURIComponent(decodeURIComponent(subtitleMatch[1]!))}/${encodeURIComponent(decodeURIComponent(subtitleMatch[2]!))}/Subtitles/${subtitleMatch[3]}/Stream.vtt`;
        await proxy(session, request, response, path);
        return;
      }
      json(response, 404, { error: 'VIDAA bridge endpoint was not found.' });
    } catch (error) {
      json(response, 502, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

export function vidaaJellyfinBridgePlugin(): Plugin {
  const handler = middleware();
  return {
    name: 'vidaa-jellyfin-bridge',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}
