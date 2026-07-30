# JellyClient for VIDAA

This folder contains the VIDAA television client and its PC-hosted Jellyfin
bridge. The TV interface uses VIDAA's native video element while the PC keeps
the Jellyfin session and proxies authenticated artwork and streams. This lets
the television select its SDR, HDR10, or Dolby Vision playback pipeline.

## Signal probe
## Connect Jellyfin

Start the development server from the repository root:

```powershell
pnpm vidaa:probe
```

On the PC, open `http://localhost:4173/connect` and sign in. The password is
used only for authentication and is not saved. The resulting Jellyfin access
token is kept in the Git-ignored `VIDAA/jellyfin.local.json` file.

Open `http://<PC-LAN-IP>:4173/` on the TV. If the VIDAA browser does not accept
a nonstandard port, build and serve the client on ordinary HTTP port 80:

```powershell
pnpm vidaa:probe:tv
```

Then open `http://<PC-LAN-IP>/` on the TV. The client provides Continue
Watching, Up Next, recently added items, audio-track selection, English text
subtitles, and native playback. Bitmap PGS overlay and VIDAA SyncPlay remain
separate implementation work.


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

If the TV browser does not connect to a nonstandard port, use ordinary HTTP
port 80:

```powershell
pnpm vidaa:probe:tv
```

Then open `http://<PC-LAN-IP>/` on the television. The server also accepts a
matching `sslip.io` hostname alias when the TV handles hostnames more reliably
than raw IP addresses.

## Recommended test reel

1. SDR H.264 or HEVC in MP4.
2. HDR10 HEVC Main 10 in MP4.

The probe routes remain available at `/probe` and `/setup`. JavaScript codec
detection alone does not prove HDR or Dolby Vision output. A test passes only
when playback is stable and the television enters the expected picture mode.

## Playback policy

The Jellyfin profile advertises MP4 H.264/HEVC direct play and progressive MP4
remuxing. HDR and Dolby Vision playback is stopped if Jellyfin selects video
transcoding, preventing an unnoticed switch to tone-mapped SDR. Audio may be
copied or converted to a format accepted by the television.
3. HDR10 HEVC Main 10 in MKV.
4. Dolby Vision Profile 5 in MP4.
5. Dolby Vision Profile 8.1 in MP4.
6. Dolby Vision Profile 8.1 in MKV.

Use local media that may legally be used for testing. Do not commit media files
or authenticated Jellyfin stream URLs.

## Local configuration

The setup page writes `probe-media.local.json` in this folder. It is excluded
from Git and contains any configured PC paths or URLs.

Short remuxed controls can be stored in `test-media.local`. That directory is
also excluded from Git.

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

The Jellyfin connection page is also restricted to PC loopback. While the
bridge is running, devices on the local network can use its library and media
endpoints, so run it only on a trusted LAN.
```

The application is written to `VIDAA/dist`. The preview command retains the
Jellyfin bridge, local probe configuration, and byte-range media endpoints.
