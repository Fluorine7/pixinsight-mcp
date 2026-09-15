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

Bitmap output has **unverified ICC handling** and reports that explicitly. It is
suitable for spatial diagnostics, not reliable cross-application SPCC/color
approval. No ICC conversion or embedding is claimed. All display transforms are
applied only to temporary copies, never baked into source images.

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
