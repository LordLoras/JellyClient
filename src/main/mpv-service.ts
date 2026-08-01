import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection, type Socket } from 'node:net';
import { app, screen } from 'electron';
import type {
  AppSettings,
  MediaItem,
  MpvAudioDevice,
  MpvCapability,
  PlaybackDiagnostics,
  PlaybackState,
  TrickplayOption,
  TrackInfo
} from '@shared/contracts.js';
import { initialPlaybackState } from '@shared/defaults.js';
import {
  choosePreferredSubtitle,
  mpvLanguagePriority
} from '@shared/subtitle-selection.js';
import { ConfigService } from './config-service.js';
import {
  codecRequestsPassthrough,
  isPassthroughOutputFormat,
  mpvPassthroughCodecs,
  parseMpvAudioDevices
} from './audio-output.js';
import { ClientEventBus } from './event-bus.js';
import { userFacingError } from './errors.js';
import {
  skipPromptAss,
  type SkipPromptOverlay
} from './mpv-skip-overlay.js';
import { postPlayAss } from './mpv-postplay-overlay.js';
import {
  MpvPlaybackGenerationTracker,
  type MpvEndFileEvent,
  type MpvFileEvent
} from './playback-lifecycle.js';
import { mpvAuthorizationHeaderField } from './mpv-http.js';
import {
  mpvSubtitleArguments,
  mpvSubtitleProperties
} from './subtitle-appearance.js';

interface MpvMessage {
  request_id?: number;
  error?: string;
  file_error?: string;
  data?: unknown;
  event?: string;
  name?: string;
  reason?: string;
  args?: string[];
  playlist_entry_id?: number;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  label: string;
}

export interface MpvLoadRequest {
  url: string;
  authorizationHeader: string;
  title: string;
  startSeconds: number;
  fullscreen: boolean;
  paused: boolean;
  externalSubtitle: {
    url: string;
    title: string;
    language: string;
  } | null;
}

export interface MpvSubtitlePreference {
  enabled: boolean;
  language: string;
  streamIndex: number | null;
}

const OBSERVED_PROPERTIES = [
  'time-pos',
  'duration',
  'pause',
  'paused-for-cache',
  'volume',
  'mute',
  'fullscreen',
  'speed',
  'sub-delay',
  'audio-delay',
  'track-list',
  'video-params',
  'video-target-params',
  'audio-out-params',
  'audio-device',
  'current-ao',
  'estimated-display-fps',
  'display-names',
  'current-vo',
  'target-colorspace-hint',
  'target-colorspace-hint-mode',
  'tone-mapping',
  'hwdec-current',
  'cache-duration',
  'vo-drop-frame-count'
] as const;

export class MpvService extends EventEmitter {
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private processValue: ChildProcess | null = null;
  private socket: Socket | null = null;
  private pipeName = '';
  private readBuffer = '';
  private nextRequestId = 1;
  private pending = new Map<number, PendingCommand>();
  private stateValue: PlaybackState = structuredClone(initialPlaybackState);
  private capabilityValue: MpvCapability = {
    available: false,
    executablePath: null,
    version: null,
    error: 'MPV has not been probed yet.'
  };
  private intentionalShutdown = false;
  private pendingSubtitlePreference: MpvSubtitlePreference | null = null;
  private skipPromptValue: SkipPromptOverlay | null = null;
  private skipSectionKey: string | null = null;
  private postPlayVisible = false;
  private audioVerificationTimer: NodeJS.Timeout | null = null;
  private readonly playbackGenerations = new MpvPlaybackGenerationTracker();
  private lastMpvError: string | null = null;
  private loadedGeneration: number | null = null;
  private pendingInitialPause: {
    generation: number;
    paused: boolean;
  } | null = null;

  constructor(config: ConfigService, events: ClientEventBus) {
    super();
    this.config = config;
    this.events = events;
  }

  get state(): PlaybackState {
    return structuredClone(this.stateValue);
  }

  get capability(): MpvCapability {
    return structuredClone(this.capabilityValue);
  }

  get isConnected(): boolean {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  get isMediaLoaded(): boolean {
    return this.loadedGeneration === this.stateValue.generation;
  }

  setMediaMetadata(
    item: MediaItem,
    diagnostics: Partial<PlaybackDiagnostics>,
    subtitlePreference: MpvSubtitlePreference,
    chapters: PlaybackState['chapters'] = [],
    nextItem: MediaItem | null = null,
    trickplay: TrickplayOption[] = []
  ): PlaybackState {
    this.pendingSubtitlePreference = subtitlePreference;
    const player = this.config.settings.player;
    this.setState({
      ...this.stateValue,
      item,
      tracks: [],
      chapters,
      trickplay,
      currentChapterIndex: null,
      nextItem,
      postPlaySecondsRemaining: null,
      postPlayCanceled: false,
      diagnostics: {
        ...this.stateValue.diagnostics,
        outputPrimaries: null,
        outputTransfer: null,
        outputMatrix: null,
        outputLevels: null,
        outputPixelFormat: null,
        outputMinLuminance: null,
        outputMaxLuminance: null,
        displayNames: [],
        displayFps: 0,
        hwdec: null,
        audioOutputFormat: null,
        audioOutputChannels: null,
        audioOutputSampleRate: null,
        audioRequestedDevice: player.audioDevice || 'auto',
        audioDriver: null,
        audioOutputMode: player.audioOutputMode,
        audioPassthroughCodecs:
          player.audioOutputMode === 'passthrough'
            ? mpvPassthroughCodecs(player.audioPassthrough)
            : [],
        audioPassthroughActive: false,
        audioFallbackReason: null,
        cacheDurationSeconds: 0,
        droppedFrames: 0,
        ...diagnostics,
        hdrMode: player.hdrMode,
        gpuApi: player.gpuApi,
        gpuContext: player.gpuApi === 'vulkan' ? 'winvk' : 'd3d11',
        targetPolicy:
          player.hdrMode === 'tone-map'
            ? 'Forced BT.709 / gamma 2.2 SDR target'
            : player.hdrMode === 'passthrough'
              ? 'Source-metadata colorspace hint'
              : 'Automatic display target'
      }
    });
    return this.state;
  }

  async probe(overridePath?: string): Promise<MpvCapability> {
    const candidates = await this.candidatePaths(overridePath);
    for (const path of candidates) {
      try {
        await access(path);
        const version = await this.readVersion(path);
        this.capabilityValue = {
          available: true,
          executablePath: path,
          version,
          error: null
        };
        this.updateDiagnostics({
          mpvVersion: version
        });
        return this.capability;
      } catch {
        // Continue to the next discovered candidate.
      }
    }

    this.capabilityValue = {
      available: false,
      executablePath: null,
      version: null,
      error:
        'MPV was not found. Select mpv.exe in Settings before starting playback.'
    };
    return this.capability;
  }

  async listAudioDevices(): Promise<MpvAudioDevice[]> {
    const capability = this.capabilityValue.available
      ? this.capabilityValue
      : await this.probe();
    if (!capability.available || !capability.executablePath) {
      throw new Error(capability.error ?? 'MPV is unavailable.');
    }
    return this.readAudioDevices(capability.executablePath);
  }

  async load(request: MpvLoadRequest): Promise<PlaybackState> {
    const capability = this.capabilityValue.available
      ? this.capabilityValue
      : await this.probe();
    if (!capability.available || !capability.executablePath) {
      throw new Error(capability.error ?? 'MPV is unavailable.');
    }

    if (this.audioVerificationTimer) {
      clearTimeout(this.audioVerificationTimer);
      this.audioVerificationTimer = null;
    }
    const nextGeneration = this.stateValue.generation + 1;
    this.lastMpvError = null;
    this.loadedGeneration = null;
    this.pendingInitialPause = {
      generation: nextGeneration,
      paused: request.paused
    };
    this.setState({
      ...this.stateValue,
      status: 'starting',
      generation: nextGeneration,
      positionSeconds: request.startSeconds,
      durationSeconds: 0,
      paused: true,
      buffering: false,
      error: null
    });

    try {
      await this.ensureRunning(capability.executablePath);
      await this.setSkipPrompt(null);
      await this.setPostPlayPrompt(this.stateValue.nextItem, null, false);
      await this.command([
        'set_property',
        'http-header-fields',
        [mpvAuthorizationHeaderField(request.authorizationHeader)]
      ]);
      await this.command(['set_property', 'force-media-title', request.title]);
      await this.command(['set_property', 'fullscreen', request.fullscreen]);
      await this.command(['set_property', 'pause', request.paused]);
      const player = this.config.settings.player;
      await this.command(['set_property', 'speed', player.playbackSpeed]);
      await this.applySubtitleAppearance(player);
      await this.command(['set_property', 'sub-delay', player.subtitleDelaySeconds]);
      await this.command(['set_property', 'audio-delay', player.audioDelaySeconds]);
      await this.applyAudioOutputSettings(player);
      const loadCommand: unknown[] = [
        'loadfile',
        request.url,
        'replace'
      ];
      if (request.startSeconds > 0) {
        loadCommand.push(-1, {
          start: String(request.startSeconds)
        });
      }
      this.playbackGenerations.beginLoad(nextGeneration);
      await this.command(loadCommand);
    } catch (error) {
      this.playbackGenerations.abandonLoad(nextGeneration);
      if (this.pendingInitialPause?.generation === nextGeneration) {
        this.pendingInitialPause = null;
      }
      const message = userFacingError(error, 'Unknown MPV error');
      this.fail(`MPV could not start playback: ${message}`);
      throw error;
    }
    if (
      request.externalSubtitle &&
      this.stateValue.generation === nextGeneration &&
      this.stateValue.status !== 'error' &&
      this.stateValue.status !== 'stopped'
    ) {
      await this.command([
        'sub-add',
        request.externalSubtitle.url,
        'select',
        request.externalSubtitle.title,
        request.externalSubtitle.language
      ]).catch((error: unknown) => {
        this.events.emitClient({
          type: 'notice',
          data: {
            level: 'warning',
            message: `Playback started, but the external subtitle could not be loaded: ${userFacingError(error, 'Unknown error')}`
          }
        });
      });
      this.pendingSubtitlePreference = null;
    }
    if (
      this.stateValue.generation === nextGeneration &&
      this.stateValue.status === 'starting'
    ) {
      this.setState({
        ...this.stateValue,
        status: 'loading',
        fullscreen: request.fullscreen
      });
    }
    return this.state;
  }

  async play(): Promise<PlaybackState> {
    await this.command(['set_property', 'pause', false]);
    return this.state;
  }

  async pause(): Promise<PlaybackState> {
    await this.command(['set_property', 'pause', true]);
    return this.state;
  }

  async stop(): Promise<PlaybackState> {
    this.loadedGeneration = null;
    this.pendingInitialPause = null;
    if (this.socket) await this.command(['stop']);
    this.setState({
      ...this.stateValue,
      status: 'stopped',
      paused: true,
      buffering: false
    });
    return this.state;
  }

  async seek(positionSeconds: number): Promise<PlaybackState> {
    if (!this.isMediaLoaded) {
      throw new Error('MPV cannot seek before a media file is loaded.');
    }
    await this.command(['seek', Math.max(0, positionSeconds), 'absolute+exact']);
    return this.state;
  }

  async setVolume(volume: number): Promise<PlaybackState> {
    await this.command([
      'set_property',
      'volume',
      Math.min(100, Math.max(0, volume))
    ]);
    return this.state;
  }

  async setMuted(muted: boolean): Promise<PlaybackState> {
    await this.command(['set_property', 'mute', muted]);
    return this.state;
  }

  async setFullscreen(fullscreen: boolean): Promise<PlaybackState> {
    await this.command(['set_property', 'fullscreen', fullscreen]);
    return this.state;
  }

  async toggleStats(): Promise<PlaybackState> {
    await this.command(['script-binding', 'stats/display-stats-toggle']);
    return this.state;
  }

  async selectTrack(
    type: 'audio' | 'subtitle',
    id: number | null
  ): Promise<PlaybackState> {
    if (type === 'subtitle') this.pendingSubtitlePreference = null;
    const property = type === 'audio' ? 'aid' : 'sid';
    await this.command(['set_property', property, id ?? 'no']);
    return this.state;
  }

  async setSpeed(speed: number): Promise<PlaybackState> {
    await this.command(['set_property', 'speed', Math.min(3, Math.max(0.25, speed))]);
    await this.showHud(`${speed.toFixed(2).replace(/\.00$/, '')}× speed`);
    return this.state;
  }

  async setSubtitleDelay(seconds: number): Promise<PlaybackState> {
    const value = Math.min(30, Math.max(-30, seconds));
    await this.command(['set_property', 'sub-delay', value]);
    await this.showHud(`Subtitle delay ${formatSignedSeconds(value)}`);
    return this.state;
  }

  async applySubtitleAppearance(
    player: AppSettings['player'] = this.config.settings.player
  ): Promise<void> {
    for (const property of mpvSubtitleProperties(player)) {
      await this.command(['set_property', property.name, property.value]);
    }
  }

  async setAudioDelay(seconds: number): Promise<PlaybackState> {
    const value = Math.min(30, Math.max(-30, seconds));
    await this.command(['set_property', 'audio-delay', value]);
    await this.showHud(`Audio delay ${formatSignedSeconds(value)}`);
    return this.state;
  }

  async seekChapter(index: number): Promise<PlaybackState> {
    const chapter = this.stateValue.chapters[index];
    if (!chapter) throw new Error('That chapter is not available.');
    await this.seek(chapter.startTicks / 10_000_000);
    await this.showHud(chapter.name || `Chapter ${index + 1}`);
    return this.state;
  }

  async showHud(message: string): Promise<void> {
    if (!this.socket || this.socket.destroyed) return;
    await this.command(['show-text', message, 1_800]);
  }

  async setSkipPrompt(prompt: SkipPromptOverlay | null): Promise<void> {
    if (sameSkipPrompt(this.skipPromptValue, prompt)) return;
    const previousPrompt = this.skipPromptValue;
    this.skipPromptValue = prompt ? { ...prompt } : null;
    try {
      if (!this.socket || this.socket.destroyed) return;
      if (prompt) {
        await this.ensureSkipSection(prompt.shortcut);
        await this.command([
          'osd-overlay',
          7_101,
          'ass-events',
          skipPromptAss(prompt),
          1280,
          720,
          100
        ]);
        await this.command(['enable-section', 'jellyclient-skip']);
        return;
      }
      await this.command(['disable-section', 'jellyclient-skip']);
      await this.command([
        'osd-overlay',
        7_101,
        'none',
        ''
      ]);
    } catch (error) {
      this.skipPromptValue = previousPrompt;
      throw error;
    }
  }

  private async ensureSkipSection(shortcut: string): Promise<void> {
    const normalized = shortcut.trim().toUpperCase();
    if (this.skipSectionKey === normalized) return;
    await this.command([
      'define-section',
      'jellyclient-skip',
      skipShortcutBindings(normalized),
      'force'
    ]);
    this.skipSectionKey = normalized;
  }

  async setPostPlayPrompt(
    nextItem: MediaItem | null,
    seconds: number | null,
    canceled = false
  ): Promise<void> {
    this.patchState({
      nextItem,
      postPlaySecondsRemaining: seconds,
      postPlayCanceled: canceled
    });
    if (!this.socket || this.socket.destroyed) return;
    if (nextItem && seconds !== null && !canceled) {
      this.postPlayVisible = true;
      await this.command([
        'osd-overlay',
        7_103,
        'ass-events',
        postPlayAss(
          nextItem.seriesName
            ? `${nextItem.indexLabel ?? ''} · ${nextItem.name}`.replace(/^ · /, '')
            : nextItem.name,
          seconds
        ),
        1280,
        720,
        100
      ]);
      await this.command(['enable-section', 'jellyclient-postplay']);
      return;
    }
    if (this.postPlayVisible) {
      this.postPlayVisible = false;
      await this.command(['disable-section', 'jellyclient-postplay']);
      await this.command(['osd-overlay', 7_103, 'none', '']);
    }
  }

  async shutdown(): Promise<void> {
    this.intentionalShutdown = true;
    if (this.audioVerificationTimer) {
      clearTimeout(this.audioVerificationTimer);
      this.audioVerificationTimer = null;
    }
    try {
      if (this.socket) await this.command(['quit']);
    } catch {
      this.processValue?.kill();
    }
    this.closeSocket();
    this.processValue = null;
  }

  private async ensureRunning(executablePath: string): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    this.intentionalShutdown = false;
    this.pipeName = `\\\\.\\pipe\\jellyclient-${randomUUID()}`;
    const args = this.buildArguments(this.config.settings);
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.processValue = child;
    child.on('error', (error) => {
      this.fail(`MPV could not start: ${userFacingError(error, 'Unknown error')}`);
    });
    child.on('exit', (code) => {
      this.closeSocket();
      this.processValue = null;
      if (!this.intentionalShutdown) {
        this.fail(`MPV exited unexpectedly${code === null ? '' : ` (code ${code})`}.`);
        this.events.emitClient({
          type: 'notice',
          data: {
            level: 'error',
            message: 'The MPV player process exited unexpectedly.'
          }
        });
      }
    });
    const captureOutput = (chunk: Buffer): void => {
      const message = chunk.toString('utf8').trim();
      if (!/fatal|error|failed/i.test(message)) return;
      const lines = message
        .split(/\r?\n/)
        .filter((line) => /fatal|error|failed/i.test(line));
      const matchingLine = [...lines]
        .reverse()
        .find((line) => /http.*error/i.test(line)) ?? lines.at(-1) ?? message;
      this.lastMpvError = this.sanitizeMpvError(matchingLine).slice(0, 300);
    };
    child.stdout.on('data', captureOutput);
    child.stderr.on('data', captureOutput);

    try {
      await this.connectPipe();
      for (const [index, property] of OBSERVED_PROPERTIES.entries()) {
        await this.command(['observe_property', index + 1, property]);
      }
      await this.ensureSkipSection(this.config.settings.player.skipSegmentKey);
      await this.command([
        'define-section',
        'jellyclient-controls',
        [
          'SPACE script-message jellyclient-toggle-pause',
          'p script-message jellyclient-toggle-pause',
          'P script-message jellyclient-toggle-pause',
          'LEFT script-message jellyclient-relative-seek -5',
          'RIGHT script-message jellyclient-relative-seek 5',
          'a cycle audio',
          'A cycle audio',
          's cycle sub',
          'S cycle sub',
          'Ctrl+LEFT script-message jellyclient-chapter -1',
          'Ctrl+RIGHT script-message jellyclient-chapter 1'
        ].join('\n'),
        'force'
      ]);
      await this.command(['enable-section', 'jellyclient-controls']);
      await this.command([
        'define-section',
        'jellyclient-postplay',
        [
          'n script-message jellyclient-play-next',
          'N script-message jellyclient-play-next',
          'ESC script-message jellyclient-cancel-next'
        ].join('\n'),
        'force'
      ]);
    } catch (error) {
      this.intentionalShutdown = true;
      this.closeSocket();
      if (child.exitCode === null && !child.killed) child.kill();
      if (this.processValue === child) this.processValue = null;
      throw error;
    }
  }

  private buildArguments(settings: AppSettings): string[] {
    const args = [
      '--idle=yes',
      '--force-window=no',
      '--keep-open=no',
      '--input-default-bindings=yes',
      '--input-vo-keyboard=yes',
      '--osc=yes',
      '--vo=gpu-next',
      `--gpu-api=${settings.player.gpuApi}`,
      `--hwdec=${settings.player.hardwareDecoding ? 'auto-safe' : 'no'}`,
      '--audio-client-name=JellyClient',
      `--audio-device=${settings.player.audioDevice || 'auto'}`,
      '--audio-channels=auto-safe',
      '--sub-auto=no',
      '--ytdl=no',
      '--msg-level=all=warn',
      '--title=JellyClient',
      `--ontop=${settings.player.alwaysOnTop ? 'yes' : 'no'}`,
      `--input-ipc-server=${this.pipeName}`
    ];

    args.push(...mpvSubtitleArguments(settings.player));

    const passthroughCodecs = settings.player.audioOutputMode === 'passthrough'
      ? mpvPassthroughCodecs(settings.player.audioPassthrough)
      : [];
    args.push(
      `--audio-spdif=${passthroughCodecs.join(',')}`,
      `--audio-exclusive=${passthroughCodecs.length > 0 ? 'yes' : 'no'}`
    );

    if (settings.player.autoEnableSubtitles) {
      args.push(
        '--sid=auto',
        `--slang=${mpvLanguagePriority(settings.player.preferredSubtitleLanguage)}`,
        '--subs-match-os-language=no',
        '--subs-fallback=no',
        '--subs-fallback-forced=no'
      );
    } else {
      args.push('--sid=no');
    }

    if (settings.player.gpuApi === 'vulkan') {
      args.push('--gpu-context=winvk');
    } else {
      args.push('--gpu-context=d3d11');
    }
    if (settings.player.hdrMode === 'tone-map') {
      args.push(
        '--target-colorspace-hint=auto',
        '--target-prim=bt.709',
        '--target-trc=gamma2.2',
        '--tone-mapping=auto'
      );
    } else if (settings.player.hdrMode === 'passthrough') {
      args.push(
        '--target-colorspace-hint=yes',
        '--target-colorspace-hint-mode=source'
      );
    } else {
      args.push('--target-colorspace-hint=auto');
    }
    if (settings.player.preferredDisplayId !== 'auto') {
      const displayIndex = screen.getAllDisplays().findIndex(
        (display) => String(display.id) === settings.player.preferredDisplayId
      );
      if (displayIndex >= 0) {
        args.push(`--screen=${displayIndex}`, `--fs-screen=${displayIndex}`);
      }
    }
    return args;
  }

  private connectPipe(): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryConnect = (): void => {
        attempts += 1;
        const socket = createConnection(this.pipeName);
        const onError = (): void => {
          socket.destroy();
          if (attempts >= 50) {
            reject(new Error('Timed out connecting to the MPV IPC pipe.'));
            return;
          }
          setTimeout(tryConnect, 100);
        };
        socket.once('error', onError);
        socket.once('connect', () => {
          socket.off('error', onError);
          socket.on('error', () => this.closeSocket());
          socket.on('close', () => this.closeSocket());
          socket.on('data', (chunk: Buffer) => this.onData(chunk));
          this.socket = socket;
          resolve();
        });
      };
      tryConnect();
    });
  }

  private command(command: unknown[]): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(new Error('MPV IPC is not connected.'));
    }
    const requestId = this.nextRequestId++;
    const label = typeof command[0] === 'string' ? command[0] : 'command';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`MPV command timed out: ${String(command[0])}`));
      }, 5000);
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        label
      });
      this.socket!.write(`${JSON.stringify({
        command,
        request_id: requestId
      })}\n`);
    });
  }

  private onData(chunk: Buffer): void {
    this.readBuffer += chunk.toString('utf8');
    let boundary = this.readBuffer.indexOf('\n');
    while (boundary >= 0) {
      const line = this.readBuffer.slice(0, boundary).trim();
      this.readBuffer = this.readBuffer.slice(boundary + 1);
      if (line) {
        try {
          this.onMessage(JSON.parse(line) as MpvMessage);
        } catch {
          // Ignore malformed MPV output without taking down playback.
        }
      }
      boundary = this.readBuffer.indexOf('\n');
    }
  }

  private onMessage(message: MpvMessage): void {
    if (message.request_id) {
      const pending = this.pending.get(message.request_id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.request_id);
        if (message.error && message.error !== 'success') {
          pending.reject(new Error(`MPV ${pending.label}: ${message.error}`));
        } else {
          pending.resolve(message.data);
        }
      }
    }

    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-skip'
    ) {
      this.emit('skip-segment');
      return;
    }
    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-toggle-pause'
    ) {
      this.emit('toggle-pause-requested');
      return;
    }
    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-relative-seek'
    ) {
      const offsetSeconds = Number(message.args[1]);
      if (Number.isFinite(offsetSeconds) && offsetSeconds !== 0) {
        this.emit('relative-seek-requested', offsetSeconds);
      }
      return;
    }
    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-chapter'
    ) {
      this.emit('chapter-step', Number(message.args[1]) || 0);
      return;
    }
    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-play-next'
    ) {
      this.emit('play-next');
      return;
    }
    if (
      message.event === 'client-message' &&
      message.args?.[0] === 'jellyclient-cancel-next'
    ) {
      this.emit('cancel-post-play');
      return;
    }

    if (message.event === 'property-change' && message.name) {
      this.onProperty(message.name, message.data);
      return;
    }
    if (message.event === 'start-file') {
      const event = this.playbackGenerations.start(
        this.playlistEntryId(message),
        this.stateValue.generation
      );
      this.emit('start-file', event satisfies MpvFileEvent);
      return;
    }
    if (message.event === 'file-loaded') {
      const event = this.playbackGenerations.current(
        this.playlistEntryId(message),
        this.stateValue.generation
      );
      if (event.generation !== this.stateValue.generation) {
        this.emit('file-loaded', event satisfies MpvFileEvent);
        return;
      }
      void this.finishFileLoaded(event);
      return;
    }
    if (message.event === 'playback-restart') {
      this.emit('playback-restart', this.state);
      return;
    }
    if (message.event === 'seek') {
      this.emit('seek', this.state);
      return;
    }
    if (message.event === 'end-file') {
      const tracked = this.playbackGenerations.end(
        this.playlistEntryId(message),
        this.stateValue.generation
      );
      const event: MpvEndFileEvent = {
        ...tracked,
        reason: message.reason ?? 'unknown',
        error: this.mpvEventError(message.file_error ?? message.error)
      };
      const isCurrent = event.generation === this.stateValue.generation;
      if (isCurrent && event.reason !== 'redirect') {
        this.loadedGeneration = null;
        this.pendingInitialPause = null;
        if (this.audioVerificationTimer) {
          clearTimeout(this.audioVerificationTimer);
          this.audioVerificationTimer = null;
        }
        void this.setSkipPrompt(null).catch(() => undefined);
        void this.setPostPlayPrompt(
          this.stateValue.nextItem,
          null,
          event.reason === 'error'
        ).catch(() => undefined);
        if (event.reason === 'error') {
          const detail = [...new Set(
            [event.error, this.lastMpvError].filter(
              (value): value is string => Boolean(value)
            )
          )].join(' · ');
          const errorMessage = detail
            ? `MPV could not play this item: ${detail}`
            : 'MPV could not play this item.';
          this.fail(errorMessage);
          this.events.emitClient({
            type: 'notice',
            data: { level: 'error', message: errorMessage }
          });
        } else {
          this.setState({
            ...this.stateValue,
            status: 'stopped',
            paused: true,
            buffering: false
          });
        }
      }
      this.emit('end-file', event);
    }
  }

  private playlistEntryId(message: MpvMessage): number | null {
    return typeof message.playlist_entry_id === 'number'
      ? message.playlist_entry_id
      : null;
  }

  private mpvEventError(error: string | undefined): string | null {
    return error && error !== 'success' ? error : null;
  }

  private sanitizeMpvError(message: string): string {
    return message
      .replace(/Authorization:.*$/gi, 'Authorization: [redacted]')
      .replace(/Token=(?:\\?"|%22)[^"%]+(?:\\?"|%22)/gi, 'Token="[redacted]"')
      .replace(/([?&](?:PlaySessionId|api_key)=)[^&\s]+/gi, '$1[redacted]');
  }

  private onProperty(name: string, value: unknown): void {
    switch (name) {
      case 'time-pos':
        {
          const positionSeconds = typeof value === 'number' ? value : 0;
          this.patchState({
            positionSeconds,
            currentChapterIndex: chapterAt(
              this.stateValue.chapters,
              positionSeconds
            )
          });
        }
        break;
      case 'duration':
        this.patchState({
          durationSeconds: typeof value === 'number' ? value : 0
        });
        break;
      case 'pause': {
        const paused = Boolean(value);
        const loading = !this.isMediaLoaded ||
          this.stateValue.status === 'starting' ||
          this.stateValue.status === 'loading';
        this.patchState({
          paused,
          status:
            loading
              ? this.stateValue.status
              : paused
                ? 'paused'
                : 'playing'
        });
        break;
      }
      case 'paused-for-cache': {
        const buffering = Boolean(value);
        const loading = !this.isMediaLoaded ||
          this.stateValue.status === 'starting' ||
          this.stateValue.status === 'loading';
        this.patchState({
          buffering,
          status: loading
            ? this.stateValue.status
            : buffering
            ? 'buffering'
            : this.stateValue.paused
              ? 'paused'
              : 'playing'
        });
        break;
      }
      case 'volume':
        this.patchState({
          volume: typeof value === 'number' ? value : this.stateValue.volume
        });
        break;
      case 'mute':
        this.patchState({ muted: Boolean(value) });
        break;
      case 'fullscreen':
        this.patchState({ fullscreen: Boolean(value) });
        break;
      case 'speed':
        this.patchState({
          speed: typeof value === 'number' ? value : this.stateValue.speed
        });
        break;
      case 'sub-delay':
        this.patchState({
          subtitleDelaySeconds:
            typeof value === 'number'
              ? value
              : this.stateValue.subtitleDelaySeconds
        });
        break;
      case 'audio-delay':
        this.patchState({
          audioDelaySeconds:
            typeof value === 'number'
              ? value
              : this.stateValue.audioDelaySeconds
        });
        break;
      case 'track-list':
        {
          const tracks = this.mapTracks(value);
          this.patchState({ tracks });
          if (
            this.pendingSubtitlePreference &&
            Array.isArray(value) &&
            value.length > 0
          ) {
            const preference = this.pendingSubtitlePreference;
            this.pendingSubtitlePreference = null;
            void this.applySubtitlePreference(tracks, preference);
          }
        }
        break;
      case 'video-params': {
        const params =
          value && typeof value === 'object'
            ? value as Record<string, unknown>
            : {};
        this.updateDiagnostics({
          videoParams:
            typeof params.w === 'number' && typeof params.h === 'number'
              ? `${params.w}×${params.h}`
              : null,
          colorPrimaries:
            typeof params.primaries === 'string' ? params.primaries : null,
          colorTransfer:
            typeof params.gamma === 'string' ? params.gamma : null,
          colorMatrix:
            typeof params.colormatrix === 'string' ? params.colormatrix : null,
          colorLevels:
            typeof params.colorlevels === 'string' ? params.colorlevels : null,
          lightType:
            typeof params.light === 'string' ? params.light : null,
          sourcePixelFormat:
            typeof params.pixelformat === 'string' ? params.pixelformat : null,
          masteringMinLuminance: this.numberOrNull(params['min-luma']),
          masteringMaxLuminance: this.numberOrNull(params['max-luma']),
          maxCll: this.numberOrNull(params['max-cll']),
          maxFall: this.numberOrNull(params['max-fall'])
        });
        break;
      }
      case 'video-target-params': {
        const params =
          value && typeof value === 'object'
            ? value as Record<string, unknown>
            : {};
        this.updateDiagnostics({
          outputPrimaries:
            typeof params.primaries === 'string' ? params.primaries : null,
          outputTransfer:
            typeof params.gamma === 'string' ? params.gamma : null,
          outputMatrix:
            typeof params.colormatrix === 'string' ? params.colormatrix : null,
          outputLevels:
            typeof params.colorlevels === 'string' ? params.colorlevels : null,
          outputPixelFormat:
            typeof params.pixelformat === 'string' ? params.pixelformat : null,
          outputMinLuminance: this.numberOrNull(params['min-luma']),
          outputMaxLuminance: this.numberOrNull(params['max-luma'])
        });
        break;
      }
      case 'audio-out-params': {
        const params =
          value && typeof value === 'object'
            ? value as Record<string, unknown>
            : {};
        this.updateDiagnostics({
          audioOutputFormat:
            typeof params.format === 'string' ? params.format : null,
          audioOutputChannels:
            typeof params['hr-channels'] === 'string'
              ? params['hr-channels']
              : typeof params.channels === 'string'
                ? params.channels
                : null,
          audioOutputSampleRate:
            typeof params.samplerate === 'number' ? params.samplerate : null,
          audioPassthroughActive: isPassthroughOutputFormat(
            typeof params.format === 'string' ? params.format : null
          )
        });
        break;
      }
      case 'audio-device':
        this.updateDiagnostics({
          audioRequestedDevice: typeof value === 'string' ? value : 'auto'
        });
        break;
      case 'current-ao':
        this.updateDiagnostics({
          audioDriver: typeof value === 'string' ? value : null
        });
        break;
      case 'estimated-display-fps':
        this.updateDiagnostics({
          displayFps: typeof value === 'number' ? value : 0
        });
        break;
      case 'display-names':
        this.updateDiagnostics({
          displayNames: Array.isArray(value)
            ? value.filter((name): name is string => typeof name === 'string')
            : []
        });
        break;
      case 'current-vo':
        this.updateDiagnostics({
          currentVo: typeof value === 'string' ? value : null
        });
        break;
      case 'target-colorspace-hint':
        this.updateDiagnostics({
          colorHint: typeof value === 'string' ? value : null
        });
        break;
      case 'target-colorspace-hint-mode':
        this.updateDiagnostics({
          colorHintMode: typeof value === 'string' ? value : null
        });
        break;
      case 'tone-mapping':
        this.updateDiagnostics({
          toneMapping: typeof value === 'string' ? value : null
        });
        break;
      case 'hwdec-current':
        this.updateDiagnostics({
          hwdec: typeof value === 'string' ? value : null
        });
        break;
      case 'cache-duration':
        this.updateDiagnostics({
          cacheDurationSeconds: typeof value === 'number' ? value : 0
        });
        break;
      case 'vo-drop-frame-count':
        this.updateDiagnostics({
          droppedFrames: typeof value === 'number' ? value : 0
        });
        break;
    }
  }

  private mapTracks(value: unknown): TrackInfo[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): TrackInfo[] => {
      if (!entry || typeof entry !== 'object') return [];
      const track = entry as Record<string, unknown>;
      if (track.type !== 'audio' && track.type !== 'sub') return [];
      if (typeof track.id !== 'number') return [];
      const type = track.type === 'audio' ? 'audio' : 'subtitle';
      return [{
        id: track.id,
        ffIndex: typeof track['ff-index'] === 'number' ? track['ff-index'] : null,
        type,
        title:
          typeof track.title === 'string'
            ? track.title
            : `${type === 'audio' ? 'Audio' : 'Subtitle'} ${track.id}`,
        language: typeof track.lang === 'string' ? track.lang : null,
        codec: typeof track.codec === 'string' ? track.codec : null,
        selected: Boolean(track.selected),
        default: Boolean(track.default),
        external: Boolean(track.external),
        forced: Boolean(track.forced)
      }];
    });
  }

  private async applySubtitlePreference(
    tracks: TrackInfo[],
    preference: MpvSubtitlePreference
  ): Promise<void> {
    const subtitles = tracks.filter((track) => track.type === 'subtitle');
    const explicit = preference.streamIndex === null
      ? null
      : subtitles.find((track) => track.ffIndex === preference.streamIndex) ??
        null;
    const automatic = preference.enabled && preference.streamIndex === null
      ? choosePreferredSubtitle(
          subtitles.map((track) => ({
            id: track.id,
            language: track.language,
            title: track.title,
            isDefault: track.default,
            isForced: track.forced
          })),
          preference.language
        )
      : null;
    await this.command([
      'set_property',
      'sid',
      explicit?.id ?? automatic?.id ?? 'no'
    ]).catch(() => undefined);
  }

  private patchState(patch: Partial<PlaybackState>): void {
    this.setState({
      ...this.stateValue,
      ...patch
    });
  }

  private updateDiagnostics(
    patch: Partial<PlaybackState['diagnostics']>
  ): void {
    this.setState({
      ...this.stateValue,
      diagnostics: {
        ...this.stateValue.diagnostics,
        ...patch
      }
    });
  }

  private scheduleAudioVerification(generation: number): void {
    if (this.audioVerificationTimer) clearTimeout(this.audioVerificationTimer);
    this.audioVerificationTimer = setTimeout(() => {
      this.audioVerificationTimer = null;
      void this.verifyAudioOutput(generation);
    }, 1_600);
  }

  private async verifyAudioOutput(generation: number): Promise<void> {
    if (this.stateValue.generation !== generation || !this.socket) return;
    const player = this.config.settings.player;
    if (
      player.audioOutputMode !== 'passthrough' ||
      !codecRequestsPassthrough(
        this.stateValue.diagnostics.audioCodec,
        player.audioPassthrough
      ) ||
      !this.stateValue.tracks.some(
        (track) => track.type === 'audio' && track.selected
      )
    ) {
      return;
    }

    if (this.stateValue.diagnostics.audioPassthroughActive) return;
    if (
      this.stateValue.diagnostics.audioDriver &&
      this.stateValue.diagnostics.audioOutputFormat
    ) {
      this.updateDiagnostics({
        audioFallbackReason:
          'The selected endpoint did not open the requested bitstream; MPV is outputting decoded PCM.'
      });
      return;
    }

    try {
      await this.command(['set_property', 'audio-spdif', '']);
      await this.command(['audio-reload']);
      this.updateDiagnostics({
        audioPassthroughActive: false,
        audioFallbackReason:
          'Bitstream output did not initialize, so JellyClient reloaded the track as decoded PCM.'
      });
      this.events.emitClient({
        type: 'notice',
        data: {
          level: 'warning',
          message: 'Audio passthrough was unavailable. Playback continued with decoded PCM.'
        }
      });
    } catch (error) {
      const detail = userFacingError(error, 'Unknown MPV error');
      this.updateDiagnostics({
        audioPassthroughActive: false,
        audioFallbackReason: `The automatic decoded-PCM retry failed: ${detail}`
      });
      this.events.emitClient({
        type: 'notice',
        data: {
          level: 'error',
          message: 'Audio output could not be initialized. Select decoded PCM or another Windows output device.'
        }
      });
    }
  }

  private async applyAudioOutputSettings(
    player: AppSettings['player']
  ): Promise<void> {
    const passthroughCodecs = player.audioOutputMode === 'passthrough'
      ? mpvPassthroughCodecs(player.audioPassthrough)
      : [];
    await this.command([
      'set_property',
      'audio-device',
      player.audioDevice || 'auto'
    ]);
    await this.command([
      'set_property',
      'audio-spdif',
      passthroughCodecs.join(',')
    ]);
    await this.command([
      'set_property',
      'audio-exclusive',
      passthroughCodecs.length > 0
    ]);
  }

  private numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private setState(state: PlaybackState): void {
    this.stateValue = state;
    this.emit('state', this.state);
    this.events.emitClient({
      type: 'playback',
      data: this.state
    });
  }

  private fail(message: string): void {
    this.loadedGeneration = null;
    this.pendingInitialPause = null;
    this.setState({
      ...this.stateValue,
      status: 'error',
      paused: true,
      buffering: false,
      error: message
    });
  }

  private closeSocket(): void {
    this.loadedGeneration = null;
    this.pendingInitialPause = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MPV IPC disconnected.'));
    }
    this.pending.clear();
    this.skipPromptValue = null;
    this.skipSectionKey = null;
    this.postPlayVisible = false;
    this.playbackGenerations.reset();
  }

  private async finishFileLoaded(event: MpvFileEvent): Promise<void> {
    const pendingPause = this.pendingInitialPause;
    if (
      event.generation !== this.stateValue.generation ||
      pendingPause?.generation !== event.generation
    ) return;
    try {
      await this.command(['set_property', 'pause', pendingPause.paused]);
    } catch (error) {
      if (event.generation !== this.stateValue.generation) return;
      this.fail(
        `MPV could not finish preparing playback: ${userFacingError(error, 'Unknown MPV error')}`
      );
      return;
    }
    if (event.generation !== this.stateValue.generation) return;
    this.loadedGeneration = event.generation;
    this.pendingInitialPause = null;
    this.setState({
      ...this.stateValue,
      paused: pendingPause.paused,
      status: pendingPause.paused ? 'paused' : 'playing',
      buffering: false,
      error: null
    });
    this.emit('file-loaded', event satisfies MpvFileEvent);
    this.scheduleAudioVerification(event.generation);
  }

  private async candidatePaths(overridePath?: string): Promise<string[]> {
    const settingsPath = this.config.settings.player.mpvPath.trim();
    const environmentPath = process.env.JELLYCLIENT_MPV_PATH?.trim();
    const candidates = [
      overridePath,
      settingsPath,
      environmentPath,
      join(process.resourcesPath, 'mpv', 'mpv.exe'),
      join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe'),
      join(homedir(), 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
      'C:\\ProgramData\\chocolatey\\bin\\mpv.exe',
      'C:\\Program Files\\mpv\\mpv.exe',
      'C:\\Program Files (x86)\\mpv\\mpv.exe'
    ].filter((value): value is string => Boolean(value));

    try {
      const where = await new Promise<string[]>((resolve) => {
        const child = spawn('where.exe', ['mpv.exe'], { windowsHide: true });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString('utf8');
        });
        child.once('exit', () => {
          resolve(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
        });
        child.once('error', () => resolve([]));
      });
      candidates.push(...where);
    } catch {
      // PATH discovery is optional.
    }

    return [...new Set(candidates)];
  }

  private readVersion(executablePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executablePath, ['--version'], {
        windowsHide: true
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error('MPV version probe failed.'));
          return;
        }
        resolve(output.split(/\r?\n/)[0]?.trim() || 'mpv');
      });
    });
  }

  private readAudioDevices(executablePath: string): Promise<MpvAudioDevice[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        executablePath,
        ['--no-config', '--audio-device=help'],
        { windowsHide: true }
      );
      let output = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Timed out while MPV listed Windows audio devices.'));
      }, 8_000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        const devices = parseMpvAudioDevices(output);
        if (code !== 0 || devices.length === 0) {
          reject(new Error('MPV did not report any Windows audio devices.'));
          return;
        }
        resolve(devices);
      });
    });
  }
}

function chapterAt(
  chapters: PlaybackState['chapters'],
  positionSeconds: number
): number | null {
  let active: number | null = null;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.startTicks / 10_000_000 > positionSeconds) break;
    active = index;
  }
  return active;
}

function formatSignedSeconds(value: number): string {
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(2)} s`;
}

function sameSkipPrompt(
  left: SkipPromptOverlay | null,
  right: SkipPromptOverlay | null
): boolean {
  return left?.label === right?.label &&
    left?.shortcut === right?.shortcut &&
    left?.secondsRemaining === right?.secondsRemaining &&
    left?.totalSeconds === right?.totalSeconds &&
    left?.automatic === right?.automatic;
}

function skipShortcutBindings(shortcut: string): string {
  const keys = /^[A-Z]$/.test(shortcut)
    ? [shortcut.toLowerCase(), shortcut]
    : [shortcut];
  return keys
    .map((key) => `${key} script-message jellyclient-skip`)
    .join('\n');
}
