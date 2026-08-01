import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@shared/defaults.js';
import {
  mpvSubtitleArguments,
  mpvSubtitleProperties
} from './subtitle-appearance.js';

describe('MPV subtitle appearance', () => {
  it('preserves MPV defaults while applying the default scale', () => {
    expect(mpvSubtitleProperties(defaultSettings.player)).toEqual([
      { name: 'sub-scale', value: 1 },
      { name: 'sub-scale-signs', value: false },
      { name: 'sub-ass-override', value: 'scale' },
      { name: 'sub-color', value: '#FFFFFF' },
      { name: 'sub-border-style', value: 'outline-and-shadow' },
      { name: 'sub-shadow-offset', value: 0 },
      { name: 'sub-back-color', value: '#00000000' }
    ]);
  });

  it('maps fine-grained scale, color, and shadow into MPV options', () => {
    const player = {
      ...defaultSettings.player,
      subtitleScalePercent: 135,
      subtitleTextColor: '#F4D35E',
      subtitleShadowStrength: 'strong' as const
    };

    expect(mpvSubtitleArguments(player)).toEqual([
      '--sub-scale=1.35',
      '--sub-scale-signs=no',
      '--sub-ass-override=force',
      '--sub-color=#F4D35E',
      '--sub-border-style=outline-and-shadow',
      '--sub-shadow-offset=3',
      '--sub-back-color=#E6000000'
    ]);
  });
});
