import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const artifactDirectory = resolve('artifacts');
  await mkdir(artifactDirectory, { recursive: true });
  const packagedExecutable = process.env.JELLYCLIENT_EXECUTABLE?.trim();
  electronApp = await electron.launch({
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
      JELLYCLIENT_CONFIG_PATH: resolve(
        'test-results',
        'e2e-profile',
        'config.json'
      ),
      JELLYCLIENT_USER_DATA_PATH: resolve(
        'test-results',
        'e2e-profile',
        'electron-data'
      )
    }
  });
  page = await electronApp.firstWindow();
  page.on('console', (message) => {
    console.log(`[renderer:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    console.error(`[renderer:pageerror] ${error.message}`);
  });
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await electronApp.close();
});

test('shows the secure Jellyfin connection profile', async () => {
  await expect(page).toHaveTitle('JellyClient');
  await expect(
    page.getByRole('heading', { name: 'Connect to Jellyfin' })
  ).toBeVisible();
  await expect(page.getByLabel('Server IP or hostname')).toBeVisible();
  await expect(page.getByLabel('Port')).toHaveValue('8096');
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'password'
  );
  await expect(page.getByText('Your password is used to sign in')).toBeVisible();
  await expect(page.getByText('The image comes first.')).toHaveCount(0);
  const brandBounds = await page.locator('.login__center > .brand').boundingBox();
  const windowCenter = await page.evaluate(() => window.innerWidth / 2);
  expect(Math.abs(
    (brandBounds?.x ?? 0) + (brandBounds?.width ?? 0) / 2 - windowCenter
  )).toBeLessThan(4);
});

test('reveals advanced base-path configuration without exposing the password', async () => {
  await page.getByRole('button', { name: 'Server uses a base path?' }).click();
  await expect(page.getByLabel('Base path')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('temporary-test-secret');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(
    page.getByLabel('Password', { exact: true })
  ).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(
    page.getByLabel('Password', { exact: true })
  ).toHaveAttribute('type', 'password');
  await page.getByLabel('Password', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Hide advanced address' }).click();
});

test('captures the first-run screen for visual review', async () => {
  const brandBounds = await page.locator('.login__center > .brand').boundingBox();
  expect(brandBounds).not.toBeNull();
  await page.screenshot({
    path: resolve('artifacts', 'login-screen.png'),
    fullPage: true
  });
});
