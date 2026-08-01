import {
  Captions,
  ChevronDown,
  Gauge,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
  StepBack,
  StepForward,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react';
import {
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent
} from 'react';
import type {
  PlaybackState,
  SyncPlayState
} from '@shared/contracts.js';
import { formatDuration } from '../format';
import { PlaybackDiagnosticsPanel } from './PlaybackDiagnosticsPanel';

interface Props {
  playback: PlaybackState;
  syncPlay: SyncPlayState;
  onAction(action: Parameters<typeof window.jellyClient.playbackAction>[0]): void;
}

export function PlayerDock({ playback, syncPlay, onAction }: Props) {
  const [showTracks, setShowTracks] = useState<'audio' | 'subtitle' | 'playback' | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [scrub, setScrub] = useState<{ percent: number; seconds: number } | null>(null);
  if (
    !playback.item ||
    playback.status === 'idle' ||
    playback.status === 'stopped'
  ) return null;

  const progress =
    playback.durationSeconds > 0
      ? (playback.positionSeconds / playback.durationSeconds) * 100
      : 0;
  const audioTracks = playback.tracks.filter((track) => track.type === 'audio');
  const subtitleTracks = playback.tracks.filter((track) => track.type === 'subtitle');
  const trickplay = playback.trickplay[0] ?? null;
  const preview = scrub && trickplay
    ? trickplayFrame(trickplay, scrub.seconds)
    : null;

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const position =
      (Number(event.target.value) / 100) * playback.durationSeconds;
    onAction({ type: 'seek', positionSeconds: position });
  };

  return (
    <aside className="player-dock">
      {playback.status === 'error' ? (
        <div className="player-dock__error" role="alert">
          <span><strong>Playback stopped</strong><small>{playback.error ?? 'MPV stopped unexpectedly.'}</small></span>
          <button className="button button--primary" onClick={() => onAction({ type: 'retry' })}><RefreshCw /> Retry</button>
        </div>
      ) : null}
      {playback.nextItem && playback.postPlaySecondsRemaining !== null && !playback.postPlayCanceled && (
        <div className="post-play-card">
          {playback.nextItem.imageUrl && <img src={playback.nextItem.imageUrl} alt="" />}
          <span>
            <small>UP NEXT · {playback.postPlaySecondsRemaining}s</small>
            <strong>{playback.nextItem.seriesName ?? playback.nextItem.name}</strong>
            {playback.nextItem.seriesName && <em>{playback.nextItem.indexLabel} · {playback.nextItem.name}</em>}
          </span>
          <button className="button button--primary" onClick={() => onAction({ type: 'play-next' })}>Play now</button>
          <button className="button button--glass" onClick={() => onAction({ type: 'cancel-post-play' })}>Cancel</button>
        </div>
      )}
      <div
        className="player-dock__progress"
        onMouseLeave={() => setScrub(null)}
        onMouseMove={(event: MouseEvent<HTMLDivElement>) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const percent = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
          setScrub({ percent, seconds: percent * playback.durationSeconds });
        }}
      >
        {preview && scrub && (
          <div className="scrub-preview" style={{ left: `${scrub.percent * 100}%` }}>
            <i style={preview.style} />
            <span>{formatDuration(scrub.seconds)}</span>
          </div>
        )}
        <input
          aria-label="Playback position"
          type="range"
          min={0}
          max={100}
          step={0.05}
          value={progress}
          onChange={seek}
        />
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="player-dock__inner">
        <div className="player-dock__identity">
          <span className="player-dock__thumb">
            {playback.item.imageUrl ? <img src={playback.item.imageUrl} alt="" /> : playback.item.name.slice(0, 1)}
          </span>
          <span>
            <strong>{playback.item.name}</strong>
            <small>
              {syncPlay.currentGroup
                ? `In sync · ${syncPlay.currentGroup.name}`
                : `${playback.diagnostics.deliveryMode} · native MPV window`}
            </small>
          </span>
        </div>

        <div className="player-dock__transport">
          {playback.chapters.length > 0 && (
            <button
              className="dock-icon dock-icon--small"
              disabled={(playback.currentChapterIndex ?? 0) <= 0}
              onClick={() => onAction({
                type: 'chapter',
                index: Math.max(0, (playback.currentChapterIndex ?? 0) - 1)
              })}
              aria-label="Previous chapter"
            ><StepBack /></button>
          )}
          <button
            className="dock-icon"
            onClick={() => onAction({ type: playback.paused ? 'play' : 'pause' })}
            aria-label={playback.paused ? 'Play' : 'Pause'}
          >
            {playback.paused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
          </button>
          <button className="dock-icon dock-icon--small" onClick={() => onAction({ type: 'stop' })} aria-label="Stop">
            <Square fill="currentColor" />
          </button>
          {playback.chapters.length > 0 && (
            <button
              className="dock-icon dock-icon--small"
              disabled={(playback.currentChapterIndex ?? 0) >= playback.chapters.length - 1}
              onClick={() => onAction({
                type: 'chapter',
                index: Math.min(
                  playback.chapters.length - 1,
                  (playback.currentChapterIndex ?? 0) + 1
                )
              })}
              aria-label="Next chapter"
            ><StepForward /></button>
          )}
          <span className="player-dock__time">
            {formatDuration(playback.positionSeconds)}
            <i>/</i>
            {formatDuration(playback.durationSeconds)}
          </span>
        </div>

        <div className="player-dock__tools">
          <div className="dock-popover-wrap">
            <button
              className={`dock-tool${showTracks === 'playback' ? ' is-active' : ''}`}
              onClick={() => setShowTracks(showTracks === 'playback' ? null : 'playback')}
            >
              <SlidersHorizontal /><span>{playback.speed}×</span><ChevronDown />
            </button>
            {showTracks === 'playback' && (
              <div className="dock-popover dock-popover--controls">
                <strong>Playback</strong>
                <label>
                  <span>Speed</span>
                  <select
                    value={playback.speed}
                    onChange={(event) => onAction({ type: 'speed', speed: Number(event.target.value) })}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                      <option value={speed} key={speed}>{speed}×</option>
                    ))}
                  </select>
                </label>
                <DelayControl
                  label="Subtitles"
                  value={playback.subtitleDelaySeconds}
                  onChange={(seconds) => onAction({ type: 'subtitle-delay', seconds })}
                />
                <DelayControl
                  label="Audio"
                  value={playback.audioDelaySeconds}
                  onChange={(seconds) => onAction({ type: 'audio-delay', seconds })}
                />
                {playback.chapters.length > 0 && (
                  <div className="dock-chapters">
                    <span>Chapters</span>
                    {playback.chapters.map((chapter, index) => (
                      <button
                        className={playback.currentChapterIndex === index ? 'is-selected' : ''}
                        key={`${chapter.startTicks}-${chapter.name}`}
                        onClick={() => onAction({ type: 'chapter', index })}
                      >{chapter.name || `Chapter ${index + 1}`}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="dock-popover-wrap">
            <button
              className={`dock-tool${showTracks === 'audio' ? ' is-active' : ''}`}
              onClick={() => setShowTracks(showTracks === 'audio' ? null : 'audio')}
            >
              <Volume2 /><span>Audio</span><ChevronDown />
            </button>
            {showTracks === 'audio' && (
              <div className="dock-popover">
                <strong>Audio tracks</strong>
                {audioTracks.map((track) => (
                  <button
                    key={track.id}
                    className={track.selected ? 'is-selected' : ''}
                    onClick={() => {
                      onAction({ type: 'select-track', trackType: 'audio', id: track.id });
                      setShowTracks(null);
                    }}
                  >
                    <span>{track.title}</span><small>{track.language ?? 'und'} · {track.codec ?? 'unknown'}</small>
                  </button>
                ))}
                {audioTracks.length === 0 && <p>Tracks appear after MPV loads the file.</p>}
              </div>
            )}
          </div>

          <div className="dock-popover-wrap">
            <button
              className={`dock-tool${showTracks === 'subtitle' ? ' is-active' : ''}`}
              onClick={() => setShowTracks(showTracks === 'subtitle' ? null : 'subtitle')}
            >
              <Captions /><span>Subtitles</span><ChevronDown />
            </button>
            {showTracks === 'subtitle' && (
              <div className="dock-popover">
                <strong>Subtitle tracks</strong>
                <button
                  className={!subtitleTracks.some((track) => track.selected) ? 'is-selected' : ''}
                  onClick={() => {
                    onAction({ type: 'select-track', trackType: 'subtitle', id: null });
                    setShowTracks(null);
                  }}
                >
                  <span>Off</span>
                </button>
                {subtitleTracks.map((track) => (
                  <button
                    key={track.id}
                    className={track.selected ? 'is-selected' : ''}
                    onClick={() => {
                      onAction({ type: 'select-track', trackType: 'subtitle', id: track.id });
                      setShowTracks(null);
                    }}
                  >
                    <span>{track.title}</span><small>{track.language ?? 'und'} · {track.codec ?? 'unknown'}{track.forced ? ' · forced' : ''}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className={`dock-tool dock-tool--icon${showDiagnostics ? ' is-active' : ''}`} onClick={() => setShowDiagnostics((value) => !value)} aria-label="Diagnostics">
            <Gauge />
          </button>
          <button
            className="dock-tool dock-tool--icon"
            onClick={() => onAction({ type: 'mute', muted: !playback.muted })}
            aria-label={playback.muted ? 'Unmute' : 'Mute'}
          >
            {playback.muted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            className="dock-volume"
            aria-label="Volume"
            type="range"
            min={0}
            max={100}
            value={playback.volume}
            onChange={(event) => onAction({ type: 'volume', volume: Number(event.target.value) })}
          />
          <button
            className="dock-tool dock-tool--icon"
            onClick={() => onAction({ type: 'fullscreen', fullscreen: !playback.fullscreen })}
            aria-label="Toggle fullscreen"
          >
            <Maximize2 />
          </button>
        </div>
      </div>

      {showDiagnostics && (
        <PlaybackDiagnosticsPanel
          playback={playback}
          onClose={() => setShowDiagnostics(false)}
          onAction={onAction}
        />
      )}
    </aside>
  );
}

function trickplayFrame(
  track: PlaybackState['trickplay'][number],
  seconds: number
): { style: CSSProperties } {
  const frame = Math.min(
    Math.max(0, track.thumbnailCount - 1),
    Math.floor((seconds * 1_000) / track.intervalMs)
  );
  const framesPerTile = track.tileWidth * track.tileHeight;
  const tile = Math.floor(frame / framesPerTile);
  const withinTile = frame % framesPerTile;
  const column = withinTile % track.tileWidth;
  const row = Math.floor(withinTile / track.tileWidth);
  return {
    style: {
      width: track.width,
      height: track.height,
      backgroundImage: `url("${track.tileUrlTemplate.replace('{index}', String(tile))}")`,
      backgroundSize: `${track.tileWidth * 100}% ${track.tileHeight * 100}%`,
      backgroundPosition: `${track.tileWidth > 1 ? (column / (track.tileWidth - 1)) * 100 : 0}% ${track.tileHeight > 1 ? (row / (track.tileHeight - 1)) * 100 : 0}%`
    }
  };
}

function DelayControl({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}) {
  const step = (amount: number) => onChange(
    Math.round((value + amount) * 10) / 10
  );
  return (
    <div className="delay-control">
      <span>{label}</span>
      <button onClick={() => step(-0.1)} aria-label={`Decrease ${label.toLowerCase()} delay`}>−</button>
      <b>{value > 0 ? '+' : ''}{value.toFixed(1)} s</b>
      <button onClick={() => step(0.1)} aria-label={`Increase ${label.toLowerCase()} delay`}>+</button>
    </div>
  );
}
