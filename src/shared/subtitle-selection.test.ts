import { describe, expect, it } from 'vitest';
import {
  choosePreferredSubtitle,
  choosePreferredAudio,
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

  it('can prefer forced subtitles and avoid SDH tracks', () => {
    const selected = choosePreferredSubtitle([
      { id: 1, language: 'eng', title: 'English SDH', isDefault: true, isForced: false, isHearingImpaired: true },
      { id: 2, language: 'eng', title: 'English forced', isDefault: false, isForced: true }
    ], 'eng', { preferForced: true, avoidHearingImpaired: true });
    expect(selected?.id).toBe(2);
  });

  it('selects preferred audio before a default in another language', () => {
    expect(choosePreferredAudio([
      { id: 1, language: 'jpn', title: 'Japanese', isDefault: true },
      { id: 2, language: 'eng', title: 'English', isDefault: false }
    ], 'eng')?.id).toBe(2);
  });
});
