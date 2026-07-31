import {
  contextBridge,
  ipcRenderer
} from 'electron';
import type {
  AppSettings,
  CatalogQuery,
  ClientEvent,
  ConnectionInput,
  JellyClientApi,
  PlayMediaInput,
  QuickConnectStartInput,
  WatchTogetherInput
} from '@shared/contracts.js';

const api: JellyClientApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  connect: (input: ConnectionInput) =>
    ipcRenderer.invoke('auth:connect', input),
  discoverServers: () => ipcRenderer.invoke('auth:discover'),
  startQuickConnect: (input: QuickConnectStartInput) =>
    ipcRenderer.invoke('auth:quick-start', input),
  pollQuickConnect: (secret: string) =>
    ipcRenderer.invoke('auth:quick-poll', secret),
  cancelQuickConnect: (secret: string) =>
    ipcRenderer.invoke('auth:quick-cancel', secret),
  disconnect: () => ipcRenderer.invoke('auth:disconnect'),
  getHome: () => ipcRenderer.invoke('catalog:home'),
  discardPlaybackProgress: (itemId: string) =>
    ipcRenderer.invoke('catalog:discard-progress', itemId),
  getItems: (query: CatalogQuery) =>
    ipcRenderer.invoke('catalog:items', query),
  getItem: (itemId: string) =>
    ipcRenderer.invoke('catalog:item', itemId),
  setFavorite: (itemId: string, favorite: boolean) =>
    ipcRenderer.invoke('catalog:favorite', itemId, favorite),
  setPlayed: (itemId: string, played: boolean) =>
    ipcRenderer.invoke('catalog:played', itemId, played),
  play: (input: PlayMediaInput) =>
    ipcRenderer.invoke('playback:play', input),
  playbackAction: (action) =>
    ipcRenderer.invoke('playback:action', action),
  copyDebugReport: (report: string) =>
    ipcRenderer.invoke('diagnostics:copy', report),
  probeMpv: () => ipcRenderer.invoke('settings:probe-mpv'),
  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke('settings:save', settings),
  chooseMpv: () => ipcRenderer.invoke('settings:choose-mpv'),
  openConfigFolder: () => ipcRenderer.invoke('settings:open-config'),
  listSyncPlayGroups: () => ipcRenderer.invoke('syncplay:list'),
  createSyncPlayGroup: (name: string) =>
    ipcRenderer.invoke('syncplay:create', name),
  joinSyncPlayGroup: (groupId: string) =>
    ipcRenderer.invoke('syncplay:join', groupId),
  leaveSyncPlayGroup: () => ipcRenderer.invoke('syncplay:leave'),
  watchTogether: (input: WatchTogetherInput) =>
    ipcRenderer.invoke('syncplay:watch-together', input),
  syncPlayAction: (action) =>
    ipcRenderer.invoke('syncplay:action', action),
  subscribe: (listener: (event: ClientEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: ClientEvent) => {
      listener(value);
    };
    ipcRenderer.on('client:event', handler);
    return () => ipcRenderer.off('client:event', handler);
  }
};

contextBridge.exposeInMainWorld('jellyClient', api);
