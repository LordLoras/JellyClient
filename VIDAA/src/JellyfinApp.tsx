import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FastForward,
  Gauge,
  Languages,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  Server,
  Settings2,
  Square,
  Subtitles,
  UsersRound,
  Wifi
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { bridgeUrl } from './bridge-url.js';
import type {
  VidaaBridgeError,
  VidaaHomePayload,
  VidaaJellyfinSession,
  VidaaMediaItem,
  VidaaPlaybackOptions,
  VidaaPlaybackPlan,
  VidaaPlaybackReport,
  VidaaPlaybackRequest,
  VidaaTrackChoice
} from './jellyfin-types.js';
import { moveSpatialFocus } from './spatial-focus.js';
import {
  parseWebVtt,
  subtitleAtTime,
  type WebVttCue
} from './webvtt.js';

const TICKS_PER_SECOND = 10_000_000;

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(bridgeUrl(url), init);
  const value = await response.json() as T | VidaaBridgeError;
  if (!response.ok) {
    const bridgeError = value as VidaaBridgeError;
    throw new Error(bridgeError.error ?? `Request failed (${response.status}).`);
  }
  return value as T;
}

function duration(ticks: number | null): string | null {
  if (!ticks) return null;
  const minutes = Math.round(ticks / TICKS_PER_SECOND / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function signalBadges(item: VidaaMediaItem) {
  return [
    item.mediaFormat.resolution,
    item.mediaFormat.videoRange,
    item.mediaFormat.audio
  ].filter((value): value is string => Boolean(value));
}

function MediaTile({ item, onSelect }: { item: VidaaMediaItem; onSelect(item: VidaaMediaItem): void }) {
  const label = item.seriesName
    ? `${item.seriesName} · ${item.indexLabel ?? item.name}`
    : item.name;
  const content = (
    <>
      <div className="vida-tile__art">
        {item.imageUrl ? <img alt="" loading="lazy" src={bridgeUrl(item.imageUrl)} /> : <span>{item.name.slice(0, 1)}</span>}
        {item.playedPercentage > 0 && item.playedPercentage < 100 && (
          <i style={{ width: `${Math.max(3, item.playedPercentage)}%` }} />
        )}
        {item.canPlay && <b><Play /></b>}
      </div>
      <strong>{label}</strong>
      <small>{[item.productionYear, ...signalBadges(item).slice(0, 2)].filter(Boolean).join(' · ')}</small>
    </>
  );
  return item.canPlay ? (
    <button className="vida-tile" data-focusable onClick={() => onSelect(item)} type="button">{content}</button>
  ) : (
    <article className="vida-tile vida-tile--static">{content}</article>
  );
}

function MediaRail({ title, eyebrow, items, onSelect }: {
  title: string;
  eyebrow: string;
  items: VidaaMediaItem[];
  onSelect(item: VidaaMediaItem): void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="vida-rail">
      <header><div><p>{eyebrow}</p><h2>{title}</h2></div><span>{items.length} titles <ChevronRight /></span></header>
      <div className="vida-rail__track">
        {items.map((item) => <MediaTile item={item} key={item.id} onSelect={onSelect} />)}
      </div>
    </section>
  );
}

function TrackRow({ track, selected, disabled, onSelect }: {
  track: VidaaTrackChoice;
  selected: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  return (
    <button className={`track-choice${selected ? ' track-choice--selected' : ''}`} data-focusable disabled={disabled} onClick={onSelect} type="button">
      <span>{selected ? <Check /> : null}</span>
      <div><strong>{track.title}</strong><small>{[track.language?.toUpperCase(), track.codec?.toUpperCase(), track.channelLayout].filter(Boolean).join(' · ')}</small></div>
      {disabled && <em>PGS overlay later</em>}
    </button>
  );
}

function PlaybackSheet({ options, busy, error, onClose, onStart }: {
  options: VidaaPlaybackOptions;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onStart(request: VidaaPlaybackRequest): void;
}) {
  const [audioIndex, setAudioIndex] = useState<number | null>(options.defaultAudioIndex);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(options.defaultSubtitleIndex);
  return (
    <div className="track-sheet" role="dialog" aria-modal="true">
      <button aria-label="Close playback options" className="track-sheet__scrim" onClick={onClose} type="button" />
      <section>
        <header>
          <button className="round-button" data-focusable onClick={onClose} type="button"><ArrowLeft /></button>
          <div><p>PLAYBACK ROUTING</p><h2>{options.item.seriesName ?? options.item.name}</h2><span>{options.item.indexLabel ? `${options.item.indexLabel} · ` : ''}{options.item.name}</span></div>
          <i>{options.container?.toUpperCase() ?? 'VIDEO'}</i>
        </header>
        <div className="track-sheet__columns">
          <div>
            <h3><Languages /> Audio track</h3>
            {options.audioTracks.map((track) => <TrackRow key={track.index} onSelect={() => setAudioIndex(track.index)} selected={audioIndex === track.index} track={track} />)}
          </div>
          <div>
            <h3><Subtitles /> English subtitles</h3>
            <button className={`track-choice${subtitleIndex === null ? ' track-choice--selected' : ''}`} data-focusable onClick={() => setSubtitleIndex(null)} type="button"><span>{subtitleIndex === null ? <Check /> : null}</span><div><strong>Off</strong><small>No subtitle overlay</small></div></button>
            {options.subtitleTracks.map((track) => <TrackRow disabled={!track.isText} key={track.index} onSelect={() => setSubtitleIndex(track.index)} selected={subtitleIndex === track.index} track={track} />)}
          </div>
        </div>
        {error && <div className="player-error"><CircleAlert /> {error}</div>}
        <footer>
          <p>ASS/SSA text is requested as WebVTT for this first TV pass. Bitmap PGS rendering is the next subtitle milestone.</p>
          <button className="signal-button signal-button--primary" data-focusable disabled={busy} onClick={() => onStart({ mediaSourceId: options.mediaSourceId, startPositionTicks: options.item.playbackPositionTicks, audioStreamIndex: audioIndex, subtitleStreamIndex: subtitleIndex })} type="button"><Play /> {busy ? 'Negotiating…' : options.item.playbackPositionTicks > 0 ? 'Resume' : 'Play'}</button>
        </footer>
      </section>
    </div>
  );
}

function NativePlayer({ plan, onExit }: { plan: VidaaPlaybackPlan; onExit(): void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const stoppedRef = useRef(false);
  const controlsTimerRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [position, setPosition] = useState(plan.startPositionSeconds);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<WebVttCue[]>([]);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);

  function clearControlsTimer() {
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }

  function revealControls() {
    setControlsVisible(true);
    clearControlsTimer();
    const video = videoRef.current;
    if (!video || video.paused || video.error) return;
    controlsTimerRef.current = window.setTimeout(() => {
      const currentVideo = videoRef.current;
      if (currentVideo && !currentVideo.paused && !currentVideo.error) {
        setControlsVisible(false);
      }
      controlsTimerRef.current = null;
    }, 3_500);
  }

  function report(event: VidaaPlaybackReport['event']) {
    const video = videoRef.current;
    if (!video) return;
    void fetch(bridgeUrl('/api/vidaa/playback/report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        itemId: plan.item.id,
        mediaSourceId: plan.mediaSourceId,
        playSessionId: plan.playSessionId,
        playMethod: plan.playMethod,
        positionSeconds: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        muted: video.muted,
        volume: video.volume * 100
      } satisfies VidaaPlaybackReport)
    });
  }

  function stop() {
    if (!stoppedRef.current) {
      stoppedRef.current = true;
      report('stop');
    }
    onExit();
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!videoRef.current?.paused) report('progress');
    }, 10_000);
    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      revealControls();
      if (event.key === 'Escape' || event.keyCode === 413) stop();
      else if (event.key === 'Enter' || event.key === ' ' || event.keyCode === 415 || event.keyCode === 19) {
        if (video.paused) void video.play(); else video.pause();
      } else if (event.key === 'ArrowLeft' || event.keyCode === 412) video.currentTime = Math.max(0, video.currentTime - 10);
      else if (event.key === 'ArrowRight' || event.keyCode === 417) video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearInterval(timer);
      clearControlsTimer();
      window.removeEventListener('keydown', onKey);
      if (!stoppedRef.current) report('stop');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSubtitleCues([]);
    setSubtitleError(null);
    if (!plan.subtitleUrl) return;
    void fetch(bridgeUrl(plan.subtitleUrl))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Subtitle request failed (${response.status}).`);
        }
        return await response.text();
      })
      .then((contents) => {
        if (cancelled) return;
        const cues = parseWebVtt(contents);
        if (cues.length === 0) {
          throw new Error('The selected subtitle track contained no readable cues.');
        }
        setSubtitleCues(cues);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setSubtitleError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plan.subtitleUrl]);

  const seek = (amount: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + amount));
  };
  const activeSubtitle = subtitleAtTime(subtitleCues, position);
  return (
    <div
      className={`native-player${controlsVisible ? '' : ' native-player--controls-hidden'}`}
      onFocusCapture={revealControls}
      onMouseDown={revealControls}
      onMouseMove={revealControls}
    >
      <video
        autoPlay
        onDurationChange={(event) => setTotal(event.currentTarget.duration || 0)}
        onEnded={stop}
        onError={() => {
          clearControlsTimer();
          setControlsVisible(true);
          setError('VIDAA could not open this negotiated stream. Check the delivery details below.');
        }}
        onLoadedMetadata={(event) => {
          if (plan.startPositionSeconds > 1) event.currentTarget.currentTime = plan.startPositionSeconds;
        }}
        onPause={() => {
          clearControlsTimer();
          setControlsVisible(true);
          setPaused(true);
          if (startedRef.current) report('progress');
        }}
        onPlay={() => {
          setPaused(false);
          revealControls();
          if (!startedRef.current) { startedRef.current = true; report('start'); }
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        playsInline
        ref={videoRef}
        src={bridgeUrl(plan.mediaUrl)}
      >
      </video>
      {(activeSubtitle || subtitleError) && (
        <div
          aria-live="off"
          className={`native-player__subtitles${controlsVisible ? ' native-player__subtitles--raised' : ''}`}
        >
          {activeSubtitle || subtitleError}
        </div>
      )}
      <div className="native-player__shade" />
      <header><div><p>{plan.item.seriesName ?? plan.item.type}</p><h1>{plan.item.name}</h1></div><button className="signal-button signal-button--quiet" data-focusable onClick={stop} type="button"><Square /> Stop</button></header>
      <aside>
        <span><Gauge /> {plan.playMethod}{plan.videoIsCopy ? ' · video copy' : ''}</span>
        <span>{plan.container?.toUpperCase() ?? 'STREAM'}</span>
        <span>{plan.videoCodec?.toUpperCase() ?? 'VIDEO'}</span>
        <span>{plan.videoRange ?? 'SDR'}</span>
        <span>{plan.audioCodec?.toUpperCase() ?? 'AUDIO'} {plan.audioLayout}</span>
      </aside>
      <footer>
        {error && <div className="player-error"><CircleAlert /> {error}</div>}
        <input aria-label="Playback position" max={Math.max(total, 1)} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} type="range" value={Math.min(position, Math.max(total, 1))} />
        <div className="native-player__controls">
          <span>{duration(position * TICKS_PER_SECOND) ?? '0m'}</span>
          <button data-focusable onClick={() => seek(-10)} type="button"><Rewind /> 10</button>
          <button className="native-player__play" data-focusable onClick={() => { const video = videoRef.current; if (video?.paused) void video.play(); else video?.pause(); }} type="button">{paused ? <Play /> : <Pause />}</button>
          <button data-focusable onClick={() => seek(10)} type="button"><FastForward /> 10</button>
          <span>{duration(total * TICKS_PER_SECOND) ?? '—'}</span>
        </div>
      </footer>
    </div>
  );
}

export function JellyfinApp() {
  const [session, setSession] = useState<VidaaJellyfinSession | null>(null);
  const [home, setHome] = useState<VidaaHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<VidaaPlaybackOptions | null>(null);
  const [plan, setPlan] = useState<VidaaPlaybackPlan | null>(null);
  const [negotiating, setNegotiating] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const nextSession = await apiJson<VidaaJellyfinSession>('/api/vidaa/session');
      setSession(nextSession);
      if (nextSession.connected) setHome(await apiJson<VidaaHomePayload>('/api/vidaa/home'));
      else setHome(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (plan) return;
      const direction = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right'
      }[event.key] as 'up' | 'down' | 'left' | 'right' | undefined;
      if (direction) {
        moveSpatialFocus(direction);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [plan]);

  const hero = useMemo(() => home?.resume[0] ?? home?.nextUp[0] ?? home?.latest.find((item) => item.canPlay) ?? null, [home]);

  async function choose(item: VidaaMediaItem) {
    setError(null);
    try {
      setOptions(await apiJson<VidaaPlaybackOptions>(`/api/vidaa/items/${encodeURIComponent(item.id)}/playback-options`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function start(request: VidaaPlaybackRequest) {
    if (!options) return;
    setNegotiating(true);
    setError(null);
    try {
      const nextPlan = await apiJson<VidaaPlaybackPlan>(`/api/vidaa/items/${encodeURIComponent(options.item.id)}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      setOptions(null);
      setPlan(nextPlan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setNegotiating(false);
    }
  }

  if (plan) return <NativePlayer onExit={() => { setPlan(null); void refresh(); }} plan={plan} />;
  return (
    <main className="vidaa-home">
      <header className="vidaa-topbar">
        <a className="vidaa-wordmark" href="/"><span>J</span><div><p>JELLYCLIENT</p><strong>VIDAA</strong></div></a>
        <nav>
          <span><Wifi /> {session?.connected ? session.serverName : 'OFFLINE'}</span>
          <button data-focusable onClick={() => void refresh()} type="button"><RefreshCw /> Refresh</button>
          <a data-focusable href="/probe"><Gauge /> Signal probe</a>
          <a data-focusable href="/connect"><Settings2 /> Setup</a>
        </nav>
      </header>

      {loading && <section className="vidaa-empty"><div className="loading-orbit" /><p>Opening your Jellyfin library…</p></section>}
      {!loading && !session?.connected && (
        <section className="vidaa-empty vidaa-empty--connect">
          <Server />
          <p>ONE-TIME PC SETUP</p>
          <h1>Connect Jellyfin on this computer.</h1>
          <span>Open <b>http://localhost/connect</b> on the PC. The television will refresh into your library without receiving the password.</span>
          <button className="signal-button signal-button--primary" data-focusable onClick={() => void refresh()} type="button"><RefreshCw /> Check connection</button>
        </section>
      )}
      {!loading && error && <div className="vidaa-global-error"><CircleAlert /> <span>{error}</span></div>}
      {!loading && home && hero && (
        <>
          <section className="vidaa-hero" style={hero.backdropUrl ? { backgroundImage: `linear-gradient(90deg, rgba(7,10,9,.98) 0%, rgba(7,10,9,.78) 40%, rgba(7,10,9,.2) 78%), url("${bridgeUrl(hero.backdropUrl)}")` } : undefined}>
            <div>
              <p>{hero.playbackPositionTicks > 0 ? 'CONTINUE WATCHING' : hero.seriesName ? 'YOUR NEXT EPISODE' : 'FEATURED FROM JELLYFIN'}</p>
              <h1>{hero.seriesName ?? hero.name}</h1>
              {hero.seriesName && <h2>{hero.indexLabel} · {hero.name}</h2>}
              <ul><li>{hero.productionYear}</li><li><Clock3 /> {duration(hero.runtimeTicks)}</li>{signalBadges(hero).map((badge) => <li className="format-pill" key={badge}>{badge}</li>)}</ul>
              <p className="vidaa-hero__overview">{hero.overview}</p>
              <div className="vidaa-hero__actions"><button className="signal-button signal-button--primary" data-focusable onClick={() => void choose(hero)} type="button"><Play /> {hero.playbackPositionTicks > 0 ? 'Resume' : 'Play'}</button><button className="signal-button signal-button--quiet" data-focusable type="button"><UsersRound /> SyncPlay next</button></div>
            </div>
          </section>
          <div className="vidaa-content">
            <MediaRail eyebrow="PICK UP WHERE YOU LEFT OFF" items={home.resume} onSelect={(item) => void choose(item)} title="Continue watching" />
            <MediaRail eyebrow="NEW EPISODES WAITING" items={home.nextUp} onSelect={(item) => void choose(item)} title="Up next" />
            <MediaRail eyebrow="FRESH FROM YOUR SERVER" items={home.latest} onSelect={(item) => void choose(item)} title="Recently added" />
            <section className="library-strip"><p>YOUR LIBRARIES</p><div>{home.libraries.map((library) => <span key={library.id}>{library.name}</span>)}</div></section>
          </div>
        </>
      )}
      {options && <PlaybackSheet busy={negotiating} error={error} onClose={() => setOptions(null)} onStart={(request) => void start(request)} options={options} />}
    </main>
  );
}
