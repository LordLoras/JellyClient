import {
  Check,
  Heart,
  ListX,
  MoreHorizontal,
  Play,
  RotateCcw,
  Star
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';

interface Props {
  item: MediaItem;
  landscape?: boolean;
  presentation?: 'standard' | 'next-up';
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
  onDismiss?(item: MediaItem): void;
  onFavorite?(item: MediaItem): void;
  onPlayed?(item: MediaItem): void;
  onRestart?(item: MediaItem): void;
  dismissLabel?: string;
}

export function MediaCard({
  item,
  landscape = false,
  presentation = 'standard',
  onOpen,
  onPlay,
  onDismiss,
  onFavorite,
  onPlayed,
  onRestart,
  dismissLabel = 'Remove from Continue Watching'
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);
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
          {!item.isPlayed && item.unplayedItemCount ? (
            <span className="media-card__count">{item.unplayedItemCount}</span>
          ) : null}
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
            title={dismissLabel}
            onClick={() => onDismiss(item)}
          >
            <ListX />
          </button>
        )}
        {(onFavorite || onPlayed || onRestart) && (
          <div className="media-card__menu" ref={menuRef}>
            <button
              className="media-card__menu-trigger"
              aria-label={`More actions for ${item.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal />
            </button>
            {menuOpen ? (
              <div className="media-card__menu-popover" role="menu">
                {onRestart && item.canPlay ? (
                  <button role="menuitem" onClick={() => {
                    setMenuOpen(false);
                    onRestart(item);
                  }}><RotateCcw /> Restart</button>
                ) : null}
                {onFavorite ? (
                  <button role="menuitem" onClick={() => {
                    setMenuOpen(false);
                    onFavorite(item);
                  }}><Heart fill={item.isFavorite ? 'currentColor' : 'none'} /> {item.isFavorite ? 'Remove from My List' : 'Add to My List'}</button>
                ) : null}
                {onPlayed ? (
                  <button role="menuitem" onClick={() => {
                    setMenuOpen(false);
                    onPlayed(item);
                  }}><Check /> {item.isPlayed ? 'Mark unwatched' : 'Mark watched'}</button>
                ) : null}
              </div>
            ) : null}
          </div>
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
