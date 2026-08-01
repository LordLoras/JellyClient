import { create } from 'zustand';
import type {
  AppBootstrap,
  AppSettings,
  ClientEvent,
  ConnectionState,
  HomePayload,
  ItemDetails,
  ItemsPage,
  LibraryView,
  MediaItem,
  MpvCapability,
  PlaybackState,
  SyncPlayState
} from '@shared/contracts.js';

export type MainView =
  | { kind: 'home' }
  | { kind: 'library'; library: LibraryView }
  | { kind: 'search'; query: string }
  | { kind: 'favorites' }
  | { kind: 'history' }
  | { kind: 'playlists' }
  | { kind: 'collections' }
  | { kind: 'genre'; genre: string }
  | { kind: 'person'; id: string; name: string }
  | { kind: 'settings' };

export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface NavigationEntry {
  view: MainView;
  page: ItemsPage | null;
}

interface AppStore {
  bootstrap: AppBootstrap | null;
  connection: ConnectionState | null;
  settings: AppSettings | null;
  mpv: MpvCapability | null;
  playback: PlaybackState | null;
  syncPlay: SyncPlayState | null;
  home: HomePayload | null;
  page: ItemsPage | null;
  detail: ItemDetails | null;
  view: MainView;
  navigationHistory: NavigationEntry[];
  busy: boolean;
  notices: Notice[];
  setBootstrap(value: AppBootstrap): void;
  applyEvent(event: ClientEvent): void;
  setConnection(value: ConnectionState): void;
  setSettings(value: AppSettings): void;
  setMpv(value: MpvCapability): void;
  setHome(value: HomePayload): void;
  setPage(value: ItemsPage | null): void;
  setDetail(value: ItemDetails | null): void;
  setView(value: MainView): void;
  goBack(): boolean;
  resetNavigation(): void;
  setBusy(value: boolean): void;
  addNotice(level: Notice['level'], message: string): void;
  dismissNotice(id: number): void;
}

let noticeSequence = 0;

export const useAppStore = create<AppStore>((set) => ({
  bootstrap: null,
  connection: null,
  settings: null,
  mpv: null,
  playback: null,
  syncPlay: null,
  home: null,
  page: null,
  detail: null,
  view: { kind: 'home' },
  navigationHistory: [],
  busy: false,
  notices: [],
  setBootstrap: (value) =>
    set({
      bootstrap: value,
      connection: value.connection,
      settings: value.settings,
      mpv: value.mpv,
      playback: value.playback,
      syncPlay: value.syncPlay
    }),
  applyEvent: (event) =>
    set((state) => {
      if (event.type === 'connection') return { connection: event.data };
      if (event.type === 'playback') return { playback: event.data };
      if (event.type === 'syncplay') return { syncPlay: event.data };
      if (event.type === 'catalog-changed') return {};
      const notice: Notice = {
        id: ++noticeSequence,
        ...event.data
      };
      return { notices: [...state.notices.slice(-3), notice] };
    }),
  setConnection: (value) => set({ connection: value }),
  setSettings: (value) => set({ settings: value }),
  setMpv: (value) => set({ mpv: value }),
  setHome: (value) => set({ home: value }),
  setPage: (value) => set({ page: value }),
  setDetail: (value) => set({ detail: value }),
  setView: (value) =>
    set((state) => {
      if (sameView(state.view, value)) return {};
      return {
        view: value,
        navigationHistory: [
          ...state.navigationHistory.slice(-19),
          { view: state.view, page: state.page }
        ]
      };
    }),
  goBack: () => {
    let navigated = false;
    set((state) => {
      const previous = state.navigationHistory.at(-1);
      if (!previous) return {};
      navigated = true;
      return {
        view: previous.view,
        page: previous.page,
        navigationHistory: state.navigationHistory.slice(0, -1)
      };
    });
    return navigated;
  },
  resetNavigation: () => set({
    view: { kind: 'home' },
    navigationHistory: [],
    page: null,
    detail: null
  }),
  setBusy: (value) => set({ busy: value }),
  addNotice: (level, message) =>
    set((state) => ({
      notices: [
        ...state.notices.slice(-3),
        {
          id: ++noticeSequence,
          level,
          message
        }
      ]
    })),
  dismissNotice: (id) =>
    set((state) => ({
      notices: state.notices.filter((notice) => notice.id !== id)
    }))
}));

function sameView(left: MainView, right: MainView): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'library' && right.kind === 'library') {
    return left.library.id === right.library.id;
  }
  if (left.kind === 'search' && right.kind === 'search') {
    return left.query === right.query;
  }
  if (left.kind === 'genre' && right.kind === 'genre') {
    return left.genre === right.genre;
  }
  if (left.kind === 'person' && right.kind === 'person') {
    return left.id === right.id;
  }
  return true;
}

export function playableHero(home: HomePayload | null): MediaItem | null {
  return (
    home?.resume[0] ??
    home?.nextUp[0] ??
    home?.latest.find((item) => item.canPlay) ??
    null
  );
}
