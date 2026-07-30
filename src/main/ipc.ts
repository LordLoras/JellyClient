import { dirname } from 'node:path';
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell
} from 'electron';
import { z } from 'zod';
import type {
  AppBootstrap,
  JellyClientApi,
  PlaybackState
} from '@shared/contracts.js';
import {
  catalogQuerySchema,
  connectionInputSchema,
  playMediaInputSchema,
  settingsSchema,
  watchTogetherInputSchema
} from '@shared/schemas.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { JellyfinService } from './jellyfin-service.js';
import { MpvService } from './mpv-service.js';
import { PlaybackService } from './playback-service.js';
import { SyncPlayService } from './syncplay-service.js';

const playbackActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('stop') }),
  z.object({
    type: z.literal('seek'),
    positionSeconds: z.number().min(0)
  }),
  z.object({
    type: z.literal('volume'),
    volume: z.number().min(0).max(100)
  }),
  z.object({
    type: z.literal('mute'),
    muted: z.boolean()
  }),
  z.object({
    type: z.literal('fullscreen'),
    fullscreen: z.boolean()
  }),
  z.object({ type: z.literal('toggle-stats') }),
  z.object({
    type: z.literal('select-track'),
    trackType: z.enum(['audio', 'subtitle']),
    id: z.number().int().nullable()
  })
]);

const syncPlayActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('stop') }),
  z.object({
    type: z.literal('seek'),
    positionTicks: z.number().int().min(0)
  })
]);

interface Services {
  config: ConfigService;
  events: ClientEventBus;
  jellyfin: JellyfinService;
  mpv: MpvService;
  playback: PlaybackService;
  syncPlay: SyncPlayService;
}

export function registerIpc(services: Services): () => void {
  const {
    config,
    events,
    jellyfin,
    mpv,
    playback,
    syncPlay
  } = services;
  const channels: string[] = [];
  const handle = (
    channel: string,
    listener: Parameters<typeof ipcMain.handle>[1]
  ): void => {
    channels.push(channel);
    ipcMain.handle(channel, listener);
  };

  handle('app:bootstrap', async (): Promise<AppBootstrap> => ({
    configPath: config.path,
    connection: jellyfin.state,
    settings: config.settings,
    mpv: mpv.capability,
    playback: playback.state,
    syncPlay: syncPlay.state
  }));

  handle('auth:connect', async (_event, raw) => {
    return jellyfin.connect(connectionInputSchema.parse(raw));
  });
  handle('auth:disconnect', async () => {
    if (playback.state.item) await playback.stopLocal();
    syncPlay.reset();
    return jellyfin.disconnect();
  });

  handle('catalog:home', async () => jellyfin.getHome());
  handle('catalog:items', async (_event, raw) => {
    return jellyfin.getItems(catalogQuerySchema.parse(raw));
  });
  handle('catalog:item', async (_event, itemId) => {
    return jellyfin.getItem(z.string().min(1).max(100).parse(itemId));
  });

  handle('playback:play', async (_event, raw): Promise<PlaybackState> => {
    const input = playMediaInputSchema.parse(raw);
    if (syncPlay.state.membership === 'joined') {
      await syncPlay.startItem(input);
      return playback.state;
    }
    return playback.play(input);
  });
  handle('playback:action', async (_event, raw): Promise<PlaybackState> => {
    const action = playbackActionSchema.parse(raw);
    const joined = syncPlay.state.membership === 'joined';
    switch (action.type) {
      case 'play':
        if (joined) await syncPlay.action(action);
        else await playback.playLocal();
        break;
      case 'pause':
        if (joined) await syncPlay.action(action);
        else await playback.pauseLocal();
        break;
      case 'stop':
        if (joined) await syncPlay.action(action);
        else await playback.stopLocal();
        break;
      case 'seek':
        if (joined) {
          await syncPlay.action({
            type: 'seek',
            positionTicks: Math.round(action.positionSeconds * 10_000_000)
          });
        } else {
          await playback.seekLocal(action.positionSeconds);
        }
        break;
      case 'volume':
        await mpv.setVolume(action.volume);
        break;
      case 'mute':
        await mpv.setMuted(action.muted);
        break;
      case 'fullscreen':
        await mpv.setFullscreen(action.fullscreen);
        break;
      case 'toggle-stats':
        await mpv.toggleStats();
        break;
      case 'select-track':
        await mpv.selectTrack(action.trackType, action.id);
        break;
    }
    return playback.state;
  });

  handle('settings:save', async (_event, raw) => {
    const settings = await config.saveSettings(settingsSchema.parse(raw));
    await mpv.probe(settings.player.mpvPath || undefined);
    return settings;
  });
  handle('settings:choose-mpv', async () => {
    const defaultPath = config.settings.player.mpvPath;
    const result = await dialog.showOpenDialog({
      title: 'Select MPV executable',
      ...(defaultPath ? { defaultPath } : {}),
      filters: [
        {
          name: 'MPV',
          extensions: ['exe']
        }
      ],
      properties: ['openFile']
    });
    const selected = result.filePaths[0];
    return mpv.probe(!result.canceled ? selected : undefined);
  });
  handle('settings:probe-mpv', async () => mpv.probe());
  handle('settings:open-config', async () => {
    const result = await shell.openPath(dirname(config.path));
    if (result) throw new Error(result);
  });
  handle('diagnostics:copy', async (_event, raw) => {
    clipboard.writeText(z.string().max(50_000).parse(raw));
  });

  handle('syncplay:list', async () => syncPlay.listGroups());
  handle('syncplay:create', async (_event, name) => {
    return syncPlay.create(z.string().trim().min(1).max(100).parse(name));
  });
  handle('syncplay:join', async (_event, groupId) => {
    return syncPlay.join(z.string().min(1).max(100).parse(groupId));
  });
  handle('syncplay:leave', async () => syncPlay.leave());
  handle('syncplay:watch-together', async (_event, raw) => {
    return syncPlay.watchTogether(watchTogetherInputSchema.parse(raw));
  });
  handle('syncplay:action', async (_event, raw) => {
    return syncPlay.action(syncPlayActionSchema.parse(raw));
  });

  const unsubscribe = events.onClient((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('client:event', event);
      }
    }
  });

  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
