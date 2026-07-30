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
  | { kind: 'settings' };

export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
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
  setView: (value) => set({ view: value }),
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

export function playableHero(home: HomePayload | null): MediaItem | null {
  return home?.resume[0] ?? home?.latest.find((item) => item.canPlay) ?? null;
}
