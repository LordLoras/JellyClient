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
  RotateCcw,
  Save,
  Server,
  Settings2,
  Square,
  Subtitles,
  Wifi
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  bridgeUrl,
  pcUrl
} from './bridge-url.js';
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
  DEFAULT_VIDAA_PLAYER_SETTINGS,
  loadPlayerSettings,
  preferredPlaybackTracks,
  savePlayerSettings,
  type VidaaPlayerSettings
} from './player-settings.js';
import {
  parseWebVtt,
  subtitleAtTime,
  type WebVttCue
} from './webvtt.js';
import {
  activeSkipSegment,
  skipSegmentLabel,
  type SkipSegment
} from '../../src/shared/skip-segments.js';

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

function ChoiceGroup<T extends string | number>({ label, value, choices, onChange }: {
  label: string;
  value: T;
  choices: Array<{ value: T; label: string }>;
  onChange(value: T): void;
}) {
  return (
    <div className="settings-choice">
      <span>{label}</span>
      <div>
        {choices.map((choice) => (
          <button
            className={choice.value === value ? 'is-selected' : ''}
            data-focusable
            key={choice.value}
            onClick={() => onChange(choice.value)}
            type="button"
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsSheet({ settings, onClose, onSave }: {
  settings: VidaaPlayerSettings;
  onClose(): void;
  onSave(settings: VidaaPlayerSettings): void;
}) {
  const [draft, setDraft] = useState(settings);
  const update = <K extends keyof VidaaPlayerSettings>(
    key: K,
    value: VidaaPlayerSettings[K]
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="track-sheet settings-sheet" role="dialog" aria-modal="true">
      <button aria-label="Dismiss settings" className="track-sheet__scrim" onClick={onClose} type="button" />
      <section>
        <header>
          <button aria-label="Close settings" className="round-button" data-focusable onClick={onClose} type="button"><ArrowLeft /></button>
          <div>
            <p>TV PLAYER PREFERENCES</p>
            <h2>Playback settings</h2>
            <span>Stored locally in this television browser.</span>
          </div>
          <i>VIDAA</i>
        </header>
        <div className="settings-sheet__grid">
          <section>
            <h3><Languages /> Default tracks</h3>
            <label className="settings-select">
              <span>Preferred audio</span>
              <select
                data-focusable
                onChange={(event) => update('preferredAudioLanguage', event.target.value)}
                value={draft.preferredAudioLanguage}
              >
                <option value="">Media default</option>
                <option value="eng">English</option>
                <option value="bul">Bulgarian</option>
                <option value="jpn">Japanese</option>
                <option value="deu">German</option>
                <option value="fra">French</option>
                <option value="spa">Spanish</option>
              </select>
            </label>
            <label className="settings-select">
              <span>Preferred subtitles</span>
              <select
                data-focusable
                onChange={(event) => update('preferredSubtitleLanguage', event.target.value)}
                value={draft.preferredSubtitleLanguage}
              >
                <option value="eng">English</option>
                <option value="bul">Bulgarian</option>
                <option value="jpn">Japanese</option>
                <option value="deu">German</option>
                <option value="fra">French</option>
                <option value="spa">Spanish</option>
              </select>
            </label>
            <button
              className={`settings-toggle${draft.subtitlesEnabled ? ' is-selected' : ''}`}
              data-focusable
              onClick={() => update('subtitlesEnabled', !draft.subtitlesEnabled)}
              type="button"
            >
              <span>{draft.subtitlesEnabled ? <Check /> : null}</span>
              <div>
                <strong>Subtitles by default</strong>
                <small>{draft.subtitlesEnabled ? 'Choose the preferred text track when available.' : 'Start playback with subtitles off.'}</small>
              </div>
            </button>
          </section>
          <section>
            <h3><Subtitles /> Subtitle appearance</h3>
            <ChoiceGroup
              choices={[
                { value: 'small', label: 'Small' },
                { value: 'standard', label: 'Standard' },
                { value: 'large', label: 'Large' },
                { value: 'extra-large', label: 'Extra large' }
              ]}
              label="Size"
              onChange={(value) => update('subtitleSize', value)}
              value={draft.subtitleSize}
            />
            <ChoiceGroup
              choices={[
                { value: 'white', label: 'White' },
                { value: 'yellow', label: 'Yellow' }
              ]}
              label="Text color"
              onChange={(value) => update('subtitleColor', value)}
              value={draft.subtitleColor}
            />
            <ChoiceGroup
              choices={[
                { value: 'shadow', label: 'Shadow' },
                { value: 'soft', label: 'Soft panel' },
                { value: 'solid', label: 'Solid panel' }
              ]}
              label="Background"
              onChange={(value) => update('subtitleBackground', value)}
              value={draft.subtitleBackground}
            />
            <ChoiceGroup
              choices={[
                { value: 'lower', label: 'Lower' },
                { value: 'higher', label: 'Higher' }
              ]}
              label="Position"
              onChange={(value) => update('subtitlePosition', value)}
              value={draft.subtitlePosition}
            />
          </section>
          <section>
            <h3><Settings2 /> Remote controls</h3>
            <ChoiceGroup
              choices={[
                { value: 10, label: '10 seconds' },
                { value: 30, label: '30 seconds' },
                { value: 60, label: '60 seconds' }
              ]}
              label="Seek interval"
              onChange={(value) => update('seekSeconds', value)}
              value={draft.seekSeconds}
            />
            <ChoiceGroup
              choices={[
                { value: 3.5, label: '3.5 seconds' },
                { value: 6, label: '6 seconds' },
                { value: 10, label: '10 seconds' },
                { value: 0, label: 'Never' }
              ]}
              label="Hide controls"
              onChange={(value) => update('controlTimeoutSeconds', value)}
              value={draft.controlTimeoutSeconds}
            />
            <div className="subtitle-preview">
              <p>PREVIEW</p>
              <div className={`subtitle-sample subtitle-sample--${draft.subtitleSize} subtitle-sample--${draft.subtitleColor} subtitle-sample--${draft.subtitleBackground}`}>
                Picture and dialogue, the way you like them.
              </div>
            </div>
          </section>
        </div>
        <footer>
          <button className="signal-button signal-button--quiet" data-focusable onClick={() => setDraft({ ...DEFAULT_VIDAA_PLAYER_SETTINGS })} type="button"><RotateCcw /> Restore defaults</button>
          <button className="signal-button signal-button--primary" data-focusable onClick={() => onSave(draft)} type="button"><Save /> Save settings</button>
        </footer>
      </section>
    </div>
  );
}

function PlaybackSheet({ options, settings, busy, error, onClose, onStart }: {
  options: VidaaPlaybackOptions;
  settings: VidaaPlayerSettings;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onStart(request: VidaaPlaybackRequest): void;
}) {
  const preferred = preferredPlaybackTracks(options, settings);
  const [audioIndex, setAudioIndex] = useState<number | null>(preferred.audioStreamIndex);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(preferred.subtitleStreamIndex);
  return (
    <div className="track-sheet" role="dialog" aria-modal="true">
      <button aria-label="Dismiss playback options" className="track-sheet__scrim" onClick={onClose} type="button" />
      <section>
        <header>
          <button aria-label="Close playback options" className="round-button" data-focusable onClick={onClose} type="button"><ArrowLeft /></button>
          <div><p>PLAYBACK ROUTING</p><h2>{options.item.seriesName ?? options.item.name}</h2><span>{options.item.indexLabel ? `${options.item.indexLabel} · ` : ''}{options.item.name}</span></div>
          <i>{options.container?.toUpperCase() ?? 'VIDEO'}</i>
        </header>
        <div className="track-sheet__columns">
          <div>
            <h3><Languages /> Audio track</h3>
            {options.audioTracks.map((track) => <TrackRow key={track.index} onSelect={() => setAudioIndex(track.index)} selected={audioIndex === track.index} track={track} />)}
          </div>
          <div>
            <h3><Subtitles /> Subtitles</h3>
            <button className={`track-choice${subtitleIndex === null ? ' track-choice--selected' : ''}`} data-focusable onClick={() => setSubtitleIndex(null)} type="button"><span>{subtitleIndex === null ? <Check /> : null}</span><div><strong>Off</strong><small>No subtitle overlay</small></div></button>
            {options.subtitleTracks.map((track) => <TrackRow disabled={!track.isText} key={track.index} onSelect={() => setSubtitleIndex(track.index)} selected={subtitleIndex === track.index} track={track} />)}
          </div>
        </div>
        {error && <div className="player-error"><CircleAlert /> {error}</div>}
        <footer>
          <p>Text, ASS, and SSA tracks are rendered by JellyClient. Bitmap PGS tracks are listed but cannot be selected yet.</p>
          <button className="signal-button signal-button--primary" data-focusable disabled={busy} onClick={() => onStart({ mediaSourceId: options.mediaSourceId, startPositionTicks: options.item.playbackPositionTicks, audioStreamIndex: audioIndex, subtitleStreamIndex: subtitleIndex })} type="button"><Play /> {busy ? 'Negotiating…' : options.item.playbackPositionTicks > 0 ? 'Resume' : 'Play'}</button>
        </footer>
      </section>
    </div>
  );
}

function PlayerOptionsSheet({ options, audioIndex, subtitleIndex, busy, error, onAudio, onSubtitle, onSettings, onClose }: {
  options: VidaaPlaybackOptions;
  audioIndex: number | null;
  subtitleIndex: number | null;
  busy: boolean;
  error: string | null;
  onAudio(index: number): void;
  onSubtitle(index: number | null): void;
  onSettings(): void;
  onClose(): void;
}) {
  return (
    <div className="track-sheet player-options-sheet" role="dialog" aria-modal="true">
      <button aria-label="Dismiss player options" className="track-sheet__scrim" onClick={onClose} type="button" />
      <section>
        <header>
          <button aria-label="Close player options" className="round-button" data-focusable onClick={onClose} type="button"><ArrowLeft /></button>
          <div>
            <p>PLAYING NOW</p>
            <h2>Audio &amp; subtitles</h2>
            <span>Change tracks without leaving the player.</span>
          </div>
          <i>LIVE</i>
        </header>
        <div className="track-sheet__columns">
          <div>
            <h3><Languages /> Audio track</h3>
            {options.audioTracks.map((track) => (
              <TrackRow
                disabled={busy}
                key={track.index}
                onSelect={() => onAudio(track.index)}
                selected={audioIndex === track.index}
                track={track}
              />
            ))}
          </div>
          <div>
            <h3><Subtitles /> Subtitles</h3>
            <button className={`track-choice${subtitleIndex === null ? ' track-choice--selected' : ''}`} data-focusable onClick={() => onSubtitle(null)} type="button">
              <span>{subtitleIndex === null ? <Check /> : null}</span>
              <div><strong>Off</strong><small>Hide the subtitle overlay</small></div>
            </button>
            {options.subtitleTracks.map((track) => (
              <TrackRow
                disabled={!track.isText}
                key={track.index}
                onSelect={() => onSubtitle(track.index)}
                selected={subtitleIndex === track.index}
                track={track}
              />
            ))}
          </div>
        </div>
        {error && <div className="player-error"><CircleAlert /> {error}</div>}
        <footer>
          <p>Subtitle changes are immediate. Changing embedded audio asks Jellyfin for a new stream and resumes at the current position.</p>
          <div className="track-sheet__actions">
            <button className="signal-button signal-button--quiet" data-focusable onClick={onSettings} type="button"><Settings2 /> Subtitle appearance</button>
            <button className="signal-button signal-button--primary" data-focusable onClick={onClose} type="button"><Check /> Done</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function NativePlayer({ plan, options, settings, onPlanChange, onSettingsChange, onExit }: {
  plan: VidaaPlaybackPlan;
  options: VidaaPlaybackOptions;
  settings: VidaaPlayerSettings;
  onPlanChange(plan: VidaaPlaybackPlan): void;
  onSettingsChange(settings: VidaaPlayerSettings): void;
  onExit(): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const planRef = useRef(plan);
  const startedRef = useRef(false);
  const stoppedRef = useRef(false);
  const controlsTimerRef = useRef<number | null>(null);
  const activeSkipSegmentRef = useRef<SkipSegment | null>(null);
  const [paused, setPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [position, setPosition] = useState(plan.startPositionSeconds);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<'tracks' | 'settings' | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [audioIndex, setAudioIndex] = useState(plan.audioStreamIndex);
  const [subtitleIndex, setSubtitleIndex] = useState(plan.subtitleStreamIndex);
  const [subtitleUrl, setSubtitleUrl] = useState(plan.subtitleUrl);
  const [subtitleCues, setSubtitleCues] = useState<WebVttCue[]>([]);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [dismissedSegmentIds, setDismissedSegmentIds] = useState<Set<string>>(
    () => new Set()
  );

  planRef.current = plan;

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
    if (
      !video ||
      video.paused ||
      video.error ||
      menu ||
      settings.controlTimeoutSeconds === 0
    ) return;
    controlsTimerRef.current = window.setTimeout(() => {
      const currentVideo = videoRef.current;
      if (currentVideo && !currentVideo.paused && !currentVideo.error) {
        setControlsVisible(false);
      }
      controlsTimerRef.current = null;
    }, settings.controlTimeoutSeconds * 1_000);
  }

  function report(event: VidaaPlaybackReport['event']) {
    const video = videoRef.current;
    if (!video) return;
    const activePlan = planRef.current;
    void fetch(bridgeUrl('/api/vidaa/playback/report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        itemId: activePlan.item.id,
        mediaSourceId: activePlan.mediaSourceId,
        playSessionId: activePlan.playSessionId,
        playMethod: activePlan.playMethod,
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

  function skipCurrentSegment() {
    const video = videoRef.current;
    const segment = activeSkipSegmentRef.current;
    if (!video || !segment) return;
    const targetSeconds = segment.endTicks / TICKS_PER_SECOND;
    video.currentTime = Math.min(video.duration || Infinity, targetSeconds);
    setPosition(targetSeconds);
    setDismissedSegmentIds((current) => {
      const next = new Set(current);
      next.add(segment.id);
      return next;
    });
    report('progress');
  }

  useEffect(() => {
    setAudioIndex(plan.audioStreamIndex);
    setSubtitleIndex(plan.subtitleStreamIndex);
    setSubtitleUrl(plan.subtitleUrl);
    setError(null);
  }, [plan]);

  useEffect(() => {
    setDismissedSegmentIds(new Set());
  }, [plan.item.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!videoRef.current?.paused) report('progress');
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      clearControlsTimer();
      if (!stoppedRef.current) report('stop');
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      revealControls();
      if (menu) {
        if (event.key === 'Escape' || event.keyCode === 413) {
          setMenu(null);
          event.preventDefault();
          return;
        }
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
        return;
      }
      if (event.key.toLowerCase() === 'n' && activeSkipSegmentRef.current) {
        skipCurrentSegment();
      } else if (event.key === 'Escape' || event.keyCode === 413) stop();
      else if (event.key === 'Enter' || event.key === ' ' || event.keyCode === 415 || event.keyCode === 19) {
        if (video.paused) void video.play(); else video.pause();
      } else if (event.key === 'ArrowLeft' || event.keyCode === 412) {
        video.currentTime = Math.max(0, video.currentTime - settings.seekSeconds);
      } else if (event.key === 'ArrowRight' || event.keyCode === 417) {
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + settings.seekSeconds
        );
      }
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, settings.seekSeconds, settings.controlTimeoutSeconds]);

  useEffect(() => {
    let cancelled = false;
    setSubtitleCues([]);
    setSubtitleError(null);
    if (!subtitleUrl) return;
    void fetch(bridgeUrl(subtitleUrl))
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
  }, [subtitleUrl]);

  async function changeAudio(nextAudioIndex: number) {
    if (nextAudioIndex === audioIndex || trackBusy) return;
    const video = videoRef.current;
    if (!video) return;
    const activePlan = planRef.current;
    setTrackBusy(true);
    setError(null);
    try {
      const nextPlan = await apiJson<VidaaPlaybackPlan>(
        `/api/vidaa/items/${encodeURIComponent(activePlan.item.id)}/play`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mediaSourceId: activePlan.mediaSourceId,
            startPositionTicks: Math.round(video.currentTime * TICKS_PER_SECOND),
            audioStreamIndex: nextAudioIndex,
            subtitleStreamIndex: subtitleIndex
          } satisfies VidaaPlaybackRequest)
        }
      );
      report('stop');
      startedRef.current = false;
      setAudioIndex(nextAudioIndex);
      onPlanChange(nextPlan);
      setMenu(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTrackBusy(false);
    }
  }

  function changeSubtitle(nextSubtitleIndex: number | null) {
    const selected = options.subtitleTracks.find(
      (track) => track.index === nextSubtitleIndex
    );
    if (selected && !selected.isText) return;
    setSubtitleIndex(nextSubtitleIndex);
    setSubtitleUrl(nextSubtitleIndex === null
      ? null
      : `/api/vidaa/subtitles/${encodeURIComponent(plan.item.id)}/${encodeURIComponent(plan.mediaSourceId)}/${nextSubtitleIndex}.vtt`
    );
  }

  const seek = (amount: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || Infinity, video.currentTime + amount));
  };
  const activeSubtitle = subtitleAtTime(subtitleCues, position);
  const activeSegment = activeSkipSegment(
    plan.segments,
    position,
    dismissedSegmentIds
  );
  activeSkipSegmentRef.current = activeSegment;
  const playerClasses = [
    'native-player',
    controlsVisible || menu ? '' : 'native-player--controls-hidden',
    `native-player--subtitle-${settings.subtitleSize}`,
    `native-player--subtitle-${settings.subtitleColor}`,
    `native-player--subtitle-${settings.subtitleBackground}`,
    `native-player--subtitle-${settings.subtitlePosition}`
  ].filter(Boolean).join(' ');
  return (
    <div
      className={playerClasses}
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
      {activeSubtitle && (
        <div
          aria-live="off"
          className={`native-player__subtitles${controlsVisible ? ' native-player__subtitles--raised' : ''}`}
        >
          <span>{activeSubtitle}</span>
        </div>
      )}
      {activeSegment && !menu && (
        <button
          aria-label={`${skipSegmentLabel(activeSegment.type)}. Press N.`}
          className="native-player__skip"
          onClick={skipCurrentSegment}
          type="button"
        >
          <span>{skipSegmentLabel(activeSegment.type)}</span>
          <kbd>N</kbd>
        </button>
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
        {(error || subtitleError) && <div className="player-error"><CircleAlert /> {error || subtitleError}</div>}
        <input aria-label="Playback position" max={Math.max(total, 1)} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} type="range" value={Math.min(position, Math.max(total, 1))} />
        <div className="native-player__controls">
          <span>{duration(position * TICKS_PER_SECOND) ?? '0m'}</span>
          <button data-focusable onClick={() => seek(-settings.seekSeconds)} type="button"><Rewind /> {settings.seekSeconds}</button>
          <button className="native-player__play" data-focusable onClick={() => { const video = videoRef.current; if (video?.paused) void video.play(); else video?.pause(); }} type="button">{paused ? <Play /> : <Pause />}</button>
          <button data-focusable onClick={() => seek(settings.seekSeconds)} type="button"><FastForward /> {settings.seekSeconds}</button>
          <button className="native-player__options" data-focusable onClick={() => { setMenu('tracks'); setControlsVisible(true); clearControlsTimer(); }} type="button"><Languages /> Audio &amp; subtitles</button>
          <span>{duration(total * TICKS_PER_SECOND) ?? '—'}</span>
        </div>
      </footer>
      {menu === 'tracks' && (
        <PlayerOptionsSheet
          audioIndex={audioIndex}
          busy={trackBusy}
          error={error}
          onAudio={(index) => void changeAudio(index)}
          onClose={() => setMenu(null)}
          onSettings={() => setMenu('settings')}
          onSubtitle={changeSubtitle}
          options={options}
          subtitleIndex={subtitleIndex}
        />
      )}
      {menu === 'settings' && (
        <SettingsSheet
          onClose={() => setMenu('tracks')}
          onSave={(nextSettings) => {
            onSettingsChange(nextSettings);
            setMenu('tracks');
          }}
          settings={settings}
        />
      )}
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<VidaaPlayerSettings>(
    loadPlayerSettings
  );
  const connectUrl = pcUrl('/connect');

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
      setPlan(nextPlan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setNegotiating(false);
    }
  }

  function updateSettings(nextSettings: VidaaPlayerSettings) {
    savePlayerSettings(nextSettings);
    setSettings(nextSettings);
    setSettingsOpen(false);
  }

  if (plan && options) {
    return (
      <NativePlayer
        onExit={() => {
          setPlan(null);
          setOptions(null);
          void refresh();
        }}
        onPlanChange={setPlan}
        onSettingsChange={updateSettings}
        options={options}
        plan={plan}
        settings={settings}
      />
    );
  }
  return (
    <main className="vidaa-home">
      <header className="vidaa-topbar">
        <a className="vidaa-wordmark" href="/"><span>J</span><div><p>JELLYCLIENT</p><strong>VIDAA</strong></div></a>
        <nav>
          <span><Wifi /> {session?.connected ? session.serverName : 'OFFLINE'}</span>
          <button data-focusable onClick={() => void refresh()} type="button"><RefreshCw /> Refresh</button>
          <a data-focusable href="/probe"><Gauge /> Signal probe</a>
          <button data-focusable onClick={() => setSettingsOpen(true)} type="button"><Settings2 /> Settings</button>
        </nav>
      </header>

      {loading && <section className="vidaa-empty"><div className="loading-orbit" /><p>Opening your Jellyfin library…</p></section>}
      {!loading && !session?.connected && (
        <section className="vidaa-empty vidaa-empty--connect">
          <Server />
          <p>ONE-TIME PC SETUP</p>
          <h1>Connect Jellyfin on this computer.</h1>
          <span>Open <b>{connectUrl}</b> on the PC. The television will refresh into your library without receiving the password.</span>
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
              <div className="vidaa-hero__actions"><button className="signal-button signal-button--primary" data-focusable onClick={() => void choose(hero)} type="button"><Play /> {hero.playbackPositionTicks > 0 ? 'Resume' : 'Play'}</button></div>
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
      {options && <PlaybackSheet busy={negotiating} error={error} onClose={() => setOptions(null)} onStart={(request) => void start(request)} options={options} settings={settings} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} onSave={updateSettings} settings={settings} />}
    </main>
  );
}
