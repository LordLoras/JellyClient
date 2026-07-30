import {
  ArrowLeft,
  Check,
  Copy,
  FileVideo,
  Link2,
  MonitorUp,
  Plus,
  Save,
  Trash2,
  Wifi
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState
} from 'react';
import type {
  ExpectedSignal,
  ProbeConfig,
  SetupProbePayload,
  StoredProbeSource
} from './types.js';

const SIGNAL_OPTIONS: ExpectedSignal[] = [
  'SDR',
  'HDR10',
  'Dolby Vision P5',
  'Dolby Vision P8.1',
  'Other'
];

const STARTER_SOURCES: StoredProbeSource[] = [
  {
    id: 'sdr-baseline',
    label: 'SDR baseline',
    expected: 'SDR',
    kind: 'file',
    location: '',
    notes: 'H.264 or HEVC BT.709 reference'
  },
  {
    id: 'hdr10-main10',
    label: 'HDR10 · HEVC Main 10',
    expected: 'HDR10',
    kind: 'file',
    location: '',
    notes: 'BT.2020 with SMPTE ST 2084/PQ'
  },
  {
    id: 'dolby-vision-p5',
    label: 'Dolby Vision · Profile 5',
    expected: 'Dolby Vision P5',
    kind: 'file',
    location: '',
    notes: 'No HDR10 fallback; incorrect colors count as failure'
  },
  {
    id: 'dolby-vision-p81',
    label: 'Dolby Vision · Profile 8.1',
    expected: 'Dolby Vision P8.1',
    kind: 'file',
    location: '',
    notes: 'Confirm Dolby Vision rather than HDR10 fallback'
  }
];

function newSource(): StoredProbeSource {
  return {
    id: `source-${Date.now()}`,
    label: 'New test source',
    expected: 'Other',
    kind: 'file',
    location: '',
    notes: ''
  };
}

export function SetupApp() {
  const [payload, setPayload] = useState<SetupProbePayload | null>(null);
  const [config, setConfig] = useState<ProbeConfig>({
    version: 1,
    firmware: 'v01.09.60V.Q0618',
    sources: STARTER_SOURCES
  });
  const [status, setStatus] = useState<
    { tone: 'neutral' | 'good' | 'error'; text: string }
  >({
    tone: 'neutral',
    text: 'Loading local configuration…'
  });
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/probe/setup', {
      cache: 'no-store'
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? 'Setup is locked to the PC. Open http://localhost:4173/setup on the computer running the probe.'
            : `Setup server returned ${response.status}.`
        );
      }
      const loaded = await response.json() as SetupProbePayload;
      setPayload(loaded);
      setConfig({
        version: 1,
        firmware: loaded.firmware,
        sources: loaded.sources.length > 0 ? loaded.sources : STARTER_SOURCES
      });
      setStatus({
        tone: loaded.configError ? 'error' : 'neutral',
        text: loaded.configError ?? 'Add paths or URLs, then save.'
      });
    }).catch((error) => {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : String(error)
      });
    });
  }, []);

  const configuredCount = useMemo(
    () => config.sources.filter((source) => source.location.trim()).length,
    [config.sources]
  );

  const updateSource = (
    index: number,
    update: Partial<StoredProbeSource>
  ) => {
    setConfig((current) => ({
      ...current,
      sources: current.sources.map((source, sourceIndex) =>
        sourceIndex === index
          ? {
              ...source,
              ...update
            }
          : source
      )
    }));
  };

  const save = async () => {
    setStatus({
      tone: 'neutral',
      text: 'Saving configuration…'
    });
    try {
      const response = await fetch('/api/probe/setup', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      const result = await response.json() as SetupProbePayload & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? `Setup server returned ${response.status}.`);
      }
      setPayload(result);
      setConfig({
        version: 1,
        firmware: result.firmware,
        sources: result.sources
      });
      setStatus({
        tone: 'good',
        text: `Saved ${configuredCount} configured source${configuredCount === 1 ? '' : 's'}. Refresh the TV page.`
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl(null), 1600);
  };

  return (
    <main className="setup-shell">
      <header className="setup-header">
        <a href="/" className="setup-back">
          <ArrowLeft /> TV VIEW
        </a>
        <div>
          <p>JELLYCLIENT / DEVICE LAB</p>
          <h1>Probe setup</h1>
        </div>
        <button className="setup-save" onClick={() => void save()}>
          <Save /> SAVE SOURCES
        </button>
      </header>

      <section className="setup-intro">
        <div>
          <span className="setup-intro__icon"><MonitorUp /></span>
          <div>
            <p>LOCAL CONTROL DESK</p>
            <h2>Load media without typing long paths on the TV.</h2>
            <span>
              Local file paths remain on this PC and are excluded from Git.
              Only configured files can be read by the LAN media endpoint.
            </span>
          </div>
        </div>
        <dl>
          <div><dt>Firmware</dt><dd>{config.firmware}</dd></div>
          <div><dt>Sources ready</dt><dd>{configuredCount}</dd></div>
          <div><dt>Range requests</dt><dd>Enabled</dd></div>
        </dl>
      </section>

      <div className="setup-grid">
        <section className="source-editor">
          <header>
            <div>
              <p>TEST REEL</p>
              <h2>Media sources</h2>
            </div>
            <button onClick={() => setConfig((current) => ({
              ...current,
              sources: [...current.sources, newSource()]
            }))}>
              <Plus /> ADD SOURCE
            </button>
          </header>

          <label className="firmware-field">
            <span>TV SOFTWARE VERSION</span>
            <input
              value={config.firmware}
              onChange={(event) => setConfig((current) => ({
                ...current,
                firmware: event.currentTarget.value
              }))}
            />
          </label>

          <div className="source-editor__list">
            {config.sources.map((source, index) => (
              <article className="source-editor__row" key={`${source.id}-${index}`}>
                <span className={`source-index source-index--${source.expected.startsWith('Dolby') ? 'dovi' : source.expected.toLowerCase().replace('10', '')}`}>
                  {String(index + 1).padStart(2, '0')}
                </span>

                <div className="source-fields">
                  <label>
                    <span>LABEL</span>
                    <input
                      value={source.label}
                      onChange={(event) => updateSource(index, {
                        label: event.currentTarget.value
                      })}
                    />
                  </label>
                  <label>
                    <span>EXPECTED OUTPUT</span>
                    <select
                      value={source.expected}
                      onChange={(event) => updateSource(index, {
                        expected: event.currentTarget.value as ExpectedSignal
                      })}
                    >
                      {SIGNAL_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>SOURCE TYPE</span>
                    <select
                      value={source.kind}
                      onChange={(event) => updateSource(index, {
                        kind: event.currentTarget.value as 'file' | 'url'
                      })}
                    >
                      <option value="file">PC-local file</option>
                      <option value="url">Direct HTTP URL</option>
                    </select>
                  </label>
                  <label className="source-fields__location">
                    <span>{source.kind === 'file' ? 'ABSOLUTE FILE PATH' : 'MEDIA URL'}</span>
                    <div>
                      {source.kind === 'file' ? <FileVideo /> : <Link2 />}
                      <input
                        value={source.location}
                        onChange={(event) => updateSource(index, {
                          location: event.currentTarget.value
                        })}
                        placeholder={
                          source.kind === 'file'
                            ? 'C:\\Media\\test-video.mkv'
                            : 'http://server/video.mp4'
                        }
                      />
                    </div>
                  </label>
                  <label className="source-fields__notes">
                    <span>TEST NOTE</span>
                    <input
                      value={source.notes}
                      onChange={(event) => updateSource(index, {
                        notes: event.currentTarget.value
                      })}
                      placeholder="What should be verified?"
                    />
                  </label>
                </div>

                <button
                  className="source-delete"
                  aria-label={`Remove ${source.label}`}
                  onClick={() => setConfig((current) => ({
                    ...current,
                    sources: current.sources.filter((_, sourceIndex) =>
                      sourceIndex !== index
                    )
                  }))}
                >
                  <Trash2 />
                </button>
              </article>
            ))}
          </div>
        </section>

        <aside className="setup-sidebar">
          <section className="lan-card">
            <header>
              <Wifi />
              <div><p>OPEN ON THE TV</p><h2>LAN addresses</h2></div>
            </header>
            {(payload?.lanUrls ?? []).length > 0 ? (
              <div className="lan-card__urls">
                {payload?.lanUrls.map((url) => (
                  <button key={url} onClick={() => void copyUrl(url)}>
                    <span>{url}</span>
                    {copiedUrl === url ? <Check /> : <Copy />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="lan-card__empty">
                No active private IPv4 address was detected.
              </p>
            )}
            <small>
              The TV and PC must be on the same network. Allow Node.js through
              Windows Firewall for private networks if prompted.
            </small>
          </section>

          <section className="procedure-card">
            <p>TEST PROCEDURE</p>
            <ol>
              <li><span>01</span><div><strong>Add sources</strong><small>Use local MP4/MKV paths or complete media URLs.</small></div></li>
              <li><span>02</span><div><strong>Save this page</strong><small>The probe reloads configuration without restarting.</small></div></li>
              <li><span>03</span><div><strong>Open the LAN URL</strong><small>Use the built-in VIDAA browser address bar.</small></div></li>
              <li><span>04</span><div><strong>Verify the TV badge</strong><small>HDR10 and Dolby Vision must be confirmed by the television.</small></div></li>
            </ol>
          </section>

          <section className={`setup-status setup-status--${status.tone}`}>
            {status.tone === 'good' ? <Check /> : <span />}
            <p>{status.text}</p>
          </section>

          {payload?.configPath && (
            <p className="config-path">
              LOCAL CONFIG<br /><span>{payload.configPath}</span>
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
