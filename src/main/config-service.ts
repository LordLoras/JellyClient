import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { app, safeStorage } from 'electron';
import { z } from 'zod';
import type {
  AppSettings,
  SeriesPlaybackPreference,
  ServerProfile
} from '@shared/contracts.js';
import { defaultSettings } from '@shared/defaults.js';
import {
  serverProfileSchema,
  settingsSchema
} from '@shared/schemas.js';

const diskConfigSchema = z.object({
  version: z.literal(1),
  deviceId: z.string().uuid(),
  server: serverProfileSchema.nullable(),
  settings: settingsSchema
});

type DiskConfig = z.infer<typeof diskConfigSchema>;

const secretsSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  serverId: z.string(),
  baseUrl: z.string().url()
});

export interface StoredSession {
  accessToken: string;
  userId: string;
  serverId: string;
  baseUrl: string;
}

export class ConfigService {
  private readonly configPath: string;
  private readonly secretsPath: string;
  private data: DiskConfig = {
    version: 1,
    deviceId: randomUUID(),
    server: null,
    settings: defaultSettings
  };

  constructor() {
    const requestedPath = process.env.JELLYCLIENT_CONFIG_PATH?.trim();
    this.configPath = requestedPath
      ? resolve(requestedPath)
      : join(app.getPath('userData'), 'config.json');
    this.secretsPath = join(dirname(this.configPath), 'session.secure');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, 'utf8');
      this.data = diskConfigSchema.parse(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code !== 'ENOENT' &&
        !(error instanceof z.ZodError) &&
        !(error instanceof SyntaxError)
      ) {
        throw error;
      }
      if (code !== 'ENOENT') {
        const recoveryPath = `${this.configPath}.invalid-${Date.now()}`;
        await rename(this.configPath, recoveryPath);
      }
      await this.persist();
    }
  }

  get path(): string {
    return this.configPath;
  }

  get directory(): string {
    return dirname(this.configPath);
  }

  get deviceId(): string {
    return this.data.deviceId;
  }

  get profile(): ServerProfile | null {
    return this.data.server;
  }

  get settings(): AppSettings {
    return structuredClone(this.data.settings);
  }

  async saveProfile(profile: ServerProfile): Promise<void> {
    this.data.server = serverProfileSchema.parse(profile);
    await this.persist();
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    this.data.settings = settingsSchema.parse(settings);
    await this.persist();
    return this.settings;
  }

  async saveSeriesPreference(
    seriesId: string,
    preference: SeriesPlaybackPreference
  ): Promise<void> {
    this.data.settings.player.seriesPreferences[seriesId] = preference;
    this.data.settings = settingsSchema.parse(this.data.settings);
    await this.persist();
  }

  async saveSession(session: StoredSession): Promise<boolean> {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const serialized = JSON.stringify(secretsSchema.parse({
      version: 1,
      ...session
    }));
    const encrypted = safeStorage.encryptString(serialized);
    await mkdir(dirname(this.secretsPath), { recursive: true });
    await writeFile(this.secretsPath, encrypted, { mode: 0o600 });
    return true;
  }

  async loadSession(): Promise<StoredSession | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(this.secretsPath);
      const parsed = secretsSchema.parse(
        JSON.parse(safeStorage.decryptString(encrypted))
      );
      return {
        accessToken: parsed.accessToken,
        userId: parsed.userId,
        serverId: parsed.serverId,
        baseUrl: parsed.baseUrl
      };
    } catch {
      return null;
    }
  }

  async clearSession(): Promise<void> {
    await rm(this.secretsPath, { force: true });
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(this.data, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    await rename(temporaryPath, this.configPath);
  }
}
