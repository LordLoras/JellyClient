import {
  Activity,
  Check,
  Copy,
  Cpu,
  Gauge,
  MonitorUp,
  Server,
  X
} from 'lucide-react';
import { useState } from 'react';
import type {
  PlaybackState
} from '@shared/contracts.js';
import {
  buildPlaybackDebugReport,
  playbackVerdict,
  type DiagnosticTone
} from '@shared/playback-diagnostics.js';

interface Props {
  playback: PlaybackState;
  onClose(): void;
  onAction(
    action: Parameters<typeof window.jellyClient.playbackAction>[0]
  ): void;
}

export function PlaybackDiagnosticsPanel({
  playback,
  onClose,
  onAction
}: Props) {
  const [copied, setCopied] = useState(false);
  const diagnostics = playback.diagnostics;
  const verdict = playbackVerdict(diagnostics);

  const copyReport = async () => {
    await window.jellyClient.copyDebugReport(
      buildPlaybackDebugReport(playback)
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="diagnostics" aria-label="Playback diagnostics">
      <header className="diagnostics__header">
        <div>
          <span><Gauge /> Live signal inspector</span>
          <small>Jellyfin transport → MPV input → display target</small>
        </div>
        <nav aria-label="Diagnostic actions">
          <button
            className="diagnostics__action"
            onClick={() => onAction({ type: 'toggle-stats' })}
          >
            <Activity /> MPV overlay
          </button>
          <button className="diagnostics__action" onClick={() => void copyReport()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy report'}
          </button>
          <button
            className="diagnostics__close"
            onClick={onClose}
            aria-label="Close diagnostics"
          >
            <X />
          </button>
        </nav>
      </header>

      <div className="signal-verdicts">
        <Verdict
          step="01"
          label="Jellyfin transport"
          value={verdict.transport}
          tone={verdict.transportTone}
        />
        <Verdict
          step="02"
          label="MPV input stream"
          value={verdict.source}
          tone={verdict.sourceTone}
        />
        <Verdict
          step="03"
          label="Display target"
          value={verdict.target}
          tone={verdict.targetTone}
        />
        <Verdict
          step="04"
          label="Color processing"
          value={verdict.processing}
          tone={verdict.processingTone}
        />
      </div>

      <div
        className={
          verdict.pqOutputReported
            ? 'pq-verdict pq-verdict--confirmed'
            : 'pq-verdict'
        }
      >
        <i>{verdict.pqOutputReported ? <Check /> : <MonitorUp />}</i>
        <span>
          <strong>
            {verdict.pqOutputReported
              ? 'PQ output target reported by MPV'
              : 'PQ output target not currently reported'}
          </strong>
          <small>
            This reads MPV’s video-target-params. Confirm the TV’s HDR badge
            separately because Windows, the driver, HDMI, and the TV remain
            downstream of MPV.
          </small>
        </span>
      </div>

      <div className="diagnostic-columns">
        <DiagnosticGroup icon={<Server />} title="Source + transport">
          <Fact label="Delivery" value={diagnostics.deliveryMode} accent />
          <Fact label="Container" value={diagnostics.container} />
          <Fact label="Source bitrate" value={formatBitrate(diagnostics.sourceBitrate)} />
          <Fact
            label="Video"
            value={[
              diagnostics.videoCodec,
              diagnostics.videoProfile,
              diagnostics.videoBitDepth
                ? `${diagnostics.videoBitDepth}-bit`
                : null
            ].filter(Boolean).join(' · ')}
          />
          <Fact label="Frame" value={diagnostics.videoParams} />
          <Fact label="Jellyfin transfer" value={diagnostics.mediaColorTransfer} signal />
          <Fact label="Jellyfin primaries" value={diagnostics.mediaColorPrimaries} />
          <Fact label="Jellyfin matrix" value={diagnostics.mediaColorMatrix} />
        </DiagnosticGroup>

        <DiagnosticGroup icon={<Activity />} title="Decoded signal">
          <Fact label="Pixel format" value={diagnostics.sourcePixelFormat} />
          <Fact label="Transfer" value={diagnostics.colorTransfer} signal />
          <Fact label="Primaries" value={diagnostics.colorPrimaries} signal />
          <Fact label="Matrix" value={diagnostics.colorMatrix} />
          <Fact label="Levels" value={diagnostics.colorLevels} />
          <Fact label="Light type" value={diagnostics.lightType} />
          <Fact
            label="Mastering luminance"
            value={formatRange(
              diagnostics.masteringMinLuminance,
              diagnostics.masteringMaxLuminance,
              'nits'
            )}
          />
          <Fact
            label="MaxCLL / MaxFALL"
            value={formatPair(diagnostics.maxCll, diagnostics.maxFall, 'nits')}
          />
        </DiagnosticGroup>

        <DiagnosticGroup icon={<MonitorUp />} title="Display target">
          <Fact label="Transfer" value={diagnostics.outputTransfer} signal />
          <Fact label="Primaries" value={diagnostics.outputPrimaries} signal />
          <Fact label="Matrix" value={diagnostics.outputMatrix} />
          <Fact label="Levels" value={diagnostics.outputLevels} />
          <Fact label="Pixel format" value={diagnostics.outputPixelFormat} />
          <Fact
            label="Target luminance"
            value={formatRange(
              diagnostics.outputMinLuminance,
              diagnostics.outputMaxLuminance,
              'nits'
            )}
          />
          <Fact
            label="Windows display"
            value={diagnostics.displayNames.join(', ')}
          />
          <Fact
            label="Estimated refresh"
            value={
              diagnostics.displayFps
                ? `${diagnostics.displayFps.toFixed(3)} Hz`
                : null
            }
          />
        </DiagnosticGroup>

        <DiagnosticGroup icon={<Cpu />} title="Render path">
          <Fact label="HDR mode" value={diagnostics.hdrMode} accent />
          <Fact label="Target policy" value={diagnostics.targetPolicy} />
          <Fact
            label="Colorspace hint"
            value={[diagnostics.colorHint, diagnostics.colorHintMode]
              .filter(Boolean)
              .join(' · ')}
          />
          <Fact label="Tone mapper" value={diagnostics.toneMapping} />
          <Fact
            label="GPU"
            value={`${diagnostics.gpuApi} · ${diagnostics.gpuContext}`}
          />
          <Fact label="Video output" value={diagnostics.currentVo} />
          <Fact label="Hardware decode" value={diagnostics.hwdec} />
          <Fact label="MPV" value={diagnostics.mpvVersion} />
          <Fact
            label="Dropped / cache"
            value={`${diagnostics.droppedFrames} frames · ${diagnostics.cacheDurationSeconds.toFixed(1)} s`}
          />
        </DiagnosticGroup>

        <DiagnosticGroup icon={<Gauge />} title="Audio path" compact>
          <Fact
            label="Source audio"
            value={[
              diagnostics.audioCodec,
              diagnostics.audioChannels,
              diagnostics.audioSampleRate
                ? `${diagnostics.audioSampleRate} Hz`
                : null
            ].filter(Boolean).join(' · ')}
          />
          <Fact
            label="Windows output"
            value={[
              diagnostics.audioOutputFormat,
              diagnostics.audioOutputChannels,
              diagnostics.audioOutputSampleRate
                ? `${diagnostics.audioOutputSampleRate} Hz`
                : null
            ].filter(Boolean).join(' · ')}
          />
        </DiagnosticGroup>
      </div>

      {diagnostics.reason && (
        <footer className="diagnostics__reason">
          <strong>Why this path?</strong>
          <span>{diagnostics.reason}</span>
        </footer>
      )}
    </section>
  );
}

function Verdict({
  step,
  label,
  value,
  tone
}: {
  step: string;
  label: string;
  value: string;
  tone: DiagnosticTone;
}) {
  return (
    <article className={`signal-verdict signal-verdict--${tone}`}>
      <small>{step} · {label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function DiagnosticGroup({
  icon,
  title,
  compact = false,
  children
}: {
  icon: React.ReactNode;
  title: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        compact
          ? 'diagnostic-group diagnostic-group--compact'
          : 'diagnostic-group'
      }
    >
      <header>{icon}<span>{title}</span></header>
      <div>{children}</div>
    </section>
  );
}

function Fact({
  label,
  value,
  accent = false,
  signal = false
}: {
  label: string;
  value: string | number | null | undefined;
  accent?: boolean;
  signal?: boolean;
}) {
  const rendered = value === null || value === undefined || value === ''
    ? 'Waiting'
    : String(value);
  return (
    <span
      className={[
        'diagnostic-fact',
        accent ? 'diagnostic-fact--accent' : '',
        signal ? 'diagnostic-fact--signal' : ''
      ].filter(Boolean).join(' ')}
    >
      <small>{label}</small>
      <strong title={rendered}>{rendered}</strong>
    </span>
  );
}

function formatBitrate(value: number | null): string | null {
  if (!value) return null;
  return `${(value / 1_000_000).toFixed(1)} Mbps`;
}

function formatRange(
  minimum: number | null,
  maximum: number | null,
  unit: string
): string | null {
  if (minimum === null && maximum === null) return null;
  return `${minimum ?? '?'}–${maximum ?? '?'} ${unit}`;
}

function formatPair(
  first: number | null,
  second: number | null,
  unit: string
): string | null {
  if (first === null && second === null) return null;
  return `${first ?? '?'} / ${second ?? '?'} ${unit}`;
}
