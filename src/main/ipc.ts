import { dirname } from 'node:path';
import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  screen,
  shell
} from 'electron';
import { z } from 'zod';
import type {
  AppBootstrap,
  JellyClientApi,
  PlaybackState
} from '@shared/contracts.js';
import {
  catalogContainerKindSchema,
  catalogQuerySchema,
  connectionInputSchema,
  playMediaInputSchema,
  quickConnectStartInputSchema,
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
    type: z.literal('speed'),
    speed: z.number().min(0.25).max(3)
  }),
  z.object({
    type: z.literal('subtitle-delay'),
    seconds: z.number().min(-30).max(30)
  }),
  z.object({
    type: z.literal('audio-delay'),
    seconds: z.number().min(-30).max(30)
  }),
  z.object({
    type: z.literal('chapter'),
    index: z.number().int().min(0)
  }),
  z.object({ type: z.literal('cancel-post-play') }),
  z.object({ type: z.literal('play-next') }),
  z.object({ type: z.literal('retry') }),
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
  handle('auth:discover', async () => jellyfin.discoverServers());
  handle('auth:quick-start', async (_event, raw) => {
    return jellyfin.startQuickConnect(quickConnectStartInputSchema.parse(raw));
  });
  handle('auth:quick-poll', async (_event, secret) => {
    return jellyfin.pollQuickConnect(
      z.string().min(1).max(500).parse(secret)
    );
  });
  handle('auth:quick-cancel', async (_event, secret) => {
    jellyfin.cancelQuickConnect(z.string().min(1).max(500).parse(secret));
  });
  handle('auth:disconnect', async () => {
    if (playback.state.item) await playback.stopLocal();
    syncPlay.reset();
    return jellyfin.disconnect();
  });

  handle('catalog:home', async () => jellyfin.getHome());
  handle('catalog:discard-progress', async (_event, itemId) => {
    return jellyfin.discardPlaybackProgress(
      z.string().min(1).max(100).parse(itemId)
    );
  });
  handle('catalog:items', async (_event, raw) => {
    return jellyfin.getItems(catalogQuerySchema.parse(raw));
  });
  handle('catalog:item', async (_event, itemId) => {
    return jellyfin.getItem(z.string().min(1).max(100).parse(itemId));
  });
  handle('catalog:restore-progress', async (_event, itemId, positionTicks) => {
    return jellyfin.restorePlaybackProgress(
      z.string().min(1).max(100).parse(itemId),
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(positionTicks)
    );
  });
  handle('catalog:favorite', async (_event, itemId, favorite) => {
    return jellyfin.setFavorite(
      z.string().min(1).max(100).parse(itemId),
      z.boolean().parse(favorite)
    );
  });
  handle('catalog:played', async (_event, itemId, played) => {
    return jellyfin.setPlayed(
      z.string().min(1).max(100).parse(itemId),
      z.boolean().parse(played)
    );
  });
  handle('catalog:containers', async (_event, kind) => {
    return jellyfin.listContainers(catalogContainerKindSchema.parse(kind));
  });
  handle('catalog:create-container', async (_event, kind, name, itemId) => {
    return jellyfin.createContainer(
      catalogContainerKindSchema.parse(kind),
      z.string().trim().min(1).max(200).parse(name),
      z.string().min(1).max(100).parse(itemId)
    );
  });
  handle('catalog:add-container-item', async (_event, kind, containerId, itemId) => {
    return jellyfin.addToContainer(
      catalogContainerKindSchema.parse(kind),
      z.string().min(1).max(100).parse(containerId),
      z.string().min(1).max(100).parse(itemId)
    );
  });
  handle('catalog:remove-container-item', async (_event, kind, containerId, entryId) => {
    return jellyfin.removeFromContainer(
      catalogContainerKindSchema.parse(kind),
      z.string().min(1).max(100).parse(containerId),
      z.string().min(1).max(100).parse(entryId)
    );
  });
  handle('catalog:move-playlist-item', async (_event, playlistId, entryId, newIndex) => {
    return jellyfin.movePlaylistItem(
      z.string().min(1).max(100).parse(playlistId),
      z.string().min(1).max(100).parse(entryId),
      z.number().int().min(0).max(100_000).parse(newIndex)
    );
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
      case 'speed':
        await mpv.setSpeed(action.speed);
        break;
      case 'subtitle-delay':
        await mpv.setSubtitleDelay(action.seconds);
        break;
      case 'audio-delay':
        await mpv.setAudioDelay(action.seconds);
        break;
      case 'chapter':
        await mpv.seekChapter(action.index);
        break;
      case 'cancel-post-play':
        await playback.cancelPostPlay();
        break;
      case 'play-next':
        await playback.playNext();
        break;
      case 'retry':
        if (joined) await syncPlay.resync();
        else await playback.retry();
        break;
      case 'select-track':
        await playback.selectTrackLocal(action.trackType, action.id);
        break;
    }
    return playback.state;
  });

  handle('settings:save', async (_event, raw) => {
    const settings = await config.saveSettings(settingsSchema.parse(raw));
    if (mpv.isConnected) {
      await mpv.applySubtitleAppearance(settings.player);
    }
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
  handle('settings:list-audio-devices', async () => mpv.listAudioDevices());
  handle('settings:list-displays', async () => {
    const primaryId = String(screen.getPrimaryDisplay().id);
    return screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      name: display.label?.trim() || `Display ${index + 1}`,
      primary: String(display.id) === primaryId,
      width: display.bounds.width,
      height: display.bounds.height
    }));
  });
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
  handle('syncplay:resync', async () => syncPlay.resync());

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
