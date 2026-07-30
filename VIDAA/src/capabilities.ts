import type { CapabilityResult } from './types.js';

interface MimeProbe {
  label: string;
  contentType: string;
}

const MIME_PROBES: MimeProbe[] = [
  {
    label: 'H.264 · MP4',
    contentType: 'video/mp4; codecs="avc1.640028"'
  },
  {
    label: 'HEVC Main 10 · hvc1',
    contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"'
  },
  {
    label: 'HEVC Main 10 · hev1',
    contentType: 'video/mp4; codecs="hev1.2.4.L153.B0"'
  },
  {
    label: 'Dolby Vision P5 · dvh1',
    contentType: 'video/mp4; codecs="dvh1.05.06"'
  },
  {
    label: 'Dolby Vision P8 · dvhe',
    contentType: 'video/mp4; codecs="dvhe.08.06"'
  },
  {
    label: 'Matroska',
    contentType: 'video/x-matroska'
  },
  {
    label: 'HLS',
    contentType: 'application/vnd.apple.mpegurl'
  },
  {
    label: 'MPEG-DASH',
    contentType: 'application/dash+xml'
  }
];

function supportTone(value: string): CapabilityResult['tone'] {
  if (value === 'probably') return 'good';
  if (value === 'maybe') return 'neutral';
  return 'warning';
}

export function collectCapabilities(): CapabilityResult[] {
  const video = document.createElement('video');
  const dynamicRange = window.matchMedia?.('(dynamic-range: high)').matches;
  const videoDynamicRange = window.matchMedia?.(
    '(video-dynamic-range: high)'
  ).matches;
  const platformGlobals = [
    'VIDAA',
    'vidaa',
    'Hisense',
    'hisense',
    'Device',
    'device'
  ].filter((name) => name in window);

  return [
    {
      label: 'Firmware under test',
      value: 'v01.09.60V.Q0618',
      tone: 'neutral'
    },
    {
      label: 'Viewport',
      value: `${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio || 1}×`,
      tone: 'neutral'
    },
    {
      label: 'CSS dynamic range',
      value: dynamicRange || videoDynamicRange ? 'High reported' : 'Not reported',
      tone: dynamicRange || videoDynamicRange ? 'good' : 'neutral'
    },
    {
      label: 'Media Source Extensions',
      value: 'MediaSource' in window ? 'Available' : 'Unavailable',
      tone: 'MediaSource' in window ? 'good' : 'warning'
    },
    {
      label: 'MediaCapabilities API',
      value: navigator.mediaCapabilities ? 'Available' : 'Unavailable',
      tone: navigator.mediaCapabilities ? 'good' : 'neutral'
    },
    {
      label: 'VIDAA globals',
      value: platformGlobals.length > 0
        ? platformGlobals.join(', ')
        : 'None exposed',
      tone: platformGlobals.length > 0 ? 'good' : 'neutral'
    },
    ...MIME_PROBES.map(({ label, contentType }) => {
      const result = video.canPlayType(contentType) || 'not reported';
      return {
        label,
        value: result,
        tone: supportTone(result)
      };
    })
  ];
}

export async function collectDecodingCapabilities(): Promise<CapabilityResult[]> {
  if (!navigator.mediaCapabilities?.decodingInfo) return [];

  const probes = MIME_PROBES.filter((probe) =>
    probe.contentType.startsWith('video/mp4')
  );
  const results: CapabilityResult[] = [];

  for (const probe of probes) {
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: 'file',
        video: {
          contentType: probe.contentType,
          width: 3840,
          height: 2160,
          bitrate: 25_000_000,
          framerate: 24
        }
      });
      results.push({
        label: `${probe.label} decoding`,
        value: [
          info.supported ? 'supported' : 'unsupported',
          info.smooth ? 'smooth' : 'not smooth',
          info.powerEfficient ? 'efficient' : 'not efficient'
        ].join(' · '),
        tone: info.supported ? 'good' : 'warning'
      });
    } catch {
      results.push({
        label: `${probe.label} decoding`,
        value: 'Query rejected',
        tone: 'neutral'
      });
    }
  }

  return results;
}

export function userAgentSummary(): string {
  return navigator.userAgent || 'User agent unavailable';
}
