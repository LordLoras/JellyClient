import type {
  PlaybackDiagnostics,
  PlaybackState
} from './contracts.js';

export type DiagnosticTone = 'good' | 'warning' | 'danger' | 'neutral';

export interface PlaybackVerdict {
  transport: string;
  transportTone: DiagnosticTone;
  source: string;
  sourceTone: DiagnosticTone;
  target: string;
  targetTone: DiagnosticTone;
  processing: string;
  processingTone: DiagnosticTone;
  pqOutputReported: boolean;
}

type SignalKind = 'pq' | 'hlg' | 'scrgb' | 'sdr' | 'unknown';

export function playbackVerdict(
  diagnostics: PlaybackDiagnostics
): PlaybackVerdict {
  const librarySignal = signalKind(diagnostics.mediaColorTransfer);
  const inputSignal = signalKind(
    diagnostics.colorTransfer ?? diagnostics.mediaColorTransfer
  );
  const targetSignal = signalKind(diagnostics.outputTransfer);

  const transport = transportVerdict(diagnostics.deliveryMode);
  const source = signalLabel(
    inputSignal,
    diagnostics.colorTransfer ?? diagnostics.mediaColorTransfer
  );
  const target = diagnostics.outputTransfer
    ? signalLabel(targetSignal, diagnostics.outputTransfer)
    : 'Waiting for MPV target';

  let processing = 'Waiting for MPV target colorspace';
  let processingTone: DiagnosticTone = 'neutral';

  if (
    diagnostics.deliveryMode === 'Transcode' &&
    isHdr(librarySignal) &&
    inputSignal === 'sdr'
  ) {
    processing = 'Server HDR → SDR conversion indicated';
    processingTone = 'danger';
  } else if (isHdr(inputSignal) && targetSignal === 'sdr') {
    processing = 'MPV HDR → SDR tone mapping indicated';
    processingTone = 'warning';
  } else if (isHdr(inputSignal) && isHdr(targetSignal)) {
    processing =
      diagnostics.hdrMode === 'passthrough'
        ? 'HDR retained · source metadata requested'
        : 'HDR target active · no SDR tone map';
    processingTone = 'good';
  } else if (inputSignal === 'sdr' && isHdr(targetSignal)) {
    processing = 'SDR adapted into the HDR display target';
    processingTone = 'warning';
  } else if (inputSignal === 'sdr' && targetSignal === 'sdr') {
    processing = 'SDR input and SDR target';
    processingTone = 'good';
  } else if (diagnostics.hdrMode === 'tone-map' && isHdr(inputSignal)) {
    processing = 'Forced SDR target requested; awaiting confirmation';
    processingTone = 'warning';
  }

  return {
    transport: transport.label,
    transportTone: transport.tone,
    source,
    sourceTone: isHdr(inputSignal)
      ? 'good'
      : inputSignal === 'unknown'
        ? 'neutral'
        : 'warning',
    target,
    targetTone: isHdr(targetSignal)
      ? 'good'
      : targetSignal === 'unknown'
        ? 'neutral'
        : 'warning',
    processing,
    processingTone,
    pqOutputReported: targetSignal === 'pq'
  };
}

export function buildPlaybackDebugReport(playback: PlaybackState): string {
  const verdict = playbackVerdict(playback.diagnostics);
  const report = {
    generatedAt: new Date().toISOString(),
    item: playback.item
      ? {
          id: playback.item.id,
          name: playback.item.name,
          type: playback.item.type
        }
      : null,
    playback: {
      status: playback.status,
      positionSeconds: playback.positionSeconds,
      durationSeconds: playback.durationSeconds,
      paused: playback.paused,
      buffering: playback.buffering
    },
    verdict: {
      transport: verdict.transport,
      source: verdict.source,
      displayTarget: verdict.target,
      processing: verdict.processing,
      pqOutputReportedByMpv: verdict.pqOutputReported
    },
    diagnostics: playback.diagnostics,
    selectedTracks: playback.tracks
      .filter((track) => track.selected)
      .map((track) => ({
        type: track.type,
        title: track.title,
        language: track.language,
        codec: track.codec,
        mpvTrackId: track.id,
        jellyfinStreamIndex: track.ffIndex
      }))
  };
  return JSON.stringify(report, null, 2);
}

function signalKind(transfer: string | null): SignalKind {
  const normalized = transfer?.toLowerCase().replace(/[\s_.-]/g, '') ?? '';
  if (
    normalized === 'pq' ||
    normalized.includes('smpte2084') ||
    normalized.includes('st2084')
  ) {
    return 'pq';
  }
  if (normalized === 'hlg' || normalized.includes('aribstdb67')) {
    return 'hlg';
  }
  if (normalized.includes('scrgb')) return 'scrgb';
  if (
    normalized.includes('bt1886') ||
    normalized.includes('bt709') ||
    normalized.includes('srgb') ||
    normalized.startsWith('gamma')
  ) {
    return 'sdr';
  }
  return 'unknown';
}

function signalLabel(kind: SignalKind, raw: string | null): string {
  if (kind === 'pq') return 'HDR10 / PQ';
  if (kind === 'hlg') return 'HDR / HLG';
  if (kind === 'scrgb') return 'HDR / scRGB';
  if (kind === 'sdr') return `SDR / ${raw ?? 'gamma'}`;
  return raw ? `Unknown / ${raw}` : 'Waiting for signal';
}

function isHdr(kind: SignalKind): boolean {
  return kind === 'pq' || kind === 'hlg' || kind === 'scrgb';
}

function transportVerdict(
  mode: PlaybackDiagnostics['deliveryMode']
): { label: string; tone: DiagnosticTone } {
  if (mode === 'DirectPlay') {
    return {
      label: 'Direct Play · original file',
      tone: 'good'
    };
  }
  if (mode === 'DirectStream') {
    return {
      label: 'Direct Stream · remux',
      tone: 'warning'
    };
  }
  if (mode === 'Transcode') {
    return {
      label: 'Server Transcode',
      tone: 'danger'
    };
  }
  return {
    label: 'Waiting for Jellyfin',
    tone: 'neutral'
  };
}
