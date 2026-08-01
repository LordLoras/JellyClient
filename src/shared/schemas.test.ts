import { describe, expect, it } from 'vitest';
import {
  connectionInputSchema,
  settingsSchema
} from './schemas.js';
import type { AppSettings } from './contracts.js';
import { defaultSettings } from './defaults.js';

describe('IPC validation', () => {
  it('accepts a complete connection profile', () => {
    expect(connectionInputSchema.parse({
      protocol: 'http',
      host: '127.0.0.1',
      port: 8096,
      basePath: '',
      username: 'test',
      password: 'secret',
      rememberSession: true,
      displayName: 'Local'
    }).host).toBe('127.0.0.1');
  });

  it('rejects invalid server ports', () => {
    expect(() => connectionInputSchema.parse({
      protocol: 'http',
      host: '127.0.0.1',
      port: 80_000,
      basePath: '',
      username: 'test',
      password: '',
      rememberSession: false,
      displayName: 'Local'
    })).toThrow();
  });

  it('accepts the committed default player settings', () => {
    expect(settingsSchema.parse(defaultSettings)).toEqual(defaultSettings);
  });

  it('migrates existing settings to automatic English subtitles', () => {
    const legacy = structuredClone(defaultSettings) as {
      player: Partial<typeof defaultSettings.player>;
      syncPlay: typeof defaultSettings.syncPlay;
    };
    delete legacy.player.autoEnableSubtitles;
    delete legacy.player.preferredSubtitleLanguage;
    delete legacy.player.preferredDisplayId;
    delete (legacy as Partial<AppSettings>).home;

    const migrated = settingsSchema.parse(legacy);
    expect(migrated.player.autoEnableSubtitles).toBe(true);
    expect(migrated.player.preferredSubtitleLanguage).toBe('eng');
    expect(migrated.player.preferredDisplayId).toBe('auto');
    expect(migrated.home.sectionOrder).toContain('resume');
    expect(migrated.home.hiddenSections).toEqual([]);
  });
});
