import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Clock3,
  Check,
  Heart,
  ListVideo,
  ListPlus,
  Play,
  Star,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ItemDetails,
  MediaItem,
  PlayMediaInput,
  SyncPlayState
} from '@shared/contracts.js';
import { formatDurationFromTicks } from '../format';
import { MediaFormatBadges } from './MediaFormatBadges';

interface Props {
  item: ItemDetails;
  syncPlay: SyncPlayState;
  backLabel: string | null;
  onBack(): void;
  onClose(): void;
  onPlay(input: PlayMediaInput): void;
  onWatchTogether(): void;
  onOpen(item: MediaItem): void;
  onPlayItem(item: MediaItem): void;
  onAddToList(item: MediaItem): void;
  onBrowseGenre(genre: string): void;
  onBrowsePerson(id: string, name: string): void;
  onRemoveChild(parent: ItemDetails, child: MediaItem): void;
  onMoveChild(parent: ItemDetails, child: MediaItem, newIndex: number): void;
  onUpdated(item: ItemDetails): void;
  onError(error: unknown): void;
}
export function ItemDetailsPanel({
  item,
  syncPlay,
  backLabel,
  onBack,
  onClose,
  onPlay,
  onWatchTogether,
  onOpen,
  onPlayItem,
  onAddToList,
  onBrowseGenre,
  onBrowsePerson,
  onRemoveChild,
  onMoveChild,
  onUpdated,
  onError
}: Props) {
  const initialSource = useMemo(
    () => item.playbackSources.find((source) => source.supportsDirectPlay) ??
      item.playbackSources[0] ?? null,
    [item]
  );
  const [sourceId, setSourceId] = useState(initialSource?.id ?? '');
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const [maxBitrate, setMaxBitrate] = useState<number | null>(null);
  const [updating, setUpdating] = useState(false);
  const source = item.playbackSources.find((candidate) => candidate.id === sourceId) ??
    initialSource;
  const secondaryTitle = [item.indexLabel, item.name]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    setSourceId(initialSource?.id ?? '');
    setAudioIndex(null);
    setSubtitleIndex(null);
    setMaxBitrate(null);
  }, [item.id, initialSource?.id]);

  const start = (startPositionTicks = item.playbackPositionTicks) => onPlay({
    itemId: item.id,
    startPositionTicks,
    mediaSourceId: source?.id ?? null,
    maxStreamingBitrate: maxBitrate,
    audioStreamIndex: audioIndex,
    subtitleStreamIndex: subtitleIndex
  });

  const updateLibraryState = async (kind: 'favorite' | 'played') => {
    setUpdating(true);
    try {
      const updated = kind === 'favorite'
        ? await window.jellyClient.setFavorite(item.id, !item.isFavorite)
        : await window.jellyClient.setPlayed(item.id, !item.isPlayed);
      onUpdated(updated);
    } catch (error) {
      onError(error);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section
        className="detail-sheet"
        onMouseDown={(event) => event.stopPropagation()}
        aria-modal="true"
        role="dialog"
      >
        {backLabel ? (
          <button
            className="detail-sheet__back"
            type="button"
            onClick={onBack}
            aria-label={`Back to ${backLabel}`}
            title={`Back to ${backLabel}`}
          >
            <ArrowLeft />
            <span><small>BACK TO</small><strong>{backLabel}</strong></span>
          </button>
        ) : null}
        <button type="button" className="icon-button detail-sheet__close" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <div className="detail-sheet__visual">
          {item.backdropUrl && <img src={item.backdropUrl} alt="" />}
          <div />
        </div>
        <div className="detail-sheet__body">
          <p className="eyebrow">{item.type.toUpperCase()}</p>
          <h1>{item.seriesName ?? item.name}</h1>
          {item.seriesName && <h2>{secondaryTitle}</h2>}
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
              <button className="button button--primary" onClick={() => start()}>
                <Play fill="currentColor" />
                {item.playbackPositionTicks > 0 ? 'Resume' : syncPlay.membership === 'joined' ? 'Play with group' : 'Play'}
              </button>
            )}
            {item.canPlay && syncPlay.membership !== 'joined' && (
              <button className="button button--glass" onClick={onWatchTogether}>
                <Users /> Watch together
              </button>
            )}
            <button
              className={`button button--glass${item.isFavorite ? ' is-active' : ''}`}
              disabled={updating}
              onClick={() => void updateLibraryState('favorite')}
            >
              <Heart fill={item.isFavorite ? 'currentColor' : 'none'} />
              {item.isFavorite ? 'In favorites' : 'Add to favorites'}
            </button>
            <button
              className={`button button--glass${item.isPlayed ? ' is-active' : ''}`}
              disabled={updating}
              onClick={() => void updateLibraryState('played')}
            >
              <Check /> {item.isPlayed ? 'Watched' : 'Mark watched'}
            </button>
            <button className="button button--glass" onClick={() => onAddToList(item)}>
              <ListPlus /> Add to list
            </button>
          </div>
          {item.children.length > 0 && (
            <section className="detail-section detail-section--children">
              <header>
                <span><strong>{item.type === 'Series' ? 'Seasons' : item.type === 'Season' ? 'Episodes' : 'Titles'}</strong><small>{item.children.length} items</small></span>
                {item.children.some((child) => child.canPlay && !child.isPlayed) ? (
                  <button className="button button--glass" onClick={() => {
                    const next = item.children.find((child) => child.canPlay && !child.isPlayed);
                    if (next) onPlayItem(next);
                  }}><Play /> Play next unwatched</button>
                ) : null}
              </header>
              <div className="detail-child-grid">
                {item.children.map((child, index) => (
                  <article className="detail-child-card" key={`${child.id}-${child.playlistItemId ?? ''}`}>
                    <button onClick={() => onOpen(child)}>
                      <span>{child.imageUrl ? <img src={child.imageUrl} alt="" /> : <Play />}</span>
                      <div><strong>{child.indexLabel ? `${child.indexLabel} · ` : ''}{child.name}</strong><small>{child.isPlayed ? 'Watched' : child.unplayedItemCount ? `${child.unplayedItemCount} unwatched` : child.type}</small></div>
                    </button>
                    {item.type === 'Playlist' || item.type === 'BoxSet' ? (
                      <button className="detail-child-card__remove" aria-label={`Remove ${child.name} from ${item.name}`} onClick={() => onRemoveChild(item, child)}><Trash2 /></button>
                    ) : null}
                    {item.type === 'Playlist' ? (
                      <span className="detail-child-card__order">
                        <button disabled={index === 0} aria-label={`Move ${child.name} up`} onClick={() => onMoveChild(item, child, index - 1)}><ArrowUp /></button>
                        <button disabled={index === item.children.length - 1} aria-label={`Move ${child.name} down`} onClick={() => onMoveChild(item, child, index + 1)}><ArrowDown /></button>
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          )}
          {item.canPlay && item.playbackSources.length > 0 && (
            <section className="playback-options">
              <header><ListVideo /><span><strong>Playback options</strong><small>Choose a file, quality, and starting tracks.</small></span></header>
              <div className="playback-options__grid">
                <label className="field">
                  <span>Version</span>
                  <select value={source?.id ?? ''} onChange={(event) => {
                    setSourceId(event.target.value);
                    setAudioIndex(null);
                    setSubtitleIndex(null);
                  }}>
                    {item.playbackSources.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {sourceLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Quality</span>
                  <select
                    value={maxBitrate ?? 'original'}
                    onChange={(event) => setMaxBitrate(
                      event.target.value === 'original' ? null : Number(event.target.value)
                    )}
                  >
                    <option value="original">Original quality</option>
                    <option value={120_000_000}>Up to 120 Mbps</option>
                    <option value={80_000_000}>Up to 80 Mbps</option>
                    <option value={40_000_000}>Up to 40 Mbps</option>
                    <option value={20_000_000}>Up to 20 Mbps</option>
                    <option value={10_000_000}>Up to 10 Mbps</option>
                  </select>
                </label>
                <label className="field">
                  <span>Audio</span>
                  <select
                    value={audioIndex ?? 'auto'}
                    onChange={(event) => setAudioIndex(
                      event.target.value === 'auto' ? null : Number(event.target.value)
                    )}
                  >
                    <option value="auto">Preferred language</option>
                    {(source?.audioTracks ?? []).map((track) => (
                      <option key={track.index} value={track.index}>{trackLabel(track)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Subtitles</span>
                  <select
                    value={subtitleIndex ?? 'auto'}
                    onChange={(event) => setSubtitleIndex(
                      event.target.value === 'auto' ? null : Number(event.target.value)
                    )}
                  >
                    <option value="auto">Use preference</option>
                    <option value={-1}>Off</option>
                    {(source?.subtitleTracks ?? []).map((track) => (
                      <option key={track.index} value={track.index}>{trackLabel(track)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="playback-options__decision">
                {source?.supportsDirectPlay
                  ? 'This file can be sent to MPV without video conversion at original quality.'
                  : source?.supportsDirectStream
                    ? 'Jellyfin may repackage this file without converting the video.'
                    : 'Jellyfin will convert this file for the selected quality.'}
              </p>
            </section>
          )}
          {item.chapters.length > 0 && (
            <section className="detail-section">
              <header><span><strong>Chapters</strong><small>{item.chapters.length} markers</small></span></header>
              <div className="chapter-strip">
                {item.chapters.map((chapter, index) => (
                  <button key={`${chapter.startTicks}-${chapter.name}`} onClick={() => start(chapter.startTicks)}>
                    <span>{chapter.imageUrl ? <img src={chapter.imageUrl} alt="" /> : <b>{index + 1}</b>}</span>
                    <strong>{chapter.name || `Chapter ${index + 1}`}</strong>
                    <small>{formatDurationFromTicks(chapter.startTicks)}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {(item.specialFeatures.length > 0 || item.localTrailers.length > 0) && (
            <section className="detail-section">
              <header><span><strong>Extras and trailers</strong><small>From this Jellyfin item</small></span></header>
              <div className="extra-strip">
                {[...item.localTrailers, ...item.specialFeatures].map((extra) => (
                  <button key={extra.id} onClick={() => onOpen(extra)}>
                    <span>{extra.imageUrl ? <img src={extra.imageUrl} alt="" /> : <Play />}</span>
                    <strong>{extra.name}</strong>
                    <small>{extra.type}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {item.genres.length > 0 && (
            <div className="detail-sheet__meta">
              <span>Genres</span>
              <p>{item.genres.map((genre) => <button key={genre} onClick={() => onBrowseGenre(genre)}>{genre}</button>)}</p>
            </div>
          )}
          {item.people.length > 0 && (
            <div className="people-strip">
              {item.people.slice(0, 8).map((person) => (
                <button key={`${person.id}-${person.name}`} onClick={() => person.id && onBrowsePerson(person.id, person.name)}>
                  <span>
                    {person.imageUrl ? <img src={person.imageUrl} alt="" /> : person.name.slice(0, 1)}
                  </span>
                  <strong>{person.name}</strong>
                  <small>{person.role ?? person.type}</small>
                </button>
              ))}
            </div>
          )}
          {item.similarItems.length > 0 && (
            <section className="detail-section">
              <header><span><strong>More like this</strong><small>From Jellyfin</small></span></header>
              <div className="extra-strip">
                {item.similarItems.map((similar) => (
                  <button key={similar.id} onClick={() => onOpen(similar)}>
                    <span>{similar.imageUrl ? <img src={similar.imageUrl} alt="" /> : <Play />}</span>
                    <strong>{similar.name}</strong>
                    <small>{similar.productionYear ?? similar.type}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function sourceLabel(source: ItemDetails['playbackSources'][number]): string {
  return [
    source.name,
    source.resolution,
    source.videoRange,
    source.videoCodec?.toUpperCase()
  ].filter(Boolean).join(' · ');
}

function trackLabel(track: ItemDetails['playbackSources'][number]['audioTracks'][number]): string {
  return [
    track.title,
    track.language,
    track.codec?.toUpperCase(),
    track.channels,
    track.forced ? 'forced' : null,
    track.hearingImpaired ? 'SDH' : null
  ].filter(Boolean).join(' · ');
}
