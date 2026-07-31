import { getSyncPlayApi } from '@jellyfin/sdk/lib/utils/api/sync-play-api.js';
import { getTimeSyncApi } from '@jellyfin/sdk/lib/utils/api/time-sync-api.js';
import type { GroupInfoDto } from '@jellyfin/sdk/lib/generated-client/models/group-info-dto.js';
import type { PlayQueueUpdate } from '@jellyfin/sdk/lib/generated-client/models/play-queue-update.js';
import type { SendCommand } from '@jellyfin/sdk/lib/generated-client/models/send-command.js';
import type {
  PlayMediaInput,
  SyncPlayGroup,
  SyncPlayState,
  WatchTogetherInput
} from '@shared/contracts.js';
import { TICKS_PER_SECOND } from '@shared/contracts.js';
import { initialSyncPlayState } from '@shared/defaults.js';
import {
  isSyncPlayPlayerLoading,
  isSyncPlayPlayerReady,
  syncPlayCommandMatchesPlaylist
} from '@shared/syncplay-player-state.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { userFacingError } from './errors.js';
import { JellyfinService } from './jellyfin-service.js';
import { MpvService } from './mpv-service.js';
import { PlaybackService } from './playback-service.js';
import {
  JellyfinWebSocketService
} from './websocket-service.js';

interface GroupUpdateMessage {
  GroupId?: string;
  Type?: string;
  Data?: unknown;
}

interface ClockSample {
  offset: number;
  roundTrip: number;
}

interface PlaybackTimelineAnchor {
  localTargetMs: number;
  playlistItemId: string;
  positionSeconds: number;
  playing: boolean;
}

export class SyncPlayService {
  private readonly jellyfin: JellyfinService;
  private readonly socket: JellyfinWebSocketService;
  private readonly playback: PlaybackService;
  private readonly mpv: MpvService;
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private stateValue: SyncPlayState = structuredClone(initialSyncPlayState);
  private intentChain: Promise<unknown> = Promise.resolve();
  private controlChain: Promise<unknown> = Promise.resolve();
  private queueLoadChain: Promise<unknown> = Promise.resolve();
  private scheduledCommand: NodeJS.Timeout | null = null;
  private commandGeneration = 0;
  private lastBuffering: boolean | null = null;
  private queueLoadGeneration = 0;
  private speedResetTimer: NodeJS.Timeout | null = null;
  private postStartCorrectionTimer: NodeJS.Timeout | null = null;
  private pendingCommand: SendCommand | null = null;
  private lastCommandEmittedAtMs = 0;
  private lastCommandKey: string | null = null;
  private readyInFlight: Promise<void> | null = null;
  private lastReadyRequest: {
    playlistItemId: string;
    sentAtMs: number;
  } | null = null;
  private lastObservedPaused = true;
  private nativeSeekTimer: NodeJS.Timeout | null = null;
  private suppressNativePauseUntil = 0;
  private suppressNativeSeekUntil = 0;
  private suppressedPauseValue: boolean | null = null;
  private queueLoadKey: string | null = null;
  private timelineAnchor: PlaybackTimelineAnchor | null = null;
  private lastDriftPublishedAt = 0;

  constructor(
    jellyfin: JellyfinService,
    socket: JellyfinWebSocketService,
    playback: PlaybackService,
    mpv: MpvService,
    config: ConfigService,
    events: ClientEventBus
  ) {
    this.jellyfin = jellyfin;
    this.socket = socket;
    this.playback = playback;
    this.mpv = mpv;
    this.config = config;
    this.events = events;
    this.lastObservedPaused = mpv.state.paused;

    socket.on('SyncPlayGroupUpdate', (data) => {
      void this.processGroupUpdate(data as GroupUpdateMessage);
    });
    socket.on('SyncPlayCommand', (data) => {
      this.processCommand(data as SendCommand);
    });
    socket.on('connected', () => {
      if (this.stateValue.currentGroup) {
        void this.restoreMembership(this.stateValue.currentGroup.id);
      }
    });
    jellyfin.on('disconnected', () => this.reset());

    mpv.on('playback-restart', () => {
      if (
        this.stateValue.membership === 'joined' &&
        this.stateValue.currentGroup?.state === 'Waiting'
      ) {
        void this.sendReady().then(() => this.flushPendingCommand());
      }
    });
    mpv.on('seek', () => this.queueNativeSeekRelay());
    mpv.on('state', () => {
      const playback = this.mpv.state;
      const paused = playback.paused;
      const pauseChanged = paused !== this.lastObservedPaused;
      this.lastObservedPaused = paused;
      void this.onPlayerState();
      if (pauseChanged) this.queueNativePauseRelay(paused);
    });
  }

  get state(): SyncPlayState {
    return structuredClone(this.stateValue);
  }

  async listGroups(): Promise<SyncPlayState> {
    const response = await getSyncPlayApi(this.jellyfin.api).syncPlayGetGroups();
    const groups = response.data.map((group: GroupInfoDto) =>
      this.mapGroup(group)
    );
    const current = this.stateValue.currentGroup
      ? groups.find((group: SyncPlayGroup) =>
          group.id === this.stateValue.currentGroup?.id
        ) ??
        this.stateValue.currentGroup
      : null;
    this.setState({
      ...this.stateValue,
      groups,
      currentGroup: current
    });
    return this.state;
  }

  create(name: string): Promise<SyncPlayState> {
    return this.serialize(async () => {
      this.setState({
        ...this.stateValue,
        membership: 'joining',
        error: null
      });
      try {
        await this.socket.waitUntilConnected();
        const response = await getSyncPlayApi(
          this.jellyfin.api
        ).syncPlayCreateGroup({
          newGroupRequestDto: {
            GroupName: name
          }
        });
        const group = this.mapGroup(response.data);
        this.confirmJoined(group);
        await this.synchronizeClock();
        await this.listGroups();
      } catch (error) {
        this.failJoin(error, 'Could not create the SyncPlay group.');
      }
      return this.state;
    });
  }

  join(groupId: string): Promise<SyncPlayState> {
    return this.serialize(async () => {
      if (
        this.stateValue.membership === 'joined' &&
        this.stateValue.currentGroup?.id === groupId
      ) {
        return this.state;
      }
      this.setState({
        ...this.stateValue,
        membership: 'joining',
        error: null
      });
      try {
        await this.socket.waitUntilConnected();
        let targetGroup = this.stateValue.groups.find(
          (group) => group.id === groupId
        );
        if (!targetGroup) {
          await this.listGroups();
          targetGroup = this.stateValue.groups.find(
            (group) => group.id === groupId
          );
        }
        await getSyncPlayApi(this.jellyfin.api).syncPlayJoinGroup({
          joinGroupRequestDto: {
            GroupId: groupId
          }
        });
        this.confirmJoined(targetGroup ?? {
          id: groupId,
          name: 'SyncPlay group',
          state: 'Idle',
          participants: []
        });
        await this.synchronizeClock();
        await this.listGroups();
      } catch (error) {
        this.failJoin(error, 'Could not join the SyncPlay group.');
      }
      return this.state;
    });
  }

  leave(): Promise<SyncPlayState> {
    return this.serialize(async () => {
      if (this.stateValue.membership === 'not-joined') return this.state;
      this.setState({
        ...this.stateValue,
        membership: 'leaving',
        error: null
      });
      try {
        await getSyncPlayApi(this.jellyfin.api).syncPlayLeaveGroup();
        this.confirmLeft();
        await this.listGroups();
      } catch (error) {
        this.setState({
          ...this.stateValue,
          membership: 'error',
          error: userFacingError(error, 'Could not leave the SyncPlay group.')
        });
      }
      return this.state;
    });
  }

  async startItem(input: PlayMediaInput): Promise<SyncPlayState> {
    if (this.stateValue.membership !== 'joined') {
      throw new Error('Join a SyncPlay group before starting group playback.');
    }
    await this.socket.waitUntilConnected();
    await getSyncPlayApi(this.jellyfin.api).syncPlaySetNewQueue({
      playRequestDto: {
        PlayingQueue: [input.itemId],
        PlayingItemPosition: 0,
        StartPositionTicks: input.startPositionTicks
      }
    });
    return this.state;
  }

  watchTogether(input: WatchTogetherInput): Promise<SyncPlayState> {
    return this.serialize(async () => {
      await this.createWithoutSerialization(input.groupName);
      if (
        this.stateValue.membership !== 'joined' ||
        !this.stateValue.currentGroup
      ) {
        throw new Error(
          this.stateValue.error ?? 'The SyncPlay group was not created.'
        );
      }
      await getSyncPlayApi(this.jellyfin.api).syncPlaySetNewQueue({
        playRequestDto: {
          PlayingQueue: [input.itemId],
          PlayingItemPosition: 0,
          StartPositionTicks: input.startPositionTicks
        }
      });
      return this.state;
    });
  }

  action(
    action:
      | { type: 'play' }
      | { type: 'pause' }
      | { type: 'stop' }
      | { type: 'seek'; positionTicks: number }
  ): Promise<SyncPlayState> {
    return this.serializeControl(async () => {
      if (this.stateValue.membership !== 'joined') {
        throw new Error('This client is not in a SyncPlay group.');
      }
      await this.socket.waitUntilConnected();
      const api = getSyncPlayApi(this.jellyfin.api);
      switch (action.type) {
        case 'play':
          await api.syncPlayUnpause();
          break;
        case 'pause':
          this.suppressNativeControlRelay('pause', 750, true);
          await this.playback.pauseLocal();
          await api.syncPlayPause();
          break;
        case 'stop':
          await api.syncPlayStop();
          break;
        case 'seek':
          await api.syncPlaySeek({
            seekRequestDto: {
              PositionTicks: action.positionTicks
            }
          });
          break;
      }
      return this.state;
    });
  }

  reset(): void {
    this.invalidatePlaybackWork();
    this.cancelScheduledCommand();
    this.clearSpeedCorrection();
    this.lastBuffering = null;
    this.pendingCommand = null;
    this.lastCommandEmittedAtMs = 0;
    this.lastCommandKey = null;
    this.lastReadyRequest = null;
    this.timelineAnchor = null;
    this.lastDriftPublishedAt = 0;
    this.clearNativeControlRelays();
    this.setState(structuredClone(initialSyncPlayState));
  }

  private async createWithoutSerialization(name: string): Promise<void> {
    this.setState({
      ...this.stateValue,
      membership: 'joining',
      error: null
    });
    await this.socket.waitUntilConnected();
    const response = await getSyncPlayApi(
      this.jellyfin.api
    ).syncPlayCreateGroup({
      newGroupRequestDto: {
        GroupName: name
      }
    });
    this.confirmJoined(this.mapGroup(response.data));
    await this.synchronizeClock();
    await this.listGroups();
  }

  private async processGroupUpdate(
    update: GroupUpdateMessage
  ): Promise<void> {
    if (
      update.Type !== 'GroupJoined' &&
      update.GroupId &&
      this.stateValue.currentGroup &&
      update.GroupId !== this.stateValue.currentGroup.id
    ) {
      return;
    }
    switch (update.Type) {
      case 'GroupJoined':
        this.confirmJoined(this.mapGroup(update.Data as GroupInfoDto));
        break;
      case 'GroupLeft':
      case 'NotInGroup':
        this.confirmLeft();
        break;
      case 'GroupDoesNotExist':
        this.failProtocol('That SyncPlay group no longer exists.');
        break;
      case 'LibraryAccessDenied':
        this.failProtocol(
          'This Jellyfin user cannot access all items in that SyncPlay queue.'
        );
        break;
      case 'StateUpdate': {
        const data = update.Data as {
          State?: string;
          Reason?: string;
        };
        if (this.stateValue.currentGroup && data.State) {
          if (data.State === 'Waiting') this.lastBuffering = null;
          this.setState({
            ...this.stateValue,
            currentGroup: {
              ...this.stateValue.currentGroup,
              state: data.State
            }
          });
        }
        break;
      }
      case 'PlayQueue':
        await this.processQueue(update.Data as PlayQueueUpdate);
        break;
      case 'UserJoined':
      case 'UserLeft':
        await this.listGroups();
        break;
    }
  }

  private async processQueue(queue: PlayQueueUpdate): Promise<void> {
    const index = queue.PlayingItemIndex ?? -1;
    const current = index >= 0 ? queue.Playlist?.[index] : undefined;
    const itemId = current?.ItemId ?? null;
    const playlistItemId = current?.PlaylistItemId ?? null;
    const startPositionTicks = queue.StartPositionTicks ?? 0;
    const queueKey = itemId && playlistItemId
      ? `${itemId}|${playlistItemId}|${startPositionTicks}`
      : null;
    const repeatedQueue = queueKey !== null && queueKey === this.queueLoadKey;
    this.lastBuffering = null;
    this.setState({
      ...this.stateValue,
      groupQueueItemId: itemId,
      playlistItemId
    });
    this.playback.setPlaylistItemId(playlistItemId);

    if (!itemId) return;
    const alreadyLoaded = isSyncPlayPlayerReady(
      this.mpv.state,
      this.mpv.isConnected,
      this.mpv.isMediaLoaded,
      itemId
    );
    if (alreadyLoaded) {
      this.queueLoadKey = queueKey;
      await this.sendReady();
      this.flushPendingCommand();
      return;
    }

    // Jellyfin can repeat the current queue while MPV is still opening it.
    // Treat that as a status refresh instead of starting another loadfile race.
    if (repeatedQueue) return;

    const loadGeneration = ++this.queueLoadGeneration;
    this.queueLoadKey = queueKey;
    try {
      await this.serializeQueueLoad(async () => {
        if (loadGeneration !== this.queueLoadGeneration) return;
        await this.playback.play(
          {
            itemId,
            startPositionTicks,
            mediaSourceId: null,
            maxStreamingBitrate: null,
            audioStreamIndex: null,
            subtitleStreamIndex: null
          },
          {
            paused: true,
            playlistItemId
          }
        );
      });
      if (loadGeneration !== this.queueLoadGeneration) return;
      await this.waitFor(
        () =>
          loadGeneration !== this.queueLoadGeneration ||
          isSyncPlayPlayerReady(
            this.mpv.state,
            this.mpv.isConnected,
            this.mpv.isMediaLoaded,
            itemId
          ),
        15_000,
        'MPV is still loading the SyncPlay item.'
      );
      if (loadGeneration !== this.queueLoadGeneration) return;
      await this.sendReady();
      this.flushPendingCommand();
    } catch (error) {
      if (loadGeneration !== this.queueLoadGeneration) return;
      this.queueLoadKey = null;
      this.warnRecoverable(
        `${userFacingError(error, 'Could not prepare the SyncPlay item.')} The room is still joined and playback will recover when MPV becomes ready.`
      );
    }
  }

  private processCommand(command: SendCommand): void {
    if (
      !command.Command ||
      !command.When ||
      this.stateValue.membership !== 'joined' ||
      (command.GroupId &&
        command.GroupId !== this.stateValue.currentGroup?.id)
    ) {
      return;
    }
    if (command.Command !== 'Stop' && !this.stateValue.playlistItemId) {
      this.retainPendingCommand(command);
      return;
    }
    if (
      command.Command !== 'Stop' &&
      !syncPlayCommandMatchesPlaylist(
        command.PlaylistItemId,
        this.stateValue.playlistItemId
      )
    ) {
      return;
    }
    const emittedAt = this.commandTime(command);
    if (emittedAt > 0 && emittedAt < this.lastCommandEmittedAtMs) return;
    const commandKey = [
      command.Command,
      command.PlaylistItemId ?? '',
      command.When,
      command.PositionTicks ?? 0
    ].join('|');
    if (commandKey === this.lastCommandKey) return;
    this.lastCommandKey = commandKey;
    if (emittedAt > 0) this.lastCommandEmittedAtMs = emittedAt;
    this.cancelScheduledCommand();
    const generation = ++this.commandGeneration;
    const serverTarget = Date.parse(command.When);
    if (!Number.isFinite(serverTarget)) return;
    const localTarget = serverTarget - this.stateValue.clockOffsetMs;
    const delay = Math.max(0, localTarget - Date.now());
    this.scheduledCommand = setTimeout(() => {
      this.scheduledCommand = null;
      if (generation !== this.commandGeneration) return;
      void this.applyCommand(command, localTarget, generation).catch((error) => {
        if (generation !== this.commandGeneration) return;
        if (!this.playerReadyForCurrentQueue()) {
          this.retainPendingCommand(command);
        }
        this.warnRecoverable(
          `${userFacingError(error, 'Could not apply the latest SyncPlay command.')} The client will retry when MPV is ready.`
        );
      });
    }, delay);
  }

  private async applyCommand(
    command: SendCommand,
    localTarget: number,
    generation: number
  ): Promise<void> {
    if (command.Command !== 'Stop') {
      await this.waitFor(
        () =>
          generation !== this.commandGeneration ||
          this.playerReadyForCurrentQueue(),
        15_000,
        'MPV is still loading the SyncPlay item.'
      );
    }
    if (generation !== this.commandGeneration) return;
    const scheduledPosition = command.PositionTicks ?? 0;
    switch (command.Command) {
      case 'Unpause': {
        const {
          softCorrectionThresholdMs,
          hardSeekThresholdMs
        } = this.config.settings.syncPlay;
        await this.resetPlaybackSpeed();
        if (generation !== this.commandGeneration) return;
        let targetSeconds = this.commandTargetSeconds(
          scheduledPosition,
          localTarget,
          true
        );
        const driftMs =
          (this.mpv.state.positionSeconds - targetSeconds) * 1000;
        if (Math.abs(driftMs) >= hardSeekThresholdMs) {
          this.suppressNativeControlRelay('seek');
          await this.playback.seekLocal(targetSeconds);
          if (generation !== this.commandGeneration) return;
        } else if (Math.abs(driftMs) >= softCorrectionThresholdMs) {
          const correctionRate = 0.03;
          await this.mpv.setSpeed(driftMs > 0 ? 1 - correctionRate : 1 + correctionRate);
          if (generation !== this.commandGeneration) return;
          this.scheduleSpeedReset(
            Math.min(
              12_000,
              Math.max(1_000, Math.abs(driftMs) / correctionRate)
            )
          );
        }
        // Recalculate after MPV commands so their IPC time is included in the
        // shared timeline instead of being hidden by the pre-play drift value.
        targetSeconds = this.commandTargetSeconds(
          scheduledPosition,
          localTarget,
          true
        );
        this.setTimelineAnchor(targetSeconds, Date.now(), true);
        this.suppressNativeControlRelay('pause', 750, false);
        await this.playback.playLocal();
        this.publishMeasuredDrift(true);
        this.schedulePostStartCorrection(generation);
        break;
      }
      case 'Pause':
        await this.resetPlaybackSpeed();
        if (generation !== this.commandGeneration) return;
        this.suppressNativeControlRelay('pause', 750, true);
        await this.playback.pauseLocal();
        if (generation !== this.commandGeneration) return;
        this.suppressNativeControlRelay('seek');
        await this.playback.seekLocal(scheduledPosition / TICKS_PER_SECOND);
        this.setTimelineAnchor(
          scheduledPosition / TICKS_PER_SECOND,
          Date.now(),
          false
        );
        this.publishMeasuredDrift(true);
        break;
      case 'Seek':
        await this.resetPlaybackSpeed();
        if (generation !== this.commandGeneration) return;
        this.suppressNativeControlRelay('seek');
        await this.playback.seekLocal(scheduledPosition / TICKS_PER_SECOND);
        if (generation !== this.commandGeneration) return;
        this.setTimelineAnchor(
          scheduledPosition / TICKS_PER_SECOND,
          Date.now(),
          false
        );
        await this.waitForPlayerRestart();
        if (generation !== this.commandGeneration) return;
        this.publishMeasuredDrift(true);
        await this.sendReady();
        break;
      case 'Stop':
        await this.resetPlaybackSpeed();
        if (generation !== this.commandGeneration) return;
        this.timelineAnchor = null;
        this.queueLoadKey = null;
        this.suppressNativeControlRelay('both', 750, true);
        await this.playback.stopLocal();
        break;
    }
  }

  private async onPlayerState(): Promise<void> {
    this.publishMeasuredDrift();
    if (
      this.stateValue.membership !== 'joined' ||
      !this.stateValue.playlistItemId
    ) {
      this.lastBuffering = null;
      return;
    }
    const playback = this.mpv.state;
    if (isSyncPlayPlayerLoading(playback)) {
      if (this.lastBuffering === true) return;
      this.lastBuffering = true;
      await this.sendBuffering();
      return;
    }
    if (
      isSyncPlayPlayerReady(
        playback,
        this.mpv.isConnected,
        this.mpv.isMediaLoaded,
        this.stateValue.groupQueueItemId
      )
    ) {
      if (this.lastBuffering !== false) await this.sendReady();
      this.flushPendingCommand();
    }
  }

  private async sendBuffering(): Promise<void> {
    if (!this.stateValue.playlistItemId) return;
    try {
      await getSyncPlayApi(this.jellyfin.api).syncPlayBuffering({
        bufferRequestDto: this.playbackRequest()
      });
    } catch {
      this.lastBuffering = null;
      // The next player edge or server update will reconcile buffering state.
    }
  }

  private async sendReady(): Promise<void> {
    if (
      this.stateValue.membership !== 'joined' ||
      !this.stateValue.playlistItemId ||
      !isSyncPlayPlayerReady(
        this.mpv.state,
        this.mpv.isConnected,
        this.mpv.isMediaLoaded,
        this.stateValue.groupQueueItemId
      )
    ) {
      return;
    }
    if (this.lastBuffering === false) return;
    if (this.readyInFlight) {
      await this.readyInFlight;
      return;
    }
    const playlistItemId = this.stateValue.playlistItemId;
    const now = Date.now();
    if (
      this.lastReadyRequest?.playlistItemId === playlistItemId &&
      now - this.lastReadyRequest.sentAtMs < 100
    ) return;
    this.lastReadyRequest = { playlistItemId, sentAtMs: now };
    this.lastBuffering = false;
    const request = getSyncPlayApi(this.jellyfin.api).syncPlayReady({
      readyRequestDto: this.playbackRequest()
    }).then(() => undefined);
    this.readyInFlight = request;
    try {
      await request;
    } catch {
      this.lastBuffering = null;
      this.lastReadyRequest = null;
      // The server may have moved to another state before Ready arrived.
    } finally {
      if (this.readyInFlight === request) this.readyInFlight = null;
    }
  }

  private playbackRequest(): {
    When: string;
    PositionTicks: number;
    IsPlaying: boolean;
    PlaylistItemId: string;
  } {
    return {
      When: new Date(Date.now() + this.stateValue.clockOffsetMs).toISOString(),
      PositionTicks: Math.round(
        this.mpv.state.positionSeconds * TICKS_PER_SECOND
      ),
      IsPlaying: !this.mpv.state.paused,
      PlaylistItemId: this.stateValue.playlistItemId ?? ''
    };
  }

  private async synchronizeClock(): Promise<void> {
    const samples: ClockSample[] = [];
    for (let index = 0; index < 8; index += 1) {
      const t0 = Date.now();
      const response = await getTimeSyncApi(this.jellyfin.api).getUtcTime();
      const t3 = Date.now();
      const t1 = Date.parse(response.data.RequestReceptionTime ?? '');
      const t2 = Date.parse(response.data.ResponseTransmissionTime ?? '');
      if (Number.isFinite(t1) && Number.isFinite(t2)) {
        samples.push({
          offset: ((t1 - t0) + (t2 - t3)) / 2,
          roundTrip: Math.max(0, (t3 - t0) - (t2 - t1))
        });
      }
    }
    const best = samples.sort((a, b) => a.roundTrip - b.roundTrip)[0];
    if (!best) return;
    this.setState({
      ...this.stateValue,
      clockOffsetMs: best.offset,
      roundTripMs: best.roundTrip
    });
    try {
      await getSyncPlayApi(this.jellyfin.api).syncPlayPing({
        pingRequestDto: {
          Ping: Math.round(best.roundTrip / 2)
        }
      });
    } catch {
      // The offset sample is still useful if the diagnostic ping is rejected.
    }
  }

  private async restoreMembership(groupId: string): Promise<void> {
    try {
      await getSyncPlayApi(this.jellyfin.api).syncPlayJoinGroup({
        joinGroupRequestDto: {
          GroupId: groupId
        }
      });
      await this.synchronizeClock();
    } catch (error) {
      this.failProtocol(
        userFacingError(error, 'Could not restore SyncPlay membership.')
      );
    }
  }

  private confirmJoined(group: SyncPlayGroup): void {
    this.setState({
      ...this.stateValue,
      membership: 'joined',
      currentGroup: group,
      error: null
    });
  }

  private confirmLeft(): void {
    this.invalidatePlaybackWork();
    this.cancelScheduledCommand();
    this.clearSpeedCorrection();
    this.lastBuffering = null;
    this.pendingCommand = null;
    this.lastCommandEmittedAtMs = 0;
    this.lastCommandKey = null;
    this.lastReadyRequest = null;
    this.timelineAnchor = null;
    this.lastDriftPublishedAt = 0;
    this.clearNativeControlRelays();
    this.setState({
      ...this.stateValue,
      membership: 'not-joined',
      currentGroup: null,
      groupQueueItemId: null,
      playlistItemId: null,
      driftMs: 0,
      error: null
    });
  }

  private failJoin(error: unknown, fallback: string): void {
    this.setState({
      ...this.stateValue,
      membership: 'error',
      currentGroup: null,
      error: userFacingError(error, fallback)
    });
  }

  private failProtocol(message: string): void {
    this.cancelScheduledCommand();
    this.setState({
      ...this.stateValue,
      membership: 'error',
      error: message
    });
    this.events.emitClient({
      type: 'notice',
      data: {
        level: 'error',
        message
      }
    });
  }

  private warnRecoverable(message: string): void {
    this.events.emitClient({
      type: 'notice',
      data: {
        level: 'warning',
        message
      }
    });
  }

  private mapGroup(group: GroupInfoDto): SyncPlayGroup {
    return {
      id: group.GroupId ?? '',
      name: group.GroupName ?? 'SyncPlay group',
      state: group.State ?? 'Idle',
      participants: group.Participants ?? []
    };
  }

  private setState(state: SyncPlayState): void {
    this.stateValue = state;
    this.events.emitClient({
      type: 'syncplay',
      data: this.state
    });
  }

  private retainPendingCommand(command: SendCommand): void {
    if (
      !this.pendingCommand ||
      this.commandTime(command) >= this.commandTime(this.pendingCommand)
    ) {
      this.pendingCommand = command;
    }
  }

  private flushPendingCommand(): void {
    const command = this.pendingCommand;
    if (!command) return;
    this.pendingCommand = null;
    // A command retained after a readiness timeout is intentionally retried;
    // it must not be mistaken for a duplicate of its first attempt.
    this.lastCommandKey = null;
    this.processCommand(command);
  }

  private commandTime(command: SendCommand): number {
    const value = Date.parse(command.EmittedAt ?? command.When ?? '');
    return Number.isFinite(value) ? value : 0;
  }

  private queueNativePauseRelay(paused: boolean): void {
    if (!this.canBeginNativeControlRelay('pause', paused)) return;
    void this.relayNativeControl(async () => {
      const api = getSyncPlayApi(this.jellyfin.api);
      if (paused) await api.syncPlayPause();
      else await api.syncPlayUnpause();
    }, paused ? 'pause' : 'play');
  }

  private queueNativeSeekRelay(): void {
    if (!this.canBeginNativeControlRelay('seek')) return;
    if (this.nativeSeekTimer) clearTimeout(this.nativeSeekTimer);
    this.nativeSeekTimer = setTimeout(() => {
      this.nativeSeekTimer = null;
      if (!this.canFinishNativeControlRelay('seek')) return;
      const positionTicks = Math.round(
        this.mpv.state.positionSeconds * TICKS_PER_SECOND
      );
      void this.relayNativeControl(async () => {
        await getSyncPlayApi(this.jellyfin.api).syncPlaySeek({
          seekRequestDto: { PositionTicks: positionTicks }
        });
      }, 'seek');
    }, 100);
  }

  private canBeginNativeControlRelay(
    type: 'pause' | 'seek',
    paused?: boolean
  ): boolean {
    return this.canFinishNativeControlRelay(type, paused) && (
      type === 'seek' || this.stateValue.currentGroup?.state !== 'Waiting'
    );
  }

  private canFinishNativeControlRelay(
    type: 'pause' | 'seek',
    paused?: boolean
  ): boolean {
    const suppressedUntil = type === 'pause'
      ? this.suppressNativePauseUntil
      : this.suppressNativeSeekUntil;
    const suppressionApplies = type === 'seek' ||
      paused === this.suppressedPauseValue;
    return this.stateValue.membership === 'joined' &&
      Boolean(this.stateValue.playlistItemId) &&
      this.mpv.isMediaLoaded &&
      (Date.now() >= suppressedUntil || !suppressionApplies);
  }

  private async relayNativeControl(
    operation: () => Promise<void>,
    label: string
  ): Promise<void> {
    try {
      await this.serializeControl(async () => {
        await this.socket.waitUntilConnected();
        await operation();
      });
    } catch (error) {
      this.events.emitClient({
        type: 'notice',
        data: {
          level: 'error',
          message: `Could not send MPV ${label} to SyncPlay: ${userFacingError(error, 'Unknown error')}`
        }
      });
    }
  }

  private suppressNativeControlRelay(
    type: 'pause' | 'seek' | 'both',
    durationMs = 750,
    pauseValue: boolean | null = null
  ): void {
    const until = Date.now() + durationMs;
    if (type === 'pause' || type === 'both') {
      this.suppressNativePauseUntil = Math.max(
        this.suppressNativePauseUntil,
        until
      );
      this.suppressedPauseValue = pauseValue;
    }
    if (type === 'seek' || type === 'both') {
      this.suppressNativeSeekUntil = Math.max(
        this.suppressNativeSeekUntil,
        until
      );
    }
  }

  private clearNativeControlRelays(): void {
    if (this.nativeSeekTimer) clearTimeout(this.nativeSeekTimer);
    this.nativeSeekTimer = null;
    this.suppressNativePauseUntil = 0;
    this.suppressNativeSeekUntil = 0;
    this.suppressedPauseValue = null;
    this.lastObservedPaused = this.mpv.state.paused;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.intentChain.then(operation, operation);
    this.intentChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private serializeControl<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.controlChain.then(operation, operation);
    this.controlChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private serializeQueueLoad<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queueLoadChain.then(operation, operation);
    this.queueLoadChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private invalidatePlaybackWork(): void {
    this.queueLoadGeneration += 1;
    this.queueLoadKey = null;
    if (this.postStartCorrectionTimer) {
      clearTimeout(this.postStartCorrectionTimer);
      this.postStartCorrectionTimer = null;
    }
  }

  private playerReadyForCurrentQueue(): boolean {
    return isSyncPlayPlayerReady(
      this.mpv.state,
      this.mpv.isConnected,
      this.mpv.isMediaLoaded,
      this.stateValue.groupQueueItemId
    );
  }

  private commandTargetSeconds(
    positionTicks: number,
    localTargetMs: number,
    playing: boolean
  ): number {
    const elapsedTicks = playing
      ? Math.max(0, Date.now() - localTargetMs) * 10_000
      : 0;
    return (positionTicks + elapsedTicks) / TICKS_PER_SECOND;
  }

  private setTimelineAnchor(
    positionSeconds: number,
    localTargetMs: number,
    playing: boolean
  ): void {
    if (!this.stateValue.playlistItemId) return;
    this.timelineAnchor = {
      localTargetMs,
      playlistItemId: this.stateValue.playlistItemId,
      positionSeconds,
      playing
    };
  }

  private publishMeasuredDrift(force = false): void {
    const anchor = this.timelineAnchor;
    if (
      !anchor ||
      anchor.playlistItemId !== this.stateValue.playlistItemId ||
      !this.playerReadyForCurrentQueue()
    ) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastDriftPublishedAt < 500) return;
    const expectedSeconds = anchor.positionSeconds + (
      anchor.playing ? Math.max(0, now - anchor.localTargetMs) / 1000 : 0
    );
    const driftMs = (this.mpv.state.positionSeconds - expectedSeconds) * 1000;
    if (
      !force &&
      Math.abs(driftMs - this.stateValue.driftMs) < 10 &&
      now - this.lastDriftPublishedAt < 1_500
    ) {
      return;
    }
    this.lastDriftPublishedAt = now;
    this.setState({
      ...this.stateValue,
      driftMs
    });
  }

  private schedulePostStartCorrection(generation: number): void {
    if (this.postStartCorrectionTimer) {
      clearTimeout(this.postStartCorrectionTimer);
    }
    this.postStartCorrectionTimer = setTimeout(() => {
      this.postStartCorrectionTimer = null;
      if (
        generation !== this.commandGeneration ||
        this.mpv.state.paused ||
        !this.playerReadyForCurrentQueue()
      ) {
        return;
      }
      const anchor = this.timelineAnchor;
      if (!anchor?.playing) return;
      const now = Date.now();
      const expectedSeconds = anchor.positionSeconds +
        Math.max(0, now - anchor.localTargetMs) / 1000;
      const driftMs =
        (this.mpv.state.positionSeconds - expectedSeconds) * 1000;
      this.setState({ ...this.stateValue, driftMs });
      if (
        Math.abs(driftMs) <
        this.config.settings.syncPlay.hardSeekThresholdMs
      ) {
        return;
      }
      this.suppressNativeControlRelay('seek', 1_500);
      void this.playback.seekLocal(expectedSeconds).then(() => {
        if (generation === this.commandGeneration) {
          this.publishMeasuredDrift(true);
        }
      }).catch((error) => {
        this.warnRecoverable(
          userFacingError(error, 'Could not complete the SyncPlay drift correction.')
        );
      });
    }, 750);
  }

  private waitFor(
    predicate: () => boolean,
    timeoutMs: number,
    message: string
  ): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (predicate()) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error(message));
        }
      }, 25);
    });
  }

  private waitForPlayerRestart(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.mpv.off('playback-restart', done);
        resolve();
      }, 1500);
      const done = (): void => {
        clearTimeout(timer);
        this.mpv.off('playback-restart', done);
        resolve();
      };
      this.mpv.once('playback-restart', done);
    });
  }

  private cancelScheduledCommand(): void {
    this.commandGeneration += 1;
    if (this.scheduledCommand) clearTimeout(this.scheduledCommand);
    this.scheduledCommand = null;
  }

  private scheduleSpeedReset(delayMs: number): void {
    if (this.speedResetTimer) clearTimeout(this.speedResetTimer);
    this.speedResetTimer = setTimeout(() => {
      this.speedResetTimer = null;
      void this.resetPlaybackSpeed().then(() => {
        if (this.stateValue.membership === 'joined') {
          this.publishMeasuredDrift(true);
        }
      });
    }, delayMs);
  }

  private clearSpeedCorrection(): void {
    if (this.speedResetTimer) clearTimeout(this.speedResetTimer);
    this.speedResetTimer = null;
    if (this.postStartCorrectionTimer) {
      clearTimeout(this.postStartCorrectionTimer);
      this.postStartCorrectionTimer = null;
    }
    if (this.mpv.state.item) {
      void this.mpv.setSpeed(1).catch(() => undefined);
    }
  }

  private async resetPlaybackSpeed(): Promise<void> {
    if (this.speedResetTimer) clearTimeout(this.speedResetTimer);
    this.speedResetTimer = null;
    if (this.mpv.isConnected && this.mpv.state.item) {
      await this.mpv.setSpeed(1);
    }
  }
}
