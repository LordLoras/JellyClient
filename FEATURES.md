# Windows features

This document describes the current Windows client. The app uses Jellyfin for
library data and stream negotiation, then opens playback in MPV.

## Library and sign-in

- Find Jellyfin servers on the local network or enter an address manually.
- Sign in with a username and password or Jellyfin Quick Connect.
- Browse home sections, libraries, folders, Continue Watching, and Up Next.
- Search the library and open a dedicated Favorites view.
- Filter libraries by watched, unwatched, or favorite status.
- Sort by title, date added, release date, year, rating, or runtime.
- Mark an item watched or unwatched and add or remove it from favorites.
- Open available trailers and special features.

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
- Show Skip Intro and Skip Ending prompts from Jellyfin media segments.
- Press `N` to skip the active segment or enable automatic segment skipping.
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
