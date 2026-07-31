import type {
  AudioPassthroughSettings,
  MpvAudioDevice
} from '@shared/contracts.js';

const DEVICE_LINE = /^\s*'([^']+)'\s+\((.+)\)\s*$/;

export function parseMpvAudioDevices(output: string): MpvAudioDevice[] {
  const devices = output
    .split(/\r?\n/)
    .flatMap((line): MpvAudioDevice[] => {
      const match = DEVICE_LINE.exec(line);
      return match
        ? [{ id: match[1]!, description: match[2]!.trim() }]
        : [];
    });

  return devices.filter((device, index) =>
    devices.findIndex((candidate) => candidate.id === device.id) === index
  );
}

export function mpvPassthroughCodecs(
  settings: AudioPassthroughSettings
): string[] {
  const codecs: string[] = [];
  if (settings.ac3) codecs.push('ac3');
  if (settings.eac3) codecs.push('eac3');
  if (settings.truehd) codecs.push('truehd');
  if (settings.dtsHd) codecs.push('dts-hd');
  else if (settings.dts) codecs.push('dts');
  return codecs;
}

export function codecRequestsPassthrough(
  sourceCodec: string | null,
  settings: AudioPassthroughSettings
): boolean {
  const codec = sourceCodec?.toLowerCase().replace(/[\s_.-]/g, '') ?? '';
  if (codec === 'ac3') return settings.ac3;
  if (codec === 'eac3' || codec === 'ec3') return settings.eac3;
  if (codec === 'truehd' || codec === 'mlp') return settings.truehd;
  if (codec.includes('dts') || codec === 'dca') {
    return settings.dts || settings.dtsHd;
  }
  return false;
}

export function isPassthroughOutputFormat(format: string | null): boolean {
  const normalized = format?.toLowerCase() ?? '';
  return normalized.includes('spdif') || normalized.includes('iec61937');
}
