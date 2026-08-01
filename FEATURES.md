# Windows features

This document describes the current Windows client. The app uses Jellyfin for
library data and stream negotiation, then opens playback in MPV.

## Library and sign-in

- Find Jellyfin servers on the local network or enter an address manually.
- Sign in with a username and password or Jellyfin Quick Connect.
- Browse configurable home sections for Continue Watching, Up Next, My List,
  recently watched, recommendations, recently added titles, and libraries.
- Search the library and open dedicated My List, history, playlist, and
  collection views.
- Browse series, seasons, genres, people, and related titles from item details.
- Filter libraries by watched state, My List, media type, genre, year, rating,
  4K availability, or subtitle availability.
- Sort by title, date added, release date, year, rating, runtime, or last played.
- Mark an item watched or unwatched and add or remove it from favorites.
- Restart an item from the beginning or remove saved progress from Continue
  Watching, with a short Undo period.
- Hide an unwanted series from Up Next with Undo, and restore hidden series
  from Home screen settings.
- Create playlists and collections, add or remove titles, and reorder playlist
  entries.
- Open available trailers and special features.
- Return through library, search, and settings history from the top bar,
  `Alt+Left`, or a mouse back button.
- Move through horizontal home sections with on-screen rail controls.

## Playback preparation

- Inspect the media versions and streams reported by Jellyfin.
- Choose a media version, starting audio track, starting subtitle track, and
  streaming bitrate before playback.
- Direct play the original file, remux it, or request a Jellyfin transcode when
  required.
- Show the planned playback method and the reason for that decision.
- Display resolution, HDR format, audio codec, and channel layout when that
  information is present in the selected media source.

## Video, audio, and subtitles

- Play SDR and HDR10/PQ video through MPV.
- Use hardware decoding when supported by the GPU, driver, and selected MPV
  configuration.
- Select and cycle audio tracks.
- Use text, ASS/SSA, and bitmap PGS subtitles through MPV.
- Set preferred audio and subtitle languages.
- Prefer forced subtitles and optionally avoid SDH/CC tracks.
- Remember manually selected audio and subtitle languages for each series.
- Adjust playback speed, subtitle delay, and audio delay while watching.
- Choose any audio endpoint reported by MPV, including speakers, headphones,
  a television over HDMI, or a directly connected receiver.
- Use decoded PCM by default or enable passthrough separately for AC-3,
  E-AC-3, TrueHD, DTS, and DTS-HD.
- Fall back to decoded PCM when a selected endpoint cannot initialize the
  requested bitstream.

## Navigation and episode playback

- Navigate chapters from the app or with MPV shortcuts.
- Preview Jellyfin trickplay images while moving over the seek bar when the
  server has generated them.
- Show centered Skip Intro and Skip Ending prompts from Jellyfin media segments
  with a visible countdown and progress bar.
- Rebind the segment shortcut to a letter, number, or function key. The prompt
  displays the active binding.
- Choose how long prompts remain visible; automatic skipping uses the same
  countdown instead of skipping without warning.
- Show a cancelable next-episode countdown after an episode.
- Press `N` during post-play to start the next episode or `Esc` to cancel it.
- Configure whether the next episode starts automatically and how long the
  countdown lasts.

## SyncPlay

- Create, join, and leave a Jellyfin SyncPlay group without casting through a
  separate browser session.
- Coordinate play, pause, seek, buffering, media changes, and segment skips.
- Relay pause and seek controls used inside the fullscreen MPV window through
  the active group.
- Correct small timing drift while retaining hard correction for larger drift.
- Recover from slow MPV loads and superseded rapid commands without leaving
  and rejoining the group.
- Request a clean room resynchronization if a client or network interruption
  leaves the local timeline behind.
- Continue measuring drift during playback and correct large offsets that
  develop after the initial start sequence.

## Remote control and recovery

- Receive Jellyfin Play On commands from another Jellyfin client.
- Apply remote play, pause, seek, and stop commands locally or through the
  active SyncPlay room.
- Retry a failed MPV load from the last known position.
- Choose a preferred Windows display for new MPV sessions or leave display
  selection automatic.

## Playback information

- Inspect Jellyfin's source and delivery decision.
- Inspect MPV's decoded video, display target, render path, dropped frames,
  cache state, and audio output information.
- Compare the requested audio device and passthrough mode with MPV's actual
  output driver, format, channel layout, and fallback status.
- Open MPV's native statistics overlay.
- Copy a debug report that excludes the Jellyfin password and access token.

MPV reporting confirms the signal sent toward the Windows display path. The
television's HDR indicator remains the final confirmation that the complete
Windows, GPU, HDMI, and television chain entered HDR mode.

## Current boundaries

- Automatic display refresh-rate switching is not implemented and is currently
  a lower priority.
- Dolby Vision output on Windows depends on the complete certified Windows and
  display path; the VIDAA client is the intended route for television-native
  Dolby Vision playback.
- Chapters, trickplay previews, and intro or ending prompts require the
  corresponding Jellyfin metadata.
