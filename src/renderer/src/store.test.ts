import { beforeEach, describe, expect, it } from 'vitest';
import type { ItemsPage } from '@shared/contracts.js';
import { useAppStore } from './store';

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
