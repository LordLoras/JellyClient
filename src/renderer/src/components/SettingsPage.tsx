import {
  Captions,
  ExternalLink,
  FileCog,
  FolderOpen,
  Gauge,
  MonitorUp,
  Save,
  ShieldCheck
} from 'lucide-react';
import {
  useEffect,
  useState
} from 'react';
import type {
  AppSettings,
  MpvCapability
} from '@shared/contracts.js';
import { friendlyError } from '../format';

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
  useEffect(() => setDraft(settings), [settings]);

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

  return (
    <div className="settings-page page-pad">
      <header className="page-title">
        <p className="eyebrow">PLAYBACK SETTINGS</p>
        <h1>Settings</h1>
        <p>Changes apply the next time the native MPV window starts.</p>
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
              detail="Use intro segments reported by Jellyfin. The N shortcut remains available."
              checked={draft.player.autoSkipIntro}
              onChange={(value) => setDraft({
                ...draft,
                player: { ...draft.player, autoSkipIntro: value }
              })}
            />
            <Toggle
              label="Automatically skip endings"
              detail="Use ending segments reported by Jellyfin."
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
