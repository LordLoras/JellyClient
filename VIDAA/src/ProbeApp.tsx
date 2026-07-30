import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Expand,
  Gauge,
  Link2,
  ListVideo,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  collectCapabilities,
  collectDecodingCapabilities,
  userAgentSummary
} from './capabilities.js';
import { moveSpatialFocus } from './spatial-focus.js';
import type {
  CapabilityResult,
  PlaybackProbeSource,
  ProbeEvent,
  PublicProbePayload
} from './types.js';

interface PlaybackSnapshot {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  readyState: number;
  networkState: number;
  width: number;
  height: number;
  droppedFrames: number | null;
  totalFrames: number | null;
}

const INITIAL_SNAPSHOT: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  paused: true,
  muted: false,
  readyState: 0,
  networkState: 0,
  width: 0,
  height: 0,
  droppedFrames: null,
  totalFrames: null
};

const MEDIA_EVENTS = [
  'abort',
  'canplay',
  'canplaythrough',
  'durationchange',
  'emptied',
  'ended',
  'error',
  'loadeddata',
  'loadedmetadata',
  'loadstart',
  'pause',
  'playing',
  'ratechange',
  'resize',
  'seeked',
  'seeking',
  'stalled',
  'suspend',
  'waiting'
] as const;

function eventTone(name: string): ProbeEvent['tone'] {
  if (name === 'error' || name === 'abort') return 'error';
  if (name === 'waiting' || name === 'stalled') return 'warning';
  if (name === 'playing' || name === 'canplay') return 'good';
  return 'normal';
}

function timeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return [
    hours > 0 ? String(hours).padStart(2, '0') : null,
    String(minutes).padStart(2, '0'),
    String(remainder).padStart(2, '0')
  ].filter(Boolean).join(':');
}

function mediaError(video: HTMLVideoElement): string {
  const code = video.error?.code;
  const descriptions: Record<number, string> = {
    1: 'Playback aborted',
    2: 'Network error',
    3: 'Decode error',
    4: 'Source or format not supported'
  };
  return code ? `${descriptions[code] ?? 'Media error'} · code ${code}` : 'No media error';
}

function playbackDetail(video: HTMLVideoElement): string {
  const resolution = video.videoWidth > 0
    ? `${video.videoWidth}×${video.videoHeight}`
    : 'dimensions pending';
  return `${resolution} · ready ${video.readyState} · network ${video.networkState} · ${mediaError(video)}`;
}

function sourceTone(expected: PlaybackProbeSource['expected']): string {
  if (expected.startsWith('Dolby Vision')) return 'dovi';
  if (expected === 'HDR10') return 'hdr';
  if (expected === 'SDR') return 'sdr';
  return 'other';
}

export function ProbeApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nextEventId = useRef(1);
  const [payload, setPayload] = useState<PublicProbePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSource, setActiveSource] =
    useState<PlaybackProbeSource | null>(null);
  const [events, setEvents] = useState<ProbeEvent[]>([]);
  const [snapshot, setSnapshot] =
    useState<PlaybackSnapshot>(INITIAL_SNAPSHOT);
  const [manualUrl, setManualUrl] = useState(
    () => window.localStorage.getItem('vidaa-probe-url') ?? ''
  );
  const [staticCapabilities] = useState<CapabilityResult[]>(
    collectCapabilities
  );
  const [decodingCapabilities, setDecodingCapabilities] =
    useState<CapabilityResult[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(true);

  const appendEvent = useCallback((
    name: string,
    detail: string,
    tone: ProbeEvent['tone'] = eventTone(name)
  ) => {
    const now = new Date();
    setEvents((current) => [
      {
        id: nextEventId.current++,
        at: now.toLocaleTimeString([], {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        name,
        detail,
        tone
      },
      ...current
    ].slice(0, 40));
  }, []);

  const refreshSources = useCallback(async () => {
    try {
      const response = await fetch('/api/probe', {
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Probe server returned ${response.status}`);
      setPayload(await response.json() as PublicProbePayload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refreshSources();
    void collectDecodingCapabilities().then(setDecodingCapabilities);
  }, [refreshSources]);

  const readSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const quality = typeof video.getVideoPlaybackQuality === 'function'
      ? video.getVideoPlaybackQuality()
      : null;
    setSnapshot({
      currentTime: video.currentTime || 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      muted: video.muted,
      readyState: video.readyState,
      networkState: video.networkState,
      width: video.videoWidth,
      height: video.videoHeight,
      droppedFrames: quality?.droppedVideoFrames ?? null,
      totalFrames: quality?.totalVideoFrames ?? null
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const listeners = MEDIA_EVENTS.map((name) => {
      const listener = () => {
        appendEvent(name, playbackDetail(video));
        readSnapshot();
      };
      video.addEventListener(name, listener);
      return {
        name,
        listener
      };
    });
    const timer = window.setInterval(readSnapshot, 500);

    return () => {
      window.clearInterval(timer);
      listeners.forEach(({ name, listener }) =>
        video.removeEventListener(name, listener)
      );
    };
  }, [appendEvent, readSnapshot]);

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.src) return;
    try {
      await video.play();
    } catch (error) {
      appendEvent(
        'play rejected',
        error instanceof Error ? error.message : String(error),
        'error'
      );
    }
  }, [appendEvent]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    try {
      video.currentTime = 0;
    } catch {
      // Some platform players reject seeks before metadata is available.
    }
    appendEvent('stop requested', playbackDetail(video));
    readSnapshot();
  }, [appendEvent, readSnapshot]);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(
      0,
      Math.min(video.duration, video.currentTime + seconds)
    );
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    readSnapshot();
  }, [readSnapshot]);

  const toggleFullscreen = useCallback(async () => {
    const element = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const documentWithWebkit = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element | null;
    };
    try {
      if (document.fullscreenElement || documentWithWebkit.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await documentWithWebkit.webkitExitFullscreen?.();
      } else if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else {
        await element.webkitRequestFullscreen?.();
      }
    } catch (error) {
      appendEvent(
        'fullscreen rejected',
        error instanceof Error ? error.message : String(error),
        'warning'
      );
    }
  }, [appendEvent]);

  const loadSource = useCallback(async (source: PlaybackProbeSource) => {
    if (!source.playbackUrl) {
      appendEvent('source unavailable', source.detail, 'error');
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    setActiveSource(source);
    appendEvent(
      'source selected',
      `${source.label} · expected ${source.expected}`,
      'normal'
    );
    video.pause();
    video.src = source.playbackUrl;
    video.load();
    await play();
  }, [appendEvent, play]);

  const loadManualUrl = useCallback(async () => {
    const location = manualUrl.trim();
    if (!/^https?:\/\//i.test(location)) {
      appendEvent(
        'manual URL rejected',
        'Use a complete http:// or https:// media URL.',
        'error'
      );
      return;
    }
    window.localStorage.setItem('vidaa-probe-url', location);
    await loadSource({
      id: 'manual-url',
      label: 'Ad hoc URL',
      expected: 'Other',
      kind: 'url',
      notes: 'Entered directly on this device',
      playbackUrl: location,
      available: true,
      detail: new URL(location).host
    });
  }, [appendEvent, loadSource, manualUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      const keyCode = event.keyCode;

      if (!editing) {
        const directions: Record<string, 'up' | 'down' | 'left' | 'right'> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right'
        };
        const direction = directions[event.key];
        if (direction) {
          event.preventDefault();
          moveSpatialFocus(direction);
          return;
        }
      }

      if (event.key === 'MediaPlay' || keyCode === 415) {
        event.preventDefault();
        void play();
      } else if (event.key === 'MediaPause' || keyCode === 19) {
        event.preventDefault();
        pause();
      } else if (event.key === 'MediaStop' || keyCode === 413) {
        event.preventDefault();
        stop();
      } else if (event.key === 'MediaFastForward' || keyCode === 417) {
        event.preventDefault();
        seekBy(10);
      } else if (event.key === 'MediaRewind' || keyCode === 412) {
        event.preventDefault();
        seekBy(-10);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pause, play, seekBy, stop]);

  const capabilities = useMemo(
    () => [...staticCapabilities, ...decodingCapabilities],
    [decodingCapabilities, staticCapabilities]
  );
  const progress = snapshot.duration > 0
    ? snapshot.currentTime / snapshot.duration * 100
    : 0;
  const frameDropRate =
    snapshot.droppedFrames !== null &&
    snapshot.totalFrames !== null &&
    snapshot.totalFrames > 0
      ? snapshot.droppedFrames / snapshot.totalFrames * 100
      : null;

  return (
    <main className="probe-shell">
      <header className="probe-header">
        <div className="probe-brand">
          <span className="probe-brand__mark"><Activity /></span>
          <div>
            <p>JELLYCLIENT / DEVICE LAB</p>
            <h1>VIDAA signal probe</h1>
          </div>
        </div>
        <div className="probe-header__status">
          <span className="status-chip status-chip--firmware">
            FW {payload?.firmware ?? 'v01.09.60V.Q0618'}
          </span>
          <span className={`status-chip ${loadError ? 'status-chip--bad' : 'status-chip--good'}`}>
            <i /> {loadError ? 'SERVER OFFLINE' : 'LAN CONNECTED'}
          </span>
          <a
            className="icon-button"
            href="/setup"
            data-focusable
            aria-label="Open PC setup"
          >
            <Settings2 />
          </a>
        </div>
      </header>

      <section className="verification-banner">
        <Gauge />
        <div>
          <strong>Verify the television—not the browser label.</strong>
          <span>
            Start a source, then confirm the TV enters HDR10 or Dolby Vision
            picture mode. “Probably” only means the runtime accepts the codec string.
          </span>
        </div>
        <span className={`expected-signal expected-signal--${sourceTone(activeSource?.expected ?? 'Other')}`}>
          EXPECTED<br />
          <b>{activeSource?.expected ?? 'SELECT SOURCE'}</b>
        </span>
      </section>

      <div className={`probe-workspace${diagnosticsOpen ? '' : ' probe-workspace--wide'}`}>
        <section className="player-stage">
          <div className="video-frame">
            <video
              ref={videoRef}
              playsInline
              preload="metadata"
              aria-label="VIDAA test video"
            />
            {!activeSource && (
              <div className="video-empty">
                <ListVideo />
                <p>Choose a configured source below</p>
                <span>PC setup: <b>http://localhost:4173/setup</b></span>
              </div>
            )}
            {activeSource && (
              <div className="video-source-label">
                <span>{activeSource.expected}</span>
                <strong>{activeSource.label}</strong>
              </div>
            )}
            <div className="video-readout">
              <span>{snapshot.width > 0 ? `${snapshot.width} × ${snapshot.height}` : 'AWAITING VIDEO'}</span>
              <span>READY {snapshot.readyState}/4</span>
              <span>NETWORK {snapshot.networkState}</span>
            </div>
          </div>

          <div className="transport">
            <div className="transport__timeline">
              <span>{timeLabel(snapshot.currentTime)}</span>
              <input
                type="range"
                min="0"
                max="1000"
                value={Math.round(progress * 10)}
                data-focusable
                aria-label="Playback position"
                onChange={(event) => {
                  const video = videoRef.current;
                  if (!video || snapshot.duration <= 0) return;
                  video.currentTime =
                    Number(event.currentTarget.value) / 1000 * snapshot.duration;
                }}
              />
              <span>{timeLabel(snapshot.duration)}</span>
            </div>
            <div className="transport__buttons">
              <button data-focusable onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
                <SkipBack /><span>−10</span>
              </button>
              <button
                className="transport__primary"
                data-focusable
                onClick={() => snapshot.paused ? void play() : pause()}
                aria-label={snapshot.paused ? 'Play' : 'Pause'}
              >
                {snapshot.paused ? <Play /> : <Pause />}
              </button>
              <button data-focusable onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
                <SkipForward /><span>+10</span>
              </button>
              <button data-focusable onClick={stop} aria-label="Stop playback">
                <CircleStop />
              </button>
              <button data-focusable onClick={toggleMute} aria-label={snapshot.muted ? 'Unmute' : 'Mute'}>
                {snapshot.muted ? <VolumeX /> : <Volume2 />}
              </button>
              <button data-focusable onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen">
                <Expand />
              </button>
              <button
                data-focusable
                onClick={() => setDiagnosticsOpen((current) => !current)}
                aria-label="Toggle diagnostics"
              >
                {diagnosticsOpen ? <ChevronRight /> : <ChevronLeft />}
              </button>
            </div>
          </div>
        </section>

        {diagnosticsOpen && (
          <aside className="diagnostics-panel">
            <div className="diagnostics-panel__head">
              <div>
                <p>RUNTIME TELEMETRY</p>
                <h2>What the app can observe</h2>
              </div>
              <span className="pulse-dot" />
            </div>

            <div className="metric-grid">
              <article>
                <small>VIDEO</small>
                <strong>{snapshot.width > 0 ? `${snapshot.width}×${snapshot.height}` : '—'}</strong>
              </article>
              <article>
                <small>DROPPED</small>
                <strong>{snapshot.droppedFrames ?? '—'}</strong>
              </article>
              <article>
                <small>DROP RATE</small>
                <strong>{frameDropRate === null ? '—' : `${frameDropRate.toFixed(3)}%`}</strong>
              </article>
            </div>

            <div className="diagnostic-tabs">
              <span>CAPABILITIES</span>
              <span>EVENT STREAM</span>
            </div>

            <div className="diagnostics-scroll">
              <section className="capability-list">
                {capabilities.map((item) => (
                  <div key={`${item.label}-${item.value}`}>
                    <span>{item.label}</span>
                    <strong className={`tone-${item.tone}`}>{item.value}</strong>
                  </div>
                ))}
              </section>

              <section className="event-log">
                <header>
                  <span>Latest player events</span>
                  <button
                    data-focusable
                    onClick={() => setEvents([])}
                    aria-label="Clear event log"
                  >
                    CLEAR
                  </button>
                </header>
                {events.length === 0 ? (
                  <p className="event-log__empty">Events appear after a source is loaded.</p>
                ) : events.map((event) => (
                  <div className={`event-row event-row--${event.tone}`} key={event.id}>
                    <time>{event.at}</time>
                    <strong>{event.name}</strong>
                    <span>{event.detail}</span>
                  </div>
                ))}
              </section>
            </div>
          </aside>
        )}
      </div>

      <section className="source-deck">
        <header>
          <div>
            <p>TEST REEL</p>
            <h2>Configured media sources</h2>
          </div>
          <button data-focusable className="text-button" onClick={() => void refreshSources()}>
            <RefreshCw /> REFRESH
          </button>
        </header>

        {payload?.configError && (
          <div className="inline-error">{payload.configError}</div>
        )}
        {loadError && <div className="inline-error">{loadError}</div>}

        <div className="source-row">
          {(payload?.sources ?? []).map((source, index) => (
            <button
              key={source.id}
              className={`source-card source-card--${sourceTone(source.expected)}${activeSource?.id === source.id ? ' is-active' : ''}`}
              data-focusable
              disabled={!source.available}
              onClick={() => void loadSource(source)}
              autoFocus={index === 0}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{source.expected}</small>
                <strong>{source.label}</strong>
                <em>{source.detail}</em>
              </div>
              {source.kind === 'file' ? <Play /> : <Link2 />}
            </button>
          ))}

          {(payload?.sources.length ?? 0) === 0 && (
            <a className="source-card source-card--empty" href="/setup" data-focusable>
              <Settings2 />
              <div>
                <small>NO SOURCES YET</small>
                <strong>Open setup on the PC</strong>
                <em>localhost:4173/setup</em>
              </div>
              <ChevronRight />
            </a>
          )}
        </div>

        <form
          className="manual-source"
          onSubmit={(event) => {
            event.preventDefault();
            void loadManualUrl();
          }}
        >
          <Link2 />
          <label>
            <span>AD HOC MEDIA URL</span>
            <input
              data-focusable
              value={manualUrl}
              onChange={(event) => setManualUrl(event.currentTarget.value)}
              placeholder="http://server/path/video.mp4"
              inputMode="url"
            />
          </label>
          <button data-focusable type="submit">LOAD URL</button>
        </form>
      </section>

      <footer className="probe-footer">
        <span>{userAgentSummary()}</span>
        <span>Arrow keys move focus · Enter selects · Media keys control playback</span>
      </footer>
    </main>
  );
}
