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
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  stat,
  writeFile
} from 'node:fs/promises';
import { resolve } from 'node:path';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let port = 0;
let resumeRemoved = false;
let nextEpisodeNumber = 2;
let nextUpRequestUrl = '';
let serverClosed = false;
let movieFavorite = false;
let moviePlayed = false;
let lastCatalogRequestUrl = '';
let playbackMedia = Buffer.alloc(0);
let playbackStreamRequests = 0;
let playbackAuthorization = '';
let addedContainer: { kind: 'playlist' | 'collection'; id: string } | null = null;
let createdContainer: { kind: 'playlist' | 'collection'; name: string } | null = null;
let movedPlaylistEntry: { entryId: string; index: number } | null = null;
let removedPlaylistEntry: string | null = null;
let playlistEntries = [
  playlistChild('entry-1', 'real-movie', 'Real Movie'),
  playlistChild('entry-2', 'similar-movie', 'Similar Movie')
];
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
const mpvPath = findMpvExecutable();

const server = createServer(
  (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(
      request.url ?? '/',
      'http://127.0.0.1'
    );
    const path = url.pathname.toLowerCase();

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
            SeriesId: 'fixture-series-id',
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
    if (path === '/movies/recommendations') {
      json(response, [{
        BaselineItemName: 'Fixture Series',
        Items: [{
          Id: 'recommended-movie',
          Name: 'Recommended Movie',
          Type: 'Movie',
          RunTimeTicks: 5_400_000_000,
          UserData: { Played: false, IsFavorite: false }
        }]
      }]);
      return;
    }
    if (path === '/useritems/resume-item-id/userdata') {
      if (request.method === 'POST') resumeRemoved = false;
      json(response, {
        PlaybackPositionTicks: resumeRemoved ? 0 : 600_000_000,
        PlayedPercentage: resumeRemoved ? 0 : 20,
        Played: false,
        IsFavorite: false
      });
      return;
    }
    if (path === '/videos/real-movie/stream') {
      playbackStreamRequests += 1;
      playbackAuthorization = request.headers.authorization ?? '';
      serveMedia(request, response, playbackMedia);
      return;
    }
    if (path === '/mediasegments/real-movie') {
      json(response, {
        Items: [{
          Id: 'opening-intro',
          Type: 'Intro',
          StartTicks: 20_000_000,
          EndTicks: 170_000_000
        }]
      });
      return;
    }
    if (/^\/playingitems\/[^/]+\/(progress|stop)$/i.test(path)) {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === '/userfavoriteitems/real-movie') {
      movieFavorite = request.method !== 'DELETE';
      json(response, movieUserData());
      return;
    }
    if (path === '/userplayeditems/real-movie') {
      moviePlayed = request.method !== 'DELETE';
      json(response, movieUserData());
      return;
    }
    if (/^\/items\/[^/]+\/playbackinfo$/i.test(path)) {
      json(response, playbackInfo());
      return;
    }
    if (/^\/items\/[^/]+\/(specialfeatures|localtrailers)$/i.test(path)) {
      json(response, []);
      return;
    }
    if (/^\/items\/[^/]+\/similar$/i.test(path)) {
      json(response, {
        Items: path === '/items/real-movie/similar'
          ? [movieItem('similar-movie', 'Similar Movie')]
          : [],
        TotalRecordCount: path === '/items/real-movie/similar' ? 1 : 0
      });
      return;
    }
    if (path === '/playlists/playlist-1/items') {
      if (request.method === 'POST') {
        addedContainer = { kind: 'playlist', id: url.searchParams.get('ids') ?? '' };
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === 'DELETE') {
        removedPlaylistEntry = url.searchParams.get('entryIds');
        playlistEntries = playlistEntries.filter(
          (entry) => entry.PlaylistItemId !== removedPlaylistEntry
        );
        response.writeHead(204);
        response.end();
        return;
      }
      json(response, {
        Items: playlistEntries,
        TotalRecordCount: playlistEntries.length
      });
      return;
    }
    const moveMatch = path.match(/^\/playlists\/playlist-1\/items\/([^/]+)\/move\/(\d+)$/i);
    if (moveMatch) {
      const entryId = moveMatch[1]!;
      const index = Number(moveMatch[2]);
      movedPlaylistEntry = { entryId, index };
      const current = playlistEntries.findIndex((entry) => entry.PlaylistItemId === entryId);
      if (current >= 0) {
        const [entry] = playlistEntries.splice(current, 1);
        playlistEntries.splice(index, 0, entry!);
      }
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === '/playlists' && request.method === 'POST') {
      createdContainer = {
        kind: 'playlist',
        name: url.searchParams.get('name') ?? ''
      };
      json(response, { Id: 'created-playlist' });
      return;
    }
    if (path === '/collections/collection-1/items' && request.method === 'POST') {
      addedContainer = { kind: 'collection', id: url.searchParams.get('ids') ?? '' };
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === '/collections' && request.method === 'POST') {
      createdContainer = {
        kind: 'collection',
        name: url.searchParams.get('name') ?? ''
      };
      json(response, { Id: 'created-collection' });
      return;
    }
    const itemMatch = path.match(/^\/items\/([^/]+)$/i);
    if (itemMatch) {
      json(response, itemForId(itemMatch[1]!));
      return;
    }
    if (path === '/items') {
      lastCatalogRequestUrl = request.url ?? '';
      const filters = url.searchParams.get('filters') ?? '';
      const sortBy = url.searchParams.get('sortBy') ?? '';
      const includeTypes = url.searchParams.get('includeItemTypes') ?? '';
      const ids = url.searchParams.get('ids') ?? '';
      const parentId = url.searchParams.get('parentId') ?? '';
      const searchTerm = url.searchParams.get('searchTerm') ?? '';
      if (ids) {
        json(response, {
          Items: ids.split(',').map(itemForId),
          TotalRecordCount: ids.split(',').length
        });
        return;
      }
      if (parentId === 'playlist-1') {
        json(response, { Items: playlistEntries, TotalRecordCount: playlistEntries.length });
        return;
      }
      if (parentId && parentId !== 'movies-library') {
        json(response, { Items: [], TotalRecordCount: 0 });
        return;
      }
      if (searchTerm) {
        json(response, {
          Items: [movieItem('search-movie', `Result for ${searchTerm}`)],
          TotalRecordCount: 1
        });
        return;
      }
      if (url.searchParams.has('genres')) {
        json(response, {
          Items: [movieItem('real-movie', 'Real Movie')],
          TotalRecordCount: 1
        });
        return;
      }
      if (url.searchParams.has('personIds')) {
        json(response, {
          Items: [movieItem('real-movie', 'Real Movie')],
          TotalRecordCount: 1
        });
        return;
      }
      if (filters.includes('IsFavorite')) {
        json(response, {
          Items: [{
            Id: 'favorite-movie',
            Name: 'Favorite Movie',
            Type: 'Movie',
            RunTimeTicks: 5_400_000_000,
            UserData: { Played: false, IsFavorite: true }
          }],
          TotalRecordCount: 1
        });
        return;
      }
      if (filters.includes('IsPlayed') || sortBy.includes('DatePlayed')) {
        json(response, {
          Items: [{
            Id: 'watched-movie',
            Name: 'Watched Movie',
            Type: 'Movie',
            RunTimeTicks: 5_400_000_000,
            UserData: {
              Played: true,
              IsFavorite: false,
              LastPlayedDate: '2026-07-30T12:00:00Z'
            }
          }],
          TotalRecordCount: 1
        });
        return;
      }
      if (includeTypes === 'Playlist') {
        json(response, {
          Items: [{
            Id: 'playlist-1',
            Name: 'Weekend Queue',
            Type: 'Playlist',
            IsFolder: true,
            ChildCount: 2
          }],
          TotalRecordCount: 1
        });
        return;
      }
      if (includeTypes === 'BoxSet') {
        json(response, {
          Items: [{
            Id: 'collection-1',
            Name: 'Science Fiction',
            Type: 'BoxSet',
            IsFolder: true,
            ChildCount: 3
          }],
          TotalRecordCount: 1
        });
        return;
      }
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
            ...movieItem('real-movie', 'Real Movie'),
            RecursiveItemCount: 0,
            ChildCount: 0
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
    if (path.startsWith('/sessions/playing')) {
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
  playbackMedia = await preparePlaybackFixture();
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

test('shows Windows library-management views and card actions', async () => {
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'My List' })).toBeVisible();
  await expect(page.getByText('Favorite Movie')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently watched' })).toBeVisible();
  await expect(page.getByText('Watched Movie')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recommended' })).toBeVisible();
  await expect(page.getByText('Recommended Movie')).toBeVisible();

  await page.getByRole('button', { name: 'More actions for Paused Episode' }).click();
  await expect(page.getByRole('menuitem', { name: 'Restart' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add to My List' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Mark watched' })).toBeVisible();

  await page.getByRole('button', { name: 'Playlists' }).click();
  await expect(page.getByRole('heading', { name: 'Playlists' })).toBeVisible();
  await expect(page.getByText('Weekend Queue')).toBeVisible();
  await page.getByRole('button', { name: 'Collections' }).click();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.getByText('Science Fiction')).toBeVisible();
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

  await page.getByRole('button', {
    name: 'Hide from Up Next: Fixture Series'
  }).click();
  await expect(page.getByRole('heading', { name: 'Up next' })).toHaveCount(0);
  await expect(page.getByText('Hidden from Up Next')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();

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

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(removePausedEpisode).toBeVisible();
  expect(resumeRemoved).toBe(false);
});

test('saves Windows playback and home-screen settings through the real UI', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByRole('combobox', { name: 'HDR behavior' }).selectOption('tone-map');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.25');
  await page.getByRole('combobox', { name: 'Preferred language' }).selectOption('spa');
  await page.getByRole('checkbox', { name: /Start fullscreen/ }).uncheck();
  await page.getByRole('checkbox', { name: /Automatically skip intros/ }).check();
  await page.getByRole('checkbox', { name: /Automatically skip endings/ }).check();
  const skipShortcut = page.getByRole('button', { name: 'Skip shortcut' });
  await skipShortcut.click();
  await skipShortcut.press('F4');
  await expect(skipShortcut.locator('kbd')).toHaveText('F4');
  await page.getByRole('combobox', {
    name: 'Skip prompt / auto-skip delay'
  }).selectOption('20');
  await page.getByRole('heading', { name: 'Playback behavior' }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve('artifacts', 'settings-skip-controls.png'),
    fullPage: true
  });
  await page.getByLabel('Subtitle delay (seconds)').fill('0.4');
  await page.getByLabel('Audio delay (seconds)').fill('-0.2');
  await page.getByRole('button', { name: 'Hide Recommended' }).click();
  await page.getByRole('button', { name: 'Move My List up' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();

  await expect(page.getByText('Playback settings saved.')).toBeVisible();
  const saved = JSON.parse(await readFile(configPath, 'utf8')) as {
    settings: {
      player: {
      hdrMode: string;
      playbackSpeed: number;
      preferredSubtitleLanguage: string;
      fullscreenOnPlay: boolean;
      autoSkipIntro: boolean;
      autoSkipOutro: boolean;
      skipSegmentKey: string;
      skipPromptDurationSeconds: number;
      subtitleDelaySeconds: number;
      audioDelaySeconds: number;
      };
      home: { hiddenSections: string[] };
    };
  };
  expect(saved.settings.player).toMatchObject({
    hdrMode: 'tone-map',
    playbackSpeed: 1.25,
    preferredSubtitleLanguage: 'spa',
    fullscreenOnPlay: false,
    autoSkipIntro: true,
    autoSkipOutro: true,
    skipSegmentKey: 'F4',
    skipPromptDurationSeconds: 20,
    subtitleDelaySeconds: 0.4,
    audioDelaySeconds: -0.2
  });
  expect(saved.settings.home.hiddenSections).toContain('recommended');

  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Recommended' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'HDR behavior' })).toHaveValue('tone-map');
  await expect(page.getByRole('button', { name: 'Show Recommended' })).toBeVisible();

  await page.getByRole('button', { name: 'Show Recommended' }).click();
  await page.getByRole('combobox', { name: 'HDR behavior' }).selectOption('auto');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1');
  await skipShortcut.click();
  await skipShortcut.press('n');
  await page.getByRole('combobox', {
    name: 'Skip prompt / auto-skip delay'
  }).selectOption('15');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Playback settings saved.')).toBeVisible();
});

test('drives search, advanced filters, keyboard back, and mouse back', async () => {
  await page.getByRole('button', { name: 'Movies' }).click();
  const search = page.getByRole('textbox', { name: 'Search your library' });
  await search.fill('needle');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Results for “needle”' })).toBeVisible();
  await expect(page.getByText('Result for needle')).toBeVisible();

  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Genres').fill('Drama, Science Fiction');
  await page.getByLabel('Years').fill('2025, 2026');
  await page.getByLabel('Minimum rating').selectOption('8');
  await page.getByRole('checkbox', { name: '4K only' }).check();
  await page.getByRole('checkbox', { name: 'Has subtitles' }).check();
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect.poll(() => lastCatalogRequestUrl).toContain('searchTerm=needle');
  const filtered = new URL(lastCatalogRequestUrl, `http://127.0.0.1:${port}`).searchParams;
  expect(filtered.get('genres')).toContain('Drama');
  expect(filtered.get('years')).toContain('2025');
  expect(filtered.get('minCommunityRating')).toBe('8');
  expect(filtered.get('is4K')).toBe('true');
  expect(filtered.get('hasSubtitles')).toBe('true');

  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByRole('heading', { name: 'Movies' })).toBeVisible();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'Recently watched' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3 })));
  await expect(page.getByRole('heading', { name: 'Movies' })).toBeVisible();
});

test('uses item details, My List, watched state, lists, genres, people, and recommendations', async () => {
  await page.getByRole('button', { name: 'Movies' }).click();
  await openMediaCard(page, 'Real Movie');
  const details = page.getByRole('dialog');
  await expect(details.getByRole('heading', { name: 'Real Movie' })).toBeVisible();
  await expect(details.getByText('Every control should work.')).toBeVisible();
  await expect(details.getByText('Playback options', { exact: true })).toBeVisible();
  await details.getByLabel('Quality').selectOption('20000000');
  await details.getByLabel('Audio').selectOption('2');
  await details.getByLabel('Subtitles').selectOption('4');

  await details.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(details.getByRole('button', { name: 'In favorites' })).toBeVisible();
  expect(movieFavorite).toBe(true);
  await details.getByRole('button', { name: 'Mark watched' }).click();
  await expect(details.getByRole('button', { name: 'Watched' })).toBeVisible();
  expect(moviePlayed).toBe(true);

  await details.getByRole('button', { name: 'Add to list' }).click();
  const listDialog = page.getByRole('dialog', { name: 'Add to a list' });
  await listDialog.getByRole('button', { name: /Weekend Queue/ }).click();
  await expect.poll(() => addedContainer).toEqual({ kind: 'playlist', id: 'real-movie' });

  await details.getByRole('button', { name: 'Add to list' }).click();
  const collectionDialog = page.getByRole('dialog', { name: 'Add to a list' });
  await collectionDialog.getByRole('tab', { name: 'Collections' }).click();
  await collectionDialog.getByRole('button', { name: /Science Fiction/ }).click();
  await expect.poll(() => addedContainer).toEqual({ kind: 'collection', id: 'real-movie' });

  await details.getByRole('button', { name: 'Add to list' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Add to a list' });
  await createDialog.getByLabel('New playlist name').fill('Road Trip');
  await createDialog.getByRole('button', { name: 'Create and add' }).click();
  await expect.poll(() => createdContainer).toEqual({ kind: 'playlist', name: 'Road Trip' });

  await details.getByRole('button', { name: 'Drama' }).click();
  await expect(page.getByRole('heading', { name: 'Drama' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await openMediaCard(page, 'Real Movie');
  await page.getByRole('dialog').getByRole('button', { name: /Test Actor/ }).click();
  await expect(page.getByRole('heading', { name: 'Test Actor' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await openMediaCard(page, 'Real Movie');
  await page.getByRole('dialog').getByRole('button', { name: /Similar Movie/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Similar Movie' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('reorders and removes playlist entries through the detail sheet', async () => {
  await page.getByRole('button', { name: 'Playlists' }).click();
  await page.getByRole('button', { name: 'Open Weekend Queue' }).click();
  const details = page.getByRole('dialog');
  await expect(details.getByText('Real Movie')).toBeVisible();
  await expect(details.getByText('Similar Movie')).toBeVisible();

  await details.getByRole('button', { name: 'Move Similar Movie up' }).click();
  await expect.poll(() => movedPlaylistEntry).toEqual({ entryId: 'entry-2', index: 0 });
  await expect(details.locator('.detail-child-card strong').first()).toHaveText('Similar Movie');

  await details.getByRole('button', { name: 'Remove Real Movie from Weekend Queue' }).click();
  await expect.poll(() => removedPlaylistEntry).toBe('entry-1');
  await expect(details.locator('.detail-child-card').filter({ hasText: 'Real Movie' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('plays synthetic media through real MPV and clicks the complete player dock', async () => {
  test.skip(playbackMedia.length === 0, 'ffmpeg is required to generate the playback fixture.');
  test.skip(!mpvPath, 'mpv is required to run the real playback checks.');
  await page.getByRole('button', { name: 'Movies' }).click();
  await openMediaCard(page, 'Real Movie');
  const details = page.getByRole('dialog');
  await details.getByLabel('Audio').selectOption('2');
  await details.getByLabel('Subtitles').selectOption('4');
  await details.getByRole('button', { name: 'Play', exact: true }).click();

  const dock = page.locator('.player-dock');
  await expect(dock.getByText('Real Movie')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => playbackStreamRequests).toBeGreaterThan(0);
  expect(playbackAuthorization).toContain('fixture-access-token');

  await dock.getByRole('button', { name: 'Pause' }).click();
  await expect(dock.getByRole('button', { name: 'Play' })).toBeVisible();
  await dock.getByLabel('Playback position').fill('40');
  await dock.getByRole('button', { name: 'Play' }).click();

  await dock.locator('.dock-tool').filter({ hasText: '×' }).click();
  await dock.getByRole('combobox', { name: 'Speed' }).selectOption('1.25');
  await dock.getByRole('button', { name: 'Increase subtitles delay' }).click();
  await dock.getByRole('button', { name: 'Increase audio delay' }).click();

  await dock.getByRole('button', { name: 'Audio', exact: true }).click();
  await dock.locator('.dock-popover').getByRole('button').filter({ hasText: 'English' }).click();
  await dock.getByRole('button', { name: 'Subtitles', exact: true }).click();
  await dock.locator('.dock-popover').getByRole('button', { name: 'Off' }).click();

  await dock.getByRole('button', { name: 'Mute' }).click();
  await expect(dock.getByRole('button', { name: 'Unmute' })).toBeVisible();
  await dock.getByLabel('Volume').fill('65');
  await dock.getByRole('button', { name: 'Diagnostics' }).click();
  await expect(page.getByLabel('Playback diagnostics')).toBeVisible();
  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Close diagnostics' }).click();

  await dock.getByRole('button', { name: 'Next chapter' }).click();
  await dock.getByRole('button', { name: 'Stop' }).click();
  await expect(dock).toHaveCount(0);
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

function movieUserData() {
  return {
    PlaybackPositionTicks: 0,
    PlayedPercentage: 0,
    Played: moviePlayed,
    IsFavorite: movieFavorite
  };
}

function playbackSource() {
  return {
    Id: 'source-1',
    Name: 'Synthetic multi-track MKV',
    Path: 'fixture-playback.mkv',
    Container: 'mkv',
    Size: playbackMedia.length,
    Bitrate: 2_000_000,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: true,
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: 3,
    MediaStreams: [
      {
        Type: 'Video',
        Index: 0,
        Codec: 'mpeg4',
        Profile: 'Simple Profile',
        Width: 320,
        Height: 180,
        BitDepth: 8,
        ColorPrimaries: 'bt709',
        ColorTransfer: 'bt709',
        ColorSpace: 'bt709'
      },
      {
        Type: 'Audio',
        Index: 1,
        Codec: 'aac',
        Language: 'eng',
        Title: 'English',
        Channels: 2,
        ChannelLayout: 'stereo',
        SampleRate: 48_000,
        IsDefault: true
      },
      {
        Type: 'Audio',
        Index: 2,
        Codec: 'aac',
        Language: 'spa',
        Title: 'Spanish',
        Channels: 2,
        ChannelLayout: 'stereo',
        SampleRate: 48_000
      },
      {
        Type: 'Subtitle',
        Index: 3,
        Codec: 'subrip',
        Language: 'eng',
        Title: 'English',
        IsDefault: true
      },
      {
        Type: 'Subtitle',
        Index: 4,
        Codec: 'subrip',
        Language: 'spa',
        Title: 'Spanish'
      }
    ]
  };
}

function playbackInfo() {
  return {
    MediaSources: [playbackSource()],
    PlaySessionId: 'play-session-1'
  };
}

function movieItem(id: string, name: string) {
  return {
    Id: id,
    Name: name,
    Type: 'Movie',
    IsFolder: false,
    RunTimeTicks: 180_000_000,
    ProductionYear: 2026,
    OfficialRating: 'PG-13',
    CommunityRating: 8.4,
    Overview: 'A synthetic movie used to exercise the complete Windows interface.',
    Taglines: ['Every control should work.'],
    Genres: ['Drama', 'Science Fiction'],
    Studios: [{ Name: 'Fixture Studio' }],
    People: [{
      Id: 'person-1',
      Name: 'Test Actor',
      Role: 'Lead',
      Type: 'Actor'
    }],
    Chapters: [
      { Name: 'Opening', StartPositionTicks: 0 },
      { Name: 'Middle', StartPositionTicks: 90_000_000 }
    ],
    MediaSources: [playbackSource()],
    UserData: id === 'real-movie'
      ? movieUserData()
      : { Played: false, IsFavorite: false }
  };
}

function playlistChild(entryId: string, itemId: string, name: string) {
  return {
    ...movieItem(itemId, name),
    PlaylistItemId: entryId
  };
}

function itemForId(id: string) {
  if (id === 'playlist-1') {
    return {
      Id: id,
      Name: 'Weekend Queue',
      Type: 'Playlist',
      IsFolder: true,
      ChildCount: playlistEntries.length,
      UserData: { Played: false, IsFavorite: false }
    };
  }
  if (id === 'collection-1') {
    return {
      Id: id,
      Name: 'Science Fiction',
      Type: 'BoxSet',
      IsFolder: true,
      ChildCount: 1,
      UserData: { Played: false, IsFavorite: false }
    };
  }
  if (id === 'resume-item-id') {
    return {
      Id: id,
      Name: 'Paused Episode',
      Type: 'Episode',
      SeriesName: 'Fixture Series',
      SeriesId: 'fixture-series',
      ParentIndexNumber: 3,
      IndexNumber: 1,
      RunTimeTicks: 3_000_000_000,
      MediaSources: fixtureMediaSources(),
      UserData: {
        PlaybackPositionTicks: 600_000_000,
        PlayedPercentage: 20,
        Played: false,
        IsFavorite: false
      }
    };
  }
  const names: Record<string, string> = {
    'real-movie': 'Real Movie',
    'similar-movie': 'Similar Movie',
    'search-movie': 'Search Result Movie'
  };
  return movieItem(id, names[id] ?? 'Fixture Movie');
}

async function preparePlaybackFixture(): Promise<Buffer> {
  const fixtureDirectory = resolve('test-results', 'playback-fixture');
  const englishSubtitles = resolve(fixtureDirectory, 'english.srt');
  const spanishSubtitles = resolve(fixtureDirectory, 'spanish.srt');
  const output = resolve(fixtureDirectory, 'fixture-playback.mkv');
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(englishSubtitles, '1\n00:00:01,000 --> 00:00:12,000\nEnglish subtitle fixture\n');
  await writeFile(spanishSubtitles, '1\n00:00:01,000 --> 00:00:12,000\nSpanish subtitle fixture\n');
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x17201f:s=320x180:r=24:d=18',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=18',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=18',
      '-i', englishSubtitles,
      '-i', spanishSubtitles,
      '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-map', '3:0', '-map', '4:0',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=English',
      '-metadata:s:a:1', 'language=spa', '-metadata:s:a:1', 'title=Spanish',
      '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English',
      '-metadata:s:s:1', 'language=spa', '-metadata:s:s:1', 'title=Spanish',
      '-shortest', output
    ], { stdio: 'ignore', timeout: 45_000 });
    return await readFile(output);
  } catch {
    return Buffer.alloc(0);
  }
}

function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  media: Buffer
): void {
  if (media.length === 0) {
    response.writeHead(503);
    response.end();
    return;
  }
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/i);
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(
      media.length - 1,
      range[2] ? Number(range[2]) : media.length - 1
    );
    response.writeHead(206, {
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${media.length}`,
      'Content-Type': 'video/x-matroska'
    });
    if (request.method === 'HEAD') response.end();
    else response.end(media.subarray(start, end + 1));
    return;
  }
  response.writeHead(200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': media.length,
    'Content-Type': 'video/x-matroska'
  });
  if (request.method === 'HEAD') response.end();
  else response.end(media);
}

async function openMediaCard(targetPage: Page, name: string): Promise<void> {
  await targetPage.locator('.media-card__copy').filter({ hasText: name }).first().click();
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
      JELLYCLIENT_USER_DATA_PATH: userDataPath,
      ...(mpvPath ? { JELLYCLIENT_MPV_PATH: mpvPath } : {})
    }
  });
}

function findMpvExecutable(): string | null {
  const profile = process.env.USERPROFILE?.trim();
  const candidates = [
    process.env.JELLYCLIENT_MPV_PATH?.trim(),
    profile ? resolve(profile, 'Downloads', 'MPV', 'mpv.exe') : null,
    profile
      ? resolve(profile, 'Downloads', 'mpv-x86_64-20260726-git-b27573a239', 'mpv.exe')
      : null
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
}
