import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api.js';
import { GeneralCommandType } from '@jellyfin/sdk/lib/generated-client/models/general-command-type.js';
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { JellyfinService } from './jellyfin-service.js';

export interface JellyfinSocketMessage {
  MessageType: string;
  MessageId?: string;
  Data?: unknown;
}

export class JellyfinWebSocketService extends EventEmitter {
  private readonly jellyfin: JellyfinService;
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;

  constructor(
    jellyfin: JellyfinService,
    config: ConfigService,
    events: ClientEventBus
  ) {
    super();
    this.jellyfin = jellyfin;
    this.config = config;
    this.events = events;
    jellyfin.on('authenticated', () => {
      void this.start();
    });
    jellyfin.on('disconnected', () => this.stop());
  }

  async start(): Promise<void> {
    this.stop();
    this.closedByUser = false;
    await this.reportCapabilities();
    this.open();
  }

  stop(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
  }

  send(messageType: string, data?: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      MessageType: messageType,
      Data: data
    }));
  }

  waitUntilConnected(timeoutMs = 7000): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onConnected = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.off('connected', onConnected);
        reject(new Error('Timed out waiting for the Jellyfin live connection.'));
      }, timeoutMs);
      this.once('connected', onConnected);
    });
  }

  private open(): void {
    const url = new URL(this.jellyfin.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/socket`;
    url.searchParams.set('deviceId', this.config.deviceId);

    const socket = new WebSocket(url, {
      headers: {
        Authorization: this.jellyfin.authorizationHeader
      }
    });
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.emit('connected');
    });
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as JellyfinSocketMessage;
        this.onMessage(message);
      } catch {
        this.events.emitClient({
          type: 'notice',
          data: {
            level: 'warning',
            message: 'Jellyfin sent a malformed WebSocket message.'
          }
        });
      }
    });
    socket.on('error', () => {
      // Close drives the bounded reconnect path.
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.emit('disconnected');
      if (!this.closedByUser) this.scheduleReconnect();
    });
  }

  private onMessage(message: JellyfinSocketMessage): void {
    if (message.MessageType === 'ForceKeepAlive') {
      const intervalSeconds =
        typeof message.Data === 'number' ? message.Data : 30;
      this.startKeepAlive(Math.max(5, intervalSeconds));
    } else if (message.MessageType === 'KeepAlive') {
      this.send('KeepAlive');
    }
    this.emit('message', message);
    this.emit(message.MessageType, message.Data);
  }

  private startKeepAlive(intervalSeconds: number): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.send('KeepAlive');
    this.keepAliveTimer = setInterval(() => {
      this.send('KeepAlive');
    }, intervalSeconds * 1000);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const baseDelay = Math.min(30_000, 500 * (2 ** this.reconnectAttempt));
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        this.open();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async reportCapabilities(): Promise<void> {
    try {
      await getSessionApi(this.jellyfin.api).postFullCapabilities({
        clientCapabilitiesDto: {
          PlayableMediaTypes: [MediaType.Video],
          SupportedCommands: [
            GeneralCommandType.Play,
            GeneralCommandType.PlayState,
            GeneralCommandType.PlayMediaSource,
            GeneralCommandType.SetAudioStreamIndex,
            GeneralCommandType.SetSubtitleStreamIndex,
            GeneralCommandType.SetVolume,
            GeneralCommandType.Mute,
            GeneralCommandType.Unmute,
            GeneralCommandType.ToggleMute,
            GeneralCommandType.ToggleFullscreen,
            GeneralCommandType.DisplayMessage
          ],
          SupportsMediaControl: true,
          SupportsPersistentIdentifier: true
        }
      });
    } catch {
      this.events.emitClient({
        type: 'notice',
        data: {
          level: 'warning',
          message:
            'Connected, but Jellyfin did not accept remote-control capabilities.'
        }
      });
    }
  }
}
