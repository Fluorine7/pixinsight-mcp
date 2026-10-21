# Development Setup

Everything here is cross-platform. Where a command differs per platform, all three are given,
and each one says whether it has actually been run.

| Platform | Status |
|---|---|
| Windows 11 | verified, the primary dev machine |
| Linux | verified 2026-08-11 on Ubuntu 24.04: path derivation, `npm test` (78/78), PCL and module built from source, signed and installed, and a full bridge round trip against that module |
| macOS | verified 2026-08-11 on Apple Silicon (M1, macOS 15.7, PixInsight 1.9.4 in `/Applications/PixInsight`, Command Line Tools only): path derivation, `npm test` (78/78), both PCL slices built from source, universal module built, ad-hoc signed, `.xsgn` signed, installed, and a full bridge round trip against that module. The **arm64** slice is the one PixInsight loaded. The x86_64 slice is built and joined but has never been executed |

## Prerequisites

- **Node.js** 22.23.4+ (22.x), 24.22.1+ (24.x, recommended LTS), or 26.12.1+ (26.x), installed for the same OS that runs PixInsight.
- **PixInsight** >= 1.9.4 "Lockhart" (V8 PJSR engine, the watcher enforces this via
  `CoreApplication.ensureMinimumVersion(1, 9, 4)`, older ES5-engine versions are not supported).
- An MCP client (Claude Code, Claude Desktop, anything that speaks stdio MCP).
- To build the native module, a C++20 toolchain and CMake:

| | Toolchain | Install |
|---|---|---|
| Windows | MSVC | Visual Studio 2022 or Build Tools with the C++ workload. `vswhere` locates it, so any edition works |
| macOS | clang | `xcode-select --install`, then `brew install cmake ninja` |
| Linux | g++ | `sudo apt install build-essential cmake ninja-build` |

## Paths

Nothing is hardcoded. `module/config.mjs` probes per platform and every value takes an
environment override, so run this first on a new machine:

```bash
npm run module:config
```

It prints the resolved `PI_ROOT`, executable, PCL directories and toolchain. Conventional
locations:

| OS | Install root (`PI_ROOT`) | Executable | Module lands in |
|---|---|---|---|
| Windows | `%ProgramFiles%\PixInsight` | `bin\PixInsight.exe` | `bin\` |
| macOS | `/Applications/PixInsight` | `PixInsight.app/Contents/MacOS/PixInsight` | `MacOS/` |
| Linux | `/opt/PixInsight` | `bin/PixInsight.sh` (or `/usr/bin/PixInsight`) | `bin/` |

Installed somewhere else? Set `PI_ROOT` and the rest follows.

> On macOS the application bundle holds only the four core executables
> (`PixInsight`, `PixInsightUpdater`, `updater2`, `updater3`). Everything else sits **beside** it
> under `PI_ROOT`: `include/`, `src/`, `lib/`, `library/`, a `bin/` holding the ~118 stock modules,
> and a top-level `MacOS/` that is where third-party modules go. So the module install directory is
> `<PI_ROOT>/MacOS`, **not** `PixInsight.app/Contents/MacOS`. Verified on 1.9.4 two ways:
> `etc/update/installed.xri` records PixInsight's own updater putting StarNet2 and this module in
> `MacOS/`, and `scripts/build-pi-repo.mjs` already publishes the macOS package with that same
> internal directory. Writing into `Contents/MacOS` would miss the directory PixInsight scans and
> break the bundle's code signature.

> On Linux, run the launcher, never `bin/PixInsight` beside it. `PixInsight.sh` exports
> `LD_LIBRARY_PATH`, `QT_PLUGIN_PATH` and friends first. Without it the bare binary cannot resolve
> PixInsight's bundled shared libraries and exits immediately (on Ubuntu 24.04, at
> `libssh2.so.1: cannot open shared object file`). Which library it dies on varies by distro.

## Project setup

```bash
git clone https://github.com/pardovot/pixinsight-mcp.git
cd pixinsight-mcp
npm install
npm run build          # tsc -> build/, plus the handler-drift check
npm run setup-bridge   # creates ~/.pixinsight-mcp/bridge/{commands,results,logs}
```

Register the local build with your client, not the published package. `npx -y
@pardovot/pixinsight-mcp` inside the repo resolves to the checkout and shadows what you meant to
test:

```bash
claude mcp add pixinsight node /absolute/path/to/pixinsight-mcp/build/index.js
```

Claude Desktop, in `claude_desktop_config.json` (`%APPDATA%\Claude\` on Windows,
`~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "pixinsight": {
      "command": "node",
      "args": ["/absolute/path/to/pixinsight-mcp/build/index.js"]
    }
  }
}
```

The server and PixInsight must run in the **same OS environment**: they rendezvous through
`~/.pixinsight-mcp/bridge`, and every image path the agent passes is opened by PixInsight verbatim.

## The two edit loops

Where a change goes is an architecture decision, see the table in `CLAUDE.md`. What each costs:

**TypeScript (MCP server, measurement tools, rendering).**

```bash
npm run build     # then restart the MCP client
```

**Handlers (`pjsr/pixinsight-mcp-watcher.js`, the module's embedded JS).** A full module cycle,
about a minute. `build.mjs` regenerates `module/src/BridgeHandlersJS.h` from the watcher, so never
edit that file:

```bash
npm run module:build     # regenerate handlers, compile
npm run module:sign      # see Signing below
# close PixInsight
npm run module:install   # self-elevates: UAC on Windows, sudo elsewhere
# reopen PixInsight, restart the MCP client
```

Bump `HANDLERS_REVISION` in the watcher **and** `EXPECTED_HANDLERS_REV` in `src/bridge/client.ts`
together on any handler change. `npm run build` fails if they disagree, or if the handler section
changed without a bump.

## Building the native module

```bash
npm run module:pcl     # once, ~10 min: builds the PCL static library
npm run module:build   # ~1 min
```

`module:pcl` compiles PixInsight's bundled PCL source. Those makefiles compile **in-tree**, and a
stock install is not user-writable, so on Linux and macOS the script mirrors the ~20 MB source tree
into `$PCL_BUILD_OUT/src` (default `~/pcl-build/src`) and builds the copy. The PixInsight install
is never written to except by `module:install`. Pass `--force` to rebuild from a fresh mirror after
a PixInsight update:

```bash
node module/build-pcl.mjs --force
```

The Windows build is redirected instead: MSBuild takes explicit `OutDir`/`IntDir`, so it needs no
mirror.

On macOS `module:pcl` builds **two** slices, `x86_64` and `arm64`, cross-compiling whichever one
the host is not. Each lands in its own directory (`~/pcl-build/lib/{x64,arm64}`) because both
per-arch makefiles end by copying `libPCL-pxi.a` under the same name, so a shared output directory
would silently keep only the slice that ran last.

> **macOS: the bundled makefiles hardcode an SDK that may not exist here.** PixInsight generates
> them on a machine with the full Xcode and bakes that path into every compile line as
> `-isysroot /Applications/Xcode.app/.../MacOSX.sdk`. With only the Command Line Tools installed,
> which is what the prerequisites above ask for, that directory is absent and every object fails
> with `no such sysroot directory` followed by `'uchar.h' file not found`. It is literal text in
> the recipe, not a variable, so there is nothing to override on the `make` command line.
> `build-pcl.mjs` rewrites the flag in its own mirrored copy to whatever `xcrun --show-sdk-path`
> reports, and forces the mirror when a rewrite is needed so the PixInsight install is never
> touched. With the full Xcode installed the path already resolves and nothing is changed.

### Signing

`AllowUnsignedModuleInstallation` is false by default, so PixInsight refuses an unsigned module and
`install.mjs` refuses to install one. Signing runs entirely in Node, no PixInsight involved, but it
needs a key:

- **Own a Certified PixInsight Developer identity?** Export the key once, on any machine:
  `module/export-signing-key.js` in PixInsight's Script Editor. It writes
  `~/.pixinsight-mcp/signing-key.json`, which every platform's `module:sign` then reads. Copy that
  file to your other dev machines rather than exporting again.
- **In CI**, supply `PI_SIGN_KEY` + `PI_SIGN_DEVELOPER_ID` instead, or point `PI_SIGN_KEY_FILE` at
  the JSON.
- **No identity at all?** You cannot install a locally built module. Use the update repository
  build (`README`, install section) and keep your changes on the TypeScript side.

Details, and why this works without PixInsight: [`SIGNING.md`](SIGNING.md).

## Running PixInsight

Normal launch works. Automation mode is only needed for headless runs:

```bash
# Windows
& "$env:ProgramFiles\PixInsight\bin\PixInsight.exe" -n --automation-mode
# macOS
/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight -n --automation-mode
# Linux (the launcher, see the note above)
/opt/PixInsight/bin/PixInsight.sh -n --automation-mode
```

`-n=N` selects the instance slot, which is what the bridge keys on.

## Running the watcher

**The native module (non-blocking, the real runtime).** Build, sign and install it, then open
`Process > Utilities > MCP Watcher`. It opens already running and leaves PixInsight fully
interactive, because it polls on PixInsight's own event loop.

**The JS watcher script (dev-only, freezes PixInsight while it runs).** Useful for a quick handler
experiment without a module cycle, at the cost of blocking the UI until it returns: open
`pjsr/pixinsight-mcp-watcher.js` in the Script Editor and press F9. Or auto-load it at startup with
`-r=<repo>/pjsr/pixinsight-mcp-watcher.js`.

Check either one from outside:

```bash
node scripts/ping-watcher.mjs
```

## Running a second instance (parallel sessions)

Two PixInsight instances on one machine, isolated so commands never cross (see
[`bridge-protocol.md`](bridge-protocol.md) for the directory convention). **No env vars, no extra
MCP registration**, the server auto-detects the live instance from its heartbeat.

1. Launch the second PixInsight with a distinct slot (`-n=2`). The module derives its bridge
   directory (`~/.pixinsight-mcp/bridge-2`) from `CoreApplication.instance`. Open
   `Process > Utilities > MCP Watcher` in each. The panel's `Bridge:` line shows which slot it owns.
2. Register the server once, as above, in every session.
3. Targeting: one instance live means it is auto-targeted (startup banner
   `Auto-detected PixInsight instance N`). With two or more, say **"use instance 2"** and the agent
   calls `use_instance`, and `list_instances` shows what is live.

**Manual override** (pins a session, skips auto-detect): `PIXINSIGHT_MCP_INSTANCE=N` or
`PIXINSIGHT_MCP_BRIDGE_DIR=<path>`. Rarely needed.

> Two instances share one GPU, so parallel BXT/SXT/NXT contend. A throughput fact, not a bug.

## Testing the bridge by hand

The bridge is just files, so the watcher can be exercised without the MCP server:

```bash
cat > ~/.pixinsight-mcp/bridge/commands/test-001.json << 'EOF'
{
  "id": "test-001",
  "timestamp": "2026-01-01T00:00:00Z",
  "tool": "list_open_images",
  "process": "__internal__",
  "parameters": {}
}
EOF
sleep 1
cat ~/.pixinsight-mcp/bridge/results/test-001.json
```

## Project structure

See the layout block in the README for the authoritative tree.

## Troubleshooting

**MCP server not connecting.** Check the client's logs (Claude Desktop: `%APPDATA%\Claude\logs\`,
`~/Library/Logs/Claude/`, `~/.config/Claude/logs/`). Use an absolute path to `node` if it is not on
the client's PATH, and confirm `build/index.js` exists.

**Watcher not picking up commands.** Confirm both sides agree on the bridge directory (the watcher
panel prints its own), read PixInsight's Process Console for handler errors, and check that both
processes can write the directory. If the server reports a handler-revision mismatch, the installed
module predates the checkout: rebuild and reinstall it.

**Build cannot find PCL.** `npm run module:config` prints what it resolved. A wrong `PI_ROOT` is
the usual cause, so set it explicitly.

**`Permission denied` writing `.o` files during `module:pcl`.** The mirror step was skipped because
the project directory itself looked writable, even though something under it is not. Mirror by
hand and build from the copy:

```bash
cp -a /opt/PixInsight/src ~/pcl-build/src      # your PI_ROOT, per module:config
PCLSRCDIR=~/pcl-build/src npm run module:pcl
```

**PixInsight refuses the module.** Signature missing, stale (a rebuild invalidates it, re-sign) or
made with an identity the machine does not know. `npm run module:verify` checks a binary against
its `.xsgn`.
