# JellyClient configuration

The Settings screen displays the exact active configuration path and can open
its containing folder. The installed app normally keeps these files under its
Windows application-data directory:

- `config.json` — readable server profile and application settings.
- `session.secure` — optional access token encrypted by Electron
  `safeStorage`, which uses the Windows-protected credential mechanism.

The Jellyfin password is never written to either file.

## Example `config.json`

```json
{
  "version": 1,
  "deviceId": "a-generated-device-uuid",
  "server": {
    "protocol": "http",
    "host": "192.168.1.20",
    "port": 8096,
    "basePath": "",
    "username": "your-jellyfin-user",
    "displayName": "192.168.1.20"
  },
  "settings": {
    "player": {
      "mpvPath": "C:\\path\\to\\mpv.exe",
      "hdrMode": "auto",
      "gpuApi": "d3d11",
      "hardwareDecoding": true,
      "alwaysOnTop": false,
      "fullscreenOnPlay": true
    },
    "syncPlay": {
      "autoJoinUnambiguousCast": true,
      "softCorrectionThresholdMs": 80,
      "hardSeekThresholdMs": 500
    }
  }
}
```

Use the in-app UI for normal changes. It validates ports, paths, enum values,
and SyncPlay thresholds before replacing the file atomically.

If `config.json` is malformed or from an incompatible schema, JellyClient moves
it beside the new file as `config.json.invalid-<timestamp>` and starts with
safe defaults. The original is preserved for manual recovery.

## Environment overrides

Developers and portable test runs can use:

- `JELLYCLIENT_CONFIG_PATH` — absolute or working-directory-relative path to a
  test `config.json`. Its encrypted session file is stored beside it.
- `JELLYCLIENT_MPV_PATH` — fallback MPV executable path.

Do not put a password or access token in either variable.

## HDR modes

- `auto` uses MPV `gpu-next` with automatic Windows display colorspace hints.
- `passthrough` requests source colorspace metadata for advanced testing.
- `tone-map` maps output to BT.709/gamma 2.2 while keeping an appropriate
  swapchain colorspace hint.

For the Hisense HDMI path, begin with D3D11 + `auto` and Windows HDR enabled.
Use the playback diagnostics to verify PQ input/output, BT.2020 primaries,
hardware decode, display refresh, and dropped frames.
