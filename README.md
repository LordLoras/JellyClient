# JellyClient

JellyClient contains Jellyfin clients for Windows and VIDAA televisions.

## Windows

The Windows app provides a library interface and opens video in MPV. See
[Windows features](FEATURES.md) for the current playback, library, SyncPlay,
subtitle, and diagnostic capabilities.

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
pnpm package:portable
```

The result is written to `release/win-unpacked`. An installer is not required.

More settings are described in [Configuration](docs/CONFIGURATION.md). Manual
playback checks are listed in the [Windows test matrix](docs/TEST_MATRIX.md).
Release changes are recorded in the [changelog](CHANGELOG.md).

## VIDAA

The VIDAA app runs in the television browser. A small program on the PC serves
the interface and connects it to Jellyfin. See the
[VIDAA setup guide](VIDAA/README.md) for installation and startup instructions,
or [VIDAA features](VIDAA/FEATURES.md) for playback and format details.

## Checks

```powershell
pnpm test
pnpm build
pnpm vidaa:build
```
