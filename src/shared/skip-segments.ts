import { TICKS_PER_SECOND } from './contracts.js';

export type SkipSegmentType = 'Intro' | 'Outro';

export interface SkipSegment {
  id: string;
  type: SkipSegmentType;
  startTicks: number;
  endTicks: number;
}

export function skipSegmentLabel(type: SkipSegmentType): string {
  return type === 'Intro' ? 'Skip Intro' : 'Skip Ending';
}

export function activeSkipSegment(
  segments: SkipSegment[],
  positionSeconds: number,
  dismissedIds: ReadonlySet<string>
): SkipSegment | null {
  const positionTicks = positionSeconds * TICKS_PER_SECOND;
  return segments.find((segment) =>
    !dismissedIds.has(segment.id) &&
    (
      positionTicks >= segment.startTicks ||
      (
        segment.type === 'Intro' &&
        positionTicks <= 3 * TICKS_PER_SECOND &&
        segment.startTicks <= 3 * TICKS_PER_SECOND
      )
    ) &&
    positionTicks < segment.endTicks - TICKS_PER_SECOND / 4
  ) ?? null;
}

export function coalesceSkipSegments(
  segments: SkipSegment[]
): SkipSegment[] {
  const sorted = [...segments].sort((left, right) =>
    left.startTicks - right.startTicks || left.endTicks - right.endTicks
  );
  const result: SkipSegment[] = [];
  for (const segment of sorted) {
    const previous = result[result.length - 1];
    if (
      previous?.type === segment.type &&
      segment.startTicks <= previous.endTicks
    ) {
      previous.startTicks = Math.min(previous.startTicks, segment.startTicks);
      previous.endTicks = Math.max(previous.endTicks, segment.endTicks);
      previous.id = [
        previous.type,
        previous.startTicks,
        previous.endTicks
      ].join(':');
      continue;
    }
    result.push({ ...segment });
  }
  return result;
}

export function validSkipSegment(
  id: string | null | undefined,
  type: string | null | undefined,
  startTicks: number | null | undefined,
  endTicks: number | null | undefined
): SkipSegment | null {
  if (
    (type !== 'Intro' && type !== 'Outro') ||
    typeof startTicks !== 'number' ||
    typeof endTicks !== 'number' ||
    !Number.isFinite(startTicks) ||
    !Number.isFinite(endTicks) ||
    startTicks < 0 ||
    endTicks <= startTicks
  ) {
    return null;
  }
  return {
    id: id?.trim() || `${type}:${startTicks}:${endTicks}`,
    type,
    startTicks,
    endTicks
  };
}
