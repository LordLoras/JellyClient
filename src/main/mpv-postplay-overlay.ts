const ASS_SPECIAL = /([{}\\])/g;

function escapeAss(value: string): string {
  return value.replace(ASS_SPECIAL, '\\$1').replace(/\r?\n/g, ' ');
}

export function postPlayAss(title: string, seconds: number): string {
  const safeTitle = escapeAss(title);
  return [
    '{\\an7\\pos(850,525)\\p1\\bord0\\shad0\\1c&H080B0A&\\1a&H12&}m 0 0 l 380 0 380 132 0 132{\\p0}',
    '{\\an7\\pos(850,525)\\p1\\bord0\\shad0\\1c&H52FFD8&}m 0 0 l 5 0 5 132 0 132{\\p0}',
    '{\\an7\\pos(875,548)\\fnSegoe UI\\fs15\\b1\\1c&H52FFD8&\\bord0\\shad0}UP NEXT',
    `{\\an7\\pos(875,576)\\fnSegoe UI\\fs24\\b1\\1c&HFFFFFF&\\bord0\\shad0}${safeTitle}`,
    `{\\an7\\pos(875,613)\\fnSegoe UI\\fs16\\1c&HC7CEC9&\\bord0\\shad0}Playing in ${Math.max(0, seconds)} seconds`,
    '{\\an7\\pos(875,637)\\fnSegoe UI\\fs13\\1c&H8B9791&\\bord0\\shad0}N  Play now     Esc  Cancel'
  ].join('\n');
}
