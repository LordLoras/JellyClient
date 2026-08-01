import {
  ArrowLeft,
  Boxes,
  CircleUserRound,
  Clapperboard,
  Clock3,
  Home,
  Heart,
  Library,
  ListVideo,
  LoaderCircle,
  LogOut,
  Radio,
  Search,
  Settings,
  Users,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from 'react';
import type {
  CatalogQuery,
  CatalogFilter,
  CatalogSort,
  HomeSectionId,
  LibraryView,
  MediaItem,
  PlayMediaInput
} from '@shared/contracts.js';
import { Brand } from './components/Brand';
import { AddToListDialog } from './components/AddToListDialog';
import { DiscardProgressDialog } from './components/DiscardProgressDialog';
import { Hero } from './components/Hero';
import { ItemDetailsPanel } from './components/ItemDetailsPanel';
import { LoginScreen } from './components/LoginScreen';
import { MediaCard } from './components/MediaCard';
import { MediaRail } from './components/MediaRail';
import { PlayerDock } from './components/PlayerDock';
import { SettingsPage } from './components/SettingsPage';
import { SyncPlayPanel } from './components/SyncPlayPanel';
import { friendlyError } from './format';
import {
  type MainView,
  playableHero,
  useAppStore
} from './store';

export function App() {
  const store = useAppStore();
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [discardItem, setDiscardItem] = useState<MediaItem | null>(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [addToListItem, setAddToListItem] = useState<MediaItem | null>(null);
  const [undoProgress, setUndoProgress] = useState<{
    item: MediaItem;
    positionTicks: number;
  } | null>(null);
  const [undoNextUp, setUndoNextUp] = useState<{
    item: MediaItem;
    seriesId: string;
  } | null>(null);
  const homeRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.jellyClient.subscribe((event) => {
      if (!active) return;
      const previousPlayback = useAppStore.getState().playback;
      useAppStore.getState().applyEvent(event);
      if (
        event.type === 'catalog-changed' ||
        (
          event.type === 'playback' &&
          event.data.status === 'stopped' &&
          previousPlayback?.status !== 'stopped'
        )
      ) {
        if (homeRefreshTimer.current !== null) {
          window.clearTimeout(homeRefreshTimer.current);
        }
        homeRefreshTimer.current = window.setTimeout(() => {
          homeRefreshTimer.current = null;
          void loadHome(true);
        }, 900);
      }
    });
    void window.jellyClient
      .bootstrap()
      .then((value) => {
        if (!active) return;
        useAppStore.getState().setBootstrap(value);
        if (value.connection.status === 'connected') void loadHome();
      })
      .catch((error) => {
        useAppStore.getState().addNotice('error', friendlyError(error));
      });
    return () => {
      active = false;
      if (homeRefreshTimer.current !== null) {
        window.clearTimeout(homeRefreshTimer.current);
      }
      unsubscribe();
    };
  }, []);

  const connected = store.connection?.status === 'connected';
  useEffect(() => {
    if (!connected) return;
    const refreshVisibleHome = () => {
      const state = useAppStore.getState();
      if (
        document.visibilityState === 'visible' &&
        state.view.kind === 'home'
      ) {
        void loadHome(true);
      }
    };
    const timer = window.setInterval(refreshVisibleHome, 5 * 60_000);
    window.addEventListener('focus', refreshVisibleHome);
    document.addEventListener('visibilitychange', refreshVisibleHome);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisibleHome);
      document.removeEventListener('visibilitychange', refreshVisibleHome);
    };
  }, [connected]);

  const hero = playableHero(
    store.home,
    store.settings?.home.dismissedNextUpSeriesIds
  );

  useEffect(() => {
    if (!undoProgress) return;
    const timer = window.setTimeout(() => setUndoProgress(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [undoProgress]);

  useEffect(() => {
    if (!undoNextUp) return;
    const timer = window.setTimeout(() => setUndoNextUp(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [undoNextUp]);

  const goBack = useCallback(() => {
    if (discardItem && !discardBusy) {
      setDiscardItem(null);
      return;
    }
    if (addToListItem) {
      setAddToListItem(null);
      return;
    }
    if (syncPanelOpen) {
      setSyncPanelOpen(false);
      return;
    }
    if (useAppStore.getState().detail) {
      useAppStore.getState().setDetail(null);
      return;
    }
    useAppStore.getState().goBack();
  }, [addToListItem, discardBusy, discardItem, syncPanelOpen]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3) return;
      event.preventDefault();
      goBack();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const escapeClosesOverlay = event.key === 'Escape' && Boolean(
        discardItem || addToListItem || syncPanelOpen || useAppStore.getState().detail
      );
      if ((event.altKey && event.key === 'ArrowLeft') || escapeClosesOverlay) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [addToListItem, goBack]);

  if (!store.bootstrap || !store.connection || !store.settings || !store.mpv || !store.playback || !store.syncPlay) {
    return (
      <main className="boot-screen">
        <Brand />
        <span><LoaderCircle className="spin" /></span>
        <p>Starting JellyClient…</p>
      </main>
    );
  }

  if (store.connection.status !== 'connected') {
    return (
      <>
        <LoginScreen
          connection={store.connection}
          configPath={store.bootstrap.configPath}
          onConnected={(connection) => {
            store.setConnection(connection);
            if (connection.status === 'connected') void loadHome();
          }}
        />
        <Notices />
      </>
    );
  }

  const openItem = async (item: MediaItem) => {
    if (
      item.isFolder &&
      !['Series', 'Season', 'BoxSet', 'Playlist'].includes(item.type)
    ) {
      const library: LibraryView = {
        id: item.id,
        name: item.name,
        collectionType: item.type,
        imageUrl: item.imageUrl
      };
      await loadItems(library, '');
      return;
    }
    store.setBusy(true);
    try {
      store.setDetail(await window.jellyClient.getItem(item.id));
    } catch (error) {
      store.addNotice('error', friendlyError(error));
    } finally {
      store.setBusy(false);
    }
  };

  const play = async (item: MediaItem, requested?: PlayMediaInput) => {
    const input: PlayMediaInput = requested ?? {
      itemId: item.id,
      startPositionTicks: item.playbackPositionTicks,
      mediaSourceId: null,
      maxStreamingBitrate: null,
      audioStreamIndex: null,
      subtitleStreamIndex: null
    };
    try {
      await window.jellyClient.play(input);
      store.setDetail(null);
      if (!store.mpv?.available) {
        store.addNotice(
          'warning',
          'Select mpv.exe in Settings before playback can open.'
        );
      }
    } catch (error) {
      store.addNotice('error', friendlyError(error));
    }
  };

  const watchTogether = async (item: MediaItem) => {
    try {
      const state = await window.jellyClient.watchTogether({
        itemId: item.id,
        startPositionTicks: item.playbackPositionTicks,
        groupName: `${store.connection?.user?.name ?? 'JellyClient'}’s room`
      });
      useAppStore.setState({ syncPlay: state });
      store.setDetail(null);
      setSyncPanelOpen(true);
    } catch (error) {
      store.addNotice('error', friendlyError(error));
    }
  };

  const updateItemState = async (
    item: MediaItem,
    kind: 'favorite' | 'played'
  ) => {
    try {
      const updated = kind === 'favorite'
        ? await window.jellyClient.setFavorite(item.id, !item.isFavorite)
        : await window.jellyClient.setPlayed(item.id, !item.isPlayed);
      const current = useAppStore.getState();
      if (current.page) {
        current.setPage({
          ...current.page,
          items: current.page.items.map((candidate) =>
            candidate.id === updated.id ? { ...candidate, ...updated } : candidate
          )
        });
      }
      if (current.detail?.id === updated.id) current.setDetail(updated);
      await loadHome(true);
    } catch (error) {
      store.addNotice('error', friendlyError(error));
    }
  };

  const dismissNextUp = async (item: MediaItem) => {
    const seriesId = item.seriesId ?? item.id;
    const current = useAppStore.getState();
    if (!current.settings) return;
    const dismissed = current.settings.home.dismissedNextUpSeriesIds;
    if (dismissed.includes(seriesId)) return;
    try {
      const settings = await window.jellyClient.saveSettings({
        ...current.settings,
        home: {
          ...current.settings.home,
          dismissedNextUpSeriesIds: [...dismissed, seriesId]
        }
      });
      current.setSettings(settings);
      setUndoNextUp({ item, seriesId });
    } catch (error) {
      current.addNotice('error', friendlyError(error));
    }
  };

  const browseGenre = (genre: string) => {
    store.setDetail(null);
    void loadSpecialCatalog({
      view: { kind: 'genre', genre },
      query: { genres: [genre] }
    });
  };

  const browsePerson = (id: string, name: string) => {
    store.setDetail(null);
    void loadSpecialCatalog({
      view: { kind: 'person', id, name },
      query: { personIds: [id] }
    });
  };

  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      store.setView({ kind: 'home' });
      return;
    }
    store.setBusy(true);
    store.setView({ kind: 'search', query });
    try {
      store.setPage(await window.jellyClient.getItems({
        parentId: null,
        searchTerm: query,
        startIndex: 0,
        limit: 100,
        includeItemTypes: [
          'Movie',
          'Series',
          'Season',
          'Episode',
          'Video',
          'BoxSet'
        ]
      }));
    } catch (error) {
      store.addNotice('error', friendlyError(error));
    } finally {
      store.setBusy(false);
    }
  };

  return (
    <div className={`app-shell${store.playback.item ? ' app-shell--playing' : ''}`}>
      <aside className="sidebar">
        <Brand compact />
        <nav className="sidebar__nav" aria-label="Primary navigation">
          <NavButton
            active={store.view.kind === 'home'}
            icon={<Home />}
            label="Home"
            onClick={() => {
              store.setView({ kind: 'home' });
              void loadHome(true);
            }}
          />
          <NavButton
            active={store.view.kind === 'favorites'}
            icon={<Heart />}
            label="My List"
            onClick={() => void loadFavorites()}
          />
          <NavButton
            active={store.view.kind === 'history'}
            icon={<Clock3 />}
            label="History"
            onClick={() => void loadSpecialCatalog({
              view: { kind: 'history' },
              query: {
                filter: 'played',
                sortBy: 'DatePlayed',
                sortDescending: true,
                includeItemTypes: ['Movie', 'Episode', 'Video']
              }
            })}
          />
          <NavButton
            active={store.view.kind === 'playlists'}
            icon={<ListVideo />}
            label="Playlists"
            onClick={() => void loadSpecialCatalog({
              view: { kind: 'playlists' },
              query: { includeItemTypes: ['Playlist'] }
            })}
          />
          <NavButton
            active={store.view.kind === 'collections'}
            icon={<Boxes />}
            label="Collections"
            onClick={() => void loadSpecialCatalog({
              view: { kind: 'collections' },
              query: { includeItemTypes: ['BoxSet'] }
            })}
          />
          <p>LIBRARIES</p>
          {(store.home?.libraries ?? []).map((library) => (
            <NavButton
              key={library.id}
              active={
                store.view.kind === 'library' &&
                store.view.library.id === library.id
              }
              icon={<Library />}
              label={library.name}
              onClick={() => void loadItems(library, '')}
            />
          ))}
          <p>TOOLS</p>
          <NavButton
            active={store.view.kind === 'settings'}
            icon={<Settings />}
            label="Settings"
            onClick={() => store.setView({ kind: 'settings' })}
          />
        </nav>
        <button
          className="sidebar__profile"
          onClick={() => store.setView({ kind: 'settings' })}
        >
          <span><CircleUserRound /></span>
          <span>
            <strong>{store.connection.user?.name}</strong>
            <small>{store.connection.server?.name}</small>
          </span>
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__leading">
            <button
              className="back-button"
              aria-label="Go back"
              title="Back · Mouse button 4 · Alt+Left"
              disabled={
                store.navigationHistory.length === 0 &&
                !store.detail &&
                !syncPanelOpen &&
                !discardItem
              }
              onClick={goBack}
            >
              <ArrowLeft />
            </button>
            <form className="search-box" onSubmit={submitSearch}>
              <Search />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search your library"
                aria-label="Search your library"
              />
              <kbd>Enter</kbd>
            </form>
          </div>
          <div className="topbar__actions">
            <span className={`connection-pill${store.connection.status === 'connected' ? ' is-online' : ''}`}>
              {store.connection.status === 'connected' ? <Wifi /> : <WifiOff />}
              {store.connection.status}
            </span>
            <button
              className={`sync-button${store.syncPlay.currentGroup ? ' is-joined' : ''}`}
              onClick={() => setSyncPanelOpen(true)}
            >
              <Users />
              <span>
                <small>SYNCPLAY</small>
                <strong>{store.syncPlay.currentGroup?.name ?? 'Join a room'}</strong>
              </span>
              {store.syncPlay.currentGroup && <i />}
            </button>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                store.setConnection(await window.jellyClient.disconnect());
                store.resetNavigation();
                store.setHome({
                  libraries: [],
                  resume: [],
                  nextUp: [],
                  favorites: [],
                  recentlyPlayed: [],
                  recommended: [],
                  latest: []
                });
              }}
            >
              <LogOut />
            </button>
          </div>
        </header>

        {store.syncPlay.currentGroup && (
          <button className="group-ribbon" onClick={() => setSyncPanelOpen(true)}>
            <Radio />
            <span>
              <strong>{store.syncPlay.currentGroup.name}</strong>
              {store.syncPlay.currentGroup.participants.join(' · ')}
            </span>
            <em>{store.syncPlay.currentGroup.state}</em>
          </button>
        )}

        <main className="content">
          {store.view.kind === 'home' && (
            <HomeView
              hero={hero}
              sectionOrder={store.settings.home.sectionOrder}
              hiddenSections={store.settings.home.hiddenSections}
              dismissedNextUpSeriesIds={store.settings.home.dismissedNextUpSeriesIds}
              onOpen={openItem}
              onPlay={play}
              onWatchTogether={watchTogether}
              onDiscardProgress={setDiscardItem}
              onDismissNextUp={(item) => void dismissNextUp(item)}
              onFavorite={(item) => void updateItemState(item, 'favorite')}
              onPlayed={(item) => void updateItemState(item, 'played')}
              onRestart={(item) => void play(item, {
                itemId: item.id,
                startPositionTicks: 0,
                mediaSourceId: null,
                maxStreamingBitrate: null,
                audioStreamIndex: null,
                subtitleStreamIndex: null
              })}
            />
          )}
          {(store.view.kind === 'library' ||
            store.view.kind === 'search' ||
            store.view.kind === 'favorites' ||
            store.view.kind === 'history' ||
            store.view.kind === 'playlists' ||
            store.view.kind === 'collections' ||
            store.view.kind === 'genre' ||
            store.view.kind === 'person') && (
            <CatalogView
              title={catalogTitle(store.view)}
              baseQuery={catalogBaseQuery(store.view)}
              items={store.page?.items ?? []}
              total={store.page?.totalRecordCount ?? 0}
              busy={store.busy}
              onOpen={openItem}
              onPlay={play}
              onFavorite={(item) => void updateItemState(item, 'favorite')}
              onPlayed={(item) => void updateItemState(item, 'played')}
              onRestart={(item) => void play(item, {
                itemId: item.id,
                startPositionTicks: 0,
                mediaSourceId: null,
                maxStreamingBitrate: null,
                audioStreamIndex: null,
                subtitleStreamIndex: null
              })}
            />
          )}
          {store.view.kind === 'settings' && (
            <SettingsPage
              settings={store.settings}
              mpv={store.mpv}
              configPath={store.bootstrap.configPath}
              onSaved={(settings, mpv) => {
                store.setSettings(settings);
                store.setMpv(mpv);
              }}
              onMpvChanged={(mpv) => store.setMpv(mpv)}
              onNotice={(level, message) => store.addNotice(level, message)}
            />
          )}
        </main>
      </div>

      {store.detail && (
        <ItemDetailsPanel
          item={store.detail}
          syncPlay={store.syncPlay}
          onClose={() => store.setDetail(null)}
          onPlay={(input) => void play(store.detail!, input)}
          onWatchTogether={() => void watchTogether(store.detail!)}
          onOpen={(item) => void openItem(item)}
          onPlayItem={(item) => void play(item)}
          onAddToList={setAddToListItem}
          onBrowseGenre={browseGenre}
          onBrowsePerson={browsePerson}
          onRemoveChild={(parent, child) => {
            const kind = parent.type === 'Playlist' ? 'playlist' : 'collection';
            const entryId = kind === 'playlist'
              ? child.playlistItemId
              : child.id;
            if (!entryId) {
              store.addNotice('error', 'Jellyfin did not provide a removable list entry.');
              return;
            }
            void window.jellyClient.removeFromContainer(
              kind,
              parent.id,
              entryId
            ).then(async () => {
              store.setDetail(await window.jellyClient.getItem(parent.id));
              store.addNotice('info', `${child.name} was removed from ${parent.name}.`);
            }).catch((error) => store.addNotice('error', friendlyError(error)));
          }}
          onMoveChild={(parent, child, newIndex) => {
            if (!child.playlistItemId) return;
            void window.jellyClient.movePlaylistItem(
              parent.id,
              child.playlistItemId,
              newIndex
            ).then(async () => {
              store.setDetail(await window.jellyClient.getItem(parent.id));
            }).catch((error) => store.addNotice('error', friendlyError(error)));
          }}
          onUpdated={(item) => {
            store.setDetail(item);
            void loadHome(true);
          }}
          onError={(error) => store.addNotice('error', friendlyError(error))}
        />
      )}

      {syncPanelOpen && (
        <>
          <button
            className="panel-scrim"
            aria-label="Close SyncPlay"
            onClick={() => setSyncPanelOpen(false)}
          />
          <SyncPlayPanel
            state={store.syncPlay}
            onClose={() => setSyncPanelOpen(false)}
            onChange={(syncPlay) => useAppStore.setState({ syncPlay })}
            onNotice={(message) => store.addNotice('error', message)}
          />
        </>
      )}

      {discardItem && (
        <DiscardProgressDialog
          item={discardItem}
          busy={discardBusy}
          onCancel={() => {
            if (!discardBusy) setDiscardItem(null);
          }}
          onConfirm={() => {
            setDiscardBusy(true);
            void window.jellyClient
              .discardPlaybackProgress(discardItem.id)
              .then((home) => {
                store.setHome(home);
                setUndoProgress({
                  item: discardItem,
                  positionTicks: discardItem.playbackPositionTicks
                });
                setDiscardItem(null);
              })
              .catch((error) =>
                store.addNotice('error', friendlyError(error))
              )
              .finally(() => setDiscardBusy(false));
          }}
        />
      )}

      {addToListItem && (
        <AddToListDialog
          item={addToListItem}
          onClose={() => setAddToListItem(null)}
          onChanged={(message) => {
            store.addNotice('info', message);
            void loadHome(true);
          }}
          onError={reportListError}
        />
      )}

      {undoProgress && (
        <div className="undo-progress" role="status">
          <span><strong>Removed from Continue Watching</strong><small>{undoProgress.item.name}</small></span>
          <button onClick={() => {
            const pending = undoProgress;
            setUndoProgress(null);
            void window.jellyClient.restorePlaybackProgress(
              pending.item.id,
              pending.positionTicks
            ).then((home) => store.setHome(home)).catch((error) =>
              store.addNotice('error', friendlyError(error))
            );
          }}>Undo</button>
        </div>
      )}

      {undoNextUp && (
        <div className="undo-progress" role="status">
          <span>
            <strong>Hidden from Up Next</strong>
            <small>{undoNextUp.item.seriesName ?? undoNextUp.item.name}</small>
          </span>
          <button onClick={() => {
            const pending = undoNextUp;
            setUndoNextUp(null);
            const current = useAppStore.getState();
            if (!current.settings) return;
            void window.jellyClient.saveSettings({
              ...current.settings,
              home: {
                ...current.settings.home,
                dismissedNextUpSeriesIds:
                  current.settings.home.dismissedNextUpSeriesIds.filter(
                    (id) => id !== pending.seriesId
                  )
              }
            }).then((settings) => current.setSettings(settings)).catch((error) =>
              current.addNotice('error', friendlyError(error))
            );
          }}>Undo</button>
        </div>
      )}

      <PlayerDock
        playback={store.playback}
        syncPlay={store.syncPlay}
        onAction={(action) => {
          void window.jellyClient
            .playbackAction(action)
            .catch((error) => store.addNotice('error', friendlyError(error)));
        }}
      />
      {store.busy && <div className="global-busy"><LoaderCircle className="spin" /></div>}
      <Notices />
    </div>
  );
}

function HomeView({
  hero,
  sectionOrder,
  hiddenSections,
  dismissedNextUpSeriesIds,
  onOpen,
  onPlay,
  onWatchTogether,
  onDiscardProgress,
  onDismissNextUp,
  onFavorite,
  onPlayed,
  onRestart
}: {
  hero: MediaItem | null;
  sectionOrder: HomeSectionId[];
  hiddenSections: HomeSectionId[];
  dismissedNextUpSeriesIds: string[];
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
  onWatchTogether(item: MediaItem): void;
  onDiscardProgress(item: MediaItem): void;
  onDismissNextUp(item: MediaItem): void;
  onFavorite(item: MediaItem): void;
  onPlayed(item: MediaItem): void;
  onRestart(item: MediaItem): void;
}) {
  const home = useAppStore((state) => state.home);
  const syncPlay = useAppStore((state) => state.syncPlay)!;
  if (!home) {
    return <PageLoading />;
  }
  const railActions = { onOpen, onPlay, onFavorite, onPlayed, onRestart };
  const renderSection = (section: HomeSectionId) => {
    switch (section) {
      case 'resume':
        return <MediaRail key={section} title="Continue watching" items={home.resume} landscape {...railActions} onDismiss={onDiscardProgress} />;
      case 'nextUp':
        return (
          <MediaRail
            key={section}
            title="Up next"
            items={home.nextUp.filter(
              (item) => !dismissedNextUpSeriesIds.includes(item.seriesId ?? item.id)
            )}
            landscape
            presentation="next-up"
            dismissLabel="Hide from Up Next"
            onDismiss={onDismissNextUp}
            {...railActions}
          />
        );
      case 'favorites':
        return <MediaRail key={section} title="My List" items={home.favorites} {...railActions} />;
      case 'recentlyPlayed':
        return <MediaRail key={section} title="Recently watched" items={home.recentlyPlayed} landscape {...railActions} />;
      case 'recommended':
        return <MediaRail key={section} title="Recommended" items={home.recommended} {...railActions} />;
      case 'latest':
        return <MediaRail key={section} title="Recently added" items={home.latest} {...railActions} />;
      case 'libraries':
        return home.libraries.length > 0 ? (
          <section className="library-band" key={section}>
            <header className="rail__header"><div><h2>Your libraries</h2></div></header>
            <div className="library-band__grid">
              {home.libraries.map((library, index) => (
                <button key={library.id} onClick={() => void loadItems(library, '')} style={{ '--library-index': index } as React.CSSProperties}>
                  {library.imageUrl && <img src={library.imageUrl} alt="" />}
                  <i />
                  <span><small>{library.collectionType ?? 'Library'}</small><strong>{library.name}</strong></span>
                </button>
              ))}
            </div>
          </section>
        ) : null;
    }
  };

  return (
    <div className="home-view">
      {hero ? (
        <Hero
          item={hero}
          syncPlay={syncPlay}
          onOpen={onOpen}
          onPlay={onPlay}
          onWatchTogether={onWatchTogether}
        />
      ) : (
        <div className="empty-hero">
          <Clapperboard />
          <h1>No playable media found</h1>
          <p>Jellyfin has not returned any playable video yet.</p>
        </div>
      )}
      {sectionOrder
        .filter((section) => !hiddenSections.includes(section))
        .map(renderSection)}
    </div>
  );
}

function CatalogView({
  title,
  baseQuery,
  items,
  total,
  busy,
  onOpen,
  onPlay,
  onFavorite,
  onPlayed,
  onRestart
}: {
  title: string;
  baseQuery: Partial<CatalogQuery>;
  items: MediaItem[];
  total: number;
  busy: boolean;
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
  onFavorite(item: MediaItem): void;
  onPlayed(item: MediaItem): void;
  onRestart(item: MediaItem): void;
}) {
  const initialSort = baseQuery.sortBy ?? 'SortName';
  const initialDescending = baseQuery.sortDescending ?? false;
  const initialFilter = baseQuery.filter ?? 'all';
  const fixedType = baseQuery.includeItemTypes?.length === 1
    ? baseQuery.includeItemTypes[0] ?? 'all'
    : 'all';
  const baseQueryKey = JSON.stringify(baseQuery);
  const containerOnly = fixedType === 'Playlist' || fixedType === 'BoxSet';
  const [sortBy, setSortBy] = useState<CatalogSort>(initialSort);
  const [descending, setDescending] = useState(initialDescending);
  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);
  const [mediaType, setMediaType] = useState(fixedType);
  const [genreText, setGenreText] = useState((baseQuery.genres ?? []).join(', '));
  const [yearText, setYearText] = useState((baseQuery.years ?? []).join(', '));
  const [minRating, setMinRating] = useState(baseQuery.minCommunityRating ?? 0);
  const [is4K, setIs4K] = useState(baseQuery.is4K ?? false);
  const [hasSubtitles, setHasSubtitles] = useState(baseQuery.hasSubtitles ?? false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setSortBy(initialSort);
    setDescending(initialDescending);
    setFilter(initialFilter);
    setMediaType(fixedType);
    setGenreText((baseQuery.genres ?? []).join(', '));
    setYearText((baseQuery.years ?? []).join(', '));
    setMinRating(baseQuery.minCommunityRating ?? 0);
    setIs4K(baseQuery.is4K ?? false);
    setHasSubtitles(baseQuery.hasSubtitles ?? false);
  }, [title, baseQueryKey]);

  const changeQuery = async (
    nextSort: CatalogSort,
    nextDescending: boolean,
    nextFilter: CatalogFilter,
    nextMediaType = mediaType
  ) => {
    const state = useAppStore.getState();
    state.setBusy(true);
    try {
      const genres = genreText.split(',').map((value) => value.trim()).filter(Boolean);
      const years = yearText.split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 1800 && value <= 3000);
      state.setPage(await window.jellyClient.getItems({
        parentId: baseQuery.parentId ?? null,
        searchTerm: baseQuery.searchTerm ?? '',
        startIndex: 0,
        limit: 150,
        includeItemTypes: nextMediaType === 'all'
          ? baseQuery.includeItemTypes ?? []
          : [nextMediaType],
        sortBy: nextSort,
        sortDescending: nextDescending,
        filter: nextFilter,
        genres: genres.length > 0 ? genres : undefined,
        years: years.length > 0 ? years : undefined,
        personIds: baseQuery.personIds,
        minCommunityRating: minRating > 0 ? minRating : undefined,
        is4K: is4K || undefined,
        hasSubtitles: hasSubtitles || undefined
      }));
    } catch (error) {
      state.addNotice('error', friendlyError(error));
    } finally {
      state.setBusy(false);
    }
  };

  return (
    <div className="catalog-view page-pad">
      <header className="page-title page-title--row">
        <div><p className="eyebrow">BROWSE</p><h1>{title}</h1></div>
        <div className="catalog-controls">
          <label>
            <span>Show</span>
            <select value={filter} onChange={(event) => {
              const value = event.target.value as CatalogFilter;
              setFilter(value);
              void changeQuery(sortBy, descending, value);
            }}>
              <option value="all">All</option>
              <option value="unplayed">Unwatched</option>
              <option value="played">Watched</option>
              <option value="favorite">Favorites</option>
            </select>
          </label>
          {!containerOnly ? (
            <label>
              <span>Type</span>
              <select value={mediaType} onChange={(event) => {
                const value = event.target.value;
                setMediaType(value);
                void changeQuery(sortBy, descending, filter, value);
              }}>
                <option value="all">All video</option>
                <option value="Movie">Movies</option>
                <option value="Series">Series</option>
                <option value="Episode">Episodes</option>
                <option value="Video">Videos</option>
                <option value="BoxSet">Collections</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>Sort</span>
            <select value={sortBy} onChange={(event) => {
              const value = event.target.value as CatalogSort;
              setSortBy(value);
              void changeQuery(value, descending, filter);
            }}>
              <option value="SortName">Title</option>
              <option value="DateCreated">Date added</option>
              <option value="PremiereDate">Release date</option>
              <option value="ProductionYear">Year</option>
              <option value="CommunityRating">Rating</option>
              <option value="Runtime">Runtime</option>
              <option value="DatePlayed">Last watched</option>
            </select>
          </label>
          <button onClick={() => {
            const value = !descending;
            setDescending(value);
            void changeQuery(sortBy, value, filter);
          }}>{descending ? 'Descending' : 'Ascending'}</button>
          {!containerOnly ? <button className={advancedOpen ? 'is-active' : ''} onClick={() => setAdvancedOpen((value) => !value)}>Filters</button> : null}
          <span>{total} items</span>
        </div>
      </header>
      {advancedOpen && !containerOnly ? (
        <section className="catalog-filters">
          <label className="field"><span>Genres</span><input value={genreText} onChange={(event) => setGenreText(event.target.value)} placeholder="Drama, Science Fiction" /></label>
          <label className="field"><span>Years</span><input value={yearText} onChange={(event) => setYearText(event.target.value)} placeholder="2024, 2025" /></label>
          <label className="field"><span>Minimum rating</span><select value={minRating} onChange={(event) => setMinRating(Number(event.target.value))}><option value={0}>Any</option><option value={6}>6+</option><option value={7}>7+</option><option value={8}>8+</option><option value={9}>9+</option></select></label>
          <label className="catalog-check"><input type="checkbox" checked={is4K} onChange={(event) => setIs4K(event.target.checked)} /><span>4K only</span></label>
          <label className="catalog-check"><input type="checkbox" checked={hasSubtitles} onChange={(event) => setHasSubtitles(event.target.checked)} /><span>Has subtitles</span></label>
          <button className="button button--primary" onClick={() => void changeQuery(sortBy, descending, filter)}>Apply filters</button>
        </section>
      ) : null}
      {items.length > 0 ? (
        <div className="media-grid">
          {items.map((item) => (
            <MediaCard
              key={`${item.id}-${item.playlistItemId ?? ''}`}
              item={item}
              onOpen={onOpen}
              onPlay={onPlay}
              onFavorite={onFavorite}
              onPlayed={onPlayed}
              onRestart={onRestart}
            />
          ))}
        </div>
      ) : !busy ? (
        <div className="empty-state">
          <Search />
          <h2>No titles found</h2>
          <p>Try changing the filters or choose another library.</p>
        </div>
      ) : null}
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button className={active ? 'is-active' : ''} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

function PageLoading() {
  return (
    <div className="page-loading">
      <LoaderCircle className="spin" />
      <span>Reading your library…</span>
    </div>
  );
}

function Notices() {
  const notices = useAppStore((state) => state.notices);
  const dismiss = useAppStore((state) => state.dismissNotice);
  useEffect(() => {
    if (notices.length === 0) return;
    const timer = setTimeout(() => dismiss(notices[0]!.id), 6500);
    return () => clearTimeout(timer);
  }, [notices, dismiss]);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((notice) => (
        <button
          key={notice.id}
          className={`notice notice--${notice.level}`}
          onClick={() => dismiss(notice.id)}
        >
          <i />
          <span>{notice.message}</span>
        </button>
      ))}
    </div>
  );
}

async function loadHome(background = false): Promise<void> {
  const state = useAppStore.getState();
  if (!background) state.setBusy(true);
  try {
    state.setHome(await window.jellyClient.getHome());
  } catch (error) {
    if (!background) state.addNotice('error', friendlyError(error));
  } finally {
    if (!background) state.setBusy(false);
  }
}

async function loadItems(library: LibraryView, searchTerm: string): Promise<void> {
  const state = useAppStore.getState();
  state.setBusy(true);
  state.setView({ kind: 'library', library });
  try {
    state.setPage(await window.jellyClient.getItems({
      parentId: library.id,
      searchTerm,
      startIndex: 0,
      limit: 150,
      includeItemTypes: []
    }));
  } catch (error) {
    state.addNotice('error', friendlyError(error));
  } finally {
    state.setBusy(false);
  }
}

async function loadFavorites(): Promise<void> {
  return loadSpecialCatalog({
    view: { kind: 'favorites' },
    query: {
      includeItemTypes: ['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet'],
      sortBy: 'SortName',
      sortDescending: false,
      filter: 'favorite'
    }
  });
}

async function loadSpecialCatalog({
  view,
  query
}: {
  view: MainView;
  query: Partial<CatalogQuery>;
}): Promise<void> {
  const state = useAppStore.getState();
  state.setBusy(true);
  state.setView(view);
  try {
    state.setPage(await window.jellyClient.getItems({
      parentId: query.parentId ?? null,
      searchTerm: query.searchTerm ?? '',
      startIndex: 0,
      limit: 150,
      includeItemTypes: query.includeItemTypes ?? [
        'Movie',
        'Series',
        'Season',
        'Episode',
        'Video',
        'BoxSet'
      ],
      ...(query.sortBy ? { sortBy: query.sortBy } : {}),
      ...(query.sortDescending !== undefined ? { sortDescending: query.sortDescending } : {}),
      ...(query.filter ? { filter: query.filter } : {}),
      ...(query.genres ? { genres: query.genres } : {}),
      ...(query.years ? { years: query.years } : {}),
      ...(query.personIds ? { personIds: query.personIds } : {}),
      ...(query.minCommunityRating !== undefined ? { minCommunityRating: query.minCommunityRating } : {}),
      ...(query.is4K !== undefined ? { is4K: query.is4K } : {}),
      ...(query.hasSubtitles !== undefined ? { hasSubtitles: query.hasSubtitles } : {})
    }));
  } catch (error) {
    state.addNotice('error', friendlyError(error));
  } finally {
    state.setBusy(false);
  }
}

function catalogTitle(view: MainView): string {
  switch (view.kind) {
    case 'library': return view.library.name;
    case 'search': return `Results for “${view.query}”`;
    case 'favorites': return 'My List';
    case 'history': return 'Recently watched';
    case 'playlists': return 'Playlists';
    case 'collections': return 'Collections';
    case 'genre': return view.genre;
    case 'person': return view.name;
    default: return 'Library';
  }
}

function catalogBaseQuery(view: MainView): Partial<CatalogQuery> {
  switch (view.kind) {
    case 'library':
      return { parentId: view.library.id };
    case 'search':
      return {
        searchTerm: view.query,
        includeItemTypes: ['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet']
      };
    case 'favorites':
      return {
        filter: 'favorite',
        includeItemTypes: ['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet']
      };
    case 'history':
      return {
        filter: 'played',
        sortBy: 'DatePlayed',
        sortDescending: true,
        includeItemTypes: ['Movie', 'Episode', 'Video']
      };
    case 'playlists':
      return { includeItemTypes: ['Playlist'] };
    case 'collections':
      return { includeItemTypes: ['BoxSet'] };
    case 'genre':
      return { genres: [view.genre] };
    case 'person':
      return { personIds: [view.id] };
    default:
      return {};
  }
}

function reportListError(error: unknown): void {
  useAppStore.getState().addNotice('error', friendlyError(error));
}
