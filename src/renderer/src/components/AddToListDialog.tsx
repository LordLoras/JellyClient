import {
  FolderHeart,
  ListPlus,
  LoaderCircle,
  Plus,
  X
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  CatalogContainer,
  CatalogContainerKind,
  MediaItem
} from '@shared/contracts.js';

interface Props {
  item: MediaItem;
  onClose(): void;
  onChanged(message: string): void;
  onError(error: unknown): void;
}

export function AddToListDialog({ item, onClose, onChanged, onError }: Props) {
  const [kind, setKind] = useState<CatalogContainerKind>('playlist');
  const [containers, setContainers] = useState<Record<CatalogContainerKind, CatalogContainer[]>>({
    playlist: [],
    collection: []
  });
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.jellyClient.listContainers('playlist'),
      window.jellyClient.listContainers('collection')
    ]).then(([playlist, collection]) => {
      if (active) setContainers({ playlist, collection });
    }).catch(onError).finally(() => {
      if (active) setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [onError]);

  const add = async (container: CatalogContainer) => {
    setBusy(true);
    try {
      await window.jellyClient.addToContainer(kind, container.id, item.id);
      onChanged(`${item.name} was added to ${container.name}.`);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const updated = await window.jellyClient.createContainer(kind, name, item.id);
      setContainers((value) => ({ ...value, [kind]: updated }));
      onChanged(`${name} was created with ${item.name}.`);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-layer add-list-layer">
      <button className="confirm-layer__scrim" aria-label="Close list picker" onClick={onClose} />
      <section className="add-list-dialog" role="dialog" aria-modal="true" aria-labelledby="add-list-title">
        <header>
          <span><ListPlus /></span>
          <div><p className="eyebrow">SAVE TITLE</p><h2 id="add-list-title">Add to a list</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <p className="add-list-dialog__item">{item.seriesName ? `${item.seriesName} · ${item.name}` : item.name}</p>
        <div className="add-list-tabs" role="tablist">
          <button className={kind === 'playlist' ? 'is-active' : ''} onClick={() => setKind('playlist')} role="tab"><ListPlus /> Playlists</button>
          <button className={kind === 'collection' ? 'is-active' : ''} onClick={() => setKind('collection')} role="tab"><FolderHeart /> Collections</button>
        </div>
        <div className="add-list-options">
          {busy && containers[kind].length === 0 ? <span className="add-list-loading"><LoaderCircle className="spin" /> Loading…</span> : null}
          {!busy && containers[kind].length === 0 ? <p>No {kind}s yet. Create the first one below.</p> : null}
          {containers[kind].map((container) => (
            <button key={container.id} disabled={busy} onClick={() => void add(container)}>
              <span>{container.imageUrl ? <img src={container.imageUrl} alt="" /> : kind === 'playlist' ? <ListPlus /> : <FolderHeart />}</span>
              <strong>{container.name}</strong>
              <small>{container.itemCount} items</small>
              <Plus />
            </button>
          ))}
        </div>
        <form onSubmit={create}>
          <label className="field"><span>New {kind} name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={200} /></label>
          <button className="button button--primary" type="submit" disabled={busy || !newName.trim()}><Plus /> Create and add</button>
        </form>
      </section>
    </div>
  );
}
