# JellyClient for VIDAA

JellyClient for VIDAA is a television interface for Jellyfin. The page runs in
the VIDAA browser, while the TV's native video element performs playback. A
companion server on the PC hosts the built interface and securely adds the
Jellyfin credentials that the TV does not store.

## What it supports

- Continue Watching, Up Next, recently added titles, and library summaries.
- Audio and text-subtitle selection before playback.
- In-player audio and subtitle switching.
- Persistent preferred track and subtitle appearance settings.
- Remote-friendly play, pause, seek, stop, and auto-hiding controls.
- MP4 direct play and progressive MP4 video-copy remuxing for compatible MKV
  sources.
- Native SDR, HDR10, and Dolby Vision output when supported by the television
  and source.
- A timed WebVTT subtitle overlay independent of VIDAA's native `<track>`
  implementation.
- Protection against unnoticed HDR or Dolby Vision video transcoding.
- A separate signal probe for validating TV playback modes with known media.

Bitmap PGS subtitle rendering and VIDAA SyncPlay are not available yet.

## Requirements

- A current Jellyfin server.
- A Windows PC with Node.js and pnpm.
- The PC and television on the same trusted local network.
- Windows Firewall permission for Node.js on private networks.

Audio is decoded and output by the television. Use the TV speakers or an audio
system connected to the TV; the PC speakers are not part of the VIDAA playback
path.

## Start the release build

From the repository root:

```powershell
pnpm install
pnpm vidaa:serve
```

`vidaa:serve` performs a clean, minified build into `VIDAA/dist`, then starts
the local release server. It does not use source hot reloading.

The default release port is 80. On the PC, open:

```text
http://localhost/connect
```

Enter the Jellyfin server URL and credentials. The page displays one or more
LAN addresses such as:

```text
http://192.168.1.20/
```

Open the displayed address in the television browser. Bookmark it on the TV if
the firmware supports bookmarks.

The password is used for the sign-in request and is not saved. The resulting
Jellyfin access token is stored on the PC in `VIDAA/jellyfin.local.json`. That
file is excluded from Git.

### Start an existing build

If `VIDAA/dist` has already been built:

```powershell
pnpm vidaa:start
```

Run `pnpm vidaa:serve` again after pulling code changes so the output is
rebuilt before it is served.

## Change the port

If port 80 is occupied or unavailable, set `VIDAA_PORT` before starting the
server. For example, to use port 8090 in PowerShell:

```powershell
$env:VIDAA_PORT = '8090'
pnpm vidaa:serve
```

Then use:

```text
PC connection page: http://localhost:8090/connect
TV client:          http://<PC-LAN-IP>:8090/
```

`VIDAA_PORT` accepts an available whole-numbered TCP port from 1 through 65535.
Strict port binding is enabled, so startup reports an error instead of silently
moving to another port.

To remove the override from the current PowerShell session:

```powershell
Remove-Item Env:VIDAA_PORT
```

If Windows Firewall asks whether Node.js may accept connections, allow it on
private networks. A custom port may also need a matching inbound firewall rule.

## Connect Jellyfin

The `/connect` page is intentionally writable only from the PC itself. Other
devices may open the interface, artwork, subtitle, and media endpoints only
after the PC has established the Jellyfin session.

The server URL may include:

- `http://` or `https://`
- a hostname or IP address
- a non-default Jellyfin port
- a Jellyfin base path such as `/jellyfin`

After connecting, leave the PC server process running while using the TV
client.

## Playback and track controls

Selecting a title first opens the audio and subtitle choices. During playback,
choose **Audio & subtitles** in the control bar:

- Text subtitle changes apply immediately and do not restart the video.
- Audio changes ask Jellyfin for a new stream and resume at the current
  position.
- Bitmap PGS tracks are shown but disabled.
- **Subtitle appearance** opens the same settings available from the home page.

The home-page **Settings** menu stores the following preferences in the
television browser:

- preferred audio and subtitle language
- whether subtitles start enabled
- subtitle size, color, background, and vertical position
- remote seek interval
- control auto-hide timeout

These settings remain on that television/browser profile. They are not written
to the Jellyfin server or the PC credential file.

## Playback policy

The Jellyfin device profile advertises MP4 H.264 and HEVC direct playback.
Compatible MKV sources are requested as progressive MP4 remuxes with the
original video copied unchanged. Audio may be copied or converted to a format
accepted by the television.

If Jellyfin reports that HDR or Dolby Vision video must be encoded, playback is
stopped instead of silently producing tone-mapped SDR or discarding Dolby
Vision metadata.

Text, ASS, SSA, SubRip, MOV_TEXT, and WebVTT subtitle tracks are requested from
Jellyfin as WebVTT and rendered above the native video.

Actual codec, profile, container, and audio compatibility still depends on the
television firmware. A Dolby Vision logo or picture-mode change reported by the
TV is stronger evidence than JavaScript codec detection.

## Tested television

Native playback has been exercised on:

- Hisense 55UR8S RGB MiniLED
- VIDAA software `v01.09.60V.Q0618`

Testing on that television confirmed distinct SDR output, HDR10/PQ mode
activation, and Dolby Vision mode activation for compatible source files.
Behavior on other Hisense models and VIDAA firmware versions may differ.

## Signal probe

The signal probe is useful before connecting a full library or when validating
a firmware update.

On the PC, open:

```text
http://localhost:<PORT>/setup
```

Add PC-local media paths or direct HTTP media URLs, save, and then open
`/probe` on the TV. A useful test set contains:

1. SDR H.264 or HEVC in MP4.
2. HDR10 HEVC Main 10 in MP4.
3. HDR10 HEVC Main 10 in MKV.
4. Dolby Vision Profile 5 in MP4.
5. Dolby Vision Profile 8.1 in MP4.
6. Dolby Vision Profile 8.1 in MKV.

The setup page writes `VIDAA/probe-media.local.json`. Optional short media
samples may be kept in `VIDAA/test-media.local`. Both locations are excluded
from Git.

## Development

Start the live development server on port 4173:

```powershell
pnpm vidaa:probe
```

The `VIDAA_PORT` override also works in development.

Build and test:

```powershell
pnpm vidaa:build
pnpm test
```

Available routes:

- `/` — Jellyfin TV home and player.
- `/connect` — PC-only Jellyfin connection.
- `/probe` — playback signal probe.
- `/setup` — PC-only signal-probe configuration.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the bridge, authentication,
playback, and subtitle flow.

## Security

Use the release server only on a trusted local network. It is not an
Internet-facing deployment and does not provide TLS, user isolation, or
rate-limiting.

Jellyfin connection changes and signal-probe configuration are accepted only
from the PC loopback interface. While the server runs, LAN devices can access
the authenticated library and media proxy endpoints.

Do not commit:

- `VIDAA/jellyfin.local.json`
- `VIDAA/probe-media.local.json`
- local media samples
- authenticated Jellyfin URLs
