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
  readFile,
  stat
} from 'node:fs/promises';
import { resolve } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let port = 0;
const configPath = resolve(
  'test-results',
  'mock-auth-profile',
  'config.json'
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
        Items: [],
        TotalRecordCount: 0
      });
      return;
    }
    if (path === '/useritems/resume') {
      json(response, {
        Items: [],
        TotalRecordCount: 0
      });
      return;
    }
    if (path === '/items/latest') {
      json(response, []);
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
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
});

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
      name: 'Your screening room is connected'
    })
  ).toBeVisible();
  await expect(page.getByText('Fixture Server')).toBeVisible();

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
      name: 'Your screening room is connected'
    })
  ).toBeVisible();
  await expect(page.getByText('Fixture Server')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Meet your Jellyfin server'
    })
  ).toHaveCount(0);
});

test('defaults automatic subtitles to English', async () => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('heading', { name: 'Subtitle preference' })
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', {
      name: /Automatically enable subtitles/
    })
  ).toBeChecked();
  await expect(
    page.getByRole('combobox', { name: /Preferred language/ })
  ).toHaveValue('eng');
});

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    'Content-Type': 'application/json'
  });
  response.end(JSON.stringify(body));
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
      JELLYCLIENT_CONFIG_PATH: configPath
    }
  });
}
