import {
  ArrowLeft,
  CircleUserRound,
  Clapperboard,
  Home,
  Heart,
  Library,
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
  useMemo,
  useRef,
  useState,
  type FormEvent
} from 'react';
import type {
  CatalogFilter,
  CatalogSort,
  LibraryView,
  MediaItem,
  PlayMediaInput
} from '@shared/contracts.js';
import { Brand } from './components/Brand';
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
  playableHero,
  useAppStore
} from './store';

export function App() {
  const store = useAppStore();
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [discardItem, setDiscardItem] = useState<MediaItem | null>(null);
  const [discardBusy, setDiscardBusy] = useState(false);
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

  const hero = useMemo(() => playableHero(store.home), [store.home]);

  const goBack = useCallback(() => {
    if (discardItem && !discardBusy) {
      setDiscardItem(null);
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
  }, [discardBusy, discardItem, syncPanelOpen]);

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3) return;
      event.preventDefault();
      goBack();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const escapeClosesOverlay = event.key === 'Escape' && Boolean(
        discardItem || syncPanelOpen || useAppStore.getState().detail
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
  }, [goBack]);

  if (!store.bootstrap || !store.connection || !store.settings || !store.mpv || !store.playback || !store.syncPlay) {
    return (
      <main className="boot-screen">
        <Brand />
        <span><LoaderCircle className="spin" /></span>
        <p>Preparing the screening room…</p>
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
    if (item.isFolder || ['Series', 'Season', 'BoxSet'].includes(item.type)) {
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
            label="Favorites"
            onClick={() => void loadFavorites()}
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
              onOpen={openItem}
              onPlay={play}
              onWatchTogether={watchTogether}
              onDiscardProgress={setDiscardItem}
            />
          )}
          {(store.view.kind === 'library' || store.view.kind === 'search' || store.view.kind === 'favorites') && (
            <CatalogView
              title={
                store.view.kind === 'library'
                  ? store.view.library.name
                  : store.view.kind === 'search'
                    ? `Results for “${store.view.query}”`
                    : 'Favorites'
              }
              parentId={store.view.kind === 'library' ? store.view.library.id : null}
              searchTerm={store.view.kind === 'search' ? store.view.query : ''}
              initialFilter={store.view.kind === 'favorites' ? 'favorite' : 'all'}
              items={store.page?.items ?? []}
              total={store.page?.totalRecordCount ?? 0}
              busy={store.busy}
              onOpen={openItem}
              onPlay={play}
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
                store.addNotice(
                  'info',
                  `${discardItem.name} was removed from Continue Watching.`
                );
                setDiscardItem(null);
              })
              .catch((error) =>
                store.addNotice('error', friendlyError(error))
              )
              .finally(() => setDiscardBusy(false));
          }}
        />
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
  onOpen,
  onPlay,
  onWatchTogether,
  onDiscardProgress
}: {
  hero: MediaItem | null;
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
  onWatchTogether(item: MediaItem): void;
  onDiscardProgress(item: MediaItem): void;
}) {
  const home = useAppStore((state) => state.home);
  const syncPlay = useAppStore((state) => state.syncPlay)!;
  if (!home) {
    return <PageLoading />;
  }
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
          <h1>Your screening room is connected</h1>
          <p>Jellyfin has not returned any playable video yet.</p>
        </div>
      )}
      <MediaRail
        kicker="PICK UP WHERE YOU LEFT OFF"
        title="Continue watching"
        items={home.resume}
        landscape
        onOpen={onOpen}
        onPlay={onPlay}
        onDismiss={onDiscardProgress}
      />
      <MediaRail
        kicker="YOUR NEXT EPISODE"
        title="Up next"
        items={home.nextUp}
        landscape
        presentation="next-up"
        onOpen={onOpen}
        onPlay={onPlay}
      />
      <MediaRail
        kicker="FRESH FROM YOUR SERVER"
        title="Recently added"
        items={home.latest}
        onOpen={onOpen}
        onPlay={onPlay}
      />
      {home.libraries.length > 0 && (
        <section className="library-band">
          <header className="rail__header">
            <div><p className="eyebrow">COLLECTIONS</p><h2>Your libraries</h2></div>
          </header>
          <div className="library-band__grid">
            {home.libraries.map((library, index) => (
              <button
                key={library.id}
                onClick={() => void loadItems(library, '')}
                style={{ '--library-index': index } as React.CSSProperties}
              >
                {library.imageUrl && <img src={library.imageUrl} alt="" />}
                <i />
                <span><small>{library.collectionType ?? 'Library'}</small><strong>{library.name}</strong></span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CatalogView({
  title,
  parentId,
  searchTerm,
  initialFilter,
  items,
  total,
  busy,
  onOpen,
  onPlay
}: {
  title: string;
  parentId: string | null;
  searchTerm: string;
  initialFilter: CatalogFilter;
  items: MediaItem[];
  total: number;
  busy: boolean;
  onOpen(item: MediaItem): void;
  onPlay(item: MediaItem): void;
}) {
  const [sortBy, setSortBy] = useState<CatalogSort>('SortName');
  const [descending, setDescending] = useState(false);
  const [filter, setFilter] = useState<CatalogFilter>(initialFilter);

  useEffect(() => {
    setSortBy('SortName');
    setDescending(false);
    setFilter(initialFilter);
  }, [title, initialFilter]);

  const changeQuery = async (
    nextSort: CatalogSort,
    nextDescending: boolean,
    nextFilter: CatalogFilter
  ) => {
    const state = useAppStore.getState();
    state.setBusy(true);
    try {
      state.setPage(await window.jellyClient.getItems({
        parentId,
        searchTerm,
        startIndex: 0,
        limit: 150,
        includeItemTypes: searchTerm || initialFilter === 'favorite'
          ? ['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet']
          : [],
        sortBy: nextSort,
        sortDescending: nextDescending,
        filter: nextFilter
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
            </select>
          </label>
          <button onClick={() => {
            const value = !descending;
            setDescending(value);
            void changeQuery(sortBy, value, filter);
          }}>{descending ? 'Descending' : 'Ascending'}</button>
          <span>{total} items</span>
        </div>
      </header>
      {items.length > 0 ? (
        <div className="media-grid">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} onOpen={onOpen} onPlay={onPlay} />
          ))}
        </div>
      ) : !busy ? (
        <div className="empty-state">
          <Search />
          <h2>No playable titles found</h2>
          <p>This view has no playable video yet.</p>
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
  const state = useAppStore.getState();
  state.setBusy(true);
  state.setView({ kind: 'favorites' });
  try {
    state.setPage(await window.jellyClient.getItems({
      parentId: null,
      searchTerm: '',
      startIndex: 0,
      limit: 150,
      includeItemTypes: ['Movie', 'Series', 'Season', 'Episode', 'Video', 'BoxSet'],
      sortBy: 'SortName',
      sortDescending: false,
      filter: 'favorite'
    }));
  } catch (error) {
    state.addNotice('error', friendlyError(error));
  } finally {
    state.setBusy(false);
  }
}
