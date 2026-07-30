export type ExpectedSignal =
  | 'SDR'
  | 'HDR10'
  | 'Dolby Vision P5'
  | 'Dolby Vision P8.1'
  | 'Other';

export type ProbeSourceKind = 'file' | 'url';

export interface StoredProbeSource {
  id: string;
  label: string;
  expected: ExpectedSignal;
  kind: ProbeSourceKind;
  location: string;
  notes: string;
}

export interface ProbeConfig {
  version: 1;
  firmware: string;
  sources: StoredProbeSource[];
}

export interface PlaybackProbeSource {
  id: string;
  label: string;
  expected: ExpectedSignal;
  kind: ProbeSourceKind;
  notes: string;
  playbackUrl: string | null;
  available: boolean;
  detail: string;
}

export interface PublicProbePayload {
  firmware: string;
  sources: PlaybackProbeSource[];
  lanUrls: string[];
  configError: string | null;
}

export interface SetupProbePayload extends ProbeConfig {
  configPath: string;
  lanUrls: string[];
  configError: string | null;
}

export interface CapabilityResult {
  label: string;
  value: string;
  tone: 'good' | 'neutral' | 'warning';
}

export interface ProbeEvent {
  id: number;
  at: string;
  name: string;
  detail: string;
  tone: 'normal' | 'good' | 'warning' | 'error';
}
