import {
  ArrowLeft,
  Check,
  Link2,
  LogOut,
  Server,
  ShieldCheck,
  Smartphone,
  Tv,
  UserRound
} from 'lucide-react';
import {
  type FormEvent,
  useEffect,
  useState
} from 'react';
import { bridgeUrl } from './bridge-url.js';
import type {
  VidaaBridgeError,
  VidaaJellyfinSession
} from './jellyfin-types.js';

interface QuickConnectRequest {
  status: 'pending';
  secret: string;
  code: string;
  serverName: string;
}

interface QuickConnectPoll {
  status: 'pending' | 'connected' | 'expired';
  session: VidaaJellyfinSession | null;
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T | VidaaBridgeError;
  if (!response.ok) {
    const bridgeError = value as VidaaBridgeError;
    throw new Error(bridgeError.error ?? `Request failed (${response.status}).`);
  }
  return value as T;
}

export function JellyfinConnectApp() {
  const [session, setSession] = useState<VidaaJellyfinSession | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8096');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading connection state…');
  const [tone, setTone] = useState<'neutral' | 'good' | 'error'>('neutral');
  const [quickConnect, setQuickConnect] = useState<QuickConnectRequest | null>(null);

  useEffect(() => {
    void fetch(bridgeUrl('/api/vidaa/session'))
      .then((response) => responseJson<VidaaJellyfinSession>(response))
      .then((value) => {
        setSession(value);
        if (value.baseUrl) setBaseUrl(value.baseUrl);
        setMessage(value.connected
          ? `Connected to ${value.serverName} as ${value.userName}.`
          : 'Enter the Jellyfin server and user. The password is used once and is not saved.');
        setTone(value.connected ? 'good' : 'neutral');
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : String(error));
        setTone('error');
      });
  }, []);

  useEffect(() => {
    if (!quickConnect) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(bridgeUrl(
          `/api/vidaa/quick-connect?secret=${encodeURIComponent(quickConnect.secret)}`
        ));
        const value = await responseJson<QuickConnectPoll>(response);
        if (!active || value.status === 'pending') return;
        setQuickConnect(null);
        if (value.status === 'connected' && value.session) {
          setSession(value.session);
          setTone('good');
          setMessage(`Connected to ${value.session.serverName} as ${value.session.userName}. The TV home is ready.`);
        } else {
          setTone('error');
          setMessage('The Quick Connect code expired. Request another code.');
        }
      } catch (error) {
        if (!active) return;
        setQuickConnect(null);
        setTone('error');
        setMessage(error instanceof Error ? error.message : String(error));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [quickConnect]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setTone('neutral');
    setMessage('Authenticating with Jellyfin…');
    try {
      const response = await fetch(bridgeUrl('/api/vidaa/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, username, password })
      });
      const value = await responseJson<VidaaJellyfinSession>(response);
      setSession(value);
      setPassword('');
      setTone('good');
      setMessage(`Connected to ${value.serverName} as ${value.userName}. The TV home is ready.`);
    } catch (error) {
      setTone('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const response = await fetch(bridgeUrl('/api/vidaa/session'), {
        method: 'DELETE'
      });
      const value = await responseJson<VidaaJellyfinSession>(response);
      setSession(value);
      setTone('neutral');
      setMessage('VIDAA is disconnected from Jellyfin.');
    } catch (error) {
      setTone('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function beginQuickConnect() {
    setBusy(true);
    setTone('neutral');
    setMessage('Requesting a Quick Connect code…');
    try {
      const response = await fetch(bridgeUrl('/api/vidaa/quick-connect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl })
      });
      setQuickConnect(await responseJson<QuickConnectRequest>(response));
      setMessage('Approve the displayed code in a signed-in Jellyfin app.');
    } catch (error) {
      setTone('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="connect-shell">
      <header className="connect-header">
        <a className="signal-button signal-button--quiet" href="/">
          <ArrowLeft /> TV home
        </a>
        <div>
          <p>JELLYCLIENT / VIDAA CONTROL DESK</p>
          <h1>Jellyfin connection</h1>
        </div>
        <a className="signal-button signal-button--quiet" href="/probe">
          Signal probe
        </a>
      </header>

      <section className="connect-stage">
        <div className="connect-copy">
          <div className="connect-orbit" aria-hidden="true">
            <Server />
            <span><Link2 /></span>
            <span><Tv /></span>
          </div>
          <p className="eyebrow">SAME-ORIGIN BRIDGE</p>
          <h2>The television never receives your password.</h2>
          <p>
            This PC authenticates with Jellyfin, keeps the session locally, and
            gives VIDAA a same-origin library and video stream. Dolby Vision and
            HDR stay on the TV-native video path.
          </p>
          <dl className="connect-facts">
            <div><dt>Transport</dt><dd>Direct play / video-copy remux</dd></div>
            <div><dt>HDR policy</dt><dd>Reject silent video transcoding</dd></div>
            <div><dt>Credentials</dt><dd>Password never persisted</dd></div>
          </dl>
        </div>

        <form className="connect-form" onSubmit={connect}>
          <div className="connect-form__heading">
            <ShieldCheck />
            <div>
              <p>LOCAL SETUP</p>
              <h2>{session?.connected ? 'Connection active' : 'Connect Jellyfin'}</h2>
            </div>
          </div>
          <label>
            <span>Jellyfin server URL</span>
            <div className="connect-input"><Server /><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8096" /></div>
          </label>
          <label>
            <span>Username</span>
            <div className="connect-input"><UserRound /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></div>
          </label>
          <label>
            <span>Password</span>
            <div className="connect-input"><ShieldCheck /><input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          </label>
          <div className={`connect-message connect-message--${tone}`}>
            {tone === 'good' ? <Check /> : <span />}
            <p>{message}</p>
          </div>
          <button className="signal-button signal-button--primary connect-submit" disabled={busy} type="submit">
            {busy ? 'Working…' : session?.connected ? 'Reconnect' : 'Connect'}
          </button>
          <button className="signal-button signal-button--quiet connect-submit" disabled={busy} onClick={() => void beginQuickConnect()} type="button">
            <Smartphone /> Use Quick Connect
          </button>
          {session?.connected && (
            <button className="signal-button signal-button--danger" disabled={busy} onClick={() => void disconnect()} type="button">
              <LogOut /> Disconnect this TV client
            </button>
          )}
        </form>
      </section>
      {quickConnect && (
        <div className="connect-quick" role="dialog" aria-modal="true">
          <section>
            <button aria-label="Cancel Quick Connect" className="round-button" onClick={() => setQuickConnect(null)} type="button"><ArrowLeft /></button>
            <Smartphone />
            <p>QUICK CONNECT</p>
            <h2>Approve this code</h2>
            <strong>{quickConnect.code}</strong>
            <span>Open Settings → Quick Connect in a signed-in Jellyfin app and enter this code for {quickConnect.serverName}.</span>
            <small>Waiting for approval…</small>
          </section>
        </div>
      )}
    </main>
  );
}
