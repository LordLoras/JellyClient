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

export const serverAddressSchema = serverProfileSchema.omit({
  username: true
});

export const quickConnectStartInputSchema = serverAddressSchema.extend({
  rememberSession: z.boolean()
});

export const settingsSchema = z.object({
  player: z.object({
    mpvPath: z.string().max(4096),
    hdrMode: z.enum(['auto', 'passthrough', 'tone-map']),
    gpuApi: z.enum(['d3d11', 'vulkan']),
    hardwareDecoding: z.boolean(),
    audioDevice: z.string().trim().min(1).max(1024).default('auto'),
    audioOutputMode: z.enum(['pcm', 'passthrough']).default('pcm'),
    audioPassthrough: z.object({
      ac3: z.boolean().default(true),
      eac3: z.boolean().default(true),
      truehd: z.boolean().default(false),
      dts: z.boolean().default(true),
      dtsHd: z.boolean().default(false)
    }).default({
      ac3: true,
      eac3: true,
      truehd: false,
      dts: true,
      dtsHd: false
    }),
    alwaysOnTop: z.boolean(),
    preferredDisplayId: z.string().trim().min(1).max(100).default('auto'),
    fullscreenOnPlay: z.boolean(),
    autoEnableSubtitles: z.boolean().default(true),
    preferredAudioLanguage: z.string().trim().min(2).max(35).default('eng'),
    preferredSubtitleLanguage: z.string().trim().min(2).max(35).default('eng'),
    preferForcedSubtitles: z.boolean().default(false),
    avoidSdhSubtitles: z.boolean().default(false),
    rememberSeriesPreferences: z.boolean().default(true),
    seriesPreferences: z.record(
      z.string().min(1).max(100),
      z.object({
        audioLanguage: z.string().min(2).max(35).nullable(),
        subtitleLanguage: z.string().min(2).max(35).nullable(),
        subtitlesEnabled: z.boolean()
      })
    ).default({}),
    playbackSpeed: z.number().min(0.25).max(4).default(1),
    subtitleDelaySeconds: z.number().min(-30).max(30).default(0),
    audioDelaySeconds: z.number().min(-30).max(30).default(0),
    autoSkipIntro: z.boolean().default(false),
    autoSkipOutro: z.boolean().default(false),
    skipSegmentKey: z.string().trim().toUpperCase().regex(
      /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/,
      'Choose one letter, number, or F1–F12.'
    ).default('N'),
    skipPromptDurationSeconds: z.number().int().min(3).max(30).default(15),
    autoPlayNext: z.boolean().default(true),
    nextEpisodeCountdownSeconds: z.number().int().min(3).max(60).default(10)
  }),
  syncPlay: z.object({
    autoJoinUnambiguousCast: z.boolean(),
    softCorrectionThresholdMs: z.number().int().min(20).max(1000),
    hardSeekThresholdMs: z.number().int().min(100).max(5000)
  }),
  home: z.object({
    sectionOrder: z.array(z.enum([
      'resume',
      'nextUp',
      'favorites',
      'recentlyPlayed',
      'recommended',
      'latest',
      'libraries'
    ])).max(7),
    hiddenSections: z.array(z.enum([
      'resume',
      'nextUp',
      'favorites',
      'recentlyPlayed',
      'recommended',
      'latest',
      'libraries'
    ])).max(7),
    dismissedNextUpSeriesIds: z.array(
      z.string().trim().min(1).max(100)
    ).max(500).default([])
  }).default({
    sectionOrder: [
      'resume',
      'nextUp',
      'favorites',
      'recentlyPlayed',
      'recommended',
      'latest',
      'libraries'
    ],
    hiddenSections: [],
    dismissedNextUpSeriesIds: []
  })
});

export const catalogQuerySchema = z.object({
  parentId: z.string().nullable(),
  searchTerm: z.string().max(200),
  startIndex: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  includeItemTypes: z.array(z.string()).max(30),
  sortBy: z.enum([
    'SortName',
    'DateCreated',
    'PremiereDate',
    'ProductionYear',
    'CommunityRating',
    'Runtime',
    'DatePlayed'
  ]).optional(),
  sortDescending: z.boolean().optional(),
  filter: z.enum(['all', 'unplayed', 'played', 'favorite']).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  years: z.array(z.number().int().min(1800).max(3000)).max(50).optional(),
  personIds: z.array(z.string().min(1).max(100)).max(20).optional(),
  minCommunityRating: z.number().min(0).max(10).optional(),
  is4K: z.boolean().optional(),
  hasSubtitles: z.boolean().optional()
});

export const catalogContainerKindSchema = z.enum(['playlist', 'collection']);

export const playMediaInputSchema = z.object({
  itemId: z.string().min(1).max(100),
  startPositionTicks: z.number().int().min(0),
  mediaSourceId: z.string().min(1).max(200).nullable().default(null),
  maxStreamingBitrate: z.number().int().min(1_000_000).max(1_000_000_000).nullable().default(null),
  audioStreamIndex: z.number().int().nullable(),
  subtitleStreamIndex: z.number().int().nullable()
});

export const watchTogetherInputSchema = z.object({
  itemId: z.string().min(1).max(100),
  startPositionTicks: z.number().int().min(0),
  groupName: z.string().trim().min(1).max(100)
});
