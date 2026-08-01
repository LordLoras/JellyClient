import axios from 'axios';

const SECRET_PATTERN =
  /((?:api[_-]?key|access[_-]?token|token|password|pw)=)[^&\s]+/gi;

export function redact(value: string): string {
  return value
    .replace(SECRET_PATTERN, '$1[REDACTED]')
    .replace(/(X-Emby-Token:\s*)[^\s,]+/gi, '$1[REDACTED]');
}
export function userFacingError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) {
      return 'Jellyfin rejected the username, password, or saved session.';
    }
    if (error.response?.status === 403) {
      return 'This Jellyfin user does not have permission for that action.';
    }
    const serverMessage =
      typeof error.response?.data === 'string'
        ? error.response.data
        : error.response?.statusText;
    if (serverMessage) return redact(serverMessage);
    if (error.code === 'ECONNREFUSED') {
      return 'The Jellyfin server refused the connection. Check its IP address and port.';
    }
    if (error.code === 'ENOTFOUND') {
      return 'The Jellyfin server address could not be found.';
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'The Jellyfin server did not respond. Check that it is running and reachable.';
    }
    return redact(error.message || fallback);
  }

  if (error instanceof Error) return redact(error.message);
  return fallback;
}
