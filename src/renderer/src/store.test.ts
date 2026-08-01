import { beforeEach, describe, expect, it } from 'vitest';
import type {
  HomePayload,
  ItemDetails,
  ItemsPage,
  MediaItem
} from '@shared/contracts.js';
import { playableHero, useAppStore } from './store';

const firstPage: ItemsPage = {
  items: [],
  startIndex: 0,
  totalRecordCount: 12
};

describe('renderer navigation history', () => {
  beforeEach(() => {
    useAppStore.getState().resetNavigation();
  });

  it('restores the previous view and its catalog page', () => {
    const store = useAppStore.getState();
    store.setPage(firstPage);
    store.setView({
      kind: 'library',
      library: {
        id: 'movies',
        name: 'Movies',
        collectionType: 'movies',
        imageUrl: null
      }
    });
    store.setPage({ ...firstPage, totalRecordCount: 42 });
    store.setView({ kind: 'search', query: 'Arrival' });

    expect(useAppStore.getState().goBack()).toBe(true);
    expect(useAppStore.getState().view).toMatchObject({ kind: 'library' });
    expect(useAppStore.getState().page?.totalRecordCount).toBe(42);
  });

  it('does not add duplicate history entries for the current view', () => {
    const store = useAppStore.getState();
    store.setView({ kind: 'home' });
    store.setView({ kind: 'home' });

    expect(useAppStore.getState().navigationHistory).toHaveLength(0);
    expect(useAppStore.getState().goBack()).toBe(false);
  });

  it('returns through series, season, and episode details in order', () => {
    const series = { id: 'series', name: 'Series', type: 'Series' } as ItemDetails;
    const season = { id: 'season-2', name: 'Season 2', type: 'Season' } as ItemDetails;
    const episode = { id: 'episode-3', name: 'Episode 3', type: 'Episode' } as ItemDetails;
    const store = useAppStore.getState();

    store.pushDetail(series);
    store.pushDetail(season);
    store.pushDetail(episode);

    expect(useAppStore.getState().detailHistory.map((item) => item.id)).toEqual([
      'series',
      'season-2'
    ]);
    expect(useAppStore.getState().goBackDetail()).toBe(true);
    expect(useAppStore.getState().detail?.id).toBe('season-2');
    expect(useAppStore.getState().goBackDetail()).toBe(true);
    expect(useAppStore.getState().detail?.id).toBe('series');
    expect(useAppStore.getState().goBackDetail()).toBe(false);
  });

  it('clears detail history when the modal closes', () => {
    const store = useAppStore.getState();
    store.pushDetail({ id: 'series', type: 'Series' } as ItemDetails);
    store.pushDetail({ id: 'season', type: 'Season' } as ItemDetails);

    store.setDetail(null);

    expect(useAppStore.getState().detail).toBeNull();
    expect(useAppStore.getState().detailHistory).toEqual([]);
  });
});

describe('home hero selection', () => {
  it('does not promote a series hidden from Up Next', () => {
    const hidden = { id: 'episode-1', seriesId: 'series-1' } as MediaItem;
    const visible = { id: 'episode-2', seriesId: 'series-2' } as MediaItem;
    const home = {
      libraries: [],
      resume: [],
      nextUp: [hidden, visible],
      favorites: [],
      recentlyPlayed: [],
      recommended: [],
      latest: []
    } satisfies HomePayload;

    expect(playableHero(home, ['series-1'])?.id).toBe('episode-2');
  });
});
