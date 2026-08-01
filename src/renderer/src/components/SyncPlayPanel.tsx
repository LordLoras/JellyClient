import {
  Activity,
  CheckCircle2,
  Clock3,
  DoorOpen,
  Gauge,
  LoaderCircle,
  Plus,
  RefreshCw,
  Radio,
  TriangleAlert,
  Users,
  X
} from 'lucide-react';
import {
  useEffect,
  useState
} from 'react';
import type { SyncPlayState } from '@shared/contracts.js';
import { friendlyError } from '../format';

interface Props {
  state: SyncPlayState;
  onClose(): void;
  onChange(value: SyncPlayState): void;
  onNotice(message: string): void;
}

const roomCheckLabels = {
  idle: 'Waiting for playback',
  checking: 'Checking the room',
  ready: 'Ready and aligned',
  waiting: 'Waiting',
  correcting: 'Correcting drift',
  degraded: 'Needs attention'
} as const;

function signedMilliseconds(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(0)} ms`;
}

interface RoomCheckProps {
  state: SyncPlayState;
  busy: boolean;
  onCheck(): void;
}

function RoomCheck({ state, busy, onCheck }: RoomCheckProps) {
  const check = state.roomCheck;
  const statusIcon = check.status === 'ready'
    ? <CheckCircle2 />
    : check.status === 'degraded'
      ? <TriangleAlert />
      : <Activity className={check.status === 'checking' ? 'spin' : ''} />;
  const correction = check.automaticCorrections > 0
    ? `${check.automaticCorrections} automatic · ${check.lastCorrectionKind}`
    : 'No corrections needed';

  return (
    <section className={`room-check room-check--${check.status}`}>
      <header className="room-check__header">
        <span className="room-check__icon">{statusIcon}</span>
        <div>
          <small>ROOM CHECK</small>
          <strong>{roomCheckLabels[check.status]}</strong>
        </div>
        <i aria-hidden="true" />
      </header>
      <p>{check.message}</p>
      <div className="room-check__grid">
        <span>
          <CheckCircle2 />
          <small>LOCAL PLAYER</small>
          <strong>{check.localReady ? 'Ready' : check.playerStatus}</strong>
          <em>{check.itemMatched ? 'Room item loaded' : 'Waiting for room item'}</em>
        </span>
        <span>
          <Users />
          <small>ROOM SIGNAL</small>
          <strong>{check.serverState}</strong>
          <em>{state.currentGroup?.participants.length ?? 0} connected</em>
        </span>
        <span>
          <Gauge />
          <small>PLAYBACK DRIFT</small>
          <strong>{check.timelineAvailable ? signedMilliseconds(state.driftMs) : 'Awaiting timeline'}</strong>
          <em>{correction}</em>
        </span>
        <span>
          <Clock3 />
          <small>SERVER CLOCK</small>
          <strong>{state.roundTripMs.toFixed(0)} ms round trip</strong>
          <em>{signedMilliseconds(state.clockOffsetMs)} offset · {check.clockJitterMs.toFixed(0)} ms jitter</em>
        </span>
      </div>
      {check.lastCorrectionMs !== null ? (
        <div className="room-check__last-correction">
          Last correction: {check.lastCorrectionKind} at {signedMilliseconds(check.lastCorrectionMs)}
        </div>
      ) : null}
      <button
        className="button button--glass button--wide room-check__action"
        onClick={onCheck}
        disabled={busy || check.status === 'checking'}
      >
        <Activity /> {check.status === 'checking' ? 'Checking…' : 'Run Room Check'}
      </button>
      <small className="room-check__note">
        Jellyfin provides a shared room signal. Participant names show who is connected, not an individual readiness score.
      </small>
    </section>
  );
}

export function SyncPlayPanel({
  state,
  onClose,
  onChange,
  onNotice
}: Props) {
  const [name, setName] = useState('Movie night');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      onChange(await window.jellyClient.listSyncPlayGroups());
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      onChange(await window.jellyClient.createSyncPlayGroup(name.trim()));
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const join = async (groupId: string) => {
    setBusy(true);
    try {
      onChange(await window.jellyClient.joinSyncPlayGroup(groupId));
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      onChange(await window.jellyClient.leaveSyncPlayGroup());
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const resync = async () => {
    setBusy(true);
    try {
      onChange(await window.jellyClient.resyncSyncPlay());
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const checkRoom = async () => {
    setBusy(true);
    try {
      onChange(await window.jellyClient.checkSyncPlayRoom());
    } catch (error) {
      onNotice(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="side-panel">
      <header className="side-panel__header">
        <div>
          <p className="eyebrow">SYNCPLAY</p>
          <h2>SyncPlay room</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close SyncPlay">
          <X />
        </button>
      </header>

      {state.currentGroup ? (
        <section className="current-room">
          <div className="current-room__pulse"><Radio /></div>
          <span>CURRENT ROOM</span>
          <h3>{state.currentGroup.name}</h3>
          <p>{state.currentGroup.state} · {state.currentGroup.participants.length} connected</p>
          <div className="participant-list">
            {state.currentGroup.participants.map((name) => (
              <span key={name}><i>{name.slice(0, 1)}</i>{name}</span>
            ))}
          </div>
          <RoomCheck state={state} busy={busy} onCheck={checkRoom} />
          <button className="button button--glass button--wide" onClick={resync} disabled={busy}>
            <RefreshCw /> Resync player
          </button>
          <button className="button button--danger button--wide" onClick={leave} disabled={busy}>
            <DoorOpen /> Leave room
          </button>
        </section>
      ) : (
        <>
          <section className="create-room">
            <label className="field">
              <span>New room name</span>
              <div className="inline-field">
                <input value={name} onChange={(event) => setName(event.target.value)} />
                <button className="button button--primary" onClick={create} disabled={busy}>
                  <Plus /> Create
                </button>
              </div>
            </label>
            <p>Creating a room joins this client automatically. MPV does not join separately.</p>
          </section>

          <section className="room-list">
            <header>
              <div>
                <span>AVAILABLE ROOMS</span>
                <strong>{state.groups.length}</strong>
              </div>
              <button className="icon-button" onClick={refresh} aria-label="Refresh rooms">
                <RefreshCw className={busy ? 'spin' : ''} />
              </button>
            </header>
            {state.groups.length === 0 && !busy ? (
              <div className="empty-state empty-state--compact">
                <Users />
                <h3>No rooms are open</h3>
                <p>Create one here, or ask another viewer to start a group.</p>
              </div>
            ) : (
              state.groups.map((group) => (
                <button
                  className="room-row"
                  key={group.id}
                  onClick={() => join(group.id)}
                  disabled={busy}
                >
                  <span className="room-row__people"><Users /></span>
                  <span>
                    <strong>{group.name}</strong>
                    <small>{group.participants.join(', ') || 'Waiting for viewers'}</small>
                  </span>
                  <em>{group.state}</em>
                </button>
              ))
            )}
          </section>
        </>
      )}

      {busy && <div className="panel-busy"><LoaderCircle className="spin" /> Syncing with server…</div>}
      {state.error && <div className="form-error">{state.error}</div>}
    </aside>
  );
}
