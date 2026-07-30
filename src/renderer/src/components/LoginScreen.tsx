import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Server,
  ShieldCheck
} from 'lucide-react';
import {
  useEffect,
  useState,
  type FormEvent
} from 'react';
import type {
  ConnectionInput,
  ConnectionState,
  ServerProfile
} from '@shared/contracts.js';
import { Brand } from './Brand';
import { friendlyError } from '../format';

interface Props {
  connection: ConnectionState;
  configPath: string;
  onConnected(value: ConnectionState): void;
}

export function LoginScreen({
  connection,
  configPath,
  onConnected
}: Props) {
  const profile = connection.profile;
  const [protocol, setProtocol] = useState<'http' | 'https'>(
    profile?.protocol ?? 'http'
  );
  const [host, setHost] = useState(profile?.host ?? '');
  const [port, setPort] = useState(profile?.port ?? 8096);
  const [basePath, setBasePath] = useState(profile?.basePath ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [password, setPassword] = useState('');
  const [rememberSession, setRememberSession] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(profile?.basePath));
  const [error, setError] = useState<string | null>(connection.error);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(connection.error), [connection.error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: ConnectionInput = {
      protocol,
      host,
      port,
      basePath,
      username,
      password,
      rememberSession,
      displayName: host
    };
    try {
      const result = await window.jellyClient.connect(input);
      onConnected(result);
      if (result.status !== 'connected') {
        setError(result.error ?? 'Jellyfin did not accept the connection.');
      }
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <main className="login">
      <div className="login__aurora" />
      <section className="login__story">
        <Brand />
        <div className="login__headline">
          <p className="eyebrow">YOUR SCREENING ROOM, IN SYNC</p>
          <h1>
            The image comes first.
            <em>The room follows.</em>
          </h1>
          <p>
            A native-window Jellyfin client built around HDR10, faithful
            subtitles, and SyncPlay that you join exactly once.
          </p>
        </div>
        <div className="login__promises" aria-label="Core capabilities">
          <span><CheckCircle2 /> HDR10 / PQ output</span>
          <span><CheckCircle2 /> ASS + PGS subtitles</span>
          <span><CheckCircle2 /> One-session SyncPlay</span>
        </div>
      </section>

      <section className="login__panel">
        <div className="login__panel-header">
          <span className="icon-plate"><Server /></span>
          <div>
            <p className="eyebrow">CONNECTION PROFILE</p>
            <h2>Meet your Jellyfin server</h2>
          </div>
        </div>

        <form onSubmit={submit} className="login__form">
          <div className="field-grid field-grid--address">
            <label className="field field--small">
              <span>Protocol</span>
              <select
                value={protocol}
                onChange={(event) => setProtocol(event.target.value as 'http' | 'https')}
              >
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label className="field">
              <span>Server IP or hostname</span>
              <input
                autoFocus
                required
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="192.168.1.20"
                spellCheck={false}
              />
            </label>
            <label className="field field--port">
              <span>Port</span>
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
          </div>

          <button
            type="button"
            className="text-button"
            onClick={() => setAdvanced((value) => !value)}
          >
            {advanced ? 'Hide advanced address' : 'Server uses a base path?'}
          </button>
          {advanced && (
            <label className="field">
              <span>Base path</span>
              <input
                value={basePath}
                onChange={(event) => setBasePath(event.target.value)}
                placeholder="/jellyfin"
                spellCheck={false}
              />
            </label>
          )}

          <div className="login__rule" />

          <label className="field">
            <span>Username</span>
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Jellyfin username"
            />
          </label>
          <div className="field">
            <label className="field__label" htmlFor="jellyfin-password">
              Password
            </label>
            <div className="password-field">
              <LockKeyhole />
              <input
                id="jellyfin-password"
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          <label className="check-line">
            <input
              type="checkbox"
              checked={rememberSession}
              onChange={(event) => setRememberSession(event.target.checked)}
            />
            <span>
              <strong>Remember this session</strong>
              <small>The access token is encrypted by Windows.</small>
            </span>
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="button button--primary button--wide" disabled={busy}>
            <span>{busy ? 'Connecting…' : 'Connect to server'}</span>
            <ArrowRight />
          </button>
        </form>

        <footer className="login__security">
          <ShieldCheck />
          <p>
            Your password is used once and never written to disk.
            <button type="button" onClick={() => window.jellyClient.openConfigFolder()}>
              Open configuration folder
            </button>
          </p>
          <span className="sr-only">{configPath}</span>
        </footer>
      </section>
    </main>
  );
}
