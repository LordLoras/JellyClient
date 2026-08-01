import { EventEmitter } from 'node:events';
import axios from 'axios';
import { Jellyfin } from '@jellyfin/sdk/lib/jellyfin.js';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api.js';
import { getCollectionApi } from '@jellyfin/sdk/lib/utils/api/collection-api.js';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api.js';
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api.js';
import { getMoviesApi } from '@jellyfin/sdk/lib/utils/api/movies-api.js';
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api.js';
import { getPlaylistsApi } from '@jellyfin/sdk/lib/utils/api/playlists-api.js';
import { getQuickConnectApi } from '@jellyfin/sdk/lib/utils/api/quick-connect-api.js';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api.js';
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api.js';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api.js';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api.js';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api.js';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto.js';
import type { ChapterInfo } from '@jellyfin/sdk/lib/generated-client/models/chapter-info.js';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind.js';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type.js';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields.js';
import { ItemFilter } from '@jellyfin/sdk/lib/generated-client/models/item-filter.js';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by.js';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info.js';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream.js';
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models/media-stream-type.js';
import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type.js';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order.js';
import type { PublicSystemInfo } from '@jellyfin/sdk/lib/generated-client/models/public-system-info.js';
import type { TrickplayInfoDto } from '@jellyfin/sdk/lib/generated-client/models/trickplay-info-dto.js';
import type {
  CatalogQuery,
  CatalogContainer,
  CatalogContainerKind,
  ConnectionInput,
  ConnectionState,
  DiscoveredServer,
  HomePayload,
  ItemDetails,
  ItemsPage,
  LibraryView,
  MediaChapter,
  MediaItem,
  PlaybackSourceOption,
  PlaybackTrackOption,
  QuickConnectPollResult,
  QuickConnectRequest,
  QuickConnectStartInput,
  ServerProfile
} from '@shared/contracts.js';
import {
  APP_NAME,
  APP_VERSION
} from '@shared/contracts.js';
import { initialConnectionState } from '@shared/defaults.js';
import { buildServerUrl } from '@shared/server-url.js';
import { isVisibleCatalogItem } from './catalog-items.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { userFacingError } from './errors.js';
import { mediaFormatForItem } from './media-format.js';
import { discoverJellyfinServers } from './server-discovery.js';

const ITEM_FIELDS = [
  ItemFields.Overview,
  ItemFields.Taglines,
  ItemFields.Genres,
  ItemFields.Studios,
  ItemFields.People,
  ItemFields.DateCreated,
  ItemFields.PrimaryImageAspectRatio,
  ItemFields.MediaStreams,
  ItemFields.MediaSources,
  ItemFields.Chapters,
  ItemFields.Trickplay,
  ItemFields.ParentId,
  ItemFields.SpecialFeatureCount,
  ItemFields.RemoteTrailers,
  ItemFields.RecursiveItemCount,
  ItemFields.ChildCount
];

const DEFAULT_NEXT_UP_DAYS = 365;
const QUICK_CONNECT_LIFETIME_MS = 5 * 60_000;
const STARTUP_RESTORE_TIMEOUT_MS = 2_500;
const CONNECTION_TIMEOUT_MS = 7_500;
const API_TIMEOUT_MS = 12_000;

interface PendingQuickConnect {
  input: QuickConnectStartInput;
  system: PublicSystemInfo;
  expiresAt: number;
}

function dateOnlyDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

export class JellyfinService extends EventEmitter {
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private apiValue: Api | null = null;
  private stateValue: ConnectionState = initialConnectionState;
  private userIdValue: string | null = null;
  private tokenStored = false;
  private readonly pendingQuickConnect = new Map<string, PendingQuickConnect>();

  constructor(config: ConfigService, events: ClientEventBus) {
    super();
    this.config = config;
    this.events = events;
    this.stateValue = {
      ...initialConnectionState,
      profile: config.profile
    };
  }

  get state(): ConnectionState {
    return structuredClone(this.stateValue);
  }

  get api(): Api {
    if (!this.apiValue || !this.userIdValue) {
      throw new Error('Connect to a Jellyfin server first.');
    }
    return this.apiValue;
  }

  get userId(): string {
    if (!this.userIdValue) throw new Error('No Jellyfin user is signed in.');
    return this.userIdValue;
  }

  get baseUrl(): string {
    return this.api.basePath;
  }

  get accessToken(): string {
    return this.api.accessToken;
  }

  get authorizationHeader(): string {
    return this.api.authorizationHeader;
  }

  async initialize(): Promise<ConnectionState> {
    const profile = this.config.profile;
    const storedSession = await this.config.loadSession();
    if (!profile || !storedSession) {
      this.setState({
        ...initialConnectionState,
        profile
      });
      return this.state;
    }

    const expectedUrl = buildServerUrl(profile);
    if (storedSession.baseUrl !== expectedUrl) {
      await this.config.clearSession();
      this.setState({
        ...initialConnectionState,
        profile
      });
      return this.state;
    }

    this.setState({
      ...initialConnectionState,
      status: 'connecting',
      profile,
      tokenStoredSecurely: true
    });

    try {
      this.createApi(expectedUrl, storedSession.accessToken);
      const [systemResponse, userResponse] = await Promise.all([
        getSystemApi(this.apiValue!).getPublicSystemInfo({
          timeout: STARTUP_RESTORE_TIMEOUT_MS
        }),
        getUserApi(this.apiValue!).getCurrentUser({
          timeout: STARTUP_RESTORE_TIMEOUT_MS
        })
      ]);
      const system = systemResponse.data;
      const user = userResponse.data;
      const restoredUserId = user.Id ?? storedSession.userId;
      this.userIdValue = restoredUserId;
      this.tokenStored = true;
      this.setState({
        status: 'connected',
        profile,
        server: {
          id: system.Id ?? storedSession.serverId,
          name: system.ServerName ?? (profile.displayName || profile.host),
          version: system.Version ?? 'unknown',
          baseUrl: expectedUrl
        },
        user: {
          id: restoredUserId,
          name: user.Name ?? profile.username,
          primaryImageTag: user.PrimaryImageTag ?? null
        },
        tokenStoredSecurely: true,
        error: null
      });
      this.emit('authenticated');
    } catch (error) {
      this.apiValue = null;
      this.userIdValue = null;
      this.setState({
        status: 'error',
        profile,
        server: null,
        user: null,
        tokenStoredSecurely: true,
        error: userFacingError(error, 'Could not restore the Jellyfin session.')
      });
    }
    return this.state;
  }

  async connect(input: ConnectionInput): Promise<ConnectionState> {
    const {
      password,
      rememberSession,
      ...profile
    } = input;
    await this.config.saveProfile(profile);
    const baseUrl = buildServerUrl(profile);

    this.setState({
      status: 'connecting',
      profile,
      server: null,
      user: null,
      tokenStoredSecurely: false,
      error: null
    });

    try {
      this.createApi(baseUrl);
      const systemResponse = await getSystemApi(
        this.apiValue!
      ).getPublicSystemInfo({ timeout: CONNECTION_TIMEOUT_MS });
      const authentication = await getUserApi(this.apiValue!).authenticateUserByName({
        authenticateUserByName: {
          Username: profile.username,
          Pw: password
        }
      }, { timeout: CONNECTION_TIMEOUT_MS });

      const token = authentication.data.AccessToken;
      const user = authentication.data.User;
      if (!token || !user?.Id) {
        throw new Error('Jellyfin returned an incomplete authentication response.');
      }

      this.userIdValue = user.Id;
      this.tokenStored = false;
      if (rememberSession) {
        this.tokenStored = await this.config.saveSession({
          accessToken: token,
          userId: user.Id,
          serverId:
            authentication.data.ServerId ?? systemResponse.data.Id ?? '',
          baseUrl
        });
      } else {
        await this.config.clearSession();
      }

      this.setState({
        status: 'connected',
        profile,
        server: {
          id: systemResponse.data.Id ?? authentication.data.ServerId ?? '',
          name:
            systemResponse.data.ServerName ??
            (profile.displayName || profile.host),
          version: systemResponse.data.Version ?? 'unknown',
          baseUrl
        },
        user: {
          id: user.Id,
          name: user.Name ?? profile.username,
          primaryImageTag: user.PrimaryImageTag ?? null
        },
        tokenStoredSecurely: this.tokenStored,
        error: null
      });
      this.emit('authenticated');
    } catch (error) {
      this.apiValue = null;
      this.userIdValue = null;
      this.setState({
        status: 'error',
        profile,
        server: null,
        user: null,
        tokenStoredSecurely: false,
        error: userFacingError(error, 'Could not connect to Jellyfin.')
      });
    }

    return this.state;
  }

  discoverServers(): Promise<DiscoveredServer[]> {
    return discoverJellyfinServers();
  }

  async startQuickConnect(
    input: QuickConnectStartInput
  ): Promise<QuickConnectRequest> {
    const profile: ServerProfile = {
      ...input,
      username: ''
    };
    const baseUrl = buildServerUrl(profile);
    this.createApi(baseUrl);
    const [systemResponse, enabledResponse] = await Promise.all([
      getSystemApi(this.apiValue!).getPublicSystemInfo({
        timeout: CONNECTION_TIMEOUT_MS
      }),
      getQuickConnectApi(this.apiValue!).getQuickConnectEnabled({
        timeout: CONNECTION_TIMEOUT_MS
      })
    ]);
    if (!enabledResponse.data) {
      throw new Error('Quick Connect is disabled on this Jellyfin server.');
    }
    const response = await getQuickConnectApi(
      this.apiValue!
    ).initiateQuickConnect({ timeout: CONNECTION_TIMEOUT_MS });
    const secret = response.data.Secret;
    const code = response.data.Code;
    if (!secret || !code) {
      throw new Error('Jellyfin did not return a Quick Connect code.');
    }
    const expiresAt = Date.now() + QUICK_CONNECT_LIFETIME_MS;
    this.pendingQuickConnect.set(secret, {
      input,
      system: systemResponse.data,
      expiresAt
    });
    this.setState({
      ...initialConnectionState,
      status: 'connecting',
      profile
    });
    return {
      secret,
      code,
      serverName:
        systemResponse.data.ServerName ?? (input.displayName || input.host),
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async pollQuickConnect(secret: string): Promise<QuickConnectPollResult> {
    const pending = this.pendingQuickConnect.get(secret);
    if (!pending || Date.now() >= pending.expiresAt) {
      this.pendingQuickConnect.delete(secret);
      return {
        status: 'expired',
        connection: null
      };
    }
    const stateResponse = await getQuickConnectApi(
      this.apiValue!
    ).getQuickConnectState({ secret });
    if (!stateResponse.data.Authenticated) {
      return {
        status: 'pending',
        connection: null
      };
    }
    const authentication = await getUserApi(
      this.apiValue!
    ).authenticateWithQuickConnect({
      quickConnectDto: { Secret: secret }
    });
    const token = authentication.data.AccessToken;
    const user = authentication.data.User;
    if (!token || !user?.Id) {
      throw new Error('Jellyfin returned incomplete Quick Connect credentials.');
    }
    const profile: ServerProfile = {
      protocol: pending.input.protocol,
      host: pending.input.host,
      port: pending.input.port,
      basePath: pending.input.basePath,
      displayName: pending.input.displayName,
      username: user.Name ?? 'Jellyfin user'
    };
    const baseUrl = buildServerUrl(profile);
    this.createApi(baseUrl, token);
    this.userIdValue = user.Id;
    await this.config.saveProfile(profile);
    this.tokenStored = false;
    if (pending.input.rememberSession) {
      this.tokenStored = await this.config.saveSession({
        accessToken: token,
        userId: user.Id,
        serverId:
          authentication.data.ServerId ?? pending.system.Id ?? '',
        baseUrl
      });
    } else {
      await this.config.clearSession();
    }
    this.pendingQuickConnect.delete(secret);
    this.setState({
      status: 'connected',
      profile,
      server: {
        id: pending.system.Id ?? authentication.data.ServerId ?? '',
        name:
          pending.system.ServerName ??
          (profile.displayName || profile.host),
        version: pending.system.Version ?? 'unknown',
        baseUrl
      },
      user: {
        id: user.Id,
        name: user.Name ?? profile.username,
        primaryImageTag: user.PrimaryImageTag ?? null
      },
      tokenStoredSecurely: this.tokenStored,
      error: null
    });
    this.emit('authenticated');
    return {
      status: 'authenticated',
      connection: this.state
    };
  }

  cancelQuickConnect(secret: string): void {
    this.pendingQuickConnect.delete(secret);
    if (this.stateValue.status === 'connecting') {
      this.apiValue = null;
      this.userIdValue = null;
      this.setState({
        ...initialConnectionState,
        profile: this.config.profile
      });
    }
  }

  async disconnect(): Promise<ConnectionState> {
    try {
      if (this.apiValue) await this.apiValue.logout();
    } catch {
      // The local logout must still complete if the server is unavailable.
    }
    await this.config.clearSession();
    this.apiValue = null;
    this.userIdValue = null;
    this.tokenStored = false;
    this.pendingQuickConnect.clear();
    this.setState({
      ...initialConnectionState,
      profile: this.config.profile
    });
    this.emit('disconnected');
    return this.state;
  }

  async getHome(): Promise<HomePayload> {
    const [
      viewsResponse,
      resumeResponse,
      nextUpResponse,
      latestResponse,
      favoritesResponse,
      recentlyPlayedResponse,
      recommendationsResponse
    ] = await Promise.all([
      getUserViewsApi(this.api).getUserViews({
        userId: this.userId
      }),
      getItemsApi(this.api).getResumeItems({
        userId: this.userId,
        limit: 18,
        mediaTypes: ['Video'],
        fields: ITEM_FIELDS,
        enableImages: true,
        enableUserData: true,
        excludeActiveSessions: true
      }),
      getTvShowsApi(this.api).getNextUp({
        userId: this.userId,
        limit: 24,
        fields: ITEM_FIELDS,
        enableImages: true,
        imageTypeLimit: 1,
        enableImageTypes: [
          ImageType.Primary,
          ImageType.Backdrop,
          ImageType.Thumb
        ],
        enableUserData: true,
        nextUpDateCutoff: dateOnlyDaysAgo(DEFAULT_NEXT_UP_DAYS),
        enableTotalRecordCount: false,
        enableResumable: false,
        enableRewatching: false
      }),
      getUserLibraryApi(this.api).getLatestMedia({
        userId: this.userId,
        fields: ITEM_FIELDS,
        includeItemTypes: [
          BaseItemKind.Movie,
          BaseItemKind.Episode,
          BaseItemKind.Series
        ],
        enableImages: true,
        enableUserData: true,
        limit: 30,
        groupItems: true
      }),
      getItemsApi(this.api).getItems({
        userId: this.userId,
        recursive: true,
        limit: 24,
        includeItemTypes: [
          BaseItemKind.Movie,
          BaseItemKind.Series,
          BaseItemKind.Episode,
          BaseItemKind.Video
        ],
        fields: ITEM_FIELDS,
        filters: [ItemFilter.IsFavorite],
        sortBy: [ItemSortBy.SortName],
        sortOrder: [SortOrder.Ascending],
        enableImages: true,
        enableUserData: true,
        enableTotalRecordCount: false
      }).catch(() => ({ data: { Items: [] } })),
      getItemsApi(this.api).getItems({
        userId: this.userId,
        recursive: true,
        limit: 24,
        includeItemTypes: [
          BaseItemKind.Movie,
          BaseItemKind.Episode,
          BaseItemKind.Video
        ],
        fields: ITEM_FIELDS,
        filters: [ItemFilter.IsPlayed],
        sortBy: [ItemSortBy.DatePlayed],
        sortOrder: [SortOrder.Descending],
        enableImages: true,
        enableUserData: true,
        enableTotalRecordCount: false
      }).catch(() => ({ data: { Items: [] } })),
      getMoviesApi(this.api).getMovieRecommendations({
        userId: this.userId,
        fields: ITEM_FIELDS,
        categoryLimit: 4,
        itemLimit: 8
      }).catch(() => ({ data: [] }))
    ]);

    const recommendations = recommendationsResponse.data.flatMap(
      (category: { Items?: BaseItemDto[] | null }) => category.Items ?? []
    );

    return {
      libraries: (viewsResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapLibrary(item)
      ),
      resume: (resumeResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      nextUp: (nextUpResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      favorites: (favoritesResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      recentlyPlayed: (recentlyPlayedResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      recommended: this.uniqueItems(recommendations).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      latest: latestResponse.data.map((item: BaseItemDto) => this.mapItem(item))
    };
  }

  async discardPlaybackProgress(itemId: string): Promise<HomePayload> {
    await getPlaystateApi(this.api).markUnplayedItem({
      itemId,
      userId: this.userId
    });
    return this.getHome();
  }

  async restorePlaybackProgress(
    itemId: string,
    positionTicks: number
  ): Promise<HomePayload> {
    const items = getItemsApi(this.api);
    const current = await items.getItemUserData({
      itemId,
      userId: this.userId
    });
    await items.updateItemUserData({
      itemId,
      userId: this.userId,
      updateUserItemDataDto: {
        ...current.data,
        PlaybackPositionTicks: positionTicks,
        Played: false
      }
    });
    return this.getHome();
  }

  async getItems(query: CatalogQuery): Promise<ItemsPage> {
    const filter = query.filter ?? 'all';
    const filters = filter === 'unplayed'
      ? [ItemFilter.IsUnplayed]
      : filter === 'played'
        ? [ItemFilter.IsPlayed]
        : filter === 'favorite'
          ? [ItemFilter.IsFavorite]
          : undefined;
    const response = await getItemsApi(this.api).getItems({
      userId: this.userId,
      parentId: query.parentId ?? undefined,
      searchTerm: query.searchTerm || undefined,
      startIndex: query.startIndex,
      limit: query.limit,
      recursive: Boolean(query.searchTerm || query.parentId === null),
      includeItemTypes:
        query.includeItemTypes.length > 0
          ? query.includeItemTypes as never
          : undefined,
      fields: ITEM_FIELDS,
      filters,
      sortBy: [this.catalogSort(query.sortBy)],
      sortOrder: [query.sortDescending
        ? SortOrder.Descending
        : SortOrder.Ascending],
      enableImages: true,
      enableUserData: true,
      enableTotalRecordCount: true,
      genres: query.genres,
      years: query.years,
      personIds: query.personIds,
      minCommunityRating: query.minCommunityRating,
      is4K: query.is4K,
      hasSubtitles: query.hasSubtitles
    });
    const returnedItems = response.data.Items ?? [];
    const visibleItems = returnedItems.filter(isVisibleCatalogItem);
    const hiddenCount = returnedItems.length - visibleItems.length;
    const serverTotal = response.data.TotalRecordCount ?? returnedItems.length;

    return {
      items: visibleItems.map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      startIndex: query.startIndex,
      totalRecordCount: Math.max(0, serverTotal - hiddenCount)
    };
  }

  async getItem(itemId: string): Promise<ItemDetails> {
    const [
      response,
      expandedResponse,
      specialFeatures,
      localTrailers,
      childrenResponse,
      similarResponse
    ] =
      await Promise.all([
        getUserLibraryApi(this.api).getItem({
          itemId,
          userId: this.userId
        }),
        getItemsApi(this.api).getItems({
          userId: this.userId,
          ids: [itemId],
          fields: ITEM_FIELDS,
          enableImages: true,
          enableUserData: true
        }),
        getUserLibraryApi(this.api).getSpecialFeatures({
          itemId,
          userId: this.userId
        }).then((value: { data: BaseItemDto[] }) => value.data).catch(() => []),
        getUserLibraryApi(this.api).getLocalTrailers({
          itemId,
          userId: this.userId
        }).then((value: { data: BaseItemDto[] }) => value.data).catch(() => []),
        getItemsApi(this.api).getItems({
          userId: this.userId,
          parentId: itemId,
          fields: ITEM_FIELDS,
          sortBy: [ItemSortBy.SortName],
          sortOrder: [SortOrder.Ascending],
          enableImages: true,
          enableUserData: true,
          enableTotalRecordCount: false
        }).then((value: { data: { Items?: BaseItemDto[] | null } }) =>
          value.data.Items ?? []
        ).catch(() => []),
        getLibraryApi(this.api).getSimilarItems({
          itemId,
          userId: this.userId,
          limit: 18,
          fields: ITEM_FIELDS
        }).then((value: { data: { Items?: BaseItemDto[] | null } }) =>
          value.data.Items ?? []
        ).catch(() => [])
      ]);
    const item = expandedResponse.data.Items?.[0] ?? response.data;
    const children = item.Type === BaseItemKind.Playlist
      ? await getPlaylistsApi(this.api).getPlaylistItems({
          playlistId: itemId,
          userId: this.userId,
          fields: ITEM_FIELDS,
          enableImages: true,
          enableUserData: true
        }).then((value: { data: { Items?: BaseItemDto[] | null } }) =>
          value.data.Items ?? []
        ).catch(() => childrenResponse)
      : childrenResponse;
    const canPlay = this.canPlayItem(item);
    const playbackSources = canPlay
      ? await getMediaInfoApi(this.api).getPlaybackInfo({
        itemId,
        userId: this.userId
      }).then((value: { data: { MediaSources?: MediaSourceInfo[] } }) =>
        (value.data.MediaSources ?? []).map((source: MediaSourceInfo) =>
          this.mapPlaybackSource(source)
        )
      ).catch(() => [])
      : [];
    return {
      ...this.mapItem(item),
      genres: item.Genres ?? [],
      studios: (item.Studios ?? [])
        .map((studio: { Name?: string | null }) => studio.Name)
        .filter((name: string | null | undefined): name is string =>
          Boolean(name)
        ),
      people: (item.People ?? []).slice(0, 20).map((person: {
        Id?: string;
        Name?: string | null;
        Role?: string | null;
        Type?: string;
        PrimaryImageTag?: string | null;
      }) => ({
        id: person.Id ?? '',
        name: person.Name ?? 'Unknown',
        role: person.Role ?? null,
        type: person.Type ?? null,
        imageUrl:
          person.Id && person.PrimaryImageTag
            ? this.imageUrl(person.Id, 'Primary', person.PrimaryImageTag)
            : null
      })),
      childCount: item.ChildCount ?? 0,
      chapters: (item.Chapters ?? []).map((chapter: ChapterInfo, index: number) => ({
        name: chapter.Name?.trim() || `Chapter ${index + 1}`,
        startTicks: chapter.StartPositionTicks ?? 0,
        imageUrl: chapter.ImageTag
          ? this.chapterImageUrl(itemId, index, chapter.ImageTag)
          : null
      } satisfies MediaChapter)),
      playbackSources,
      trickplay: this.mapTrickplay(itemId, item.Trickplay),
      specialFeatures: specialFeatures.map((feature: BaseItemDto) =>
        this.mapItem(feature)
      ),
      localTrailers: localTrailers.map((trailer: BaseItemDto) =>
        this.mapItem(trailer)
      ),
      children: children
        .filter(isVisibleCatalogItem)
        .map((child: BaseItemDto) => this.mapItem(child)),
      similarItems: similarResponse
        .filter((similar: BaseItemDto) => similar.Id !== itemId)
        .filter(isVisibleCatalogItem)
        .map((similar: BaseItemDto) => this.mapItem(similar))
    };
  }

  async listContainers(kind: CatalogContainerKind): Promise<CatalogContainer[]> {
    const response = await getItemsApi(this.api).getItems({
      userId: this.userId,
      recursive: true,
      includeItemTypes: [
        kind === 'playlist' ? BaseItemKind.Playlist : BaseItemKind.BoxSet
      ],
      fields: ITEM_FIELDS,
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      enableImages: true,
      enableUserData: true,
      enableTotalRecordCount: false
    });
    return (response.data.Items ?? []).map((item: BaseItemDto) =>
      this.mapContainer(item, kind)
    );
  }

  async createContainer(
    kind: CatalogContainerKind,
    name: string,
    itemId: string
  ): Promise<CatalogContainer[]> {
    if (kind === 'playlist') {
      await getPlaylistsApi(this.api).createPlaylist({
        name,
        ids: [itemId],
        userId: this.userId,
        mediaType: MediaType.Video
      });
    } else {
      await getCollectionApi(this.api).createCollection({
        name,
        ids: [itemId]
      });
    }
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
    return this.listContainers(kind);
  }

  async addToContainer(
    kind: CatalogContainerKind,
    containerId: string,
    itemId: string
  ): Promise<void> {
    if (kind === 'playlist') {
      await getPlaylistsApi(this.api).addItemToPlaylist({
        playlistId: containerId,
        ids: [itemId],
        userId: this.userId
      });
    } else {
      await getCollectionApi(this.api).addToCollection({
        collectionId: containerId,
        ids: [itemId]
      });
    }
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
  }

  async removeFromContainer(
    kind: CatalogContainerKind,
    containerId: string,
    entryId: string
  ): Promise<void> {
    if (kind === 'playlist') {
      await getPlaylistsApi(this.api).removeItemFromPlaylist({
        playlistId: containerId,
        entryIds: [entryId]
      });
    } else {
      await getCollectionApi(this.api).removeFromCollection({
        collectionId: containerId,
        ids: [entryId]
      });
    }
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
  }

  async movePlaylistItem(
    playlistId: string,
    entryId: string,
    newIndex: number
  ): Promise<void> {
    await getPlaylistsApi(this.api).moveItem({
      playlistId,
      itemId: entryId,
      newIndex
    });
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
  }

  async getNextEpisode(
    itemId: string,
    seriesId: string | null
  ): Promise<MediaItem | null> {
    if (!seriesId) return null;
    try {
      const response = await getTvShowsApi(this.api).getEpisodes({
        seriesId,
        userId: this.userId,
        fields: ITEM_FIELDS,
        enableImages: true,
        enableUserData: true,
        sortBy: ItemSortBy.SortName
      });
      const episodes = response.data.Items ?? [];
      const current = episodes.findIndex((episode: BaseItemDto) => episode.Id === itemId);
      const next = current >= 0 ? episodes[current + 1] : undefined;
      return next ? this.mapItem(next) : null;
    } catch {
      return null;
    }
  }

  async setFavorite(itemId: string, favorite: boolean): Promise<ItemDetails> {
    const api = getUserLibraryApi(this.api);
    if (favorite) {
      await api.markFavoriteItem({ itemId, userId: this.userId });
    } else {
      await api.unmarkFavoriteItem({ itemId, userId: this.userId });
    }
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
    return this.getItem(itemId);
  }

  async setPlayed(itemId: string, played: boolean): Promise<ItemDetails> {
    const api = getPlaystateApi(this.api);
    if (played) {
      await api.markPlayedItem({ itemId, userId: this.userId });
    } else {
      await api.markUnplayedItem({ itemId, userId: this.userId });
    }
    this.events.emitClient({
      type: 'catalog-changed',
      data: { reason: 'library' }
    });
    return this.getItem(itemId);
  }

  async proxyImage(requestUrl: string): Promise<Response> {
    if (!this.apiValue) return new Response(null, { status: 401 });
    const request = new URL(requestUrl);
    if (request.hostname === 'trickplay') {
      const [itemId, width, index] = request.pathname.split('/').filter(Boolean);
      if (!itemId || !width || !index || !/^\d+$/.test(width) || !/^\d+$/.test(index)) {
        return new Response(null, { status: 400 });
      }
      const params = new URLSearchParams();
      const mediaSourceId = request.searchParams.get('mediaSourceId');
      if (mediaSourceId) params.set('mediaSourceId', mediaSourceId);
      return this.proxyAuthenticated(
        `/Videos/${encodeURIComponent(itemId)}/Trickplay/${width}/${index}.jpg?${params.toString()}`
      );
    }
    if (request.hostname !== 'image') {
      return new Response(null, { status: 404 });
    }
    const [itemId, imageType] = request.pathname.split('/').filter(Boolean);
    if (!itemId || !imageType) return new Response(null, { status: 400 });
    const query = new URLSearchParams();
    const tag = request.searchParams.get('tag');
    const maxWidth = request.searchParams.get('maxWidth') ?? '900';
    if (tag) query.set('tag', tag);
    query.set('maxWidth', maxWidth);
    query.set('quality', '90');
    const imageIndex = request.searchParams.get('index');
    const imagePath = imageIndex && /^\d+$/.test(imageIndex)
      ? `${encodeURIComponent(imageType)}/${imageIndex}`
      : encodeURIComponent(imageType);
    const path = `/Items/${encodeURIComponent(itemId)}/Images/${imagePath}?${query.toString()}`;
    return this.proxyAuthenticated(path);
  }

  private async proxyAuthenticated(path: string): Promise<Response> {
    if (!this.apiValue) return new Response(null, { status: 401 });
    const upstream = `${this.apiValue.basePath}${path}`;
    try {
      return await fetch(upstream, {
        headers: {
          Authorization: this.apiValue.authorizationHeader
        }
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  }

  imageUrl(
    itemId: string,
    imageType: 'Primary' | 'Backdrop',
    tag: string,
    maxWidth = imageType === 'Backdrop' ? 1600 : 900
  ): string {
    const params = new URLSearchParams({
      tag,
      maxWidth: String(maxWidth)
    });
    return `jellyclient-media://image/${encodeURIComponent(itemId)}/${imageType}?${params.toString()}`;
  }

  private chapterImageUrl(itemId: string, index: number, tag: string): string {
    const params = new URLSearchParams({
      tag,
      index: String(index),
      maxWidth: '640'
    });
    return `jellyclient-media://image/${encodeURIComponent(itemId)}/Chapter?${params.toString()}`;
  }

  private createApi(baseUrl: string, accessToken = ''): void {
    const jellyfin = new Jellyfin({
      clientInfo: {
        name: APP_NAME,
        version: APP_VERSION
      },
      deviceInfo: {
        name: `${APP_NAME} on Windows`,
        id: this.config.deviceId
      }
    });
    this.apiValue = jellyfin.createApi(
      baseUrl,
      accessToken,
      axios.create({ timeout: API_TIMEOUT_MS })
    );
  }

  private mapLibrary(item: BaseItemDto): LibraryView {
    const tag = item.ImageTags?.Primary;
    return {
      id: item.Id ?? '',
      name: item.Name ?? 'Untitled library',
      collectionType: item.CollectionType ?? null,
      imageUrl:
        item.Id && tag ? this.imageUrl(item.Id, 'Primary', tag, 700) : null
    };
  }

  private mapItem(item: BaseItemDto): MediaItem {
    const id = item.Id ?? '';
    const primaryTag = item.ImageTags?.Primary;
    const backdropTag = item.BackdropImageTags?.[0];
    const indexLabel =
      item.Type === BaseItemKind.Episode
        ? `S${String(item.ParentIndexNumber ?? 0).padStart(2, '0')} E${String(item.IndexNumber ?? 0).padStart(2, '0')}`
        : null;

    return {
      id,
      name: item.Name ?? 'Untitled',
      type: item.Type ?? 'Unknown',
      seriesName: item.SeriesName ?? null,
      seriesId: item.SeriesId ?? null,
      seasonId: item.SeasonId ?? null,
      parentId: item.ParentId ?? null,
      productionYear: item.ProductionYear ?? null,
      indexLabel,
      overview: item.Overview ?? null,
      tagline: item.Taglines?.[0] ?? null,
      communityRating: item.CommunityRating ?? null,
      officialRating: item.OfficialRating ?? null,
      runtimeTicks: item.RunTimeTicks ?? null,
      playbackPositionTicks: item.UserData?.PlaybackPositionTicks ?? 0,
      playedPercentage: item.UserData?.PlayedPercentage ?? 0,
      isPlayed: item.UserData?.Played ?? false,
      isFavorite: item.UserData?.IsFavorite ?? false,
      lastPlayedDate: item.UserData?.LastPlayedDate ?? null,
      unplayedItemCount: item.UserData?.UnplayedItemCount ?? null,
      playlistItemId: item.PlaylistItemId ?? null,
      isFolder: item.IsFolder ?? false,
      canPlay: this.canPlayItem(item),
      mediaFormat: mediaFormatForItem(item),
      imageUrl:
        id && primaryTag ? this.imageUrl(id, 'Primary', primaryTag) : null,
      backdropUrl:
        id && backdropTag ? this.imageUrl(id, 'Backdrop', backdropTag) : null
    };
  }

  private canPlayItem(item: BaseItemDto): boolean {
    return item.Type === BaseItemKind.Movie ||
      item.Type === BaseItemKind.Episode ||
      item.Type === BaseItemKind.Video;
  }

  private mapContainer(
    item: BaseItemDto,
    kind: CatalogContainerKind
  ): CatalogContainer {
    const id = item.Id ?? '';
    const tag = item.ImageTags?.Primary;
    return {
      id,
      name: item.Name ?? (kind === 'playlist' ? 'Untitled playlist' : 'Untitled collection'),
      kind,
      itemCount: item.ChildCount ?? item.RecursiveItemCount ?? 0,
      imageUrl: id && tag ? this.imageUrl(id, 'Primary', tag) : null
    };
  }

  private uniqueItems(items: BaseItemDto[]): BaseItemDto[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const id = item.Id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  private catalogSort(value?: CatalogQuery['sortBy']): ItemSortBy {
    const mapping: Record<NonNullable<CatalogQuery['sortBy']>, ItemSortBy> = {
      SortName: ItemSortBy.SortName,
      DateCreated: ItemSortBy.DateCreated,
      PremiereDate: ItemSortBy.PremiereDate,
      ProductionYear: ItemSortBy.ProductionYear,
      CommunityRating: ItemSortBy.CommunityRating,
      Runtime: ItemSortBy.Runtime,
      DatePlayed: ItemSortBy.DatePlayed
    };
    return value ? mapping[value] : ItemSortBy.SortName;
  }

  private mapPlaybackTrack(stream: MediaStream): PlaybackTrackOption {
    return {
      index: stream.Index ?? 0,
      type: stream.Type === MediaStreamType.Audio ? 'audio' : 'subtitle',
      title:
        stream.DisplayTitle ??
        stream.Title ??
        stream.Language ??
        'Unknown track',
      language: stream.Language ?? null,
      codec: stream.Codec ?? null,
      channels:
        stream.ChannelLayout ??
        (stream.Channels ? `${stream.Channels} channels` : null),
      default: stream.IsDefault ?? false,
      forced: stream.IsForced ?? false,
      hearingImpaired: stream.IsHearingImpaired ?? false,
      external: stream.IsExternal ?? false
    };
  }

  private mapPlaybackSource(source: MediaSourceInfo): PlaybackSourceOption {
    const streams = source.MediaStreams ?? [];
    const video = streams.find((stream) =>
      stream.Type === MediaStreamType.Video
    );
    const audioStreams = streams.filter((stream) =>
      stream.Type === MediaStreamType.Audio
    );
    const subtitleStreams = streams.filter((stream) =>
      stream.Type === MediaStreamType.Subtitle
    );
    const defaultAudio = audioStreams.find((stream) => stream.IsDefault) ??
      audioStreams[0];
    const resolution = video?.Width && video.Height
      ? `${video.Width}×${video.Height}`
      : null;
    const videoRange = video?.VideoDoViTitle ??
      (video?.Hdr10PlusPresentFlag ? 'HDR10+' : null) ??
      video?.VideoRangeType ??
      video?.VideoRange ??
      null;
    return {
      id: source.Id ?? '',
      name: source.Name?.trim() || [resolution, source.Container?.toUpperCase()]
        .filter(Boolean)
        .join(' · ') || 'Original source',
      container: source.Container ?? null,
      size: source.Size ?? null,
      bitrate: source.Bitrate ?? null,
      resolution,
      videoCodec: video?.Codec ?? null,
      videoRange,
      dolbyVisionProfile: video?.DvProfile ?? null,
      audio: defaultAudio?.DisplayTitle ?? defaultAudio?.Codec ?? null,
      supportsDirectPlay: source.SupportsDirectPlay ?? false,
      supportsDirectStream: source.SupportsDirectStream ?? false,
      audioTracks: audioStreams.map((stream) => this.mapPlaybackTrack(stream)),
      subtitleTracks: subtitleStreams.map((stream) => this.mapPlaybackTrack(stream))
    };
  }

  private mapTrickplay(
    itemId: string,
    value: BaseItemDto['Trickplay']
  ): ItemDetails['trickplay'] {
    const result: ItemDetails['trickplay'] = [];
    for (const [mediaSourceId, widths] of Object.entries(value ?? {})) {
      for (const [widthValue, raw] of Object.entries(widths ?? {})) {
        const info = raw as TrickplayInfoDto;
        const width = info.Width ?? Number(widthValue);
        if (
          !Number.isFinite(width) ||
          !info.Height ||
          !info.TileWidth ||
          !info.TileHeight ||
          !info.ThumbnailCount ||
          !info.Interval
        ) continue;
        result.push({
          mediaSourceId,
          width,
          height: info.Height,
          tileWidth: info.TileWidth,
          tileHeight: info.TileHeight,
          thumbnailCount: info.ThumbnailCount,
          intervalMs: info.Interval,
          tileUrlTemplate:
            `jellyclient-media://trickplay/${encodeURIComponent(itemId)}/${width}/{index}?mediaSourceId=${encodeURIComponent(mediaSourceId)}`
        });
      }
    }
    return result.sort((left, right) => right.width - left.width);
  }

  private setState(state: ConnectionState): void {
    this.stateValue = state;
    this.events.emitClient({
      type: 'connection',
      data: this.state
    });
  }
}
