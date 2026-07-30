import {
  Clock3,
  Play,
  Users
} from 'lucide-react';
import type {
  MediaItem,
  SyncPlayState
} from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';
import { MediaFormatBadges } from './MediaFormatBadges';

interface Props {
  item: MediaItem;
  syncPlay: SyncPlayState;
  onPlay(item: MediaItem): void;
  onWatchTogether(item: MediaItem): void;
  onOpen(item: MediaItem): void;
}
export function Hero({
  item,
  syncPlay,
  onPlay,
  onWatchTogether,
  onOpen
}: Props) {
  return (
    <section className="hero">
      {item.backdropUrl && <img className="hero__backdrop" src={item.backdropUrl} alt="" />}
      <div className="hero__wash" />
      <div className="hero__copy">
        <p className="eyebrow">
          {item.playbackPositionTicks > 0 ? 'CONTINUE SCREENING' : 'FEATURED TONIGHT'}
        </p>
        <button className="hero__title" onClick={() => onOpen(item)}>
          <h1>{item.seriesName ?? item.name}</h1>
          {item.seriesName && <h2>{item.indexLabel} · {item.name}</h2>}
        </button>
        <div className="hero__facts">
          {item.productionYear && <span>{item.productionYear}</span>}
          {item.officialRating && <span className="rating-chip">{item.officialRating}</span>}
          {item.runtimeTicks && <span><Clock3 /> {formatDurationFromTicks(item.runtimeTicks)}</span>}
          <MediaFormatBadges mediaFormat={item.mediaFormat} />
        </div>
        <p className="hero__overview">
          {item.overview ?? 'Ready for playback through the native MPV window.'}
        </p>
        <div className="hero__actions">
          <button className="button button--primary" onClick={() => onPlay(item)}>
            <Play fill="currentColor" />
            {item.playbackPositionTicks > 0 ? 'Resume' : syncPlay.membership === 'joined' ? 'Play with group' : 'Play'}
          </button>
          {syncPlay.membership !== 'joined' && (
            <button className="button button--glass" onClick={() => onWatchTogether(item)}>
              <Users />
              Watch together
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
