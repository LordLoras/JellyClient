import {
  Check,
  Heart,
  ListX,
  MoreHorizontal,
  Play,
  RotateCcw,
  Star
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null);
  const positionMenu = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const triggerBounds = trigger.getBoundingClientRect();
    const menuWidth = Math.min(220, window.innerWidth - 16);
    const menuHeight = menuPopoverRef.current?.offsetHeight ?? 132;
    const left = Math.max(
      8,
      Math.min(triggerBounds.right - menuWidth, window.innerWidth - menuWidth - 8)
    );
    const fitsBelow = triggerBounds.bottom + 8 + menuHeight <= window.innerHeight - 8;
    const top = fitsBelow
      ? triggerBounds.bottom + 8
      : Math.max(8, triggerBounds.top - menuHeight - 8);
    setMenuPosition({ left, top, width: menuWidth });
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !menuPopoverRef.current?.contains(target)
      ) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [menuOpen, positionMenu]);
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
            aria-label={dismissLabel === 'Remove from Continue Watching'
              ? `Remove ${item.name} from Continue Watching`
              : `${dismissLabel}: ${title}`}
            title={dismissLabel}
            onClick={() => onDismiss(item)}
          >
            <ListX />
          </button>
        )}
        {(onFavorite || onPlayed || onRestart) && (
          <div className="media-card__menu" ref={menuRef}>
            <button
              ref={menuTriggerRef}
              className="media-card__menu-trigger"
              aria-label={`More actions for ${item.name}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal />
            </button>
            {menuOpen ? createPortal(
              <div
                className="media-card__menu-popover"
                ref={menuPopoverRef}
                role="menu"
                style={menuPosition ?? { visibility: 'hidden' }}
              >
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
              </div>,
              document.body
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
