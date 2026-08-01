import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import {
  mkdir,
  readFile,
  stat
} from 'node:fs/promises';
import { resolve } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let port = 0;
let resumeRemoved = false;
let nextEpisodeNumber = 2;
let nextUpRequestUrl = '';
let serverClosed = false;
const configPath = resolve(
  'test-results',
  'mock-auth-profile',
  'config.json'
);
const userDataPath = resolve(
  'test-results',
  'mock-auth-profile',
  'electron-data'
);

const server = createServer(
  (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(
      request.url ?? '/',
      'http://127.0.0.1'
    ).pathname.toLowerCase();

    if (path === '/system/info/public') {
      json(response, {
        Id: 'mock-server-id',
        ServerName: 'Fixture Server',
        Version: '10.11.11',
        ProductName: 'Jellyfin'
      });
      return;
    }
    if (path === '/users/authenticatebyname') {
      json(response, {
        User: {
          Id: 'mock-user-id',
          Name: 'preview-user'
        },
        AccessToken: 'fixture-access-token',
        ServerId: 'mock-server-id'
      });
      return;
    }
    if (path === '/users/me') {
      json(response, {
        Id: 'mock-user-id',
        Name: 'preview-user'
      });
      return;
    }
    if (path === '/userviews') {
      json(response, {
        Items: [
          {
            Id: 'movies-library',
            Name: 'Movies',
            Type: 'CollectionFolder',
            CollectionType: 'movies'
          }
        ],
        TotalRecordCount: 1
      });
      return;
    }
    if (path === '/useritems/resume') {
      json(response, {
        Items: resumeRemoved
          ? []
          : [
              {
                Id: 'resume-item-id',
                Name: 'Paused Episode',
                Type: 'Episode',
                SeriesName: 'Fixture Series',
                ParentIndexNumber: 3,
                IndexNumber: 1,
                RunTimeTicks: 3_000_000_000,
                MediaSources: fixtureMediaSources(),
                UserData: {
                  PlaybackPositionTicks: 600_000_000,
                  PlayedPercentage: 20,
                  Played: false
                }
              }
            ],
        TotalRecordCount: resumeRemoved ? 0 : 1
      });
      return;
    }
    if (path === '/shows/nextup') {
      nextUpRequestUrl = request.url ?? '';
      json(response, {
        Items: [
          {
            Id: `next-item-${nextEpisodeNumber}`,
            Name:
              nextEpisodeNumber === 2
                ? 'The Next Episode'
                : 'Freshly Added Episode',
            Type: 'Episode',
            SeriesName: 'Fixture Series',
            ParentIndexNumber: 3,
            IndexNumber: nextEpisodeNumber,
            RunTimeTicks: 3_000_000_000,
            MediaSources: fixtureMediaSources(),
            UserData: {
              PlaybackPositionTicks: 0,
              PlayedPercentage: 0,
              Played: false
            }
          }
        ],
        TotalRecordCount: 1
      });
      return;
    }
    if (
      path === '/userplayeditems/resume-item-id' &&
      request.method === 'DELETE'
    ) {
      resumeRemoved = true;
      json(response, {
        PlaybackPositionTicks: 0,
        PlayedPercentage: 0,
        Played: false
      });
      return;
    }
    if (path === '/items/latest') {
      json(response, []);
      return;
    }
    if (path === '/items') {
      json(response, {
        Items: [
          {
            Id: 'deleted-folder',
            Name: 'Deleted Movie Folder',
            Type: 'Folder',
            IsFolder: true,
            RecursiveItemCount: 0,
            ChildCount: 0
          },
          {
            Id: 'playable-folder',
            Name: 'Playable Folder',
            Type: 'Folder',
            IsFolder: true,
            RecursiveItemCount: 1,
            ChildCount: 1
          },
          {
            Id: 'real-movie',
            Name: 'Real Movie',
            Type: 'Movie',
            IsFolder: false,
            RecursiveItemCount: 0,
            ChildCount: 0,
            RunTimeTicks: 5_400_000_000
          }
        ],
        TotalRecordCount: 3
      });
      return;
    }
    if (path === '/sessions/capabilities/full') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  }
);

server.on('upgrade', (_request, socket) => socket.destroy());

test.beforeAll(async () => {
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('The mock Jellyfin server did not bind a TCP port.');
      }
      port = address.port;
      resolveListen();
    });
  });

  electronApp = await launchApp();
  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp.close();
  await closeServer();
});

async function closeServer(): Promise<void> {
  if (serverClosed) return;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
  serverClosed = true;
}

test('authenticates, persists a password-free profile, and opens the catalog', async () => {
  await page.getByLabel('Server IP or hostname').fill('127.0.0.1');
  await page.getByLabel('Port').fill(String(port));
  await page.getByLabel('Username').fill('preview-user');
  await page
    .getByLabel('Password', { exact: true })
    .fill('one-use-password');
  await page.getByRole('button', { name: 'Connect to server' }).click();

  await expect(
    page.getByRole('heading', {
      name: 'Fixture Series'
    })
  ).toBeVisible();
  await expect(page.getByText('Fixture Server')).toBeVisible();
  await expect(page.getByText('4K', { exact: true })).toBeVisible();
  await expect(page.getByText('HDR10', { exact: true })).toBeVisible();
  await expect(page.getByText('5.1', { exact: true })).toBeVisible();
  await expect(page.getByText('HDR PATH READY')).toHaveCount(0);
  await expect(page.locator('.hero__format')).toHaveCount(0);
  await mkdir(resolve('artifacts'), { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: resolve('artifacts', 'home-media-format-badges.png'),
    fullPage: true
  });

  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    server: {
      host: string;
      port: number;
      username: string;
    };
  };
  expect(config.server).toEqual({
    protocol: 'http',
    host: '127.0.0.1',
    port,
    basePath: '',
    username: 'preview-user',
    displayName: '127.0.0.1'
  });

  const serializedConfig = JSON.stringify(config);
  expect(serializedConfig).not.toContain('one-use-password');
  expect(serializedConfig).not.toContain('fixture-access-token');

  const encryptedSessionPath = resolve(configPath, '..', 'session.secure');
  expect((await stat(encryptedSessionPath)).size).toBeGreaterThan(0);
  const encryptedSession = await readFile(encryptedSessionPath);
  expect(encryptedSession.includes(Buffer.from('fixture-access-token'))).toBe(
    false
  );
});

test('restores the encrypted session without asking for the password again', async () => {
  await electronApp.close();
  electronApp = await launchApp();
  page = await electronApp.firstWindow();

  await expect(
    page.getByRole('heading', {
      name: 'Fixture Series'
    })
  ).toBeVisible();
  await expect(page.getByText('Fixture Server')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Connect to Jellyfin'
    })
  ).toHaveCount(0);
});

test('defaults automatic subtitles to English', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('heading', { name: 'Language preferences' })
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', {
      name: /Automatically enable subtitles/
    })
  ).toBeChecked();
  await expect(
    page.getByRole('combobox', { name: /Preferred language/ })
  ).toHaveValue('eng');
  const audioMode = page.getByRole('combobox', { name: 'Audio output mode' });
  await expect(audioMode).toHaveValue('pcm');
  await audioMode.selectOption('passthrough');
  await expect(page.getByRole('checkbox', { name: /E-AC-3/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /TrueHD/ })).not.toBeChecked();
  await page.getByRole('heading', { name: 'Audio output' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve('artifacts', 'settings-audio-output.png'),
    fullPage: true
  });
});

test('hides empty filesystem folders from a movie library', async () => {
  await page.getByRole('button', { name: 'Movies' }).click();

  await expect(
    page.getByRole('heading', { name: 'Movies' })
  ).toBeVisible();
  await expect(page.getByText('Deleted Movie Folder')).toHaveCount(0);
  await expect(page.getByText('Playable Folder')).toBeVisible();
  await expect(page.getByText('Real Movie')).toBeVisible();
  await expect(page.getByText('2 items')).toBeVisible();
});

test('can cancel or confirm removing saved progress and keeps Up Next useful', async () => {
  nextEpisodeNumber = 3;
  await page.getByRole('button', { name: 'Home' }).click();

  await expect(
    page.getByRole('heading', { name: 'Continue watching' })
  ).toBeVisible();
  const removePausedEpisode = page.getByRole('button', {
    name: 'Remove Paused Episode from Continue Watching'
  });
  await expect(removePausedEpisode).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Up next' })
  ).toBeVisible();
  const upNextRail = page.locator('section.rail').filter({
    has: page.getByRole('heading', { name: 'Up next' })
  });
  await expect(
    upNextRail.getByText(/^S03 E03 · Freshly Added Episode/)
  ).toBeVisible();
  const nextUpQuery = new URL(
    nextUpRequestUrl,
    `http://127.0.0.1:${port}`
  ).searchParams;
  expect(nextUpQuery.get('enableResumable')).toBe('false');
  expect(nextUpQuery.get('enableRewatching')).toBe('false');
  expect(nextUpQuery.has('disableFirstEpisode')).toBe(false);
  expect(nextUpQuery.get('nextUpDateCutoff')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await removePausedEpisode.click();
  await expect(
    page.getByRole('heading', { name: 'Discard saved progress?' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep progress' }).click();

  await expect(removePausedEpisode).toBeVisible();
  expect(resumeRemoved).toBe(false);

  await removePausedEpisode.click();
  await page.getByRole('button', { name: 'Discard & remove' }).click();

  await expect(removePausedEpisode).toHaveCount(0);
  await expect(
    upNextRail.getByText(/^S03 E03 · Freshly Added Episode/)
  ).toBeVisible();
  expect(resumeRemoved).toBe(true);
});

test('shows the connection form immediately when the saved server is offline', async () => {
  await electronApp.close();
  await closeServer();

  const startedAt = Date.now();
  electronApp = await launchApp();
  page = await electronApp.firstWindow();

  await expect(
    page.getByRole('heading', { name: 'Connect to Jellyfin' })
  ).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(2_500);
  await expect(
    page.getByRole('alert').filter({
      hasText: /did not respond|refused the connection|could not be found/i
    })
  ).toBeVisible({ timeout: 4_000 });
});

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    'Content-Type': 'application/json'
  });
  response.end(JSON.stringify(body));
}

function fixtureMediaSources() {
  return [
    {
      DefaultAudioStreamIndex: 1,
      MediaStreams: [
        {
          Type: 'Video',
          Index: 0,
          Width: 3840,
          Height: 1606,
          VideoRangeType: 'HDR10',
          ColorTransfer: 'smpte2084'
        },
        {
          Type: 'Audio',
          Index: 1,
          Channels: 6,
          IsDefault: true
        }
      ]
    }
  ];
}

function launchApp(): Promise<ElectronApplication> {
  const packagedExecutable = process.env.JELLYCLIENT_EXECUTABLE?.trim();
  return electron.launch({
    ...(packagedExecutable
      ? {
          executablePath: resolve(packagedExecutable),
          args: []
        }
      : {
          args: ['.']
        }),
    env: {
      ...process.env,
      JELLYCLIENT_CONFIG_PATH: configPath,
      JELLYCLIENT_USER_DATA_PATH: userDataPath
    }
  });
}
