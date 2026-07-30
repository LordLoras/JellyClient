import type { PlayMediaInput } from '@shared/contracts.js';
import { TICKS_PER_SECOND } from '@shared/contracts.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { MpvService } from './mpv-service.js';
import { PlaybackService } from './playback-service.js';
import { SyncPlayService } from './syncplay-service.js';
import { JellyfinWebSocketService } from './websocket-service.js';

interface RemotePlayRequest {
  ItemIds?: string[];
  PlayCommand?: string;
  StartPositionTicks?: number;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  SyncPlayGroup?: string;
}

interface RemotePlaystateRequest {
  Command?: string;
  SeekPositionTicks?: number;
}

interface GeneralCommand {
  Name?: string;
  Arguments?: Record<string, string>;
}

export class RemoteCommandService {
  constructor(
    socket: JellyfinWebSocketService,
    private readonly playback: PlaybackService,
    private readonly syncPlay: SyncPlayService,
    private readonly mpv: MpvService,
    private readonly config: ConfigService,
    private readonly events: ClientEventBus
  ) {
    socket.on('Play', (data) => {
      void this.onPlay(data as RemotePlayRequest).catch((error) => {
        this.notice(
          'error',
          error instanceof Error ? error.message : 'Remote playback failed.'
        );
      });
    });
    socket.on('Playstate', (data) => {
      void this.onPlaystate(data as RemotePlaystateRequest).catch((error) => {
        this.notice(
          'error',
          error instanceof Error
            ? error.message
            : 'The remote transport command failed.'
        );
      });
    });
    socket.on('GeneralCommand', (data) => {
      void this.onGeneralCommand(data as GeneralCommand).catch((error) => {
        this.notice(
          'error',
          error instanceof Error
            ? error.message
            : 'The remote player command failed.'
        );
      });
    });
  }

  private async onPlay(request: RemotePlayRequest): Promise<void> {
    const itemId = request.ItemIds?.[0];
    if (!itemId || request.PlayCommand !== 'PlayNow') return;
    const input: PlayMediaInput = {
      itemId,
      startPositionTicks: request.StartPositionTicks ?? 0,
      audioStreamIndex: request.AudioStreamIndex ?? null,
      subtitleStreamIndex: request.SubtitleStreamIndex ?? null
    };

    try {
      if (request.SyncPlayGroup) {
        await this.syncPlay.join(request.SyncPlayGroup);
        if (
          this.syncPlay.state.membership !== 'joined' ||
          this.syncPlay.state.currentGroup?.id !== request.SyncPlayGroup
        ) {
          throw new Error(
            this.syncPlay.state.error ??
              'The receiver could not join the requested SyncPlay group.'
          );
        }
        await this.syncPlay.startItem(input);
        return;
      }

      if (this.syncPlay.state.membership === 'joined') {
        await this.syncPlay.startItem(input);
        return;
      }

      await this.syncPlay.listGroups();
      const groups = this.syncPlay.state.groups;
      if (
        groups.length === 1 &&
        this.config.settings.syncPlay.autoJoinUnambiguousCast
      ) {
        await this.syncPlay.join(groups[0]!.id);
        await this.syncPlay.startItem(input);
        this.notice(
          'info',
          `Remote playback joined “${groups[0]!.name}” automatically.`
        );
        return;
      }

      if (groups.length > 0) {
        this.notice(
          'warning',
          'Remote playback is waiting because Jellyfin Web did not specify a SyncPlay group. Join the group in JellyClient, then cast again.'
        );
        return;
      }

      await this.playback.play(input);
    } catch (error) {
      this.notice(
        'error',
        error instanceof Error ? error.message : 'Remote playback failed.'
      );
    }
  }

  private async onPlaystate(
    request: RemotePlaystateRequest
  ): Promise<void> {
    const inGroup = this.syncPlay.state.membership === 'joined';
    switch (request.Command) {
      case 'PlayPause':
        if (inGroup) {
          await this.syncPlay.action({
            type: this.mpv.state.paused ? 'play' : 'pause'
          });
        } else if (this.mpv.state.paused) {
          await this.playback.playLocal();
        } else {
          await this.playback.pauseLocal();
        }
        break;
      case 'Unpause':
        if (inGroup) await this.syncPlay.action({ type: 'play' });
        else await this.playback.playLocal();
        break;
      case 'Pause':
        if (inGroup) await this.syncPlay.action({ type: 'pause' });
        else await this.playback.pauseLocal();
        break;
      case 'Stop':
        if (inGroup) await this.syncPlay.action({ type: 'stop' });
        else await this.playback.stopLocal();
        break;
      case 'Seek':
        if (inGroup) {
          await this.syncPlay.action({
            type: 'seek',
            positionTicks: request.SeekPositionTicks ?? 0
          });
        } else {
          await this.playback.seekLocal(
            (request.SeekPositionTicks ?? 0) / TICKS_PER_SECOND
          );
        }
        break;
    }
  }

  private async onGeneralCommand(command: GeneralCommand): Promise<void> {
    const value = command.Arguments?.Volume;
    switch (command.Name) {
      case 'SetVolume':
        if (value) await this.mpv.setVolume(Number(value));
        break;
      case 'Mute':
        await this.mpv.setMuted(true);
        break;
      case 'Unmute':
        await this.mpv.setMuted(false);
        break;
      case 'ToggleMute':
        await this.mpv.setMuted(!this.mpv.state.muted);
        break;
      case 'ToggleFullscreen':
        await this.mpv.setFullscreen(!this.mpv.state.fullscreen);
        break;
      case 'SetAudioStreamIndex': {
        const index = command.Arguments?.Index;
        if (index) {
          const requestedIndex = Number(index);
          const track = this.mpv.state.tracks.find(
            (candidate) =>
              candidate.type === 'audio' &&
              candidate.ffIndex === requestedIndex
          );
          if (track) await this.mpv.selectTrack('audio', track.id);
        }
        break;
      }
      case 'SetSubtitleStreamIndex': {
        const index = command.Arguments?.Index;
        const requestedIndex = index ? Number(index) : -1;
        const track = this.mpv.state.tracks.find(
          (candidate) =>
            candidate.type === 'subtitle' &&
            candidate.ffIndex === requestedIndex
        );
        await this.mpv.selectTrack('subtitle', track?.id ?? null);
        break;
      }
    }
  }

  private notice(
    level: 'info' | 'warning' | 'error',
    message: string
  ): void {
    this.events.emitClient({
      type: 'notice',
      data: {
        level,
        message
      }
    });
  }
}
