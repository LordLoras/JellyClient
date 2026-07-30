export interface WebVttCue {
  start: number;
  end: number;
  text: string;
}

function timestampSeconds(value: string): number | null {
  const parts = value.replace(',', '.').split(':').map(Number);
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    parts.some((part) => !Number.isFinite(part))
  ) {
    return null;
  }
  const seconds = parts.pop()!;
  const minutes = parts.pop()!;
  const hours = parts.pop() ?? 0;
  return hours * 3_600 + minutes * 60 + seconds;
}

function cueText(lines: string[]): string {
  return lines
    .join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

export function parseWebVtt(input: string): WebVttCue[] {
  return input
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split('\n');
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return [];
      const [rawStart, rawEnd] = lines[timingIndex]!.split('-->');
      const start = timestampSeconds(rawStart?.trim() ?? '');
      const endToken = rawEnd?.trim().split(/\s+/)[0] ?? '';
      const end = timestampSeconds(endToken);
      const text = cueText(lines.slice(timingIndex + 1));
      if (start === null || end === null || end <= start || !text) return [];
      return [{ start, end, text }];
    });
}

export function subtitleAtTime(
  cues: WebVttCue[],
  position: number
): string {
  return cues
    .filter((cue) => position >= cue.start && position < cue.end)
    .map((cue) => cue.text)
    .join('\n');
}
