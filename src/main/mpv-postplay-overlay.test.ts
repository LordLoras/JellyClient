import { describe, expect, it } from 'vitest';
import { postPlayAss } from './mpv-postplay-overlay.js';

describe('MPV post-play overlay', () => {
  it('shows the next title, countdown, and shortcuts', () => {
    const overlay = postPlayAss('S02 E04 · The Test', 10);
    expect(overlay).toContain('UP NEXT');
    expect(overlay).toContain('S02 E04 · The Test');
    expect(overlay).toContain('Playing in 10 seconds');
    expect(overlay).toContain('N  Play now');
    expect(overlay).toContain('Esc  Cancel');
  });

  it('escapes ASS control characters in titles', () => {
    expect(postPlayAss('Next {Episode}', 5)).toContain('Next \\{Episode\\}');
  });
});
