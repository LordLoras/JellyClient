# JellyClient

JellyClient is a set of standalone Jellyfin clients focused on native playback
features that are difficult to deliver consistently through a desktop browser.
The repository contains clients for Windows and Hisense VIDAA televisions.

| Client | Playback engine | Main capabilities |
| --- | --- | --- |
| Windows | MPV in a managed native window | HDR10/PQ, ASS/SSA and PGS subtitles, track selection, and integrated SyncPlay |
| VIDAA | Television-native video pipeline | HDR10 and Dolby Vision, Jellyfin library access, audio selection, and rendered text subtitles |

## Windows client

The Windows application provides a desktop library interface and controls a
separate MPV playback window.

Features include:

- Jellyfin sign-in with a Windows-encrypted saved access token.
- Home, libraries, folders, search, item details, resume, and progress.
- Continue Watching removal and Jellyfin-compatible Up Next behavior.
- Direct play, remux, and server-transcode negotiation.
- HDR-aware MPV output with D3D11 or Vulkan/winvk.
- ASS/SSA, attached-font, and PGS subtitle rendering.
- Audio and subtitle selection before and during playback.
- SyncPlay room creation, joining, playback control, buffering coordination,
  and bounded drift correction.
- A live signal inspector and credential-free diagnostic report.

### Windows requirements

- Windows 11 x64.
- A current Jellyfin server.
- A recent 64-bit MPV build (MPV 0.38 or newer).

MPV is not redistributed in this repository. Select `mpv.exe` under
**Settings → MPV + HDR output** after installing a trusted Windows build.

### Run the Windows client

```powershell
pnpm install
pnpm dev
```

Build and package:

```powershell
pnpm test
pnpm build
pnpm package:win
```

The unpacked application and optional installer are written to `release/`.
An installer is not required to run the unpacked executable.

See [Configuration](docs/CONFIGURATION.md) and the
[Windows test matrix](docs/TEST_MATRIX.md) for more detail.

## VIDAA client

The VIDAA client runs in the television browser and delegates video decoding
and display-mode selection to the TV. A small server on the PC hosts the built
interface and connects it to Jellyfin over the local network.

The client currently provides:

- Continue Watching, Up Next, recently added media, and libraries.
- Native SDR, HDR10, and Dolby Vision playback when the television accepts the
  source stream.
- MP4 direct play and video-copy MP4 remuxing for compatible MKV media.
- Audio and text-subtitle selection before playback.
- Audio and subtitle changes while playback is open.
- Persistent subtitle appearance, preferred-language, seek, and control
  settings stored on the television.
- Protection against unnoticed HDR or Dolby Vision video transcoding.

### Run the built VIDAA client

From the repository root:

```powershell
pnpm install
pnpm vidaa:serve
```

The command creates a minified production build and serves it on port 80. Open
`http://localhost/connect` on the PC to connect Jellyfin, then open the LAN URL
shown there on the television.

If port 80 is occupied:

```powershell
$env:VIDAA_PORT = '8090'
pnpm vidaa:serve
```

Use `http://localhost:8090/connect` on the PC and
`http://<PC-LAN-IP>:8090/` on the TV.

The server is intended for a trusted home network and should not be exposed to
the public Internet. See the [VIDAA guide](VIDAA/README.md) for installation,
firewall, playback, and troubleshooting details, and
[VIDAA architecture](VIDAA/ARCHITECTURE.md) for the request and media flow.

## Development

```powershell
pnpm test
pnpm build
pnpm vidaa:build
```

The VIDAA live-development server uses port 4173:

```powershell
pnpm vidaa:probe
```

Project development is centered on reliable native playback, transparent media
routing, accessible TV controls, and low-friction synchronized viewing.
