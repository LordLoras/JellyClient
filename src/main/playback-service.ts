import { EventEmitter } from 'node:events';
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api.js';
import { getMediaSegmentsApi } from '@jellyfin/sdk/lib/utils/api/media-segments-api.js';
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api.js';
import { DlnaProfileType } from '@jellyfin/sdk/lib/generated-client/models/dlna-profile-type.js';
import { EncodingContext } from '@jellyfin/sdk/lib/generated-client/models/encoding-context.js';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info.js';
import type { MediaSegmentDto } from '@jellyfin/sdk/lib/generated-client/models/media-segment-dto.js';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream.js';
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol.js';
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type.js';
import { MediaSegmentType } from '@jellyfin/sdk/lib/generated-client/models/media-segment-type.js';
import { PlayMethod } from '@jellyfin/sdk/lib/generated-client/models/play-method.js';
import { SubtitleDeliveryMethod } from '@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method.js';
import type {
  DeviceProfile
} from '@jellyfin/sdk/lib/generated-client/models/device-profile.js';
import type {
  PlayMediaInput,
  PlaybackState
} from '@shared/contracts.js';
import { TICKS_PER_SECOND } from '@shared/contracts.js';
import {
  choosePreferredAudio,
  choosePreferredSubtitle
} from '@shared/subtitle-selection.js';
import {
  activeSkipSegment,
  coalesceSkipSegments,
  skipSegmentLabel,
  validSkipSegment,
  type SkipSegment
} from '@shared/skip-segments.js';
import { ConfigService } from './config-service.js';
import { JellyfinService } from './jellyfin-service.js';
import {
  MpvService,
  type MpvLoadRequest
} from './mpv-service.js';
import {
  shouldAutomaticallyAdvance,
  type MpvEndFileEvent,
  type MpvFileEvent
} from './playback-lifecycle.js';

interface ActivePlayback {
  generation: number;
  itemId: string;
  seriesId: string | null;
  mediaSourceId: string;
  playSessionId: string;
  method: typeof PlayMethod[keyof typeof PlayMethod];
  loaded: boolean;
  started: boolean;
  stopped: boolean;
  initialAudioIndex: number | null;
  initialSubtitleIndex: number | null;
  playlistItemId: string | null;
  segments: SkipSegment[];
  dismissedSegmentIds: Set<string>;
  promptSegmentId: string | null;
  nextItem: PlaybackState['nextItem'];
  postPlayCanceled: boolean;
  playNextRequested: boolean;
}

export interface SegmentSkipRequest {
  itemId: string;
  targetSeconds: number;
}

export class PlaybackService extends EventEmitter {
  private readonly jellyfin: JellyfinService;
  private readonly mpv: MpvService;
  private readonly config: ConfigService;
  private active: ActivePlayback | null = null;
  private reportTimer: NodeJS.Timeout | null = null;
  private reportChain: Promise<void> = Promise.resolve();

  constructor(
    jellyfin: JellyfinService,
    mpv: MpvService,
    config: ConfigService
  ) {
    super();
    this.jellyfin = jellyfin;
    this.mpv = mpv;
    this.config = config;
    this.mpv.on('file-loaded', (event: MpvFileEvent) => {
      const active = this.active;
      if (!active || event.generation !== active.generation) return;
      active.loaded = true;
      this.queueReport('start');
    });
    this.mpv.on('end-file', (event: MpvEndFileEvent) => {
      this.handleEndFile(event);
    });
    this.mpv.on('skip-segment', () => this.requestSegmentSkip());
    this.mpv.on('chapter-step', (step: number) => {
      void this.stepChapter(step).catch(() => undefined);
    });
    this.mpv.on('play-next', () => this.requestPlayNext());
    this.mpv.on('cancel-post-play', () => {
      void this.cancelPostPlay().catch(() => undefined);
    });
    this.mpv.on('state', (state: PlaybackState) => {
      this.updateSegmentPrompt(state);
      this.updatePostPlay(state);
      if (state.status === 'playing' || state.status === 'paused') {
        this.ensureReportTimer();
      }
    });
    this.jellyfin.on('disconnected', () => {
      this.clearReportTimer();
      void this.mpv.setSkipPrompt(null).catch(() => undefined);
      this.active = null;
    });
  }

  get state(): PlaybackState {
    return this.mpv.state;
  }

  async play(
    input: PlayMediaInput,
    options: {
      paused?: boolean;
      playlistItemId?: string | null;
    } = {}
  ): Promise<PlaybackState> {
    if (this.active && !this.active.stopped) {
      await this.reportStopped(false);
    }

    const [item, segments] = await Promise.all([
      this.jellyfin.getItem(input.itemId),
      this.mediaSegments(input.itemId)
    ]);
    const playerSettings = this.config.settings.player;
    const nextItem = await this.jellyfin.getNextEpisode(item.id, item.seriesId);
    const mediaInfoApi = getMediaInfoApi(this.jellyfin.api);
    const discovery = await mediaInfoApi.getPlaybackInfo({
      itemId: input.itemId,
      userId: this.jellyfin.userId
    });
    const discoveredSource = this.selectMediaSource(
      discovery.data.MediaSources ?? [],
      input.mediaSourceId
    );
    const seriesPreference = item.seriesId && playerSettings.rememberSeriesPreferences
      ? playerSettings.seriesPreferences[item.seriesId] ?? null
      : null;
    const audioStreamIndex = input.audioStreamIndex ?? this.preferredAudioIndex(
      discoveredSource?.MediaStreams ?? [],
      seriesPreference?.audioLanguage ?? playerSettings.preferredAudioLanguage
    );
    const subtitleStreamIndex = input.subtitleStreamIndex ?? (
      seriesPreference?.subtitlesEnabled === false
        ? -1
        : this.preferredSubtitleIndex(
            discoveredSource?.MediaStreams ?? [],
            seriesPreference?.subtitleLanguage ??
              playerSettings.preferredSubtitleLanguage,
            seriesPreference?.subtitlesEnabled ?? playerSettings.autoEnableSubtitles
          )
    );

    const response = await mediaInfoApi.getPostedPlaybackInfo({
      itemId: input.itemId,
      userId: this.jellyfin.userId,
      playbackInfoDto: {
        UserId: this.jellyfin.userId,
        MediaSourceId: discoveredSource?.Id ?? input.mediaSourceId,
        StartTimeTicks: input.startPositionTicks,
        AudioStreamIndex: audioStreamIndex,
        SubtitleStreamIndex: subtitleStreamIndex,
        MaxStreamingBitrate: input.maxStreamingBitrate ?? 200_000_000,
        MaxAudioChannels: 8,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AllowVideoStreamCopy: true,
        AllowAudioStreamCopy: true,
        DeviceProfile: this.deviceProfile()
      }
    });

    const source = this.selectMediaSource(
      response.data.MediaSources ?? [],
      discoveredSource?.Id ?? input.mediaSourceId
    );
    if (!source?.Id) {
      throw new Error(
        `Jellyfin did not return a playable source${response.data.ErrorCode ? `: ${response.data.ErrorCode}` : '.'}`
      );
    }

    const method = this.playMethod(source);
    const streamUrl = this.streamUrl(
      input.itemId,
      source,
      response.data.PlaySessionId ?? ''
    );
    const video = source.MediaStreams?.find(
      (stream) => stream.Type === MediaStreamType.Video
    );
    const audio = source.MediaStreams?.find(
      (stream) =>
        stream.Type === MediaStreamType.Audio &&
        (audioStreamIndex === null || stream.Index === audioStreamIndex)
    );
    const subtitle = source.MediaStreams?.find(
      (stream) =>
        stream.Type === MediaStreamType.Subtitle &&
        stream.Index === subtitleStreamIndex
    );

    const generation = this.mpv.state.generation + 1;
    this.active = {
      generation,
      itemId: input.itemId,
      seriesId: item.seriesId,
      mediaSourceId: source.Id,
      playSessionId: response.data.PlaySessionId ?? '',
      method,
      loaded: false,
      started: false,
      stopped: false,
      initialAudioIndex:
        audioStreamIndex ?? source.DefaultAudioStreamIndex ?? null,
      initialSubtitleIndex:
        subtitleStreamIndex,
      playlistItemId: options.playlistItemId ?? null,
      segments,
      dismissedSegmentIds: new Set<string>(),
      promptSegmentId: null,
      nextItem,
      postPlayCanceled: false,
      playNextRequested: false
    };

    this.mpv.setMediaMetadata(
      item,
      {
        deliveryMode: method,
        container: source.Container ?? null,
        sourceBitrate: source.Bitrate ?? null,
        videoCodec: video?.Codec ?? null,
        videoProfile: video?.Profile ?? null,
        videoBitDepth: video?.BitDepth ?? null,
        audioCodec: audio?.Codec ?? null,
        audioChannels:
          audio?.ChannelLayout ??
          (audio?.Channels ? `${audio.Channels} channels` : null),
        audioSampleRate: audio?.SampleRate ?? null,
        videoParams:
          video?.Width && video.Height ? `${video.Width}×${video.Height}` : null,
        mediaColorPrimaries: video?.ColorPrimaries ?? null,
        mediaColorTransfer: video?.ColorTransfer ?? null,
        mediaColorMatrix: video?.ColorSpace ?? null,
        colorPrimaries: video?.ColorPrimaries ?? null,
        colorTransfer: video?.ColorTransfer ?? null,
        colorMatrix: video?.ColorSpace ?? null,
        reason: this.playbackReason(source, method)
      },
      {
        enabled: subtitleStreamIndex !== -1 && (
          seriesPreference?.subtitlesEnabled ?? playerSettings.autoEnableSubtitles
        ),
        language: seriesPreference?.subtitleLanguage ??
          playerSettings.preferredSubtitleLanguage,
        streamIndex: subtitleStreamIndex === -1 ? null : subtitleStreamIndex
      },
      item.chapters,
      nextItem,
      item.trickplay.filter((track) => track.mediaSourceId === source.Id)
    );

    try {
      await this.mpv.load({
        url: streamUrl,
        authorizationHeader: this.jellyfin.authorizationHeader,
        title: item.seriesName
          ? `${item.seriesName} · ${item.name}`
          : item.name,
        startSeconds: input.startPositionTicks / TICKS_PER_SECOND,
        fullscreen: this.config.settings.player.fullscreenOnPlay,
        paused: options.paused ?? false,
        externalSubtitle: this.externalSubtitle(source, subtitle)
      });
    } catch (error) {
      const failed = this.active;
      if (failed?.generation === generation) {
        void this.reportStopped(true, failed, this.mpv.state)
          .catch(() => undefined);
      }
      throw error;
    }
    return this.state;
  }

  async playLocal(): Promise<PlaybackState> {
    await this.mpv.play();
    this.queueReport('progress');
    return this.state;
  }

  async pauseLocal(): Promise<PlaybackState> {
    await this.mpv.pause();
    this.queueReport('progress');
    return this.state;
  }

  async seekLocal(positionSeconds: number): Promise<PlaybackState> {
    await this.mpv.seek(positionSeconds);
    this.queueReport('progress');
    return this.state;
  }

  async stopLocal(): Promise<PlaybackState> {
    await this.mpv.stop();
    await this.reportStopped(false);
    return this.state;
  }

  async selectTrackLocal(
    type: 'audio' | 'subtitle',
    id: number | null
  ): Promise<PlaybackState> {
    const active = this.active;
    const track = id === null
      ? null
      : this.mpv.state.tracks.find(
          (candidate) => candidate.type === type && candidate.id === id
        ) ?? null;
    await this.mpv.selectTrack(type, id);
    if (
      active?.seriesId &&
      this.config.settings.player.rememberSeriesPreferences
    ) {
      const current = this.config.settings.player.seriesPreferences[active.seriesId] ?? {
        audioLanguage: null,
        subtitleLanguage: null,
        subtitlesEnabled: this.config.settings.player.autoEnableSubtitles
      };
      await this.config.saveSeriesPreference(active.seriesId, {
        ...current,
        ...(type === 'audio'
          ? { audioLanguage: track?.language ?? null }
          : {
              subtitleLanguage: track?.language ?? current.subtitleLanguage,
              subtitlesEnabled: id !== null
            })
      });
    }
    this.queueReport('progress');
    return this.state;
  }

  async stepChapter(step: number): Promise<PlaybackState> {
    const state = this.mpv.state;
    if (state.chapters.length === 0) return state;
    const current = state.currentChapterIndex ?? 0;
    const next = Math.min(
      state.chapters.length - 1,
      Math.max(0, current + step)
    );
    return this.mpv.seekChapter(next);
  }

  async cancelPostPlay(): Promise<PlaybackState> {
    if (this.active) this.active.postPlayCanceled = true;
    await this.mpv.setPostPlayPrompt(
      this.active?.nextItem ?? this.mpv.state.nextItem,
      null,
      true
    );
    return this.state;
  }

  async playNext(): Promise<PlaybackState> {
    this.requestPlayNext();
    return this.state;
  }

  async reportBufferingState(): Promise<void> {
    this.queueReport('progress');
  }

  setPlaylistItemId(value: string | null): void {
    if (this.active) this.active.playlistItemId = value;
  }

  async shutdown(): Promise<void> {
    this.clearReportTimer();
    await this.reportStopped(false);
    await this.mpv.shutdown();
  }

  private queueReport(
    type: 'start' | 'progress' | 'stop',
    failed = false
  ): void {
    const target = this.active;
    const state = this.mpv.state;
    this.reportChain = this.reportChain
      .then(async () => {
        if (type === 'start') await this.reportStarted(target, state);
        else if (type === 'stop') await this.reportStopped(failed, target, state);
        else await this.reportProgress(target, state);
      })
      .catch(() => {
        // Playback remains usable while reports retry on the next interval.
      });
  }

  private async reportStarted(
    active = this.active,
    state = this.mpv.state
  ): Promise<void> {
    if (!active || active.started || active.stopped) return;
    await getPlaystateApi(this.jellyfin.api).reportPlaybackStart({
      playbackStartInfo: {
        ItemId: active.itemId,
        MediaSourceId: active.mediaSourceId,
        PlaySessionId: active.playSessionId,
        PlaylistItemId: active.playlistItemId,
        PositionTicks: Math.round(state.positionSeconds * TICKS_PER_SECOND),
        PlaybackStartTimeTicks: Date.now() * 10_000,
        AudioStreamIndex: this.selectedTrackIndex('audio', state, active),
        SubtitleStreamIndex: this.selectedTrackIndex('subtitle', state, active),
        IsPaused: state.paused,
        IsMuted: state.muted,
        VolumeLevel: Math.round(state.volume),
        CanSeek: true,
        PlayMethod: active.method
      }
    });
    active.started = true;
    this.ensureReportTimer();
  }

  private async reportProgress(
    active = this.active,
    state = this.mpv.state
  ): Promise<void> {
    if (!active || !active.started || active.stopped) return;
    await getPlaystateApi(this.jellyfin.api).reportPlaybackProgress({
      playbackProgressInfo: {
        ItemId: active.itemId,
        MediaSourceId: active.mediaSourceId,
        PlaySessionId: active.playSessionId,
        PlaylistItemId: active.playlistItemId,
        PositionTicks: Math.round(state.positionSeconds * TICKS_PER_SECOND),
        AudioStreamIndex: this.selectedTrackIndex('audio', state, active),
        SubtitleStreamIndex: this.selectedTrackIndex('subtitle', state, active),
        IsPaused: state.paused,
        IsMuted: state.muted,
        VolumeLevel: Math.round(state.volume),
        CanSeek: true,
        PlayMethod: active.method
      }
    });
  }

  private async reportStopped(
    failed: boolean,
    active = this.active,
    state = this.mpv.state
  ): Promise<void> {
    if (!active || active.stopped) return;
    active.stopped = true;
    this.clearReportTimer();
    void this.mpv.setSkipPrompt(null).catch(() => undefined);
    try {
      await getPlaystateApi(this.jellyfin.api).reportPlaybackStopped({
        playbackStopInfo: {
          ItemId: active.itemId,
          MediaSourceId: active.mediaSourceId,
          PlaySessionId: active.playSessionId,
          PlaylistItemId: active.playlistItemId,
          PositionTicks: Math.round(state.positionSeconds * TICKS_PER_SECOND),
          Failed: failed
        }
      });
    } finally {
      if (this.active === active) this.active = null;
    }
  }

  private ensureReportTimer(): void {
    if (this.reportTimer || !this.active) return;
    this.reportTimer = setInterval(() => {
      this.queueReport('progress');
    }, 10_000);
  }

  private clearReportTimer(): void {
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.reportTimer = null;
  }

  private selectedTrackIndex(
    type: 'audio' | 'subtitle',
    state = this.mpv.state,
    active = this.active
  ): number | null {
    const selected = state.tracks.find(
      (track) => track.type === type && track.selected
    );
    if (selected?.ffIndex !== null && selected?.ffIndex !== undefined) {
      return selected.ffIndex;
    }
    return type === 'audio'
      ? active?.initialAudioIndex ?? null
      : active?.initialSubtitleIndex ?? null;
  }

  private async mediaSegments(itemId: string): Promise<SkipSegment[]> {
    try {
      const response = await getMediaSegmentsApi(
        this.jellyfin.api
      ).getItemSegments({
        itemId,
        includeSegmentTypes: [
          MediaSegmentType.Intro,
          MediaSegmentType.Outro
        ]
      });
      return coalesceSkipSegments(
        (response.data.Items ?? []).flatMap((segment: MediaSegmentDto) => {
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
      // Playback remains available when the server has no segment provider.
      return [];
    }
  }

  private updateSegmentPrompt(state: PlaybackState): void {
    const active = this.active;
    const segment = active && !active.stopped && (
      state.status === 'playing' ||
      state.status === 'paused' ||
      state.status === 'buffering'
    )
      ? activeSkipSegment(
        active.segments,
        state.positionSeconds,
        active.dismissedSegmentIds
      )
      : null;
    if (segment && this.shouldAutoSkip(segment.type)) {
      active?.dismissedSegmentIds.add(segment.id);
      if (active) active.promptSegmentId = null;
      this.emit('segment-skip-requested', {
        itemId: active?.itemId ?? '',
        targetSeconds: segment.endTicks / TICKS_PER_SECOND
      } satisfies SegmentSkipRequest);
      return;
    }
    const segmentId = segment?.id ?? null;
    if (!active || active.promptSegmentId === segmentId) return;
    active.promptSegmentId = segmentId;
    void this.mpv.setSkipPrompt(
      segment ? skipSegmentLabel(segment.type) : null
    ).catch(() => undefined);
  }

  private requestSegmentSkip(): void {
    const active = this.active;
    if (!active?.promptSegmentId || active.stopped) return;
    const segment = active.segments.find(
      (candidate) => candidate.id === active.promptSegmentId
    );
    if (!segment) return;
    active.dismissedSegmentIds.add(segment.id);
    active.promptSegmentId = null;
    void this.mpv.setSkipPrompt(null).catch(() => undefined);
    this.emit('segment-skip-requested', {
      itemId: active.itemId,
      targetSeconds: segment.endTicks / TICKS_PER_SECOND
    } satisfies SegmentSkipRequest);
  }

  private updatePostPlay(state: PlaybackState): void {
    const active = this.active;
    if (
      !active?.nextItem ||
      !active.loaded ||
      active.stopped ||
      active.postPlayCanceled ||
      active.playNextRequested ||
      state.generation !== active.generation ||
      !['playing', 'paused', 'buffering'].includes(state.status) ||
      state.durationSeconds <= 0
    ) return;
    const countdown = this.config.settings.player.nextEpisodeCountdownSeconds;
    const remaining = Math.max(
      0,
      Math.ceil(state.durationSeconds - state.positionSeconds)
    );
    if (remaining > countdown) {
      if (state.postPlaySecondsRemaining !== null) {
        void this.mpv.setPostPlayPrompt(active.nextItem, null, false);
      }
      return;
    }
    if (remaining <= 1 && this.config.settings.player.autoPlayNext) {
      this.requestPlayNext();
      return;
    }
    if (
      state.postPlaySecondsRemaining !== remaining ||
      state.nextItem?.id !== active.nextItem.id
    ) {
      void this.mpv.setPostPlayPrompt(active.nextItem, remaining, false)
        .catch(() => undefined);
    }
  }

  private requestPlayNext(): void {
    const active = this.active;
    if (
      !active?.nextItem ||
      !active.loaded ||
      active.stopped ||
      active.playNextRequested
    ) return;
    active.playNextRequested = true;
    void this.mpv.setPostPlayPrompt(active.nextItem, null, false)
      .catch(() => undefined);
    this.emit('play-next-requested', {
      itemId: active.nextItem.id,
      startPositionTicks: 0,
      mediaSourceId: null,
      maxStreamingBitrate: null,
      audioStreamIndex: null,
      subtitleStreamIndex: null
    } satisfies PlayMediaInput);
  }

  private handleEndFile(event: MpvEndFileEvent): void {
    const active = this.active;
    if (!active || event.generation !== active.generation) return;

    const autoAdvance = shouldAutomaticallyAdvance(
      event,
      {
        generation: active.generation,
        loaded: active.loaded,
        stopped: active.stopped,
        hasNextItem: Boolean(active.nextItem),
        postPlayCanceled: active.postPlayCanceled,
        playNextRequested: active.playNextRequested
      },
      this.config.settings.player.autoPlayNext
    );

    if (autoAdvance) this.requestPlayNext();
    void this.reportStopped(
      event.reason === 'error',
      active,
      this.mpv.state
    ).catch(() => undefined);
  }

  private selectMediaSource(
    sources: MediaSourceInfo[],
    preferredId: string | null = null
  ): MediaSourceInfo | null {
    return (
      sources.find((source) => preferredId && source.Id === preferredId) ??
      sources.find((source) => source.SupportsDirectPlay) ??
      sources.find((source) => source.SupportsDirectStream) ??
      sources.find((source) => source.SupportsTranscoding) ??
      sources[0] ??
      null
    );
  }

  private preferredAudioIndex(
    streams: MediaStream[],
    language: string
  ): number | null {
    return choosePreferredAudio(
      streams.flatMap((stream) =>
        stream.Type === MediaStreamType.Audio && typeof stream.Index === 'number'
          ? [{
              id: stream.Index,
              language: stream.Language ?? null,
              title: stream.Title ?? null,
              isDefault: Boolean(stream.IsDefault)
            }]
          : []
      ),
      language
    )?.id ?? null;
  }

  private preferredSubtitleIndex(
    streams: MediaStream[],
    language: string,
    enabled: boolean
  ): number | null {
    const settings = this.config.settings.player;
    if (!enabled) return null;
    return choosePreferredSubtitle(
      streams.flatMap((stream) =>
        stream.Type === MediaStreamType.Subtitle &&
        typeof stream.Index === 'number'
          ? [{
              id: stream.Index,
              language: stream.Language ?? null,
              title: stream.Title ?? null,
              isDefault: Boolean(stream.IsDefault),
              isForced: Boolean(stream.IsForced),
              isHearingImpaired: Boolean(stream.IsHearingImpaired)
            }]
          : []
      ),
      language,
      {
        preferForced: settings.preferForcedSubtitles,
        avoidHearingImpaired: settings.avoidSdhSubtitles
      }
    )?.id ?? null;
  }

  private shouldAutoSkip(type: SkipSegment['type']): boolean {
    const player = this.config.settings.player;
    return type === MediaSegmentType.Intro
      ? player.autoSkipIntro
      : player.autoSkipOutro;
  }

  private externalSubtitle(
    source: MediaSourceInfo,
    subtitle: MediaStream | undefined
  ): MpvLoadRequest['externalSubtitle'] {
    if (!subtitle?.IsExternal || !subtitle.DeliveryUrl) return null;
    const rawUrl = /^https?:\/\//i.test(subtitle.DeliveryUrl)
      ? subtitle.DeliveryUrl
      : `${this.jellyfin.baseUrl.replace(/\/$/, '')}/${subtitle.DeliveryUrl.replace(/^\//, '')}`;
    const url = new URL(rawUrl);
    url.searchParams.delete('api_key');
    return {
      url: url.toString(),
      title: subtitle.Title ?? 'Preferred subtitle',
      language: subtitle.Language ?? this.config.settings.player.preferredSubtitleLanguage
    };
  }

  private playMethod(
    source: MediaSourceInfo
  ): typeof PlayMethod[keyof typeof PlayMethod] {
    if (source.SupportsDirectPlay) return PlayMethod.DirectPlay;
    if (source.SupportsDirectStream) return PlayMethod.DirectStream;
    return PlayMethod.Transcode;
  }

  private streamUrl(
    itemId: string,
    source: MediaSourceInfo,
    playSessionId: string
  ): string {
    const method = this.playMethod(source);
    if (method !== PlayMethod.DirectPlay) {
      if (!source.TranscodingUrl) {
        throw new Error(
          `Jellyfin selected ${method === PlayMethod.DirectStream ? 'direct streaming' : 'transcoding'} but returned no stream URL.`
        );
      }
      const transcodingUrl = /^https?:\/\//i.test(source.TranscodingUrl)
        ? source.TranscodingUrl
        : `${this.jellyfin.baseUrl.replace(/\/$/, '')}/${source.TranscodingUrl.replace(/^\//, '')}`;
      const url = new URL(transcodingUrl);
      url.searchParams.delete('api_key');
      return url.toString();
    }

    const url = new URL(
      `Videos/${encodeURIComponent(itemId)}/stream`,
      `${this.jellyfin.baseUrl}/`
    );
    url.searchParams.set('static', 'true');
    url.searchParams.set('MediaSourceId', source.Id ?? '');
    if (playSessionId) url.searchParams.set('PlaySessionId', playSessionId);
    if (source.LiveStreamId) {
      url.searchParams.set('LiveStreamId', source.LiveStreamId);
    }
    return url.toString();
  }

  private playbackReason(
    source: MediaSourceInfo,
    method: typeof PlayMethod[keyof typeof PlayMethod]
  ): string {
    if (method === PlayMethod.DirectPlay) {
      return `Direct play: ${source.Container ?? 'source container'} is handled by MPV.`;
    }
    if (method === PlayMethod.DirectStream) {
      return 'Direct stream/remux selected by Jellyfin; video is not re-encoded.';
    }
    return 'Server transcoding selected because the source did not match the tested client profile.';
  }

  private deviceProfile(): DeviceProfile {
    const videoContainers =
      'mkv,mp4,m4v,mov,webm,avi,ts,mpegts,m2ts,wmv,asf,flv,ogv,3gp';
    const videoCodecs =
      'h264,hevc,vp8,vp9,av1,mpeg1video,mpeg2video,mpeg4,vc1,wmv3,mjpeg';
    const audioCodecs =
      'aac,mp3,ac3,eac3,truehd,dts,flac,opus,vorbis,alac,pcm_s16le,pcm_s24le';
    const subtitleFormats = [
      'ass',
      'ssa',
      'srt',
      'subrip',
      'pgssub',
      'hdmv_pgs_subtitle',
      'pgs',
      'dvdsub',
      'vobsub'
    ];

    return {
      Name: 'JellyClient MPV',
      MaxStreamingBitrate: 200_000_000,
      MaxStaticBitrate: 200_000_000,
      DirectPlayProfiles: [
        {
          Container: videoContainers,
          VideoCodec: videoCodecs,
          AudioCodec: audioCodecs,
          Type: DlnaProfileType.Video
        }
      ],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: DlnaProfileType.Video,
          VideoCodec: 'h264,hevc',
          AudioCodec: 'aac,ac3',
          Protocol: MediaStreamProtocol.Http,
          Context: EncodingContext.Streaming,
          CopyTimestamps: true,
          EnableSubtitlesInManifest: false,
          MaxAudioChannels: '8'
        }
      ],
      SubtitleProfiles: subtitleFormats.flatMap((format) => [
        {
          Format: format,
          Method: SubtitleDeliveryMethod.Embed
        },
        {
          Format: format,
          Method: SubtitleDeliveryMethod.External
        }
      ])
    };
  }
}
