import {
  DoorOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Radio,
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
          <div className="clock-readout">
            <span>Clock offset <strong>{state.clockOffsetMs.toFixed(1)} ms</strong></span>
            <span>Round trip <strong>{state.roundTripMs.toFixed(1)} ms</strong></span>
            <span title="MPV playback timeline compared with the shared room clock">
              Playback offset <strong>{state.driftMs.toFixed(1)} ms</strong>
            </span>
          </div>
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
