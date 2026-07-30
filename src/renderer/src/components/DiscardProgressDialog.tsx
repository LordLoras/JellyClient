import {
  History,
  LoaderCircle,
  RotateCcw,
  X
} from 'lucide-react';
import {
  useEffect
} from 'react';
import type { MediaItem } from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';

interface Props {
  item: MediaItem;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function DiscardProgressDialog({
  item,
  busy,
  onCancel,
  onConfirm
}: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div className="confirm-layer">
      <button
        className="confirm-layer__scrim"
        aria-label="Cancel discarding progress"
        onClick={onCancel}
        disabled={busy}
      />
      <section
        className="discard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-progress-title"
      >
        <header>
          <span><History /></span>
          <button
            className="icon-button"
            aria-label="Cancel"
            onClick={onCancel}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        <p className="eyebrow">CONTINUE WATCHING</p>
        <h2 id="discard-progress-title">Discard saved progress?</h2>
        <p>
          <strong>{item.name}</strong> will be removed from Continue Watching
          and its resume position will return to the beginning.
        </p>
        <div className="discard-dialog__readout">
          <span>
            <small>Saved position</small>
            <strong>{formatDurationFromTicks(item.playbackPositionTicks)}</strong>
          </span>
          <i />
          <span>
            <small>After removal</small>
            <strong>00:00</strong>
          </span>
        </div>
        <p className="discard-dialog__safety">
          The media file is not deleted. This only clears your Jellyfin
          playback history for this item.
        </p>
        <footer>
          <button
            className="button button--glass"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            Keep progress
          </button>
          <button
            className="button button--danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="spin" /> : <RotateCcw />}
            {busy ? 'Removing…' : 'Discard & remove'}
          </button>
        </footer>
      </section>
    </div>
  );
}
