import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  protocol
} from 'electron';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { registerIpc } from './ipc.js';
import { JellyfinService } from './jellyfin-service.js';
import { MpvService } from './mpv-service.js';
import { PlaybackService } from './playback-service.js';
import { RemoteCommandService } from './remote-command-service.js';
import { SyncPlayService } from './syncplay-service.js';
import { JellyfinWebSocketService } from './websocket-service.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jellyclient-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

let mainWindow: BrowserWindow | null = null;
let cleanupIpc: (() => void) | null = null;
let playbackService: PlaybackService | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#090b0c',
    title: 'JellyClient',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('http://localhost:') ||
      url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId('dev.jellyclient.windows');

    const config = new ConfigService();
    await config.load();
    const events = new ClientEventBus();
    const jellyfin = new JellyfinService(config, events);
    const mpv = new MpvService(config, events);
    const playback = new PlaybackService(jellyfin, mpv, config);
    const socket = new JellyfinWebSocketService(jellyfin, config, events);
    const syncPlay = new SyncPlayService(
      jellyfin,
      socket,
      playback,
      mpv,
      config,
      events
    );
    new RemoteCommandService(
      socket,
      playback,
      syncPlay,
      mpv,
      config,
      events
    );
    playbackService = playback;

    protocol.handle('jellyclient-media', (request) =>
      jellyfin.proxyImage(request.url)
    );
    cleanupIpc = registerIpc({
      config,
      events,
      jellyfin,
      mpv,
      playback,
      syncPlay
    });

    await Promise.all([
      jellyfin.initialize(),
      mpv.probe()
    ]);
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (!playbackService) return;
  event.preventDefault();
  const playback = playbackService;
  playbackService = null;
  void playback.shutdown().finally(() => {
    cleanupIpc?.();
    cleanupIpc = null;
    app.exit(0);
  });
});
