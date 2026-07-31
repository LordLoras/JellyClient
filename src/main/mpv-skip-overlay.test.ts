import {
  describe,
  expect,
  it
} from 'vitest';
import { skipPromptAss } from './mpv-skip-overlay.js';

describe('MPV skip overlay', () => {
  it('renders the bottom-left label and N shortcut', () => {
    const overlay = skipPromptAss('Skip Intro');
    expect(overlay).toContain('Skip Intro');
    expect(overlay).toContain('}N');
    expect(overlay).toContain('\\pos(52,620)');
  });

  it('escapes ASS control characters in labels', () => {
    expect(skipPromptAss('Skip {Intro}')).toContain('Skip \\{Intro\\}');
  });
});
