import { beforeEach, describe, expect, it } from 'vitest';
import type { HomePayload, ItemsPage, MediaItem } from '@shared/contracts.js';
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
