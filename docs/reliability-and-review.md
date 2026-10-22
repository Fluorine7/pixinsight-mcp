# Execution evidence, reproducible display and live-parameter exports

Implemented 2026-09-15 in the Node server. Uses the existing signed Watcher's
`run_script` carrier; no native module rebuild/signing is needed. Run `npm run
build`, then reconnect the MCP client to load the new tool definitions.

## 1. Durable command jobs

`run_process` accepts:

- `waitMs`: wait budget, in milliseconds; `0` submits and returns immediately.
- `commandId`: optional caller-generated UUID. Reuse the same UUID with the
  identical process/view/settings/verification request to retrieve its result
  without publishing another command. Different requests cannot share an ID.
- `verifyPixels`: optional full target-image comparison (see below).

`get_command_job({commandId})` queries the **active instance** without sending a
new PI command. Results identify their bridge directory; select that instance
before querying. Each running request pins its destination. Different command
IDs are independent requests; this is not automatic content-based deduplication.

A wait timeout does **not** cancel execution. The timeout contains its command ID.
Job states are `queued`, `running`, `success`, `error`, or `unknown`. `unknown`
means no reliable execution outcome is available; it does not mean the process
failed. The outer bridge status describes the carrier; `execution.status` from a
verified process describes the actual process. A false process return is surfaced
as an MCP error even when the carrier succeeded.

The bridge stores `jobs/<UUID>/command.json` and terminal `result.json`. These
survive server restarts. Tracked results are excluded from the old ten-minute
orphan cleanup. Records are retained until explicitly removed; they may contain
scripts and paths. Keep them while a job is unresolved. Existing untracked bridge
files still use the original cleanup policy. Crashes during initial publication
can leave an unresolved reservation, which is never automatically resubmitted.

## 2. Actual execution evidence

`run_process` now checks the boolean returned by `executeOn`/`executeGlobal`,
reports requested and actual parameters separately, records history indices,
new windows, sample format, and mask state. It flags parameters PI normalizes or
rounds during assignment. It preserves existing known-defect parameter guards.

With `verifyPixels:true`, a full image copy is compared against every output
sample, returning changed-sample count, maximum absolute difference and geometry
changes. This costs an extra image copy and full scan. Without it,
`pixelChangeVerified:false` is explicit: history change does not prove pixel
change. Global processes require their own output verification.

## 3. Live history and export

`get_full_history` reads live `processing.at()` values, including nested initial
containers, historical mask IDs/inversion and enabled state. `maxParamLines` is
retained for API compatibility but no longer truncates runtime values. These
values do not go through `toSource()`.

`export_container` always writes an adjacent `.history.json` audit before trying
the XPSM export. XPSM uses the native XML serializer for process versions, table
column IDs and symbolic enums; live scalars/table values replace rounded numeric
and textual values. In particular, DeepSNR amount `0.15` must not become `0.1`.
Historical enabled states and masks are retained. By default only applied steps
are exported; an explicit `toIndex` can include redo steps.

Unmapped native aliases, unsupported table representations and nested containers
fail explicitly, retaining the live audit instead of silently emitting incomplete
parameters. Native symbolic enum mappings are retained rather than inferred from
integer values. The audit records this limitation. Historical script steps may
reference missing or temporary files; the audit is not proof of replayability.

Optional `dependencies:[{path,role}]` records checkpoint/mask/script files and
SHA-256 hashes using streamed reads. Files are recorded, not copied or bundled.
Capture live history before closing/reopening an image. Full image replay is
**not** automatically executed or claimed verified by export.

## 4. Display modes and comparison packs

`render_view.stf` supports:

| Mode | Behavior |
| --- | --- |
| `auto` | Linked RGB normal stretch |
| `auto-unlinked` | Independently computed channels, normal stretch |
| `boosted-unlinked` | Independent channels, defaults -1.8 sigma / target 0.5 |
| `fixed` | Apply supplied `fixedStretch` HT rows exactly |
| `view` | Use stored view STF, including range terms; independent of GUI enable state |
| `asis` | No display transform |

Boost defaults come from the locally installed DSCProcessingSuite, **not** a
claim to have read or operated native toolbar Boost preferences. The manifest
records algorithm, clipping/background settings, channel medians/MADs and exact
rows. The normal defaults are -2.8 sigma / target 0.25. Automatic modes are for
non-inverted linear images; unsuitable medians are rejected or explicitly flagged
as fallback displays, never labelled as a passed diagnostic check.

HT row order is `[shadows, midtones, highlights, lowRange, highRange]`; keys `0`,
`1`, `2` are R/G/B and `3` is combined RGB/K (also used for monochrome).
Use `stf:'fixed', fixedStretch:<earlier result.stretch>` for exact comparisons.
Alternatively supply `referenceViewId` in an automatic mode to compute the
stretch from a matching-geometry reference. `shadowsClipping` and
`targetBackground` can override automatic defaults explicitly.

Linear `render_critic_pack` now includes normal and unlinked Boost versions of
full field, corners, edge midpoints, core, stars and optional faint region. Each
set freezes full-image rows across its crops. `referenceViewId` also produces
fixed-reference Boost comparisons, while independently calculated Boost remains
available for diagnosing each image. Supply the same `starsRect` for pairwise
packs. Manifests record exact crops, scale and display parameters.

RGB output defaults to `colorMode:display`. A Float32 temporary copy receives
the explicit source crop, display stretch and resampling. The **original source
window/view** then applies its native `applyColorTransformation` to the rendered
bitmap. This uses the live source ICC and PixInsight display pipeline. The active
monitor ICC bytes and global profile path are read from PixInsight at render time.
A default-profile change is never substituted for an assigned source profile.

PJSR ImageWindow has no supported `iccProfile` property, and PixelMath new images
do not preserve assigned source ICC; the regression uses a source profile that
differs from the default to catch this. PI's PNG format cannot embed ICC itself.
Node embeds the actual monitor profile as PNG iCCP or JPEG APP2 metadata, removes
conflicting PNG color tags, and reads the written file to verify the profile before
publishing. `colorManagement.status:managed-display`, `outputICCEmbedded:true` and
`outputICCVerified:true` are reported only after completion. Missing profiles,
disabled/invalid global color management, transform failures and write failures
are errors; an existing output is kept. Neither source images nor global color
settings are modified.

These are **display-referred previews**, with the gamut/precision and any proofing
of PI's display pipeline. They are not sRGB or archival master exports. Use a
color-managed viewer to interpret the embedded monitor profile; this prevents
viewers from treating monitor RGB values as sRGB or applying the wrong profile.

`render_view.colorMode:raw` deliberately bypasses conversion/embedding. Monochrome
previews remain `grayscale-unmanaged`; neither is claimed suitable for calibrated
cross-application color approval. Critic packs use managed RGB previews by default.
All transformations affect temporary copies. Unlinked/Boost displays still serve
spatial diagnosis, not SPCC/global-color approval, even with embedded ICC. Display
agreement also requires a color-managed viewer and a correctly configured monitor.

## 5. Temporary rendering state

Every render uses a UUID window name. It never closes a pre-existing window to
claim a name. Source/reference rectangles, channel selections and selected point
are restored in `finally`; temporary processing and windows are cleaned up on
assignment, transform and save failures. Monochrome stored STF maps to RGB/K.

## Validation

Automated tests cover durable timeout/restart recovery, same-ID deduplication,
instance-switch protection, process false returns, live parameter precision,
XPSM table/alias behavior, masks/redo slices, display math, fixed comparisons,
monochrome STF and exception cleanup. A tool-layer test covers async submission,
querying a false process result and replaying the same request ID.

Live macOS PixInsight 1.9.4 checks used a separate 64×48 Float32 synthetic RGB
window: actual parameter/history evidence, a 9,216-sample before/after comparison,
unlinked render/crop and preservation of selections/history. Native DeepSNR
serialization was confirmed to round 0.15 to 0.1 before correction. A live-history
XPSM and JSON audit were exported and read back. No astronomical target image was
processed. Full image replay, Windows/Linux execution, and color-managed bitmap
export are not verified by these tests.


## 6. Running-server diagnostics

Call `get_runtime_info` to inspect Node version/executable, SDK version, server PID,
start time, package version and build provenance (commit, dirty state, build time
and unique build ID). `npm run build` captures provenance; it is loaded once at
process startup. A changed build ID on disk sets `restartRequired:true` without
misreporting the new checkout as already running. A missing manifest is unknown,
and a dirty build must not be treated as an exact commit. After updating, restart
the MCP connection and check again.

The active bridge directory is included even for a custom pinned path. Its
heartbeat reports the native module version, slot/PID and freshness; a stale
heartbeat can also mean PI's main thread is busy. `probeWatcher:true` adds a
read-only script round trip (5-second wait) for actual PI version/build/instance
and observed versus expected handler revision. Timeout/mismatch is unconfirmed,
not proof that PI is stopped. No image processing is performed by this probe.

Malformed supported JSON-RPC request envelopes now return `-32602`. Unknown
methods still return `-32601`; tool argument and execution errors retain MCP tool
error semantics. The SDK itself is unchanged.

### 2026-10-22 validation

The automated suite covers process-versus-disk provenance, invalid JSON-RPC
params, ICC container round trips (PNG CRCs/JPEG multi-segment profiles), crop
geometry, managed failures/cleanup and the existing reliability checks. Actual
flightcheck: 12 pass, 0 warnings, 0 failures.

`node scripts/smoke-runtime-preview.mjs <evidence-directory>` is an opt-in live
regression using only owned synthetic windows. On macOS arm64 / PixInsight 1.9.5
build 1706 it checks the runtime probe, source pixels/history/selections/STF,
managed PNG/JPEG, raw rendering, crop/downsampling and source-profile correctness.
Independent Pillow/LittleCMS comparison of eight Adobe RGB color patches against
the exported monitor-profile PNG matched exactly (maximum 8-bit channel
difference 0). A second sRGB-tagged
source is compared with PI’s direct native display reference to detect lost source
ICC or double conversion; it also matched exactly.
Windows/Linux CI exercises Node and mocks, not a licensed PixInsight installation.
The older 1.9.4 validation above predates managed export and does not establish
managed-export compatibility on that version.
