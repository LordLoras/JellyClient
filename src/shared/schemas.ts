import { z } from 'zod';

export const serverProfileSchema = z.object({
  protocol: z.enum(['http', 'https']),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  basePath: z.string().max(200),
  username: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(200)
});

export const connectionInputSchema = serverProfileSchema.extend({
  password: z.string().max(1024),
  rememberSession: z.boolean()
});

export const settingsSchema = z.object({
  player: z.object({
    mpvPath: z.string().max(4096),
    hdrMode: z.enum(['auto', 'passthrough', 'tone-map']),
    gpuApi: z.enum(['d3d11', 'vulkan']),
    hardwareDecoding: z.boolean(),
    alwaysOnTop: z.boolean(),
    fullscreenOnPlay: z.boolean(),
    autoEnableSubtitles: z.boolean().default(true),
    preferredSubtitleLanguage: z.string().trim().min(2).max(35).default('eng')
  }),
  syncPlay: z.object({
    autoJoinUnambiguousCast: z.boolean(),
    softCorrectionThresholdMs: z.number().int().min(20).max(1000),
    hardSeekThresholdMs: z.number().int().min(100).max(5000)
  })
});

export const catalogQuerySchema = z.object({
  parentId: z.string().nullable(),
  searchTerm: z.string().max(200),
  startIndex: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  includeItemTypes: z.array(z.string()).max(30)
});

export const playMediaInputSchema = z.object({
  itemId: z.string().min(1).max(100),
  startPositionTicks: z.number().int().min(0),
  audioStreamIndex: z.number().int().nullable(),
  subtitleStreamIndex: z.number().int().nullable()
});

export const watchTogetherInputSchema = z.object({
  itemId: z.string().min(1).max(100),
  startPositionTicks: z.number().int().min(0),
  groupName: z.string().trim().min(1).max(100)
});
