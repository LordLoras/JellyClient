import { TICKS_PER_SECOND } from '@shared/contracts.js';

export function formatDurationFromTicks(ticks: number | null): string {
  if (!ticks) return '';
  return formatDuration(ticks / TICKS_PER_SECOND);
}
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function friendlyError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : 'The operation could not be completed.';
  return message
    .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '')
    .replace(/^Error:\s*/i, '');
}
