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
      "audioDevice": "auto",
      "audioOutputMode": "pcm",
      "audioPassthrough": {
        "ac3": true,
        "eac3": true,
        "truehd": false,
        "dts": true,
        "dtsHd": false
      },
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

Begin with D3D11 and `auto`. Use the playback diagnostics to verify PQ
input/output, BT.2020 primaries, hardware decode, display refresh, and dropped
frames.

## Audio output

- `audioDevice` is an MPV device identifier. Use `auto` for the current Windows
  default or choose an endpoint from the Settings screen.
- `pcm` decodes audio and uses the Windows endpoint's preferred channel layout.
- `passthrough` forwards only the codecs enabled under `audioPassthrough`.

For PC → TV → eARC soundbar connections, choose the television's HDMI endpoint.
The television controls the final eARC route. If the endpoint does not accept a
requested bitstream, JellyClient asks MPV to continue with decoded PCM and
records the result in playback diagnostics.
