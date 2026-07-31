# Changelog

## 0.4.0 — 2026-07-31

### Windows

- Added MPV audio-device discovery and output-device selection.
- Added decoded PCM and optional encoded-passthrough modes.
- Added individual AC-3, E-AC-3, TrueHD, DTS, and DTS-HD passthrough controls.
- Added PCM fallback when a requested bitstream output cannot initialize.
- Expanded playback diagnostics with the requested device, MPV audio driver,
  actual output format, passthrough state, and fallback reason.
- Added LAN server discovery and Jellyfin Quick Connect.
- Added library filtering, sorting, favorites, watched-state controls, media
  version selection, bitrate selection, chapters, and trickplay previews.
- Added language preferences, per-series track memory, live timing controls,
  automatic intro or ending skips, and cancelable next-episode playback.

### VIDAA

- Added TV-speaker, eARC, and custom audio compatibility profiles.
- Added original-versus-converted audio information to the player overlay.
- Added Quick Connect, complete library browsing, search, media-source and
  bitrate selection, chapters, player settings, and post-play controls.
- Kept HDR10 and Dolby Vision video conversion blocked when it would remove the
  original HDR signal.

### Documentation and verification

- Split detailed Windows and VIDAA features into separate reference documents.
- Added automated coverage for Windows MPV audio parsing and VIDAA audio-profile
  negotiation.
- Updated the portable Windows build and VIDAA production bundle.
