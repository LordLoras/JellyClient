import {
  Accessibility,
  ArrowDown,
  ArrowUp,
  Captions,
  ExternalLink,
  FileCog,
  FolderOpen,
  Gauge,
  Eye,
  EyeOff,
  MonitorUp,
  RefreshCw,
  Rows3,
  Save,
  ShieldCheck,
  Volume2
} from 'lucide-react';
import {
  useEffect,
  useState
} from 'react';
import type { CSSProperties } from 'react';
import type {
  AppSettings,
  HomeSectionId,
  MpvAudioDevice,
  MpvCapability,
  PlayerSettings,
  WindowsDisplay
} from '@shared/contracts.js';
import { friendlyError } from '../format';

const HOME_SECTION_LABELS: Record<HomeSectionId, string> = {
  resume: 'Continue watching',
  nextUp: 'Up next',
  favorites: 'My List',
  recentlyPlayed: 'Recently watched',
  recommended: 'Recommended',
  latest: 'Recently added',
  libraries: 'Libraries'
};

interface Props {
  settings: AppSettings;
  mpv: MpvCapability;
  configPath: string;
  onSaved(settings: AppSettings, mpv: MpvCapability): void;
  onMpvChanged(mpv: MpvCapability): void;
  onNotice(level: 'info' | 'error', message: string): void;
}

export function SettingsPage({
  settings,
  mpv,
  configPath,
  onSaved,
  onMpvChanged,
  onNotice
}: Props) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MpvAudioDevice[]>([]);
  const [audioDevicesBusy, setAudioDevicesBusy] = useState(false);
  const [audioDevicesError, setAudioDevicesError] = useState<string | null>(null);
  const [displays, setDisplays] = useState<WindowsDisplay[]>([]);
  const [recordingSkipShortcut, setRecordingSkipShortcut] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    let cancelled = false;
    if (!mpv.available) {
      setAudioDevices([]);
      return;
    }
    setAudioDevicesBusy(true);
    setAudioDevicesError(null);
    void window.jellyClient.listAudioDevices()
      .then((devices) => {
        if (!cancelled) setAudioDevices(devices);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAudioDevicesError(friendlyError(error));
      })
      .finally(() => {
        if (!cancelled) setAudioDevicesBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mpv.available, mpv.executablePath]);
  useEffect(() => {
    let cancelled = false;
    void window.jellyClient.listDisplays()
      .then((value) => {
        if (!cancelled) setDisplays(value);
      })
      .catch(() => {
        if (!cancelled) setDisplays([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAudioDevices = async () => {
    setAudioDevicesBusy(true);
    setAudioDevicesError(null);
    try {
      setAudioDevices(await window.jellyClient.listAudioDevices());
    } catch (error) {
      setAudioDevicesError(friendlyError(error));
    } finally {
      setAudioDevicesBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const saved = await window.jellyClient.saveSettings(draft);
      const capability = await window.jellyClient.probeMpv();
      onSaved(saved, capability);
      onNotice('info', 'Playback settings saved.');
    } catch (error) {
      onNotice('error', friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseMpv = async () => {
    setBusy(true);
    try {
      const capability = await window.jellyClient.chooseMpv();
      const next = {
        ...draft,
        player: {
          ...draft.player,
          mpvPath: capability.executablePath ?? draft.player.mpvPath
        }
      };
      setDraft(next);
      onMpvChanged(capability);
    } catch (error) {
      onNotice('error', friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const moveHomeSection = (id: HomeSectionId, direction: -1 | 1) => {
    const order = [...draft.home.sectionOrder];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    setDraft({ ...draft, home: { ...draft.home, sectionOrder: order } });
  };

  const toggleHomeSection = (id: HomeSectionId) => {
    const hidden = draft.home.hiddenSections.includes(id)
      ? draft.home.hiddenSections.filter((candidate) => candidate !== id)
      : [...draft.home.hiddenSections, id];
    setDraft({ ...draft, home: { ...draft.home, hiddenSections: hidden } });
  };

  return (
    <div className="settings-page page-pad">
      <header className="page-title">
        <p className="eyebrow">PLAYBACK SETTINGS</p>
        <h1>Settings</h1>
        <p>Saved defaults apply to the current player where supported and every new video.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card settings-card--wide">
          <header>
            <span className="icon-plate"><MonitorUp /></span>
            <div><h2>MPV + HDR output</h2><p>The player owns the Windows swapchain.</p></div>
          </header>
          <label className="field">
            <span>MPV executable</span>
            <div className="inline-field">
              <input
                value={draft.player.mpvPath}
                onChange={(event) => setDraft({
                  ...draft,
                  player: { ...draft.player, mpvPath: event.target.value }
                })}
                placeholder="Select mpv.exe"
              />
              <button className="button button--glass" onClick={chooseMpv}>
                <FolderOpen /> Browse
              </button>
            </div>
          </label>
          <div className={`capability ${mpv.available ? 'capability--ok' : 'capability--missing'}`}>
            <i>{mpv.available ? <ShieldCheck /> : <ExternalLink />}</i>
            <span>
              <strong>{mpv.available ? 'MPV ready' : 'MPV required'}</strong>
              <small>{mpv.version ?? mpv.error}</small>
            </span>
          </div>
          <div className="settings-columns">
            <label className="field">
              <span>HDR behavior</span>
              <select
                value={draft.player.hdrMode}
                onChange={(event) => setDraft({
                  ...draft,
                  player: {
                    ...draft.player,
                    hdrMode: event.target.value as AppSettings['player']['hdrMode']
                  }
                })}
              >
                <option value="auto">Automatic HDR10 passthrough</option>
                <option value="passthrough">Force passthrough intent</option>
                <option value="tone-map">Tone-map to SDR</option>
              </select>
            </label>
            <label className="field">
              <span>GPU API</span>
              <select
                value={draft.player.gpuApi}
                onChange={(event) => setDraft({
                  ...draft,
                  player: {
                    ...draft.player,
                    gpuApi: event.target.value as AppSettings['player']['gpuApi']
                  }
                })}
              >
                <option value="d3d11">D3D11 · recommended</option>
                <option value="vulkan">Vulkan / winvk fallback</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Preferred display</span>
            <select
              value={draft.player.preferredDisplayId}
              onChange={(event) => setDraft({
                ...draft,
                player: { ...draft.player, preferredDisplayId: event.target.value }
              })}
            >
              <option value="auto">Current display / move manually</option>
              {displays.map((display) => (
                <option value={display.id} key={display.id}>
                  {display.name} · {display.width}×{display.height}{display.primary ? ' · primary' : ''}
                </option>
              ))}
            </select>
            <small>Automatic HDR follows MPV on the display where its window is shown. Choose a display only when playback should always open there.</small>
          </label>
          <div className="toggle-stack">
            <Toggle
              label="Hardware decoding"
              detail="Use auto-safe hardware decoding."
              checked={draft.player.hardwareDecoding}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, hardwareDecoding: value }
              })}
            />
            <Toggle
              label="Start fullscreen"
              detail="Open the separate MPV window fullscreen on the TV."
              checked={draft.player.fullscreenOnPlay}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, fullscreenOnPlay: value }
              })}
            />
            <Toggle
              label="Always on top"
              detail="Keep the player above the catalog window."
              checked={draft.player.alwaysOnTop}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, alwaysOnTop: value }
              })}
            />
          </div>
        </section>

        <section className="settings-card">
          <header>
            <span className="icon-plate"><FileCog /></span>
            <div><h2>Configuration</h2><p>Human-readable, secret-free settings.</p></div>
          </header>
          <code className="config-path">{configPath}</code>
          <p className="settings-note">
            The server IP, port, base path, username, and player settings live
            here. Passwords never do. A Windows-encrypted token is stored beside
            this file when “Remember session” is enabled.
          </p>
          <button className="button button--glass button--wide" onClick={() => window.jellyClient.openConfigFolder()}>
            <FolderOpen /> Open configuration folder
          </button>
        </section>

        <section className="settings-card subtitle-settings">
          <header>
            <span className="icon-plate"><Captions /></span>
            <div><h2>Language preferences</h2><p>Default audio and subtitle selection.</p></div>
          </header>
          <label className="field">
            <span>Preferred audio language</span>
            <LanguageSelect
              value={draft.player.preferredAudioLanguage}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, preferredAudioLanguage: value }
              })}
            />
          </label>
          <Toggle
            label="Automatically enable subtitles"
            detail="Choose the preferred language when playback starts."
            checked={draft.player.autoEnableSubtitles}
            onChange={(value) => setDraft({
              ...draft,
              player: { ...draft.player, autoEnableSubtitles: value }
            })}
          />
          <label className="field">
            <span>Preferred language</span>
            <LanguageSelect
              value={draft.player.preferredSubtitleLanguage}
              disabled={!draft.player.autoEnableSubtitles}
              onChange={(value) => setDraft({
                ...draft,
                player: {
                  ...draft.player,
                  preferredSubtitleLanguage: value
                }
              })}
            />
          </label>
          <Toggle
            label="Prefer forced subtitles"
            detail="Choose a matching forced track when one is available."
            checked={draft.player.preferForcedSubtitles}
            onChange={(value) => setDraft({
              ...draft,
              player: { ...draft.player, preferForcedSubtitles: value }
            })}
          />
          <Toggle
            label="Avoid SDH subtitles"
            detail="Prefer a standard subtitle track over SDH or closed captions."
            checked={draft.player.avoidSdhSubtitles}
            onChange={(value) => setDraft({
              ...draft,
              player: { ...draft.player, avoidSdhSubtitles: value }
            })}
          />
          <Toggle
            label="Remember each series"
            detail="Reuse manually selected audio and subtitle languages for later episodes."
            checked={draft.player.rememberSeriesPreferences}
            onChange={(value) => setDraft({
              ...draft,
              player: { ...draft.player, rememberSeriesPreferences: value }
            })}
          />
          <p className="settings-note settings-note--signal">
            No matching language means subtitles stay off. A manual track
            choice in the player always wins for the current video.
          </p>
        </section>

        <section className="settings-card settings-card--full subtitle-appearance-settings">
          <header>
            <span className="icon-plate"><Accessibility /></span>
            <div>
              <h2>Subtitle appearance</h2>
              <p>Scale and contrast controls for text subtitles rendered by MPV.</p>
            </div>
          </header>
          <SubtitleAppearanceEditor
            player={draft.player}
            onChange={(player) => setDraft({ ...draft, player })}
          />
        </section>

        <section className="settings-card settings-card--full audio-settings">
          <header>
            <span className="icon-plate"><Volume2 /></span>
            <div>
              <h2>Audio output</h2>
              <p>Choose the Windows endpoint and whether MPV decodes or forwards supported formats.</p>
            </div>
          </header>
          <div className="settings-columns audio-routing">
            <label className="field">
              <span>Output device</span>
              <div className="inline-field">
                <select
                  aria-label="Audio output device"
                  value={draft.player.audioDevice}
                  onChange={(event) => setDraft({
                    ...draft,
                    player: { ...draft.player, audioDevice: event.target.value }
                  })}
                >
                  {!audioDevices.some((device) => device.id === draft.player.audioDevice) && (
                    <option value={draft.player.audioDevice}>
                      {draft.player.audioDevice === 'auto'
                        ? 'Windows default'
                        : 'Saved device · currently unavailable'}
                    </option>
                  )}
                  {audioDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.id === 'auto' ? 'Windows default' : device.description}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Refresh audio devices"
                  className="button button--glass"
                  disabled={!mpv.available || audioDevicesBusy}
                  onClick={() => void refreshAudioDevices()}
                >
                  <RefreshCw /> {audioDevicesBusy ? 'Scanning…' : 'Refresh'}
                </button>
              </div>
            </label>
            <label className="field">
              <span>Output mode</span>
              <select
                aria-label="Audio output mode"
                value={draft.player.audioOutputMode}
                onChange={(event) => setDraft({
                  ...draft,
                  player: {
                    ...draft.player,
                    audioOutputMode: event.target.value as AppSettings['player']['audioOutputMode']
                  }
                })}
              >
                <option value="pcm">Automatic / decoded PCM</option>
                <option value="passthrough">Encoded passthrough</option>
              </select>
              <small>
                PCM works with speakers, headphones, televisions, and most sound systems.
                Passthrough is intended for HDMI devices that decode the selected formats.
              </small>
            </label>
          </div>
          {audioDevicesError && (
            <p className="settings-note settings-note--warning">{audioDevicesError}</p>
          )}
          {draft.player.audioOutputMode === 'passthrough' && (
            <div className="audio-codec-section">
              <div>
                <strong>Formats to forward</strong>
                <small>Start conservatively. Unsupported formats automatically fall back to decoded PCM.</small>
              </div>
              <div className="audio-codec-grid">
                <CodecToggle
                  checked={draft.player.audioPassthrough.ac3}
                  detail="Dolby Digital"
                  label="AC-3"
                  onChange={(value) => setDraft({
                    ...draft,
                    player: {
                      ...draft.player,
                      audioPassthrough: { ...draft.player.audioPassthrough, ac3: value }
                    }
                  })}
                />
                <CodecToggle
                  checked={draft.player.audioPassthrough.eac3}
                  detail="Dolby Digital Plus / Atmos"
                  label="E-AC-3"
                  onChange={(value) => setDraft({
                    ...draft,
                    player: {
                      ...draft.player,
                      audioPassthrough: { ...draft.player.audioPassthrough, eac3: value }
                    }
                  })}
                />
                <CodecToggle
                  checked={draft.player.audioPassthrough.truehd}
                  detail="Dolby TrueHD / Atmos"
                  label="TrueHD"
                  onChange={(value) => setDraft({
                    ...draft,
                    player: {
                      ...draft.player,
                      audioPassthrough: { ...draft.player.audioPassthrough, truehd: value }
                    }
                  })}
                />
                <CodecToggle
                  checked={draft.player.audioPassthrough.dts}
                  detail="DTS core"
                  label="DTS"
                  onChange={(value) => setDraft({
                    ...draft,
                    player: {
                      ...draft.player,
                      audioPassthrough: { ...draft.player.audioPassthrough, dts: value }
                    }
                  })}
                />
                <CodecToggle
                  checked={draft.player.audioPassthrough.dtsHd}
                  detail="DTS-HD MA / DTS:X"
                  label="DTS-HD"
                  onChange={(value) => setDraft({
                    ...draft,
                    player: {
                      ...draft.player,
                      audioPassthrough: { ...draft.player.audioPassthrough, dtsHd: value }
                    }
                  })}
                />
              </div>
            </div>
          )}
          <p className="settings-note settings-note--signal">
            For PC → TV → eARC soundbar, select the television’s HDMI audio endpoint.
            The television remains responsible for forwarding the signal to the soundbar.
          </p>
        </section>

        <section className="settings-card settings-card--wide">
          <header>
            <span className="icon-plate"><Gauge /></span>
            <div><h2>Playback behavior</h2><p>Defaults for every new video.</p></div>
          </header>
          <div className="settings-columns">
            <label className="field">
              <span>Playback speed</span>
              <select
                value={draft.player.playbackSpeed}
                onChange={(event) => setDraft({
                  ...draft,
                  player: { ...draft.player, playbackSpeed: Number(event.target.value) }
                })}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                  <option key={speed} value={speed}>{speed}×</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Next episode countdown</span>
              <select
                value={draft.player.nextEpisodeCountdownSeconds}
                disabled={!draft.player.autoPlayNext}
                onChange={(event) => setDraft({
                  ...draft,
                  player: {
                    ...draft.player,
                    nextEpisodeCountdownSeconds: Number(event.target.value)
                  }
                })}
              >
                {[5, 10, 15, 20, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} seconds</option>
                ))}
              </select>
            </label>
          </div>
          <div className="settings-columns">
            <div className="field">
              <span>Skip intro / ending shortcut</span>
              <button
                type="button"
                className={`shortcut-recorder${recordingSkipShortcut ? ' is-recording' : ''}`}
                aria-label="Skip shortcut"
                onBlur={() => setRecordingSkipShortcut(false)}
                onClick={() => setRecordingSkipShortcut(true)}
                onKeyDown={(event) => {
                  if (!recordingSkipShortcut) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === 'Escape') {
                    setRecordingSkipShortcut(false);
                    return;
                  }
                  const shortcut = normalizeSkipShortcut(event.key);
                  if (!shortcut) return;
                  setDraft({
                    ...draft,
                    player: { ...draft.player, skipSegmentKey: shortcut }
                  });
                  setRecordingSkipShortcut(false);
                }}
              >
                <kbd>{draft.player.skipSegmentKey}</kbd>
                <span>
                  <strong>{recordingSkipShortcut ? 'Press a key' : 'Change shortcut'}</strong>
                  <small>Letter, number, or F1–F12</small>
                </span>
              </button>
            </div>
            <label className="field">
              <span>Skip prompt / auto-skip delay</span>
              <select
                value={draft.player.skipPromptDurationSeconds}
                onChange={(event) => setDraft({
                  ...draft,
                  player: {
                    ...draft.player,
                    skipPromptDurationSeconds: Number(event.target.value)
                  }
                })}
              >
                {[5, 10, 15, 20, 30].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds} seconds</option>
                ))}
              </select>
            </label>
          </div>
          <div className="settings-columns">
            <label className="field">
              <span>Subtitle delay (seconds)</span>
              <input
                type="number"
                min={-30}
                max={30}
                step={0.1}
                value={draft.player.subtitleDelaySeconds}
                onChange={(event) => setDraft({
                  ...draft,
                  player: { ...draft.player, subtitleDelaySeconds: Number(event.target.value) }
                })}
              />
            </label>
            <label className="field">
              <span>Audio delay (seconds)</span>
              <input
                type="number"
                min={-30}
                max={30}
                step={0.1}
                value={draft.player.audioDelaySeconds}
                onChange={(event) => setDraft({
                  ...draft,
                  player: { ...draft.player, audioDelaySeconds: Number(event.target.value) }
                })}
              />
            </label>
          </div>
          <div className="toggle-stack">
            <Toggle
              label="Automatically skip intros"
              detail={`Wait ${draft.player.skipPromptDurationSeconds} seconds, then skip. Press ${draft.player.skipSegmentKey} immediately.`}
              checked={draft.player.autoSkipIntro}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, autoSkipIntro: value }
              })}
            />
            <Toggle
              label="Automatically skip endings"
              detail={`Wait ${draft.player.skipPromptDurationSeconds} seconds before advancing or seeking.`}
              checked={draft.player.autoSkipOutro}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, autoSkipOutro: value }
              })}
            />
            <Toggle
              label="Play the next episode"
              detail="Show a countdown at the end of an episode and continue automatically."
              checked={draft.player.autoPlayNext}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, autoPlayNext: value }
              })}
            />
          </div>
        </section>

        <section className="settings-card settings-card--full">
          <header>
            <span className="icon-plate"><Rows3 /></span>
            <div><h2>Home screen</h2><p>Choose which rows appear and in what order.</p></div>
          </header>
          <div className="home-layout-list">
            {draft.home.sectionOrder.map((id, index) => {
              const hidden = draft.home.hiddenSections.includes(id);
              return (
                <div key={id} className={hidden ? 'is-hidden' : ''}>
                  <span><strong>{HOME_SECTION_LABELS[id]}</strong><small>{hidden ? 'Hidden' : 'Visible'}</small></span>
                  <button className="icon-button" aria-label={`Move ${HOME_SECTION_LABELS[id]} up`} disabled={index === 0} onClick={() => moveHomeSection(id, -1)}><ArrowUp /></button>
                  <button className="icon-button" aria-label={`Move ${HOME_SECTION_LABELS[id]} down`} disabled={index === draft.home.sectionOrder.length - 1} onClick={() => moveHomeSection(id, 1)}><ArrowDown /></button>
                  <button className="icon-button" aria-label={`${hidden ? 'Show' : 'Hide'} ${HOME_SECTION_LABELS[id]}`} onClick={() => toggleHomeSection(id)}>{hidden ? <EyeOff /> : <Eye />}</button>
                </div>
              );
            })}
          </div>
          {draft.home.dismissedNextUpSeriesIds.length > 0 ? (
            <div className="up-next-hidden-settings">
              <span>
                <strong>Hidden from Up Next</strong>
                <small>{draft.home.dismissedNextUpSeriesIds.length} series hidden on this client</small>
              </span>
              <button
                className="button button--glass"
                type="button"
                onClick={() => setDraft({
                  ...draft,
                  home: { ...draft.home, dismissedNextUpSeriesIds: [] }
                })}
              >Restore all</button>
            </div>
          ) : null}
        </section>

        <section className="settings-card settings-card--full">
          <header>
            <span className="icon-plate"><ShieldCheck /></span>
            <div><h2>SyncPlay safety</h2><p>No silent unsynchronized playback.</p></div>
          </header>
          <Toggle
            label="Auto-join an unambiguous cast"
            detail="Only when exactly one accessible group exists."
            checked={draft.syncPlay.autoJoinUnambiguousCast}
            onChange={(value) => setDraft({
              ...draft,
              syncPlay: { ...draft.syncPlay, autoJoinUnambiguousCast: value }
            })}
          />
          <div className="settings-columns">
            <label className="field">
              <span>Soft correction (ms)</span>
              <input
                type="number"
                min={20}
                max={1000}
                value={draft.syncPlay.softCorrectionThresholdMs}
                onChange={(event) => setDraft({
                  ...draft,
                  syncPlay: {
                    ...draft.syncPlay,
                    softCorrectionThresholdMs: Number(event.target.value)
                  }
                })}
              />
            </label>
            <label className="field">
              <span>Hard seek (ms)</span>
              <input
                type="number"
                min={100}
                max={5000}
                value={draft.syncPlay.hardSeekThresholdMs}
                onChange={(event) => setDraft({
                  ...draft,
                  syncPlay: {
                    ...draft.syncPlay,
                    hardSeekThresholdMs: Number(event.target.value)
                  }
                })}
              />
            </label>
          </div>
        </section>
      </div>

      <button className="button button--primary settings-save" onClick={save} disabled={busy}>
        <Save /> {busy ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

function normalizeSkipShortcut(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  const functionKey = key.toUpperCase().match(/^F([1-9]|1[0-2])$/);
  return functionKey ? functionKey[0] : null;
}

function LanguageSelect({
  value,
  disabled = false,
  onChange
}: {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="eng">English</option>
      <option value="bul">Bulgarian</option>
      <option value="spa">Spanish</option>
      <option value="deu">German</option>
      <option value="fra">French</option>
      <option value="ita">Italian</option>
      <option value="jpn">Japanese</option>
      <option value="kor">Korean</option>
      <option value="zho">Chinese</option>
    </select>
  );
}

const SUBTITLE_SCALE_PRESETS = [
  { label: 'Small', value: 80 },
  { label: 'Default', value: 100 },
  { label: 'Large', value: 125 },
  { label: 'Extra large', value: 150 }
] as const;

const SUBTITLE_COLOR_PRESETS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Warm white', value: '#FFF1D6' },
  { label: 'Yellow', value: '#FFD84A' },
  { label: 'Cyan', value: '#79E6FF' }
] as const;

const SUBTITLE_SHADOW_PRESETS = [
  { label: 'Off', detail: 'MPV default', value: 'off' },
  { label: 'Soft', detail: '1.5 px', value: 'soft' },
  { label: 'Strong', detail: '3 px', value: 'strong' }
] as const;

function SubtitleAppearanceEditor({
  player,
  onChange
}: {
  player: PlayerSettings;
  onChange(player: PlayerSettings): void;
}) {
  const update = (patch: Partial<PlayerSettings>) => onChange({ ...player, ...patch });
  const selectedScale = SUBTITLE_SCALE_PRESETS.find(
    (preset) => preset.value === player.subtitleScalePercent
  );
  const selectedColor = SUBTITLE_COLOR_PRESETS.find(
    (preset) => preset.value === player.subtitleTextColor
  );
  const previewStyle = {
    '--subtitle-preview-scale': player.subtitleScalePercent / 100,
    '--subtitle-preview-color': player.subtitleTextColor,
    '--subtitle-preview-shadow': previewShadow(player.subtitleShadowStrength)
  } as CSSProperties;

  return (
    <div className="subtitle-appearance-layout">
      <div className="subtitle-appearance-controls">
        <div className="subtitle-control-group">
          <div className="subtitle-control-heading">
            <span>
              <strong>Text size</strong>
              <small>{selectedScale?.label ?? 'Custom'} · {player.subtitleScalePercent}%</small>
            </span>
            <output htmlFor="subtitle-scale subtitle-scale-number">
              {player.subtitleScalePercent}%
            </output>
          </div>
          <div className="subtitle-scale-row">
            <div className="subtitle-scale-range">
              <input
                aria-label="Subtitle text size"
                id="subtitle-scale"
                type="range"
                min={50}
                max={200}
                step={5}
                value={player.subtitleScalePercent}
                style={{
                  '--subtitle-scale-position':
                    ((player.subtitleScalePercent - 50) / 150) * 100
                } as CSSProperties}
                onChange={(event) => update({
                  subtitleScalePercent: Number(event.target.value)
                })}
              />
              <i className="subtitle-scale-default" aria-hidden="true">
                <span>100</span>
              </i>
            </div>
            <label className="subtitle-scale-number" htmlFor="subtitle-scale-number">
              <input
                aria-label="Subtitle scale percentage"
                id="subtitle-scale-number"
                type="number"
                min={50}
                max={200}
                step={1}
                value={player.subtitleScalePercent}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  update({ subtitleScalePercent: Math.min(200, Math.max(50, Math.round(value))) });
                }}
              />
              <span>%</span>
            </label>
          </div>
          <div className="subtitle-preset-grid subtitle-preset-grid--scale">
            {SUBTITLE_SCALE_PRESETS.map((preset) => (
              <button
                className={player.subtitleScalePercent === preset.value ? 'is-selected' : ''}
                type="button"
                key={preset.value}
                aria-pressed={player.subtitleScalePercent === preset.value}
                onClick={() => update({ subtitleScalePercent: preset.value })}
              >
                <strong>{preset.label}</strong>
                <span>{preset.value}%</span>
              </button>
            ))}
          </div>
        </div>

        <div className="subtitle-control-group">
          <div className="subtitle-control-heading">
            <span>
              <strong>Text color</strong>
              <small>{selectedColor?.label ?? 'Custom'} · {player.subtitleTextColor}</small>
            </span>
          </div>
          <div className="subtitle-color-grid">
            {SUBTITLE_COLOR_PRESETS.map((preset) => (
              <button
                className={player.subtitleTextColor === preset.value ? 'is-selected' : ''}
                type="button"
                key={preset.value}
                aria-label={`${preset.label} ${preset.value}`}
                aria-pressed={player.subtitleTextColor === preset.value}
                onClick={() => update({ subtitleTextColor: preset.value })}
              >
                <i style={{ backgroundColor: preset.value }} />
                <span><strong>{preset.label}</strong><small>{preset.value}</small></span>
              </button>
            ))}
            <label className={`subtitle-custom-color${selectedColor ? '' : ' is-selected'}`}>
              <input
                aria-label="Custom subtitle text color"
                type="color"
                value={player.subtitleTextColor}
                onChange={(event) => update({ subtitleTextColor: event.target.value.toUpperCase() })}
              />
              <span><strong>Custom</strong><small>{player.subtitleTextColor}</small></span>
            </label>
          </div>
        </div>

        <div className="subtitle-control-group">
          <div className="subtitle-control-heading">
            <span>
              <strong>Text shadow</strong>
              <small>Extra separation from bright scenes</small>
            </span>
          </div>
          <div className="subtitle-preset-grid subtitle-preset-grid--shadow">
            {SUBTITLE_SHADOW_PRESETS.map((preset) => (
              <button
                className={player.subtitleShadowStrength === preset.value ? 'is-selected' : ''}
                type="button"
                key={preset.value}
                aria-pressed={player.subtitleShadowStrength === preset.value}
                onClick={() => update({ subtitleShadowStrength: preset.value })}
              >
                <strong>{preset.label}</strong>
                <span>{preset.detail}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="subtitle-preview" style={previewStyle}>
        <div className="subtitle-preview__topline">
          <span>LIVE PREVIEW</span>
          <small>Text subtitles</small>
        </div>
        <div className="subtitle-preview__scene" aria-label="Subtitle appearance preview">
          <i className="subtitle-preview__light" />
          <span className="subtitle-preview__subject subtitle-preview__subject--left" />
          <span className="subtitle-preview__subject subtitle-preview__subject--right" />
          <p>Everything we watch should feel this clear.</p>
        </div>
        <div className="subtitle-preview__readout">
          <span>{player.subtitleScalePercent}%</span>
          <span>{player.subtitleTextColor}</span>
          <span>{player.subtitleShadowStrength} shadow</span>
        </div>
        <p className="settings-note settings-note--signal">
          Scale applies to dialogue without enlarging ASS signs. Choosing a custom
          color or shadow asks MPV to override styled text subtitles. PGS subtitles
          are images and keep their original appearance.
        </p>
      </div>
    </div>
  );
}

function previewShadow(strength: PlayerSettings['subtitleShadowStrength']): string {
  const outline = '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000';
  if (strength === 'soft') return `${outline}, 0 3px 6px rgba(0, 0, 0, .88)`;
  if (strength === 'strong') return `${outline}, 0 5px 12px #000, 3px 3px 2px rgba(0, 0, 0, .95)`;
  return outline;
}

function Toggle({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="toggle">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i />
    </label>
  );
}

function CodecToggle({
  label,
  detail,
  checked,
  onChange
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className={`codec-toggle${checked ? ' codec-toggle--active' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span><strong>{label}</strong><small>{detail}</small></span>
      <i>{checked ? 'ON' : 'OFF'}</i>
    </label>
  );
}
