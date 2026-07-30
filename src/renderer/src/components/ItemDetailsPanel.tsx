import {
  Clock3,
  Play,
  Star,
  Users,
  X
} from 'lucide-react';
import type {
  ItemDetails,
  SyncPlayState
} from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';
import { MediaFormatBadges } from './MediaFormatBadges';

interface Props {
  item: ItemDetails;
  syncPlay: SyncPlayState;
  onClose(): void;
  onPlay(): void;
  onWatchTogether(): void;
}
export function ItemDetailsPanel({
  item,
  syncPlay,
  onClose,
  onPlay,
  onWatchTogether
}: Props) {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section
        className="detail-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        aria-modal="true"
        role="dialog"
      >
        <button className="icon-button detail-sheet__close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <div className="detail-sheet__visual">
          {item.backdropUrl && <img src={item.backdropUrl} alt="" />}
          <div />
        </div>
        <div className="detail-sheet__body">
          <p className="eyebrow">{item.type.toUpperCase()}</p>
          <h1>{item.seriesName ?? item.name}</h1>
          {item.seriesName && <h2>{item.indexLabel} · {item.name}</h2>}
          <div className="detail-sheet__facts">
            {item.productionYear && <span>{item.productionYear}</span>}
            {item.officialRating && <span className="rating-chip">{item.officialRating}</span>}
            {item.runtimeTicks && <span><Clock3 /> {formatDurationFromTicks(item.runtimeTicks)}</span>}
            {item.communityRating && <span><Star fill="currentColor" /> {item.communityRating.toFixed(1)}</span>}
            <MediaFormatBadges mediaFormat={item.mediaFormat} />
          </div>
          {item.tagline && <blockquote>{item.tagline}</blockquote>}
          <p className="detail-sheet__overview">{item.overview ?? 'No overview is available.'}</p>
          <div className="detail-sheet__actions">
            {item.canPlay && (
              <button className="button button--primary" onClick={onPlay}>
                <Play fill="currentColor" />
                {item.playbackPositionTicks > 0 ? 'Resume' : syncPlay.membership === 'joined' ? 'Play with group' : 'Play'}
              </button>
            )}
            {item.canPlay && syncPlay.membership !== 'joined' && (
              <button className="button button--glass" onClick={onWatchTogether}>
                <Users /> Watch together
              </button>
            )}
          </div>
          {item.genres.length > 0 && (
            <div className="detail-sheet__meta">
              <span>Genres</span>
              <p>{item.genres.join(' · ')}</p>
            </div>
          )}
          {item.people.length > 0 && (
            <div className="people-strip">
              {item.people.slice(0, 8).map((person) => (
                <article key={`${person.id}-${person.name}`}>
                  <span>
                    {person.imageUrl ? <img src={person.imageUrl} alt="" /> : person.name.slice(0, 1)}
                  </span>
                  <strong>{person.name}</strong>
                  <small>{person.role ?? person.type}</small>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
