import type { AppSettings } from '@shared/contracts.js';

type SubtitlePlayerSettings = Pick<
  AppSettings['player'],
  'subtitleScalePercent' | 'subtitleTextColor' | 'subtitleShadowStrength'
>;

export interface MpvSubtitleProperty {
  name: string;
  value: string | number | boolean;
}

const SHADOW_STYLES = {
  off: { offset: 0, color: '#00000000' },
  soft: { offset: 1.5, color: '#B0000000' },
  strong: { offset: 3, color: '#E6000000' }
} as const;

export function mpvSubtitleProperties(
  player: SubtitlePlayerSettings
): MpvSubtitleProperty[] {
  const shadow = SHADOW_STYLES[player.subtitleShadowStrength];
  const usesAccessibilityStyle =
    player.subtitleTextColor !== '#FFFFFF' ||
    player.subtitleShadowStrength !== 'off';

  return [
    { name: 'sub-scale', value: player.subtitleScalePercent / 100 },
    { name: 'sub-scale-signs', value: false },
    {
      name: 'sub-ass-override',
      value: usesAccessibilityStyle ? 'force' : 'scale'
    },
    { name: 'sub-color', value: player.subtitleTextColor },
    { name: 'sub-border-style', value: 'outline-and-shadow' },
    { name: 'sub-shadow-offset', value: shadow.offset },
    { name: 'sub-back-color', value: shadow.color }
  ];
}

export function mpvSubtitleArguments(
  player: SubtitlePlayerSettings
): string[] {
  return mpvSubtitleProperties(player).map(({ name, value }) =>
    `--${name}=${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`
  );
}
