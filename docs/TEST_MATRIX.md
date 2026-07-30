# JellyClient Windows test matrix

Status: initial acceptance matrix
Date: 2026-07-30

## 1. Reference environment

| Component | Baseline |
|---|---|
| Client OS | Windows 11 Pro 64-bit, build 26200 |
| GPU | AMD Radeon RX 7900 XT |
| GPU driver | `32.0.31021.5001` at plan time |
| HDR display | Hisense 55UR8S RGB MiniLED |
| Connection | RX 7900 XT directly to TV over HDMI |
| Secondary display | LG UltraGear |
| Audio | PC speakers; decode locally; no bitstream passthrough requirement |
| Jellyfin server | Windows, current stable baseline 10.11.11 |
| Windows client shell | Electron main process + React renderer |
| Player | Managed MPV process using JSON IPC |
| Required subtitles | ASS/SSA with fonts/styling and PGS |
| Required HDR | HDR10 using PQ/BT.2020 |

The application must query and log the actual OS, GPU driver, display, audio
device, MPV version, and Jellyfin server version on every diagnostic run. The
values above are the reference, not hard-coded capability declarations.

## 2. Pass/fail principles

- "Plays" is insufficient. A pass requires the expected server delivery mode,
  decoder, color path, audio track, subtitle rendering, and lifecycle reports.
- A visual HDR pass requires both correct player diagnostics and no obvious
  washed-out blacks, raised blacks, clipped highlights, wrong saturation, or
  SDR/HDR mode mismatch.
- Every failure must produce a redacted diagnostic reason.
- Access tokens must never appear in logs, command lines, screenshots, or
  support bundles.
- Tests marked `Gate A` must pass before building the full library UI.
- Tests marked `Gate B` must pass before enabling SyncPlay by default.
- Tests marked `Later` are not current release blockers.

## 3. Test media manifest

Record each test file without copying copyrighted media into the repository:

| Field | Required value |
|---|---|
| Fixture ID | Stable local identifier such as `HDR10_HEVC_01` |
| Source | Synthetic, redistributable sample, or private local file |
| Container | MKV, MP4, MPEG-TS, HLS |
| Video | Codec, profile, level, bit depth, resolution, frame rate |
| Color | Primaries, transfer, matrix, range, mastering metadata, MaxCLL/FALL |
| Audio | Codec, channels/layout, sample rate, default flag, language |
| Subtitles | Codec, language, default/forced flags, attached fonts |
| Jellyfin item ID | Test-server item identifier |
| Expected mode | Direct Play, Direct Stream, or Transcode |
| `ffprobe` snapshot | Stored as redacted JSON/text test metadata |

Minimum fixture set:

1. SDR H.264 8-bit, BT.709, MKV, two audio tracks, SRT.
2. SDR HEVC 10-bit, BT.709, MKV.
3. HDR10 HEVC Main10, BT.2020/PQ, MKV, static mastering metadata.
4. HDR10 HEVC Main10, BT.2020/PQ, MP4.
5. HDR10 AV1 Main10 if a suitable sample is available.
6. HDR10 file with complex ASS and attached fonts.
7. HDR10 file with PGS subtitles.
8. ASS torture fixture: positioning, signs, karaoke, transforms, blur, outline,
   font fallback, and overlapping events.
9. PGS forced-subtitle fixture.
10. Multiple-audio fixture with at least two languages and different codecs.
11. A fixture intentionally requiring container remux.
12. A fixture intentionally requiring audio transcode.
13. A fixture intentionally requiring video transcode/HDR-to-SDR.

## 4. MPV baseline candidates

The spike compares configurations; it does not assume one works merely because
MPV accepts it.

### Candidate A: Windows D3D11

Starting intent:

```text
vo=gpu-next
gpu-api=d3d11
target-colorspace-hint=auto
hwdec=auto-safe
```

### Candidate B: Windows Vulkan fallback

Starting intent:

```text
vo=gpu-next
gpu-api=vulkan
gpu-context=winvk
target-colorspace-hint=auto
hwdec=auto-safe
```

Candidate A is preferred if color signaling, frame pacing, and hardware decode
are correct. Candidate B is a controlled fallback, not a user-facing choice in
the first release.

Do not initially force the TV's advertised marketing peak brightness. Use
detected/calibrated display information and MPV automatic target behavior.
Explicit target values are a diagnostic experiment only.

## 5. Environment and capability tests

| ID | Test | Expected result | Gate |
|---|---|---|---|
| ENV-01 | Enumerate displays | Hisense and LG are distinct; stable display IDs are recorded | A |
| ENV-02 | Detect HDR state | App identifies whether Windows HDR is active on the Hisense | A |
| ENV-03 | Detect GPU/driver | RX 7900 XT and driver are shown in diagnostics | A |
| ENV-04 | Detect audio output | Current PC speaker endpoint is shown; HDMI passthrough is disabled | A |
| ENV-05 | Detect Jellyfin version | Actual server version is displayed; 10.11.11 is accepted | A |
| ENV-06 | Detect MPV capabilities | MPV version, output drivers, hardware decoders, and libplacebo path are logged | A |
| ENV-07 | Move between monitors | Moving/opening playback on the Hisense selects the Hisense color path | A |
| ENV-08 | Remote desktop/Parsec adapter present | Virtual display never becomes the HDR output accidentally | A |

## 6. Player lifecycle and IPC tests

| ID | Test | Expected result | Gate |
|---|---|---|---|
| PLY-01 | Launch MPV and connect IPC | Random restricted named pipe connects within timeout | A |
| PLY-02 | Load local SDR file | `file-loaded` received; position and duration are valid | A |
| PLY-03 | Load local HDR10 file | HDR metadata and hardware decoder are observable | A |
| PLY-04 | Pause/unpause | State changes once; no feedback loop | A |
| PLY-05 | Absolute seek | Lands within agreed tolerance and emits seeking completion | A |
| PLY-06 | Temporary speed change | Speed changes, position delta is measurable, and speed returns exactly to 1.0 | A |
| PLY-07 | Real cache underrun | `paused-for-cache` produces buffering start/end facts | A |
| PLY-08 | Stop and reload 100 times | No orphan MPV processes, pipe leaks, or stale events | A |
| PLY-09 | Kill MPV during playback | App reports player crash and can create a clean new session | A |
| PLY-10 | App exit during transcode | MPV exits and Jellyfin transcode session is closed | A |
| PLY-11 | Stale event after new load | Prior generation event is ignored | A |
| PLY-12 | Renderer reload | Authoritative playback continues in Electron main or stops by explicit policy; never becomes orphaned | A |

## 7. HDR and color tests

Run the important tests with MPV Candidate A and Candidate B until one baseline
is selected.

| ID | Windows/TV condition | Source | Expected result | Gate |
|---|---|---|---|---|
| HDR-01 | Windows HDR on, Hisense active | HDR10 HEVC MKV | TV enters HDR; MPV reports PQ/BT.2020 output; no client tone map to SDR | A |
| HDR-02 | Windows HDR on, Hisense active | HDR10 HEVC MP4 | Same color result as HDR-01 | A |
| HDR-03 | Windows HDR on, Hisense active | SDR BT.709 | Correct SDR appearance inside HDR desktop; no washed blacks or oversaturation | A |
| HDR-04 | Windows HDR off, Hisense active | HDR10 | Client selects HDR-to-SDR path or clearly blocks with actionable guidance; never outputs washed HDR as SDR | A |
| HDR-05 | LG SDR display active | HDR10 | Tone-mapped SDR with correct range and color | A |
| HDR-06 | Switch output LG to Hisense before load | HDR10 | New session re-probes output and uses HDR path | A |
| HDR-07 | Move active playback between displays | HDR10 | Defined behavior: restart output safely or refuse move with guidance; never retain wrong color state | B |
| HDR-08 | Windowed on Hisense | HDR10 | Correct HDR/color signaling | A |
| HDR-09 | Borderless fullscreen on Hisense | HDR10 | Correct HDR/color signaling and frame pacing | A |
| HDR-10 | 23.976/24 fps film | HDR10 | Stable pacing; dropped/repeated frames remain within threshold | A |
| HDR-11 | Seek repeatedly in HDR file | HDR10 | No persistent black frame, green/purple corruption, or color-mode loss | A |
| HDR-12 | HDR subtitle overlay | ASS and PGS | Subtitle white level is readable and does not destroy highlight detail | A |
| HDR-13 | HDR10 AV1 | AV1 Main10 | Hardware decode if supported; otherwise documented fallback | Optional |
| HDR-14 | HLG | HLG/BT.2020 | Correctly identified and rendered or tone-mapped | Later |
| HDR-15 | Dolby Vision over Windows HDMI | DV | Explicitly outside the current Windows scope; no false capability claim | Later |

Initial measurable thresholds:

- No unplanned Jellyfin video transcode for supported HEVC Main10 HDR10 files.
- No persistent dropped-frame rate above 0.1% after the first five seconds on a
  normal 24 fps file.
- Seek recovery to visible moving video within two seconds for a local/direct
  LAN source, excluding server transcode startup.
- Diagnostic output states input and output primaries, transfer, matrix, range,
  decoder, hardware decode mode, display, and tone-mapping decision.

## 8. Subtitle tests

| ID | Test | Expected result | Gate |
|---|---|---|---|
| SUB-01 | Internal ASS default track | Correct track selected and rendered by libass | A |
| SUB-02 | ASS attached fonts | Intended fonts are used without installing them globally | A |
| SUB-03 | Complex ASS positioning/signs | Positions, transforms, layers, and clipping match reference MPV playback | A |
| SUB-04 | ASS language switch | Switch occurs during playback without restarting video | A |
| SUB-05 | Disable subtitles | Track becomes none and Jellyfin progress remains valid | A |
| SUB-06 | Internal PGS | Image subtitles render at correct scale/aspect | A |
| SUB-07 | Forced PGS | Forced track can be selected and remains synchronized after seek | A |
| SUB-08 | External Jellyfin subtitle | Authenticated external subtitle URL loads without exposing token | A |
| SUB-09 | Subtitle during SyncPlay speed correction | Subtitle timing remains aligned with corrected playback | B |
| SUB-10 | Subtitle choice differs between group members | Local track preference does not alter another member | B |

## 9. Audio-track tests

The Windows client decodes to PC speakers. Passthrough is disabled even if the source
codec and TV advertise it.

| ID | Test | Expected result | Gate |
|---|---|---|---|
| AUD-01 | Start with Jellyfin/default audio | Correct default language/track is audible | A |
| AUD-02 | Switch language during playback | New track becomes audible without video restart | A |
| AUD-03 | AAC/FLAC/Opus track | MPV decodes successfully to current PC speaker layout | A |
| AUD-04 | AC-3/E-AC-3 track | Local decode/downmix succeeds or server audio transcode reason is explicit | A |
| AUD-05 | DTS/TrueHD track | Local decode/downmix succeeds when bundled MPV supports it; otherwise explicit fallback | A |
| AUD-06 | Seek after audio switch | Selected track persists and remains synchronized | A |
| AUD-07 | Next episode | Preference rule is applied without confusing Jellyfin and MPV track IDs | A |
| AUD-08 | HDMI passthrough | Not exposed in current settings | Later |

## 10. Jellyfin playback tests

| ID | Test | Expected result | Gate |
|---|---|---|---|
| JF-01 | Connect/login | Server validated; token stored with Windows DPAPI; password discarded | A |
| JF-02 | Direct Play HDR10 item | Original video reaches MPV; server dashboard reports Direct Play | A |
| JF-03 | Direct Play with ASS | Video and ASS/font resources load correctly | A |
| JF-04 | Direct Play with PGS | Video and PGS track load correctly | A |
| JF-05 | Direct Stream/remux fixture | Server reason and remux mode are displayed | A |
| JF-06 | Audio transcode fixture | Video remains direct/remuxed when possible; reason is displayed | A |
| JF-07 | Video transcode fixture | Expected SDR transcode plays and diagnostic reason is displayed | A |
| JF-08 | Start at resume point | MPV starts within tolerance and reports the correct item/source ID | A |
| JF-09 | Progress reporting | Position, pause, seek, and volume facts do not arrive out of order | A |
| JF-10 | Stop reporting | Final position and played state are correct | A |
| JF-11 | End of file | Item completion and next-item transition occur once | A |
| JF-12 | WebSocket reconnect | Session and remote-command state are resynchronized without duplicate playback | B |
| JF-13 | Server unavailable | Actionable error; current local player policy is deterministic | A |
| JF-14 | Redaction | Token absent from logs, MPV command line, and support bundle | A |

## 11. SyncPlay tests

Use at least:

- Client A: JellyClient Windows with MPV.
- Client B: Jellyfin Web in a separate browser/profile or a second machine.
- Optional Client C: second JellyClient instance with a unique device ID.

| ID | Test | Expected result | Gate |
|---|---|---|---|
| SP-01 | Create group once inside JellyClient | Same catalog/player session is confirmed joined; no browser, cast, or player-side join | B |
| SP-02 | Join an existing group once inside JellyClient | Group queue/state loads and playback converges with no second join | B |
| SP-03 | "Watch together" on an item while not joined | One action creates/joins, sets the group queue after acknowledgement, and opens the player | B |
| SP-04 | Select Play while already joined | Request routes through `SetNewQueue`; no independent local playback starts | B |
| SP-05 | Start playback from paused/idle | Commands execute at scheduled server time | B |
| SP-06 | Pause from Client A | All members pause once at equivalent position | B |
| SP-07 | Pause from Client B | MPV pauses and reports no feedback-loop request | B |
| SP-08 | Seek from each member | All members seek; each sends Ready; group leaves Waiting | B |
| SP-09 | Very fast local seek | Ready is still sent and group never hangs in Waiting | B |
| SP-10 | Stop from each member | All stop and remain group members until explicit Leave | B |
| SP-11 | Join while playing | New member loads, estimates current position, and converges | B |
| SP-12 | Join while paused | New member loads paused at group position | B |
| SP-13 | Cache underrun | Client reports Buffering; group waits; Ready resumes | B |
| SP-14 | Moderate drift | Narrow temporary speed correction converges without seek | B |
| SP-15 | Large drift | Absolute seek converges and speed returns to group rate | B |
| SP-16 | WebSocket disconnect/reconnect | No duplicate item/load or manual rejoin; membership and command state reconcile | B |
| SP-17 | Rapid pause/seek/play sequence | Stale scheduled commands are invalidated by generation/order | B |
| SP-18 | Queue next episode | All clients agree on playlist item ID and transition once | B |
| SP-19 | Different audio/subtitle choices | Tracks remain local while timeline stays synchronized | B |
| SP-20 | Close/reopen MPV while joined | Membership remains; reopening prepares current group item without another join | B |
| SP-21 | MPV crash in group | Client recovers while retaining/reconciling membership, or applies defined ignore/leave policy; group is not blocked forever | B |
| SP-22 | Join denied, group deleted, or inaccessible media | Actionable error; playback remains stopped and never falls back to unsynchronized mode | B |
| SP-23 | Duplicate create/join action or repeated server update | Idempotent result: one membership, one load, one Ready sequence | B |
| SP-24 | Thirty-minute stress loop | No deadlock, orphan process, runaway speed, or growing queue | B |
| SP-25 | Two-hour real viewing soak | No unrecovered drift or player/session hang | Beta |

Receiver/cast compatibility is a separate set because it is not needed for the
primary standalone join-once experience:

| ID | Test | Expected result | Gate |
|---|---|---|---|
| CAST-SP-01 | Capable sender supplies exact group ID | Target auto-joins once, prepares, sends Ready, and starts only on group command | v1 |
| CAST-SP-02 | Exact group ID matches current membership | Join is idempotent; no duplicate load, report, or playback | v1 |
| CAST-SP-03 | Exact group ID differs from current membership | Ordered leave/join transition completes before load; failure leaves playback stopped | v1 |
| CAST-SP-04 | Standard Web cast while target is already joined | Requested item is routed into the target's confirmed group, not played independently | v1 |
| CAST-SP-05 | Standard Web cast with one opt-in unambiguous group match | Target auto-joins that group once and clearly reports the choice | Optional |
| CAST-SP-06 | Standard Web cast with zero or multiple matches | Group chooser/error appears; no group is guessed and no unsynchronized playback starts | v1 |
| CAST-SP-07 | Join denied/deleted group/timeout during cast | Sender/target receives actionable failure; MPV remains stopped | v1 |
| CAST-SP-08 | Cast arrives before MPV is ready | Intent is serialized; exactly one prepare/Ready/start sequence occurs | v1 |

SyncPlay target after clock warm-up and outside buffering/seeks:

- p95 absolute drift below 100 ms on a healthy LAN;
- recovery below 150 ms within five seconds after an induced 300 ms offset;
- no speed correction for small jitter inside the deadband;
- speed always returns to the exact group/user base rate;
- every correction decision is logged with target position, actual position,
  drift, clock offset, RTT, selected method, and generation.

## 12. Reliability and security tests

| ID | Test | Expected result | Gate |
|---|---|---|---|
| REL-01 | App restart | Saved server restores without password storage | A |
| REL-02 | Sleep/resume | Display/audio/server capabilities are re-probed | B |
| REL-03 | TV power cycle/HDMI loss | Playback fails or pauses cleanly; no wrong-display HDR output | B |
| REL-04 | Network interface change | WebSocket and clock samples reset/reconnect | B |
| REL-05 | Malformed WebSocket message | Logged and isolated; process remains alive | A |
| REL-06 | MPV IPC flood/high-frequency position | Events are coalesced; queues remain bounded | A |
| REL-07 | Renderer compromise check | `nodeIntegration` off, context isolation on, allowlisted preload API | A |
| REL-08 | Support bundle | Contains versions/events but no credentials or raw auth URLs | A |

## 13. Gate definitions

### Gate A: playback foundation

Gate A passes when:

- the selected MPV configuration passes HDR-01 through HDR-12 except tests
  explicitly marked optional;
- ASS, attached fonts, PGS, and audio switching work;
- Jellyfin direct play/remux/transcode lifecycle reports are correct;
- 100 load/stop cycles and crash recovery pass;
- all relevant diagnostics are redacted.

Only then should the project invest in the complete desktop library UI.

### Gate B: SyncPlay foundation

Gate B passes when:

- every mandatory SyncPlay test passes;
- create, join, and "Watch together" require no browser, cast handoff, or second
  group join;
- stop, player-window close, and renderer restart do not accidentally leave the
  group;
- failed or ambiguous group intent never starts unsynchronized playback;
- LAN drift targets pass;
- buffering and fast-seek barriers cannot strand the group;
- the thirty-minute automated stress run passes repeatedly;
- the two-hour soak has no hang or unrecovered drift.

Only then should receiver/casting mode be enabled for normal use.

## 14. Later VIDAA matrix outline

Do not fill this from marketing specifications. Populate it on the exact TV
after a supported developer/hosted-app route is confirmed:

- VIDAA and firmware version.
- Native player API and browser version.
- H.264, HEVC Main10, and AV1 by container.
- HDR10, HDR10+, HLG, and Dolby Vision by profile/container.
- MP4 Dolby Vision profiles 5 and 8 first.
- MKV/profile 7 and HDR10 fallback behavior.
- Audio-track enumeration and switching.
- ASS styling/font fidelity.
- PGS support or Jellyfin burn-in requirement.
- Native buffering/seeking events needed by SyncPlay.
- WebSocket stability and background/standby lifecycle.
