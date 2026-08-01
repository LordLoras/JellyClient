import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { userFacingError } from './errors.js';

describe('userFacingError', () => {
  it('turns request timeouts into a useful server status message', () => {
    const error = new AxiosError(
      'timeout of 2500ms exceeded',
      'ECONNABORTED'
    );

    expect(userFacingError(error, 'Connection failed.')).toBe(
      'The Jellyfin server did not respond. Check that it is running and reachable.'
    );
  });
});
