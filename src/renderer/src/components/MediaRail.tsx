import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem } from '@shared/contracts.js';
import { MediaCard } from './MediaCard';

interface Props {
  title: string;
  kicker?: string;
  items: MediaItem[];
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

export function MediaRail({
  title,
  kicker,
  items,
  landscape,
  presentation,
  onOpen,
  onPlay,
  onDismiss,
  onFavorite,
  onPlayed,
  onRestart,
  dismissLabel
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({
      start: track.scrollLeft <= 2,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2
    });
  }, []);
  const move = useCallback((direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({
      left: direction * Math.max(280, track.clientWidth * 0.82),
      behavior: 'smooth'
    });
  }, []);

  useEffect(() => {
    updateEdges();
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(track);
    return () => observer.disconnect();
  }, [items.length, landscape, updateEdges]);

  if (items.length === 0) return null;
  return (
    <section className={`rail${landscape ? ' rail--landscape' : ''}`}>
      <header className="rail__header">
        <div>
          {kicker && <p className="eyebrow">{kicker}</p>}
          <h2>{title}</h2>
        </div>
        <div className="rail__tools">
          <span>{items.length} titles</span>
          <button
            onClick={() => move(-1)}
            aria-label={`Scroll ${title} left`}
            disabled={edges.start}
          >
            <ChevronLeft />
          </button>
          <button
            onClick={() => move(1)}
            aria-label={`Scroll ${title} right`}
            disabled={edges.end}
          >
            <ChevronRight />
          </button>
        </div>
      </header>
      <div
        className={`rail__track${landscape ? ' rail__track--landscape' : ''}`}
        ref={trackRef}
        onScroll={updateEdges}
      >
        {items.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            landscape={landscape ?? false}
            presentation={presentation ?? 'standard'}
            onOpen={onOpen}
            onPlay={onPlay}
            {...(onDismiss ? { onDismiss } : {})}
            {...(onFavorite ? { onFavorite } : {})}
            {...(onPlayed ? { onPlayed } : {})}
            {...(onRestart ? { onRestart } : {})}
            {...(dismissLabel ? { dismissLabel } : {})}
          />
        ))}
      </div>
    </section>
  );
}
