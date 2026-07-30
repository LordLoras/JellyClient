import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api.js';
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api.js';
import { DlnaProfileType } from '@jellyfin/sdk/lib/generated-client/models/dlna-profile-type.js';
import { EncodingContext } from '@jellyfin/sdk/lib/generated-client/models/encoding-context.js';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info.js';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream.js';
import { MediaStreamProtocol } from '@jellyfin/sdk/lib/generated-client/models/media-stream-protocol.js';
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type.js';
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
import { choosePreferredSubtitle } from '@shared/subtitle-selection.js';
import { ConfigService } from './config-service.js';
import { JellyfinService } from './jellyfin-service.js';
import {
  MpvService,
  type MpvLoadRequest
} from './mpv-service.js';

interface ActivePlayback {
  generation: number;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  method: typeof PlayMethod[keyof typeof PlayMethod];
  started: boolean;
  stopped: boolean;
  initialAudioIndex: number | null;
  initialSubtitleIndex: number | null;
  playlistItemId: string | null;
}

export class PlaybackService {
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
    this.jellyfin = jellyfin;
    this.mpv = mpv;
    this.config = config;
    this.mpv.on('file-loaded', () => this.queueReport('start'));
    this.mpv.on('end-file', () => this.queueReport('stop'));
    this.mpv.on('state', (state: PlaybackState) => {
      if (state.status === 'playing' || state.status === 'paused') {
        this.ensureReportTimer();
      }
    });
    this.jellyfin.on('disconnected', () => {
      this.clearReportTimer();
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

    const item = await this.jellyfin.getItem(input.itemId);
    const mediaInfoApi = getMediaInfoApi(this.jellyfin.api);
    const discovery = await mediaInfoApi.getPlaybackInfo({
      itemId: input.itemId,
      userId: this.jellyfin.userId
    });
    const discoveredSource = this.selectMediaSource(
      discovery.data.MediaSources ?? []
    );
    const subtitleStreamIndex = input.subtitleStreamIndex ??
      this.preferredSubtitleIndex(discoveredSource?.MediaStreams ?? []);

    const response = await mediaInfoApi.getPostedPlaybackInfo({
      itemId: input.itemId,
      userId: this.jellyfin.userId,
      playbackInfoDto: {
        UserId: this.jellyfin.userId,
        MediaSourceId: discoveredSource?.Id ?? null,
        StartTimeTicks: input.startPositionTicks,
        AudioStreamIndex: input.audioStreamIndex,
        SubtitleStreamIndex: subtitleStreamIndex,
        MaxStreamingBitrate: 200_000_000,
        MaxAudioChannels: 8,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        AllowVideoStreamCopy: true,
        AllowAudioStreamCopy: true,
        DeviceProfile: this.deviceProfile()
      }
    });

    const source = this.selectMediaSource(response.data.MediaSources ?? []);
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
        (input.audioStreamIndex === null ||
          stream.Index === input.audioStreamIndex)
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
      mediaSourceId: source.Id,
      playSessionId: response.data.PlaySessionId ?? '',
      method,
      started: false,
      stopped: false,
      initialAudioIndex:
        input.audioStreamIndex ?? source.DefaultAudioStreamIndex ?? null,
      initialSubtitleIndex:
        subtitleStreamIndex,
      playlistItemId: options.playlistItemId ?? null
    };

    const playerSettings = this.config.settings.player;
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
        enabled: playerSettings.autoEnableSubtitles,
        language: playerSettings.preferredSubtitleLanguage,
        streamIndex: subtitleStreamIndex
      }
    );

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

  private queueReport(type: 'start' | 'progress' | 'stop'): void {
    this.reportChain = this.reportChain
      .then(async () => {
        if (type === 'start') await this.reportStarted();
        else if (type === 'stop') await this.reportStopped(false);
        else await this.reportProgress();
      })
      .catch(() => {
        // Playback remains usable while reports retry on the next interval.
      });
  }

  private async reportStarted(): Promise<void> {
    const active = this.active;
    if (!active || active.started || active.stopped) return;
    const state = this.mpv.state;
    await getPlaystateApi(this.jellyfin.api).reportPlaybackStart({
      playbackStartInfo: {
        ItemId: active.itemId,
        MediaSourceId: active.mediaSourceId,
        PlaySessionId: active.playSessionId,
        PlaylistItemId: active.playlistItemId,
        PositionTicks: Math.round(state.positionSeconds * TICKS_PER_SECOND),
        PlaybackStartTimeTicks: Date.now() * 10_000,
        AudioStreamIndex: this.selectedTrackIndex('audio'),
        SubtitleStreamIndex: this.selectedTrackIndex('subtitle'),
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

  private async reportProgress(): Promise<void> {
    const active = this.active;
    if (!active || !active.started || active.stopped) return;
    const state = this.mpv.state;
    await getPlaystateApi(this.jellyfin.api).reportPlaybackProgress({
      playbackProgressInfo: {
        ItemId: active.itemId,
        MediaSourceId: active.mediaSourceId,
        PlaySessionId: active.playSessionId,
        PlaylistItemId: active.playlistItemId,
        PositionTicks: Math.round(state.positionSeconds * TICKS_PER_SECOND),
        AudioStreamIndex: this.selectedTrackIndex('audio'),
        SubtitleStreamIndex: this.selectedTrackIndex('subtitle'),
        IsPaused: state.paused,
        IsMuted: state.muted,
        VolumeLevel: Math.round(state.volume),
        CanSeek: true,
        PlayMethod: active.method
      }
    });
  }

  private async reportStopped(failed: boolean): Promise<void> {
    const active = this.active;
    if (!active || active.stopped) return;
    active.stopped = true;
    this.clearReportTimer();
    const state = this.mpv.state;
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

  private selectedTrackIndex(type: 'audio' | 'subtitle'): number | null {
    const selected = this.mpv.state.tracks.find(
      (track) => track.type === type && track.selected
    );
    if (selected?.ffIndex !== null && selected?.ffIndex !== undefined) {
      return selected.ffIndex;
    }
    return type === 'audio'
      ? this.active?.initialAudioIndex ?? null
      : this.active?.initialSubtitleIndex ?? null;
  }

  private selectMediaSource(
    sources: MediaSourceInfo[]
  ): MediaSourceInfo | null {
    return (
      sources.find((source) => source.SupportsDirectPlay) ??
      sources.find((source) => source.SupportsDirectStream) ??
      sources.find((source) => source.SupportsTranscoding) ??
      sources[0] ??
      null
    );
  }

  private preferredSubtitleIndex(streams: MediaStream[]): number | null {
    const settings = this.config.settings.player;
    if (!settings.autoEnableSubtitles) return null;
    return choosePreferredSubtitle(
      streams.flatMap((stream) =>
        stream.Type === MediaStreamType.Subtitle &&
        typeof stream.Index === 'number'
          ? [{
              id: stream.Index,
              language: stream.Language ?? null,
              title: stream.Title ?? null,
              isDefault: Boolean(stream.IsDefault),
              isForced: Boolean(stream.IsForced)
            }]
          : []
      ),
      settings.preferredSubtitleLanguage
    )?.id ?? null;
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
