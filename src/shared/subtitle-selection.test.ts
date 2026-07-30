import { describe, expect, it } from 'vitest';
import {
  choosePreferredSubtitle,
  languageAliases,
  mpvLanguagePriority
} from './subtitle-selection.js';

describe('subtitle selection', () => {
  it('selects a default full English track ahead of forced English', () => {
    const selected = choosePreferredSubtitle([
      {
        id: 2,
        language: 'eng',
        title: 'English forced',
        isDefault: false,
        isForced: true
      },
      {
        id: 3,
        language: 'en',
        title: 'English',
        isDefault: true,
        isForced: false
      }
    ], 'eng');

    expect(selected?.id).toBe(3);
  });

  it('does not fall back to a non-preferred language', () => {
    expect(choosePreferredSubtitle([
      {
        id: 4,
        language: 'spa',
        title: 'Español',
        isDefault: true,
        isForced: false
      }
    ], 'eng')).toBeNull();
  });

  it('recognizes a language name in the title when the tag is missing', () => {
    expect(choosePreferredSubtitle([
      {
        id: 5,
        language: null,
        title: 'English SDH',
        isDefault: false,
        isForced: false
      }
    ], 'eng')?.id).toBe(5);
  });

  it('provides MPV with common English aliases', () => {
    expect(languageAliases('English')).toContain('eng');
    expect(mpvLanguagePriority('eng')).toContain('en');
  });
});
