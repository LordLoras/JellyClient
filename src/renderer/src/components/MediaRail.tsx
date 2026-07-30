import { ChevronRight } from 'lucide-react';
import type { MediaItem } from '@shared/contracts.js';
import { MediaCard } from './MediaCard';

interface Props {
  title: string;
  kicker?: string;
  items: MediaItem[];
  landscape?: boolean;
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
}

export function MediaRail({
  title,
  kicker,
  items,
  landscape,
  onOpen,
  onPlay
}: Props) {
  if (items.length === 0) return null;
  return (
    <section className="rail">
      <header className="rail__header">
        <div>
          {kicker && <p className="eyebrow">{kicker}</p>}
          <h2>{title}</h2>
        </div>
        <span>{items.length} titles <ChevronRight /></span>
      </header>
      <div className="rail__track">
        {items.map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            landscape={landscape ?? false}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ))}
      </div>
    </section>
  );
}
