# VIDAA features

This document describes the current VIDAA client. The television uses its
built-in video player while the companion server on the PC communicates with
Jellyfin.

## Library and connection

- Connect with a Jellyfin username and password or Quick Connect.
- Browse home sections, Continue Watching, Up Next, recent items, libraries,
  and nested folders.
- Search the Jellyfin library.
- Navigate the interface with a television remote or pointer.
- Return through the browse history with the television Back button.

## Playback preparation

- Inspect the media sources and streams reported by Jellyfin.
- Choose a media version, streaming bitrate, audio track, and subtitle track
  before playback.
- Show the selected source's resolution, HDR format, audio codec, channel
  layout, and expected playback method when available.
- Direct play supported files or ask Jellyfin to remux a compatible file into
  MP4 without re-encoding its video.
- Allow audio conversion when required by the television.
- Stop playback rather than silently request a video transcode when that would
  remove HDR10 or Dolby Vision.

## Player controls

- Play, pause, stop, and seek forward or backward.
- Change playback speed and configure the seek distance and control timeout.
- Select a different audio track while watching. Playback restarts at the same
  position with the selected stream.
- Change compatible text subtitles while watching without restarting video.
- Configure preferred languages, default subtitles, subtitle size, color,
  background, position, and timing.
- Navigate chapters from the in-player options menu.
- Show Skip Intro and Skip Ending prompts when Jellyfin provides the matching
  media segments.
- Press `N` to skip the active segment or enable automatic segment skipping.
- Show a cancelable Up Next countdown after an episode.
- Press `N` during post-play to start the next episode or Back/Esc to cancel.

## Video and subtitles

- Use the television's native path for compatible SDR, HDR10, and Dolby Vision
  playback.
- Request MP4 H.264 or HEVC playback from Jellyfin.
- Convert text, ASS, SSA, SubRip, MOV_TEXT, and WebVTT subtitle streams to
  WebVTT through Jellyfin and draw them in the app.
- Use the included signal probe to test files or media URLs independently of
  the Jellyfin library interface.

The actual video, audio, and HDR formats accepted depend on the television
model and firmware. The current path has been tested on a Hisense 55UR8S with
VIDAA software `v01.09.60V.Q0618`, including SDR, HDR10, and compatible Dolby
Vision files.

## Current boundaries

- Bitmap PGS subtitles are not rendered by the VIDAA client.
- SyncPlay is not implemented yet.
- The PC companion server must remain running while the television uses the
  client.
- The client is intended for a trusted home network and should not be exposed
  directly to the Internet.
- Chapters and intro or ending prompts require the corresponding Jellyfin
  metadata.
