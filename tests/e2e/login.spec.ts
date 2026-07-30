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
    page.getByRole('heading', { name: 'Meet your Jellyfin server' })
  ).toBeVisible();
  await expect(page.getByLabel('Server IP or hostname')).toBeVisible();
  await expect(page.getByLabel('Port')).toHaveValue('8096');
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'type',
    'password'
  );
  await expect(page.getByText('Your password is used once')).toBeVisible();
  const brandBounds = await page.locator('.login__story > .brand').boundingBox();
  expect(brandBounds?.x).toBeGreaterThanOrEqual(40);
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
});

test('captures the first-run screen for visual review', async () => {
  const brandBounds = await page.locator('.login__story > .brand').boundingBox();
  expect(brandBounds?.x).toBeGreaterThanOrEqual(40);
  await page.screenshot({
    path: resolve('artifacts', 'login-screen.png'),
    fullPage: true
  });
});
