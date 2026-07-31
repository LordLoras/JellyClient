import { describe, expect, it } from 'vitest';
import type { PlaybackDiagnostics } from './contracts.js';
import {
  initialPlaybackDiagnostics,
  initialPlaybackState
} from './defaults.js';
import {
  buildPlaybackDebugReport,
  playbackVerdict
} from './playback-diagnostics.js';

function diagnostics(
  patch: Partial<PlaybackDiagnostics>
): PlaybackDiagnostics {
  return {
    ...initialPlaybackDiagnostics,
    ...patch
  };
}

describe('playbackVerdict', () => {
  it('identifies direct-play PQ output without an SDR tone map', () => {
    const result = playbackVerdict(diagnostics({
      deliveryMode: 'DirectPlay',
      colorTransfer: 'pq',
      outputTransfer: 'pq'
    }));

    expect(result.transport).toContain('Direct Play');
    expect(result.processing).toContain('no SDR tone map');
    expect(result.pqOutputReported).toBe(true);
  });

  it('identifies MPV HDR to SDR tone mapping', () => {
    const result = playbackVerdict(diagnostics({
      colorTransfer: 'pq',
      outputTransfer: 'gamma2.2'
    }));

    expect(result.processing).toContain('MPV HDR → SDR');
    expect(result.pqOutputReported).toBe(false);
  });

  it('distinguishes a server-side HDR transcode', () => {
    const result = playbackVerdict(diagnostics({
      deliveryMode: 'Transcode',
      mediaColorTransfer: 'smpte2084',
      colorTransfer: 'bt.709',
      outputTransfer: 'bt.1886'
    }));

    expect(result.processing).toContain('Server HDR → SDR');
  });

  it('reports SDR adaptation into a PQ desktop target', () => {
    const result = playbackVerdict(diagnostics({
      colorTransfer: 'bt.1886',
      outputTransfer: 'pq'
    }));

    expect(result.processing).toContain('SDR adapted');
    expect(result.pqOutputReported).toBe(true);
  });

  it('includes the actionable playback error in a copied debug report', () => {
    const report = JSON.parse(buildPlaybackDebugReport({
      ...structuredClone(initialPlaybackState),
      status: 'error',
      error: 'MPV could not play this item: loading failed'
    })) as { playback: { error: string } };

    expect(report.playback.error).toBe(
      'MPV could not play this item: loading failed'
    );
  });
});
