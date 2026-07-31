const ASS_SPECIAL = /([{}\\])/g;

function escapeAss(value: string): string {
  return value.replace(ASS_SPECIAL, '\\$1').replace(/\r?\n/g, ' ');
}

export function skipPromptAss(label: string): string {
  const safeLabel = escapeAss(label);
  return [
    '{\\an7\\pos(52,620)\\p1\\bord0\\shad0\\1c&H080B0A&\\1a&H18&}m 0 0 l 330 0 330 64 0 64{\\p0}',
    '{\\an7\\pos(52,620)\\p1\\bord0\\shad0\\1c&H52FFD8&}m 0 0 l 5 0 5 64 0 64{\\p0}',
    `{\\an7\\pos(78,638)\\fnSegoe UI\\fs25\\b1\\1c&HFFFFFF&\\bord0\\shad0}${safeLabel}`,
    '{\\an7\\pos(292,636)\\fnSegoe UI\\fs18\\b1\\1c&H52FFD8&\\3c&H52FFD8&\\bord1\\shad0}N'
  ].join('\n');
}
