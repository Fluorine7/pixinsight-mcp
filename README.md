# PixInsight MCP

An MCP server that lets an AI assistant drive PixInsight: open images, measure them, run any
installed process, read the results back. PixInsight stays responsive while it works, so you can
watch and intervene.

Cross-platform: Windows, macOS and Linux.

## This fork: complete script execution

This fork adds `resolve_script`, `run_script_file`, and `get_script_job` to the
Node MCP server. They locate installed scripts across platforms and run full
PJSR files through PixInsight 1.9.4's official IPC interface, with parameters,
completion records, logs, and runtime errors. See [the change summary and usage](docs/script-files.md).

**Keep the original author's PixInsight update repository and signed MCP Watcher.**
This fork does not publish native modules or claim a Certified PixInsight Developer identity.
The existing Watcher works with these additions.

To use the additions, build this fork (the upstream npm package does not include them):

```text
git clone https://github.com/Fluorine7/pixinsight-mcp.git
cd pixinsight-mcp
npm ci
npm run build
```

Point your MCP client at the built server. For example, in Codex:

```toml
[mcp_servers.pixinsight]
command = "node"
args = ["/absolute/path/to/pixinsight-mcp/build/index.js"]
```

Use your actual checkout path; on Windows use forward slashes or escaped backslashes
inside the TOML string. Restart/reconnect the MCP client after configuration.
For the PixInsight side, keep the update URL shown in step 2 below unchanged.

## Original upstream installation (without fork additions)

**1. MCP server.** Any MCP client works. This is a stock stdio server with no client-specific code.

Claude Code:

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

Claude Desktop, Cursor, Windsurf and anything else that takes an `mcp.json`:

```json
{
  "mcpServers": {
    "pixinsight": { "command": "npx", "args": ["-y", "@pardovot/pixinsight-mcp"] }
  }
}
```

Codex CLI, in `~/.codex/config.toml`:

```toml
[mcp_servers.pixinsight]
command = "npx"
args = ["-y", "@pardovot/pixinsight-mcp"]
```

On Windows, if a client cannot resolve `npx`, use `"command": "cmd"` with
`"args": ["/c", "npx", "-y", "@pardovot/pixinsight-mcp"]`.

**2. PixInsight module.** `Resources > Updates > Manage Repositories`, add:

```
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/
```

Then `Resources > Updates > Check for Updates` and restart. Signed with a Certified PixInsight
Developer identity, so the dialog shows *Verified. Certified developer: OfirPardo*.

**3. Start it.** `Process > Utilities > MCP Watcher > Start`, then ask your assistant to list your
open images. If it answers, you are connected.

Requires PixInsight 1.9.4+ (V8 engine), Node 18+, and an MCP client.

## Tools

The upstream tools remain available; this fork adds three script-file tools. Bold ones carry the work.

| Category | Tools |
|---|---|
| Execution | **`run_process`**, **`get_process_parameters`**, **`run_script`** |
| Images | `list_open_images`, `open_image`, `save_image`, `close_image`, **`get_image_statistics`** |
| Measurement | **`get_noise`**, **`get_background_gradient`**, `get_background_neutrality`, **`get_star_metrics`**, `get_structure_color` |
| Rendering | **`render_view`**, **`render_critic_pack`** |
| History | `get_history`, `get_full_history`, `undo`, `redo`, `snapshot`, `restore` |
| Instances | `list_instances`, `use_instance` |
| Export | `export_container` |

`run_process` runs **any** process by class name, including third-party ones you have installed,
so nothing needs adding when you install a new tool.

Measurement tools exist so settings come from your frame instead of a tutorial. Two traps:
`get_noise` returns an MRS estimate, `stdDev` is signal-dominated on astro frames and will lie to
you. `get_background_neutrality` needs `mode:'poststretch'` after stretching, the sky-band metric
is only valid pre-curve.

Definitions live in `src/tools/*.ts`. Verified gotchas: [`docs/facts.md`](docs/facts.md).

## How it works

```
  MCP client
    │  MCP (stdio)
  MCP server                    src/ (TypeScript)
    │  file bridge              ~/.pixinsight-mcp/bridge/{commands,results}
  MCPWatcher-pxm.dll            pcl::Timer on PixInsight's event loop
    │  MetaModule::EvaluateScript
  Embedded JS handlers          generated from pjsr/pixinsight-mcp-watcher.js
  PixInsight
```

PixInsight has no socket or HTTP API, so a file bridge is the only route in. Round trip is about
one poll interval, 300 ms by default.

The runtime is a compiled module rather than a PJSR script because a running script holds
PixInsight's only thread, which blocks the interface until it returns. The module's timer fires on
the event loop instead, which is why the application stays usable while a run is in progress.

> Anything that can write to `~/.pixinsight-mcp/bridge/commands` can run arbitrary code inside
> PixInsight. Keep the directory user-private, never on a shared or synced path.

## Platform

| | Module installed as |
|---|---|
| Windows | `bin/MCPWatcher-pxm.dll` |
| macOS | `MacOS/MCPWatcher-pxm.dylib`, universal x86_64 + arm64 |
| Linux | `bin/MCPWatcher-pxm.so` |

All three build in CI on every change and ship in every release. Nothing in the design is
platform-specific: Node server, file bridge, PJSR handlers, CMake build with per-platform branches.

## Building from source

Needs Node 18+, a C++ toolchain and CMake:

| | Toolchain |
|---|---|
| Windows | Visual Studio 2022 or Build Tools, with the C++ workload (found via `vswhere`) |
| macOS | Xcode Command Line Tools, plus `brew install cmake ninja` |
| Linux | `build-essential cmake ninja-build` |

```bash
npm run module:pcl       # once, builds PCL from PixInsight's bundled source
npm run module:build     # regenerate handlers, compile
npm run module:sign      # needs your own signing identity, see docs/SIGNING.md
npm run module:install   # admin/root, PixInsight closed
```

`node module/config.mjs` prints every path resolved on your machine, start there when a build
cannot find something. `install.mjs` copies the module and its `.xsgn`, and refuses a signature
older than the binary.

PixInsight's bundled makefiles compile in-tree, so on a read-only install (`/opt/PixInsight` is
root-owned) `module:pcl` mirrors the ~20 MB source tree into `$PCL_BUILD_OUT/src` and builds the
copy. The install directory is never written to except by `module:install`.

Full local setup per platform: [`docs/dev-setup.md`](docs/dev-setup.md).

Handler logic lives in `pjsr/pixinsight-mcp-watcher.js` only. `module/src/BridgeHandlersJS.h` is
generated from it, never edit it by hand.

## Configuration

Every path is a default an environment variable overrides, derived rather than hardcoded, so a
stock install needs nothing.

| Variable | Default | Purpose |
|---|---|---|
| `PIXINSIGHT_EXE` | probed | PixInsight executable, for the build scripts |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | per-command timeout |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | long operations |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | bridge poll cadence |
| `PI_ROOT` | probed | install root, build scripts derive the rest |
| `PCL_BUILD_OUT` | `~/pcl-build` | where the PCL library and its source mirror land |
| `PI_SIGN_KEY`, `PI_SIGN_DEVELOPER_ID` | none | signing, how CI supplies it |
| `PI_SIGN_KEY_FILE` | `~/.pixinsight-mcp/signing-key.json` | exported key for local signing |

`PI_ROOT` is probed per platform: `%ProgramFiles%\PixInsight`, `/Applications/PixInsight`,
`/opt/PixInsight`. Everything else derives from it, so overriding one variable relocates the rest.

```bash
PI_ROOT=/opt/PixInsight-1.9.5 node module/build.mjs
```

## Signing

PixInsight refuses unsigned modules by default. Modules and the repository index are both signed,
in Node, with no PixInsight involved, which is why CI can publish a signed release from a runner
that has none installed. PixInsight is needed once, to export the key.

Both constructions and the security caveats: [`docs/SIGNING.md`](docs/SIGNING.md).
Release process: [`docs/RELEASING.md`](docs/RELEASING.md).

## Layout

```
src/                MCP server: tools/, pjsr/, bridge/
module/             native module (the runtime), build/sign/install tooling
pjsr/               JS watcher, source of truth for handler logic
docs/               SIGNING, RELEASING, bridge-protocol, facts, architecture
scripts/            ping-watcher, build-pi-repo
test/               node --test suites
```

## Origins

Began in 2026 as a fork of [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp),
independent codebase since. The file bridge and the PJSR handler bodies come from there. The native
module, the generic process runner, the measurement layer, signing and the update repository were
added here.

## Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)), originator of the project this
  one grew from: the file bridge, the agentic architecture, and the PJSR watcher whose handler
  logic still runs here. Developed as a member of [**Astro ARO**](https://astrolentejo.fr), a
  remote observatory in the Alentejo Dark Sky Reserve (Portugal), Bortle 2-3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)), V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart"
  ([PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1) on the original repository).
- **pardovot**, native module, generic process runner, measurement and knowledge layer, signing
  and release pipeline, packaging.

## License

MIT © Alain Escaffre (original work) and pardovot. See [LICENSE](LICENSE).

## Local complete-script extension

See [script file tools](docs/script-files.md) for installation discovery, full PJSR file execution and persistent job status.
