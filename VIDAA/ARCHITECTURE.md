# VIDAA client architecture

## Overview

The VIDAA client is split across the television and a PC on the same local
network:

```text
VIDAA browser and native video
            │
            │ HTTP on the trusted LAN
            ▼
JellyClient local release server
            │
            │ Authenticated Jellyfin API and media requests
            ▼
        Jellyfin server
```

The television receives the interface, public library data, artwork,
subtitles, and ticketed media through the local release server. The Jellyfin
access token remains on the PC.

## Components

### TV interface

`VIDAA/src/JellyfinApp.tsx` provides:

- home rails and media selection
- pre-play audio and subtitle choices
- native `<video>` playback
- custom WebVTT subtitle rendering
- in-player track controls
- local playback preferences
- playback progress reporting

`VIDAA/src/player-settings.ts` validates and persists TV-local settings in
`localStorage`. No credentials are stored there.

### Jellyfin bridge

`VIDAA/server/jellyfin-bridge.ts`:

- authenticates the PC setup request
- stores and loads the Jellyfin session
- fetches home and playback metadata
- negotiates direct play, remuxing, or audio conversion
- creates expiring media tickets
- proxies media, images, and subtitle streams
- reports playback state to Jellyfin

### Release host and signal probe

`VIDAA/vite.config.ts` configures the built interface, Jellyfin bridge, local
signal-probe media server, LAN addresses, and selectable port.

## Routes

### Pages

| Route | Purpose |
| --- | --- |
| `/` | TV home, settings, and native player |
| `/connect` | Jellyfin connection page; changes are loopback-only |
| `/probe` | Standalone TV signal probe |
| `/setup` | Signal-probe configuration; loopback-only |

### Jellyfin bridge API

| Route | Purpose |
| --- | --- |
| `GET /api/vidaa/session` | Public connection status |
| `POST /api/vidaa/session` | Authenticate and save a session from the PC |
| `DELETE /api/vidaa/session` | Remove the saved session from the PC |
| `GET /api/vidaa/home` | Continue Watching, Up Next, latest items, and libraries |
| `GET /api/vidaa/items/:id/playback-options` | Media source and track choices |
| `POST /api/vidaa/items/:id/play` | Negotiate playback and create a media ticket |
| `GET /api/vidaa/media/:ticket` | Range-capable ticketed media proxy |
| `GET /api/vidaa/images/:id/:type` | Authenticated artwork proxy |
| `GET /api/vidaa/subtitles/:item/:source/:track.vtt` | Jellyfin WebVTT subtitle stream |
| `POST /api/vidaa/playback/report` | Start, progress, pause state, and stop reporting |

## Authentication and local state

The PC connection page sends the Jellyfin username and password directly to
the local bridge. The password is discarded after authentication. The bridge
stores the returned access token with the server and user identifiers in:

```text
VIDAA/jellyfin.local.json
```

The file is plaintext because it must be read by the local Node.js server. It
is excluded from Git. Filesystem access to the PC account and access to the
trusted LAN should therefore be treated as security boundaries.

Session creation, deletion, and probe configuration reject non-loopback
requests. Playback and library endpoints must remain reachable by the TV after
the PC has connected Jellyfin.

## Playback negotiation

The bridge advertises a conservative VIDAA device profile:

- MP4/M4V/MOV containers
- H.264 and HEVC video
- AAC, AC-3, E-AC-3, and MP3 audio
- external text subtitle formats

The resulting paths are:

1. **Direct play** — Jellyfin returns the original compatible MP4 source.
2. **Direct stream** — Jellyfin remuxes a source such as MKV to progressive MP4
   while copying the video.
3. **Audio conversion** — Jellyfin may convert incompatible audio while
   copying the video.
4. **Video transcode** — accepted for SDR when needed, but rejected for HDR or
   Dolby Vision to avoid unnoticed tone mapping or metadata loss.

The TV remains the final authority on container, codec, profile, level, audio,
and Dolby Vision compatibility.

## In-player track changes

Text subtitle selection is client-side:

1. The player requests the selected track as WebVTT.
2. The cue parser builds timed cues.
3. React selects the active cue from the native video's current time.
4. The overlay updates without reloading the video.

Embedded audio cannot be switched on a standard browser `<video>` element. An
audio change therefore:

1. records the current playback position
2. reports the old play session as stopped
3. requests a new Jellyfin playback plan with the selected audio index
4. receives a new expiring media ticket
5. resumes the native video at the recorded position

## Subtitles

Supported text codecs include ASS, SSA, SRT/SubRip, MOV_TEXT, TX3G, WebVTT, and
plain text when Jellyfin can expose them as WebVTT.

The custom overlay exists because VIDAA's native `<track>` behavior was not
reliable on the tested firmware. It also enables user-controlled size, color,
background, and position.

PGS is bitmap-based and cannot be converted by the current cue parser. PGS
tracks are visible in the picker but disabled.

## Controls and remote input

The native player supports browser keys and common VIDAA media key codes for:

- play and pause
- backward and forward seek
- stop/back
- spatial navigation while a settings sheet is open

Controls auto-hide after the configured timeout while video is playing. Opening
Audio & Subtitles or Settings keeps the controls visible.

## Build and operation

Create the production bundle:

```powershell
pnpm vidaa:build
```

Serve an existing bundle:

```powershell
pnpm vidaa:start
```

Build and serve in one command:

```powershell
pnpm vidaa:serve
```

Port 80 is the default for the release server. Set `VIDAA_PORT` to use another
available port. The development server defaults to 4173.

The release host is designed for a trusted home LAN. It should not be exposed
to the public Internet.

## Remaining work

- VIDAA SyncPlay and drift correction
- bitmap PGS subtitle rendering
- broader device profiles based on additional television testing
- TV-friendly connection or Jellyfin Quick Connect
- packaged background service and automatic startup
- HTTPS or an authenticated reverse-proxy deployment model
