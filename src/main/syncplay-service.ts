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

export class SyncPlayService {
  private readonly jellyfin: JellyfinService;
  private readonly socket: JellyfinWebSocketService;
  private readonly playback: PlaybackService;
  private readonly mpv: MpvService;
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private stateValue: SyncPlayState = structuredClone(initialSyncPlayState);
  private intentChain: Promise<unknown> = Promise.resolve();
  private scheduledCommand: NodeJS.Timeout | null = null;
  private commandGeneration = 0;
  private lastBuffering: boolean | null = null;
  private queueLoadGeneration = 0;
  private speedResetTimer: NodeJS.Timeout | null = null;
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
        void this.sendReady();
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

  async action(
    action:
      | { type: 'play' }
      | { type: 'pause' }
      | { type: 'stop' }
      | { type: 'seek'; positionTicks: number }
  ): Promise<SyncPlayState> {
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
  }

  reset(): void {
    this.cancelScheduledCommand();
    this.clearSpeedCorrection();
    this.lastBuffering = null;
    this.pendingCommand = null;
    this.lastCommandEmittedAtMs = 0;
    this.lastCommandKey = null;
    this.lastReadyRequest = null;
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
      await this.sendReady();
      this.flushPendingCommand();
      return;
    }

    const loadGeneration = ++this.queueLoadGeneration;
    try {
      await this.playback.play(
        {
          itemId,
          startPositionTicks: queue.StartPositionTicks ?? 0,
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
      if (loadGeneration === this.queueLoadGeneration) {
        await this.waitFor(
          () => isSyncPlayPlayerReady(
            this.mpv.state,
            this.mpv.isConnected,
            this.mpv.isMediaLoaded,
            itemId
          ),
          15_000,
          'MPV did not finish loading the SyncPlay item.'
        );
        await this.sendReady();
        this.flushPendingCommand();
      }
    } catch (error) {
      this.failProtocol(
        userFacingError(error, 'Could not prepare the SyncPlay item.')
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
    if (emittedAt > 0 && emittedAt <= this.lastCommandEmittedAtMs) return;
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
      void this.applyCommand(command, localTarget).catch((error) => {
        this.failProtocol(
          userFacingError(error, 'Could not apply a SyncPlay command.')
        );
      });
    }, delay);
  }

  private async applyCommand(
    command: SendCommand,
    localTarget: number
  ): Promise<void> {
    if (command.Command !== 'Stop') {
      await this.waitFor(
        () => isSyncPlayPlayerReady(
          this.mpv.state,
          this.mpv.isConnected,
          this.mpv.isMediaLoaded,
          this.stateValue.groupQueueItemId
        ),
        15_000,
        'MPV was not ready for the SyncPlay command.'
      );
    }
    const scheduledPosition = command.PositionTicks ?? 0;
    switch (command.Command) {
      case 'Unpause': {
        const lateTicks = Math.max(0, Date.now() - localTarget) * 10_000;
        const targetSeconds =
          (scheduledPosition + lateTicks) / TICKS_PER_SECOND;
        const driftMs =
          (this.mpv.state.positionSeconds - targetSeconds) * 1000;
        this.setState({
          ...this.stateValue,
          driftMs
        });
        const {
          softCorrectionThresholdMs,
          hardSeekThresholdMs
        } = this.config.settings.syncPlay;
        if (Math.abs(driftMs) >= hardSeekThresholdMs) {
          await this.resetPlaybackSpeed();
          this.suppressNativeControlRelay('seek');
          await this.playback.seekLocal(targetSeconds);
        } else if (Math.abs(driftMs) >= softCorrectionThresholdMs) {
          const correctionRate = 0.03;
          await this.mpv.setSpeed(driftMs > 0 ? 1 - correctionRate : 1 + correctionRate);
          this.scheduleSpeedReset(
            Math.min(
              12_000,
              Math.max(1_000, Math.abs(driftMs) / correctionRate)
            )
          );
        } else {
          await this.resetPlaybackSpeed();
        }
        this.suppressNativeControlRelay('pause', 750, false);
        await this.playback.playLocal();
        break;
      }
      case 'Pause':
        await this.resetPlaybackSpeed();
        this.suppressNativeControlRelay('pause', 750, true);
        await this.playback.pauseLocal();
        this.suppressNativeControlRelay('seek');
        await this.playback.seekLocal(scheduledPosition / TICKS_PER_SECOND);
        break;
      case 'Seek':
        await this.resetPlaybackSpeed();
        this.suppressNativeControlRelay('seek');
        await this.playback.seekLocal(scheduledPosition / TICKS_PER_SECOND);
        await this.waitForPlayerRestart();
        await this.sendReady();
        break;
      case 'Stop':
        await this.resetPlaybackSpeed();
        this.suppressNativeControlRelay('both', 750, true);
        await this.playback.stopLocal();
        break;
    }
  }

  private async onPlayerState(): Promise<void> {
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
      if (this.lastBuffering === false) return;
      await this.sendReady();
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
    this.cancelScheduledCommand();
    this.clearSpeedCorrection();
    this.lastBuffering = null;
    this.pendingCommand = null;
    this.lastCommandEmittedAtMs = 0;
    this.lastCommandKey = null;
    this.lastReadyRequest = null;
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
      await this.socket.waitUntilConnected();
      await operation();
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
          this.setState({
            ...this.stateValue,
            driftMs: 0
          });
        }
      });
    }, delayMs);
  }

  private clearSpeedCorrection(): void {
    if (this.speedResetTimer) clearTimeout(this.speedResetTimer);
    this.speedResetTimer = null;
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
