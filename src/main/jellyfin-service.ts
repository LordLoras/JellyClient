import { EventEmitter } from 'node:events';
import { Jellyfin } from '@jellyfin/sdk/lib/jellyfin.js';
import type { Api } from '@jellyfin/sdk/lib/api.js';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api.js';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api.js';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api.js';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api.js';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api.js';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto.js';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind.js';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type.js';
import { ItemFields } from '@jellyfin/sdk/lib/generated-client/models/item-fields.js';
import { ItemSortBy } from '@jellyfin/sdk/lib/generated-client/models/item-sort-by.js';
import { SortOrder } from '@jellyfin/sdk/lib/generated-client/models/sort-order.js';
import type {
  CatalogQuery,
  ConnectionInput,
  ConnectionState,
  HomePayload,
  ItemDetails,
  ItemsPage,
  LibraryView,
  MediaItem,
  ServerProfile
} from '@shared/contracts.js';
import {
  APP_NAME,
  APP_VERSION
} from '@shared/contracts.js';
import { initialConnectionState } from '@shared/defaults.js';
import { buildServerUrl } from '@shared/server-url.js';
import { ConfigService } from './config-service.js';
import { ClientEventBus } from './event-bus.js';
import { userFacingError } from './errors.js';

const ITEM_FIELDS = [
  ItemFields.Overview,
  ItemFields.Taglines,
  ItemFields.Genres,
  ItemFields.Studios,
  ItemFields.People,
  ItemFields.PrimaryImageAspectRatio,
  ItemFields.MediaSources
];

export class JellyfinService extends EventEmitter {
  private readonly config: ConfigService;
  private readonly events: ClientEventBus;
  private apiValue: Api | null = null;
  private stateValue: ConnectionState = initialConnectionState;
  private userIdValue: string | null = null;
  private tokenStored = false;

  constructor(config: ConfigService, events: ClientEventBus) {
    super();
    this.config = config;
    this.events = events;
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
        getSystemApi(this.apiValue!).getPublicSystemInfo(),
        getUserApi(this.apiValue!).getCurrentUser()
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
      const systemResponse = await getSystemApi(this.apiValue!).getPublicSystemInfo();
      const authentication = await getUserApi(this.apiValue!).authenticateUserByName({
        authenticateUserByName: {
          Username: profile.username,
          Pw: password
        }
      });

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
    this.setState({
      ...initialConnectionState,
      profile: this.config.profile
    });
    this.emit('disconnected');
    return this.state;
  }

  async getHome(): Promise<HomePayload> {
    const [viewsResponse, resumeResponse, latestResponse] = await Promise.all([
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
      })
    ]);

    return {
      libraries: (viewsResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapLibrary(item)
      ),
      resume: (resumeResponse.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      latest: latestResponse.data.map((item: BaseItemDto) => this.mapItem(item))
    };
  }

  async getItems(query: CatalogQuery): Promise<ItemsPage> {
    const response = await getItemsApi(this.api).getItems({
      userId: this.userId,
      parentId: query.parentId ?? undefined,
      searchTerm: query.searchTerm || undefined,
      startIndex: query.startIndex,
      limit: query.limit,
      recursive: Boolean(query.searchTerm),
      includeItemTypes:
        query.includeItemTypes.length > 0
          ? query.includeItemTypes as never
          : undefined,
      fields: ITEM_FIELDS,
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      enableImages: true,
      enableUserData: true,
      enableTotalRecordCount: true
    });
    return {
      items: (response.data.Items ?? []).map((item: BaseItemDto) =>
        this.mapItem(item)
      ),
      startIndex: query.startIndex,
      totalRecordCount: response.data.TotalRecordCount ?? 0
    };
  }

  async getItem(itemId: string): Promise<ItemDetails> {
    const response = await getUserLibraryApi(this.api).getItem({
      itemId,
      userId: this.userId
    });
    const item = response.data;
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
      childCount: item.ChildCount ?? 0
    };
  }

  async proxyImage(requestUrl: string): Promise<Response> {
    if (!this.apiValue) return new Response(null, { status: 401 });
    const request = new URL(requestUrl);
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
    const upstream = `${this.apiValue.basePath}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(imageType)}?${query.toString()}`;
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
    this.apiValue = jellyfin.createApi(baseUrl, accessToken);
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
      isFolder: item.IsFolder ?? false,
      canPlay:
        item.Type === BaseItemKind.Movie ||
        item.Type === BaseItemKind.Episode ||
        item.Type === BaseItemKind.Video,
      imageUrl:
        id && primaryTag ? this.imageUrl(id, 'Primary', primaryTag) : null,
      backdropUrl:
        id && backdropTag ? this.imageUrl(id, 'Backdrop', backdropTag) : null
    };
  }

  private setState(state: ConnectionState): void {
    this.stateValue = state;
    this.events.emitClient({
      type: 'connection',
      data: this.state
    });
  }
}
