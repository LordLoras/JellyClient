const ASS_SPECIAL = /([{}\\])/g;

function escapeAss(value: string): string {
  return value.replace(ASS_SPECIAL, '\\$1').replace(/\r?\n/g, ' ');
}

export interface SkipPromptOverlay {
  label: string;
  shortcut: string;
  secondsRemaining: number;
  totalSeconds: number;
  automatic: boolean;
}

export function skipPromptAss(prompt: SkipPromptOverlay): string {
  const safeLabel = escapeAss(prompt.label);
  const safeShortcut = escapeAss(prompt.shortcut);
  const seconds = Math.max(0, Math.ceil(prompt.secondsRemaining));
  const progress = Math.min(
    1,
    Math.max(0, prompt.secondsRemaining / Math.max(1, prompt.totalSeconds))
  );
  const progressWidth = Math.round(420 * progress);
  const status = prompt.automatic
    ? `AUTO-SKIP · ${seconds}s`
    : `${safeShortcut} · ${seconds}s`;
  return [
    '{\\an7\\pos(430,594)\\p1\\bord0\\shad0\\1c&H080B0A&\\1a&H18&}m 0 0 l 420 0 420 82 0 82{\\p0}',
    '{\\an7\\pos(430,594)\\p1\\bord0\\shad0\\1c&H52FFD8&}m 0 0 l 4 0 4 82 0 82{\\p0}',
    `{\\an7\\pos(454,612)\\fnSegoe UI\\fs25\\b1\\1c&HFFFFFF&\\bord0\\shad0}${safeLabel}`,
    `{\\an9\\pos(826,616)\\fnSegoe UI\\fs12\\b1\\1c&H52FFD8&\\bord0\\shad0}${status}`,
    '{\\an7\\pos(430,671)\\p1\\bord0\\shad0\\1c&H3A4140&}m 0 0 l 420 0 420 5 0 5{\\p0}',
    `{\\an7\\pos(430,671)\\p1\\bord0\\shad0\\1c&H52FFD8&}m 0 0 l ${progressWidth} 0 ${progressWidth} 5 0 5{\\p0}`
  ].join('\n');
}
