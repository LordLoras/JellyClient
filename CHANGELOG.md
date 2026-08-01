# Changelog

## 1.4.1 — 2026-08-01

- Replace hidden checkbox-based settings toggles with explicit switch controls
  so automatic skipping, playback, subtitle, codec, and SyncPlay options remain
  stable while they are changed.
- Add navigation history inside item details. A visible Back control, `Alt+Left`,
  `Escape`, and the mouse back button can now return from an episode to its
  season and then to its series without closing the details view.
- Correct season and episode headings so optional labels do not leave a leading
  separator.
- Expand automated coverage to 118 unit tests and 16 desktop workflows,
  including settings-toggle stability and series navigation.

## 1.4.0 — 2026-08-01

- Add text-subtitle scaling from 50–200%, named presets, 1% adjustment,
  selectable text colors, shadow strength, and an in-app preview. Saved
  appearance settings are passed directly to MPV.
- Add a SyncPlay Room Check for local player readiness, the shared Jellyfin
  room state, playback drift, server round trip, clock offset, clock jitter,
  and automatic correction history.
- Re-sample and filter the Jellyfin server clock while a SyncPlay room remains
  joined. Smaller ongoing drift now uses temporary speed adjustment, while
  larger offsets retain exact seek correction.
- Keep card action menus inside the application viewport, including cards near
  the left edge and cards inside clipped poster containers.
- Expand automated coverage to 116 unit tests and retain 15 packaged-app
  workflows, including real Electron and MPV playback interaction.

## 1.3.0 — 2026-08-01

- Center the native MPV Skip Intro and Skip Ending prompt and add a visible
  countdown with a shrinking fifteen-second progress bar.
- Allow the skip shortcut to be rebound to a letter, number, or function key;
  the active key is shown directly in the prompt.
- Delay automatic intro and ending skips by the configured prompt duration and
  display the remaining time instead of skipping without warning.
- Detect opening intro markers immediately, including markers that begin in
  the first few seconds of an episode.
- Allow an Up Next series to be hidden on this client with Undo, and restore
  all hidden series from Home screen settings.
- Expand automated coverage to 109 unit tests while retaining 15 packaged-app
  click workflows, including an opening intro rendered through real MPV.

## 1.2.0 — 2026-08-01

- Add configurable home rows for Continue Watching, Up Next, My List,
  recently watched, recommendations, recently added titles, and libraries.
- Add My List and watch-history views, richer catalog filters, genre and person
  browsing, series and season contents, and Jellyfin recommendations.
- Add playlist and collection browsing, creation, item management, and playlist
  reordering from the item details screen.
- Add card menus for restarting a title, changing watched state, and managing
  My List, plus a ten-second undo after removing Continue Watching progress.
- Add selectable Windows display targeting while retaining automatic display
  selection as the default.
- Add retry controls for failed playback and manual SyncPlay resynchronization
  without leaving the room.
- Harden SyncPlay against overlapping seeks and rapid command bursts, preserve
  the playing state across synchronized seeks, and continuously correct large
  drift after playback starts.
- Route Jellyfin remote play, pause, stop, and seek commands through the local
  player or the active SyncPlay room as appropriate.
- Keep the list picker above item details so playlists and collections remain
  clickable, and dismiss the player dock after playback is stopped.
- Expand automated coverage to 102 unit tests and 15 desktop tests, including
  deterministic randomized SyncPlay command bursts, transient server failures,
  remote-control routing, Continue Watching undo, offline startup, list
  management, and a real MPV playback-control session.

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
- Show the connection form immediately while saved-session and MPV checks run
  in the background, with bounded timeouts for an offline server.
- Replace the split promotional sign-in screen with a larger centered
  connection form and simplify decorative labels across both clients.

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
