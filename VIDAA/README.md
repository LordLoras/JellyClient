# VIDAA signal probe

This folder contains a LAN-hosted playback probe for validating the VIDAA
browser/runtime before a full JellyClient TV application is built.

The probe does not claim that JavaScript codec detection proves HDR or Dolby
Vision output. A test passes only when playback is stable and the television
enters the expected HDR10 or Dolby Vision picture mode.

## Start

From the repository root:

```powershell
pnpm vidaa:probe
```

Open the PC setup page:

```text
http://localhost:4173/setup
```

Add PC-local media paths or direct HTTP media URLs and save. The setup page
shows the LAN address to open in the VIDAA browser.

## Recommended test reel

1. SDR H.264 or HEVC in MP4.
2. HDR10 HEVC Main 10 in MP4.
3. HDR10 HEVC Main 10 in MKV.
4. Dolby Vision Profile 5 in MP4.
5. Dolby Vision Profile 8.1 in MP4.
6. Dolby Vision Profile 8.1 in MKV.

Use local media that may legally be used for testing. Do not commit media files
or authenticated Jellyfin stream URLs.

## Local configuration

The setup page writes `probe-media.local.json` in this folder. It is excluded
from Git and contains any configured PC paths or URLs.

Configuration changes are accepted only from the PC loopback interface.
LAN devices can read the redacted source list and stream only the explicitly
configured files. Local file responses support HTTP byte-range requests needed
for seeking and large media.

To keep separate configurations, set `VIDAA_PROBE_CONFIG_PATH` before starting
the server.

## Production build

```powershell
pnpm vidaa:build
pnpm vidaa:preview
```

The static application is written to `VIDAA/dist`. The preview command retains
the local configuration and byte-range media endpoints.
