import {
  Captions,
  ChevronDown,
  Gauge,
  Maximize2,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX
} from 'lucide-react';
import {
  useState,
  type ChangeEvent
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
  const [showTracks, setShowTracks] = useState<'audio' | 'subtitle' | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  if (!playback.item || playback.status === 'idle') return null;

  const progress =
    playback.durationSeconds > 0
      ? (playback.positionSeconds / playback.durationSeconds) * 100
      : 0;
  const audioTracks = playback.tracks.filter((track) => track.type === 'audio');
  const subtitleTracks = playback.tracks.filter((track) => track.type === 'subtitle');

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    const position =
      (Number(event.target.value) / 100) * playback.durationSeconds;
    onAction({ type: 'seek', positionSeconds: position });
  };

  return (
    <aside className="player-dock">
      <div className="player-dock__progress">
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
          <span className="player-dock__time">
            {formatDuration(playback.positionSeconds)}
            <i>/</i>
            {formatDuration(playback.durationSeconds)}
          </span>
        </div>

        <div className="player-dock__tools">
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
