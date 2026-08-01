import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  Radar,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react';
import type {
  ConnectionInput,
  ConnectionState,
  DiscoveredServer,
  QuickConnectRequest
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
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [quickConnect, setQuickConnect] =
    useState<QuickConnectRequest | null>(null);
  const onConnectedRef = useRef(onConnected);

  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => setError(connection.error), [connection.error]);

  useEffect(() => {
    if (!quickConnect) return;
    let active = true;
    const poll = async () => {
      try {
        const result = await window.jellyClient.pollQuickConnect(
          quickConnect.secret
        );
        if (!active || result.status === 'pending') return;
        if (result.status === 'authenticated' && result.connection) {
          setQuickConnect(null);
          onConnectedRef.current(result.connection);
          return;
        }
        setQuickConnect(null);
        setError('The Quick Connect code expired. Request a new code.');
      } catch (reason) {
        if (active) {
          setQuickConnect(null);
          setError(friendlyError(reason));
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [quickConnect]);

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    try {
      setDiscovered(await window.jellyClient.discoverServers());
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setDiscovering(false);
    }
  };

  const chooseServer = (server: DiscoveredServer) => {
    try {
      const url = new URL(server.address);
      setProtocol(url.protocol === 'https:' ? 'https' : 'http');
      setHost(url.hostname);
      setPort(Number(url.port) || (url.protocol === 'https:' ? 443 : 80));
      setBasePath(url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
      setAdvanced(url.pathname !== '/');
    } catch {
      setError(`Could not read the address reported by ${server.name}.`);
    }
  };

  const beginQuickConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      setQuickConnect(await window.jellyClient.startQuickConnect({
        protocol,
        host,
        port,
        basePath,
        displayName: host,
        rememberSession
      }));
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancelQuickConnect = () => {
    const request = quickConnect;
    setQuickConnect(null);
    if (request) void window.jellyClient.cancelQuickConnect(request.secret);
  };

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
      <div className="login__center">
        <Brand />
        <section className="login__panel">
          <div className="login__panel-header">
          <div>
              <h1>Connect to Jellyfin</h1>
              <p>Enter your server address and account details.</p>
            </div>
          </div>

          <form onSubmit={submit} className="login__form">
          <div className="server-discovery">
            <button
              className="button button--glass"
              disabled={discovering || busy}
              onClick={() => void discover()}
              type="button"
            >
              {discovering ? <RefreshCw className="spin" /> : <Radar />}
              {discovering ? 'Looking…' : 'Find servers on this network'}
            </button>
            {discovered.length > 0 && (
              <div className="server-discovery__results">
                {discovered.map((server) => (
                  <button
                    key={`${server.id}-${server.address}`}
                    onClick={() => chooseServer(server)}
                    type="button"
                  >
                    <span><strong>{server.name}</strong><small>{server.address}</small></span>
                    <ArrowRight />
                  </button>
                ))}
              </div>
            )}
          </div>
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
          <button
            className="button button--glass button--wide quick-connect-button"
            disabled={busy || !host.trim()}
            onClick={() => void beginQuickConnect()}
            type="button"
          >
            <Smartphone /> Use Quick Connect instead
          </button>
          </form>

          <footer className="login__security">
            <ShieldCheck />
            <p>
              Your password is used to sign in and is not saved.
              <button type="button" onClick={() => window.jellyClient.openConfigFolder()}>
                Open configuration folder
              </button>
            </p>
            <span className="sr-only">{configPath}</span>
          </footer>
        </section>
      </div>
      {quickConnect && (
        <div className="quick-connect" role="dialog" aria-modal="true">
          <section>
            <button
              aria-label="Cancel Quick Connect"
              className="icon-button"
              onClick={cancelQuickConnect}
              type="button"
            ><X /></button>
            <span className="quick-connect__icon"><Smartphone /></span>
            <p className="eyebrow">QUICK CONNECT</p>
            <h2>Approve this code</h2>
            <strong className="quick-connect__code">{quickConnect.code}</strong>
            <p>
              In a signed-in Jellyfin app, open <b>Settings → Quick Connect</b>
              and enter this code for {quickConnect.serverName}.
            </p>
            <span className="quick-connect__waiting"><RefreshCw className="spin" /> Waiting for approval</span>
          </section>
        </div>
      )}
    </main>
  );
}
