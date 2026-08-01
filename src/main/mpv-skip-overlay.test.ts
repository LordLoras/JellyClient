import {
  describe,
  expect,
  it
} from 'vitest';
import { skipPromptAss } from './mpv-skip-overlay.js';

describe('MPV skip overlay', () => {
  it('renders a centered label, dynamic shortcut, countdown, and progress', () => {
    const overlay = skipPromptAss({
      label: 'Skip Intro',
      shortcut: 'F4',
      secondsRemaining: 7.2,
      totalSeconds: 15,
      automatic: false
    });
    expect(overlay).toContain('Skip Intro');
    expect(overlay).toContain('F4 · 8s');
    expect(overlay).toContain('\\pos(430,594)');
    expect(overlay).toContain('l 202 0 202 5');
  });

  it('escapes ASS control characters in labels', () => {
    expect(skipPromptAss({
      label: 'Skip {Intro}',
      shortcut: 'N',
      secondsRemaining: 15,
      totalSeconds: 15,
      automatic: true
    })).toContain('Skip \\{Intro\\}');
  });

  it('shows the automatic skip countdown', () => {
    expect(skipPromptAss({
      label: 'Skip Ending',
      shortcut: 'N',
      secondsRemaining: 14.1,
      totalSeconds: 15,
      automatic: true
    })).toContain('AUTO-SKIP · 15s');
  });
});
