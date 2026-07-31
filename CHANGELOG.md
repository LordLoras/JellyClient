# Changelog

## 1.1.0 — 2026-08-01

- Keep SyncPlay membership alive when MPV loads slowly, retry the latest room
  command after playback becomes ready, and serialize rapid local controls.
- Ignore superseded queue loads and accept distinct commands that share a
  server timestamp.
- Measure playback offset continuously after playback starts and perform a
  follow-up hard correction when the initial start is late.
- Add back navigation through the top bar, `Alt+Left`, and the mouse back
  button, with modal-first behavior and restored catalog state.
- Fix overlapping Continue Watching and Up Next cards, add horizontal rail
  controls, and refine card motion and spacing.
- Increase the prominence of resolution, HDR, Dolby Vision, and audio badges
  with distinct visual treatments.

## 1.0.1 — 2026-07-31

- Route seek and pause actions made inside the MPV window through an active
  Jellyfin SyncPlay room.
- Add fullscreen MPV shortcuts for synchronized pause and five-second seeking:
  `Space` or `P` pauses and resumes, while `Left` and `Right` seek.
- Detect MPV OSC seek and pause changes and relay them to the room.
- Suppress local MPV events produced by incoming SyncPlay commands so they are
  not echoed back to Jellyfin.

## 1.0.0 — 2026-07-31

### Windows

- Browse and search Jellyfin libraries, continue watching, view next episodes,
  manage favorites and watched state, and choose media versions or tracks.
- Play through MPV with direct-play support, HDR10 output controls, subtitle and
  audio selection, audio-device routing, and optional encoded passthrough.
- Create or join SyncPlay rooms directly in the app, with synchronized start,
  pause, seek, resume, stop, buffering, and drift correction.
- Show intro and ending prompts, use the `N` shortcut, and continue to the next
  episode with a cancelable countdown.
- Inspect playback and display information through the signal inspector,
  copyable debug report, and MPV statistics overlay.

### VIDAA

- Run a television interface from a small LAN bridge with Quick Connect,
  library browsing, search, playback options, and locally stored settings.
- Use native television playback for compatible HDR10 and Dolby Vision files,
  with selectable audio and text-subtitle tracks.
- Use chapters, intro and ending skips, player controls, and next-episode
  playback from the television interface.

### Reliability

- Fixed Jellyfin authorization for MPV media requests that previously surfaced
  as `loading failed`.
- Fixed SyncPlay readiness so a room starts only after MPV has loaded the file
  and settled into its requested initial state.
- Prevented stale or duplicate playback events from advancing multiple episodes
  after a failed or replaced item.
- Kept ending skips inside a loaded file and advanced directly to the next
  episode when one is available.
- Added clear MPV command context to playback errors and blocked seeks before a
  media file is ready.
