import {
  Check,
  ListX,
  Play,
  Star
} from 'lucide-react';
import type { MediaItem } from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';

interface Props {
  item: MediaItem;
  landscape?: boolean;
  presentation?: 'standard' | 'next-up';
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
  onDismiss?(item: MediaItem): void;
}

export function MediaCard({
  item,
  landscape = false,
  presentation = 'standard',
  onOpen,
  onPlay,
  onDismiss
}: Props) {
  const isNextUp = presentation === 'next-up' && Boolean(item.seriesName);
  const title = isNextUp ? item.seriesName! : item.name;
  const context = isNextUp
    ? [item.indexLabel, item.name].filter(Boolean).join(' · ')
    : item.seriesName
      ? [item.seriesName, item.indexLabel].filter(Boolean).join(' · ')
      : item.indexLabel ?? item.productionYear ?? item.type;
  return (
    <article className={`media-card${landscape ? ' media-card--landscape' : ''}`}>
      <div className="media-card__art">
        <button
          className="media-card__open"
          onClick={() => onOpen(item)}
          aria-label={`Open ${item.name}`}
        >
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" loading="lazy" />
          ) : (
            <span className="media-card__fallback" aria-hidden="true">
              <i />
              <b>{item.name.slice(0, 1)}</b>
            </span>
          )}
          {item.isPlayed && <span className="media-card__watched"><Check /></span>}
          {item.playedPercentage > 0 && item.playedPercentage < 95 && (
            <span className="media-card__progress">
              <i style={{ width: `${item.playedPercentage}%` }} />
            </span>
          )}
        </button>
        {item.canPlay && (
          <button
            className="media-card__play"
            aria-label={`Play ${item.name}`}
            onClick={() => onPlay(item)}
          >
            <Play fill="currentColor" />
          </button>
        )}
        {onDismiss && (
          <button
            className="media-card__dismiss"
            aria-label={`Remove ${item.name} from Continue Watching`}
            title="Remove from Continue Watching"
            onClick={() => onDismiss(item)}
          >
            <ListX />
          </button>
        )}
      </div>
      <button className="media-card__copy" onClick={() => onOpen(item)}>
        <strong>{title}</strong>
        <span>
          {context}
          {item.runtimeTicks ? ` · ${formatDurationFromTicks(item.runtimeTicks)}` : ''}
          {item.communityRating ? (
            <em><Star fill="currentColor" /> {item.communityRating.toFixed(1)}</em>
          ) : null}
        </span>
      </button>
    </article>
  );
}
