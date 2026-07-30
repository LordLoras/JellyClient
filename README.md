# JellyClient

JellyClient is a Windows-first standalone Jellyfin client built around a
separate native MPV video window. The project aims to provide dependable
HDR10/PQ playback, ASS/SSA and PGS subtitles, explicit audio/subtitle track
selection, and first-class SyncPlay without a browser or cast handoff.

## Features

- Jellyfin server, port, optional base-path, username, and password sign-in UI.
- Password-free JSON configuration and a Windows-encrypted saved access token.
- Home, libraries, nested folders, search, item details, resume, and progress.
- Confirmed removal from Continue Watching and a dedicated Jellyfin-powered
  Up Next row matching Jellyfin Web's next-unwatched episode behavior, with
  automatic refresh when newly scanned episodes arrive.
- Direct play, direct stream/remux, and Jellyfin server transcode negotiation.
- A managed MPV process using a private, per-launch Windows named pipe.
- D3D11 and Vulkan/winvk output modes using `gpu-next`.
- Automatic HDR output, advanced source-metadata passthrough, and SDR tone map.
- Native MPV ASS/SSA/attached-font and PGS subtitle rendering.
- Automatic preferred-language subtitles, enabled by default for English, with
  an explicit opt-out and manual per-video overrides.
- In-player audio and subtitle track selection.
- SyncPlay list/create/join/leave and one-action **Watch together**.
- Group play, pause, seek, stop, queue, buffering/ready, clock sampling, and
  bounded drift correction.
- Jellyfin remote-control support with safe, unambiguous SyncPlay auto-join.
- A live signal inspector that separates Jellyfin transport, MPV's decoded
  input, display-target color parameters, tone mapping, GPU/VO state, audio
  output, dropped frames, and cache health.
- Resolution, HDR format, and audio-layout labels from Jellyfin media metadata.
- Playback diagnostics with a redacted report and MPV statistics overlay.

## Requirements

- Windows 11 x64.
- A current Jellyfin server.
- A recent 64-bit MPV build (MPV 0.38 or newer).

MPV is not redistributed in this repository yet. Install a trusted current
Windows build, then select `mpv.exe` under **Settings → MPV + HDR output**.
JellyClient also checks common Scoop, Chocolatey, Program Files, bundled, and
`PATH` locations.

## Run from source

```powershell
pnpm install
pnpm dev
```

Production checks and the Windows installer:

```powershell
pnpm test
pnpm test:e2e
pnpm package:win
```

The NSIS installer is written to `release/`.

## First run

1. Enter the protocol (`http` or `https`), Jellyfin host/IP, and port.
2. If the server uses a path prefix, select **Server uses a base path?** and
   enter a value such as `/jellyfin`.
3. Enter the Jellyfin username and password.
4. Leave **Remember this session** on to save only the access token encrypted
   with Windows. The password is discarded after the login request.
5. Open Settings, select or confirm `mpv.exe`, choose D3D11, and leave HDR
   behavior on **Automatic HDR10 passthrough** unless testing another output
   policy.
6. Browse and play locally, or use **Watch together** on a title. That action
   creates and joins the room before setting its queue; there is no second MPV
   or browser-side join.
7. During playback, select the gauge icon in the player dock. A green
   **Direct play**, **PQ input**, and **PQ display target** chain is the expected
   HDR10 path. The display's own HDR indicator remains the final end-to-end
   check.

See [Configuration](docs/CONFIGURATION.md) and
[Windows test matrix](docs/TEST_MATRIX.md) for details.

## Project direction

Development is focused on dependable Windows playback, observable HDR and
tone-mapping decisions, broad subtitle support, and low-friction SyncPlay.
Longer-term goals include a native VIDAA client for platform-native Dolby
Vision playback, optional HDMI audio bitstream passthrough, bundled-player
distribution, and broader Jellyfin features such as Quick Connect, multiple
saved servers, Live TV, downloads, and music.
