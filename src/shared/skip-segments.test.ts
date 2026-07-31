import {
  describe,
  expect,
  it
} from 'vitest';
import {
  activeSkipSegment,
  coalesceSkipSegments,
  skipSegmentLabel,
  validSkipSegment
} from './skip-segments.js';

describe('skip segments', () => {
  const intro = validSkipSegment('intro', 'Intro', 100_000_000, 300_000_000)!;
  const outro = validSkipSegment('outro', 'Outro', 500_000_000, 700_000_000)!;

  it('recognizes active intro and outro windows', () => {
    expect(activeSkipSegment([intro, outro], 12, new Set())?.id).toBe('intro');
    expect(activeSkipSegment([intro, outro], 55, new Set())?.id).toBe('outro');
    expect(activeSkipSegment([intro, outro], 40, new Set())).toBeNull();
  });

  it('does not reopen a dismissed segment', () => {
    expect(activeSkipSegment([intro], 12, new Set(['intro']))).toBeNull();
  });

  it('merges duplicate provider markers without joining separate segments', () => {
    const overlappingIntro = validSkipSegment(
      'second-intro',
      'Intro',
      100_000_000,
      299_000_000
    )!;
    const laterIntro = validSkipSegment(
      'later-intro',
      'Intro',
      800_000_000,
      900_000_000
    )!;
    const normalized = coalesceSkipSegments([
      laterIntro,
      intro,
      overlappingIntro,
      outro
    ]);
    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      type: 'Intro',
      startTicks: 100_000_000,
      endTicks: 300_000_000
    });
    expect(normalized[1]?.id).toBe('outro');
    expect(normalized[2]?.id).toBe('later-intro');
  });

  it('rejects malformed timing and supplies stable fallback ids', () => {
    expect(validSkipSegment(null, 'Intro', 10, 20)?.id).toBe('Intro:10:20');
    expect(validSkipSegment('bad', 'Intro', 20, 10)).toBeNull();
    expect(validSkipSegment('bad', 'Credits', 10, 20)).toBeNull();
  });

  it('uses the requested interface wording', () => {
    expect(skipSegmentLabel('Intro')).toBe('Skip Intro');
    expect(skipSegmentLabel('Outro')).toBe('Skip Ending');
  });
});
