import { describe, expect, it } from 'vitest';
import { mpvAuthorizationHeaderField } from './mpv-http.js';

describe('MPV HTTP authorization', () => {
  it('adds the HTTP field name expected by MPV and FFmpeg', () => {
    expect(mpvAuthorizationHeaderField('MediaBrowser Client="JellyClient"'))
      .toBe('Authorization: MediaBrowser Client="JellyClient"');
  });

  it('does not duplicate an existing Authorization field name', () => {
    expect(mpvAuthorizationHeaderField(
      'Authorization: MediaBrowser Client="JellyClient"'
    )).toBe('Authorization: MediaBrowser Client="JellyClient"');
  });

  it('removes line breaks and rejects an empty value', () => {
    expect(mpvAuthorizationHeaderField('MediaBrowser\r\n Token="test"'))
      .toBe('Authorization: MediaBrowser  Token="test"');
    expect(() => mpvAuthorizationHeaderField('  ')).toThrow(
      'authorization header is missing'
    );
  });
});
