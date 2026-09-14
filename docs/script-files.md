# Complete script files: local MCP extension

This local extension is based on upstream 0.9.1. It adds three tools without replacing the native Watcher or changing the existing `run_script` bridge verb:

- `resolve_script`: discover the live installation with `CoreApplication.srcDirPath`, `filePath`, and `instance`. ImageSolver candidates are `scripts/ImageSolver/ImageSolver.js` then `scripts/AdP/ImageSolver.js` under the source directory. An absolute custom `scriptPath` is also supported.
- `run_script_file`: generate a wrapper, set typed `Parameters`, optionally activate a main view, and dispatch through the official `--execute=<slot>:<file>` IPC interface using `execFile` without a shell.
- `get_script_job`: read persistent completion/error/log records. It never reruns the script. `submitted`, `pending`, and `running` do not mean success.

Example for an open image with valid initial coordinates/scale:

```json
{
  "scriptId": "ImageSolver",
  "viewId": "RGB",
  "parameters": {"non_interactive": true, "useActive": true}
}
```

Pass this to `run_script_file`, then poll `get_script_job` with the returned `jobId`. Supply additional parameters according to the installed script's own schema; they are not generic solver options. After completion verify the image's astrometric solution. `viewId` selects the active window, not `Parameters.isViewTarget`.

## Design and limitations

The launcher composes installation discovery via the existing bridge with PixInsight's official whole-file IPC interface. It is Node-side because process dispatch and durable job polling belong outside the single-threaded PJSR evaluation context. It does not duplicate or replace the `run_script` handler. The original script remains installed in place, and the wrapper includes it so relative includes are resolved by PixInsight's preprocessor.

MCP and PixInsight must share the local file system, as with the existing bridge. Windows/macOS/Linux installation roots are derived at runtime; no fixed installation paths. Whitespace, Unicode parameters and commas in parameter values do not pass through a shell or CLI parameter parser. Quotes/newlines in include paths are refused.

Runtime exceptions are captured. Preprocessing/syntax errors can occur before the wrapper starts and therefore cannot write a result: such jobs stay pending with instructions to inspect the PI console. Dialogs and long-running scripts may remain running. Polling timeout does not cancel execution. IPC dispatch failure is marked uncertain because delivery may already have happened; do not blindly retry. Scripts that catch their own errors may finish normally; always inspect their result/log and task-specific postconditions.

Console logging is started if no log text is present and stopped if the wrapper started it. A script that manages its own console log may interrupt capture. The last 20,000 characters are retained. Job files remain under the active bridge's `script-jobs/<UUID>/` for diagnosis; switching instances also switches the job directory. This is a wrapper-based runner, not a promise that every interactive third-party script is automation-compatible.

## Validation, 2026-09-14

- 84 automated tests passed, including custom roots on all three platforms, legacy path fallback, argument quoting, invalid paths, pending/error status and traversal rejection.
- Live macOS PixInsight 1.9.4 build 1695, Watcher 1.3.5: discovered current ImageSolver 6.4.2 layout; complete script with `#include` and `hello, 世界` parameter ran successfully; log text captured; intentional runtime exception returned as an error.
- Official ImageSolver launched through the new path, with its includes and noninteractive parameters. With no image open it correctly returned an error. A successful astrometric solve has not been re-tested in this update.
- Windows/Linux path behavior is unit-tested; live execution on those systems remains unverified.

## Installation and upstream compatibility

Build this fork with `npm ci` and `npm run build`, then configure the MCP client's
command as `node` with the absolute path to `build/index.js` as its argument.
Reconnect the MCP client to refresh its tools. The original `npx -y
@pardovot/pixinsight-mcp` command runs the upstream server, without these additions.

Keep this original PixInsight update repository:

```text
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/
```

The native Watcher and its developer signature remain supplied by the original
author. This fork does not publish a replacement PixInsight update repository or
require the fork owner to be a Certified PixInsight Developer. Native build and
release workflows are guarded to run only in the original upstream repository;
ordinary MCP tests remain cross-platform.

To restore upstream, change the client command back to `npx` and args to
`["-y", "@pardovot/pixinsight-mcp"]`. No Watcher reinstall is required.

Official interfaces were verified against the installed 1.9.4 command-line
`--help`, `CoreApplication` runtime properties, and the installed
`src/scripts/ImageSolver/ImageSolver.js` source. Codex configuration reference:
https://developers.openai.com/codex/mcp
