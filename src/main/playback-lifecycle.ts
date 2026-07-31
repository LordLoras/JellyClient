export interface MpvFileEvent {
  generation: number | null;
  playlistEntryId: number | null;
}

export interface MpvEndFileEvent extends MpvFileEvent {
  reason: string;
  error: string | null;
}

export interface AutoAdvanceState {
  generation: number;
  loaded: boolean;
  stopped: boolean;
  hasNextItem: boolean;
  postPlayCanceled: boolean;
  playNextRequested: boolean;
}

export function shouldAutomaticallyAdvance(
  event: MpvEndFileEvent,
  state: AutoAdvanceState,
  enabled: boolean
): boolean {
  return (
    enabled &&
    event.reason === 'eof' &&
    event.generation === state.generation &&
    state.loaded &&
    !state.stopped &&
    state.hasNextItem &&
    !state.postPlayCanceled &&
    !state.playNextRequested
  );
}

export class MpvPlaybackGenerationTracker {
  private pendingGeneration: number | null = null;
  private currentEntryId: number | null = null;
  private readonly generations = new Map<number, number>();

  beginLoad(generation: number): void {
    this.pendingGeneration = generation;
  }

  start(
    playlistEntryId: number | null,
    fallbackGeneration: number
  ): MpvFileEvent {
    const generation = this.pendingGeneration ?? fallbackGeneration;
    this.pendingGeneration = null;
    this.currentEntryId = playlistEntryId;
    if (playlistEntryId !== null) {
      this.generations.set(playlistEntryId, generation);
    }
    return { generation, playlistEntryId };
  }

  current(
    playlistEntryId: number | null,
    fallbackGeneration: number
  ): MpvFileEvent {
    const resolvedEntryId = playlistEntryId ?? this.currentEntryId;
    return {
      generation:
        resolvedEntryId === null
          ? this.pendingGeneration ?? fallbackGeneration
          : this.generations.get(resolvedEntryId) ?? fallbackGeneration,
      playlistEntryId: resolvedEntryId
    };
  }

  end(
    playlistEntryId: number | null,
    fallbackGeneration: number
  ): MpvFileEvent {
    const event = this.current(playlistEntryId, fallbackGeneration);
    if (event.playlistEntryId !== null) {
      this.generations.delete(event.playlistEntryId);
      if (this.currentEntryId === event.playlistEntryId) {
        this.currentEntryId = null;
      }
    }
    return event;
  }

  abandonLoad(generation: number): void {
    if (this.pendingGeneration === generation) this.pendingGeneration = null;
  }

  reset(): void {
    this.pendingGeneration = null;
    this.currentEntryId = null;
    this.generations.clear();
  }
}
