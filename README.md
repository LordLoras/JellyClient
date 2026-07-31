# JellyClient

JellyClient contains Jellyfin clients for Windows and VIDAA televisions.

## Windows

The Windows app provides a library interface and opens video in MPV.

- Browse, search, resume, and manage items in a Jellyfin library.
- Find servers on the local network or sign in with Jellyfin Quick Connect.
- Filter and sort libraries, open favorites, and update favorite or watched
  status.
- Direct play, remux, or use a Jellyfin transcode when required.
- Choose a media version, starting tracks, and streaming bitrate before play.
- Play HDR10/PQ through MPV.
- Select audio, ASS/SSA, text, and PGS subtitle tracks.
- Apply language preferences globally or remember audio and subtitle choices
  for each series.
- Navigate chapters and preview Jellyfin trickplay images while seeking.
- Change playback speed and audio or subtitle timing while watching.
- Create or join a SyncPlay group from the app.
- Keep group playback aligned through pause, seek, buffering, and drift updates.
- Press `N` when the on-screen Skip Intro or Skip Ending prompt appears.
- Optionally skip intro or ending segments automatically.
- Continue to the next episode with a cancelable post-play countdown.
- View playback, video, display, and audio details while a video is open.
- Show resolution, HDR format, and audio information when it is present in
  Jellyfin's media data.

### Requirements

- Windows 11 x64.
- A current Jellyfin server.
- A recent 64-bit MPV build (MPV 0.38 or newer).

MPV is not included. After downloading a Windows build, select `mpv.exe` under
**Settings → MPV + HDR output**.

### Run from source

```powershell
pnpm install
pnpm dev
```

Build the app and create the unpacked executable:

```powershell
pnpm test
pnpm build
pnpm package:win
```

The result is written to `release/win-unpacked`. An installer is not required.

More settings are described in [Configuration](docs/CONFIGURATION.md). Manual
playback checks are listed in the [Windows test matrix](docs/TEST_MATRIX.md).

## VIDAA

The VIDAA app runs in the television browser. A small program on the PC serves
the interface and connects it to Jellyfin.

- Browse Continue Watching, Up Next, recent items, and libraries.
- Play compatible SDR, HDR10, and Dolby Vision video through the TV player.
- Choose a media version and streaming bitrate before playback.
- Select audio and text subtitle tracks before or during playback.
- Adjust subtitle appearance and timing, preferred languages, playback speed,
  seek length, and the control timeout.
- Navigate chapters and continue to the next episode from post-play.
- Press `N` when the Skip Intro or Skip Ending prompt appears.
- Optionally skip intro or ending segments automatically.
- Use the included signal probe to test the formats accepted by a television.

See the [VIDAA setup guide](VIDAA/README.md) for the required software and
step-by-step instructions.

## Checks

```powershell
pnpm test
pnpm build
pnpm vidaa:build
```
