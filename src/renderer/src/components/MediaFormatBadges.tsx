import type { MediaFormatInfo } from '@shared/contracts.js';

interface Props {
  mediaFormat: MediaFormatInfo;
}

export function MediaFormatBadges({ mediaFormat }: Props) {
  const badges = [
    { kind: 'resolution', label: mediaFormat.resolution },
    { kind: 'range', label: mediaFormat.videoRange },
    { kind: 'audio', label: mediaFormat.audio }
  ].filter(
    (badge): badge is { kind: string; label: string } =>
      Boolean(badge.label)
  );

  return badges.map((badge) => (
    <span
      className={`media-format-badge media-format-badge--${badge.kind}`}
      key={badge.kind}
      title={`${badge.label} source metadata reported by Jellyfin`}
    >
      {badge.label}
    </span>
  ));
}
