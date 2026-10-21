# PixInsight MCP

[简体中文](#简体中文) · [English](#english)

## 简体中文

通过 MCP，让 AI 助手操作 PixInsight：打开图像、测量数据、运行已安装的处理工具，并读取结果。支持 Windows、macOS 和 Linux。

### 本 fork 新增的功能

本 fork 基于 [pardovot/pixinsight-mcp](https://github.com/pardovot/pixinsight-mcp)，为 Node MCP 服务增加三个工具：

| 工具 | 功能 |
|---|---|
| `resolve_script` | 根据正在运行的 PixInsight 实例定位脚本，支持 ImageSolver 别名和自定义绝对路径 |
| `run_script_file` | 通过 PixInsight 1.9.4 官方 IPC 接口启动完整 PJSR 文件，支持参数及 `#include` |
| `get_script_job` | 查询执行状态、日志和运行错误；提交成功不等于脚本执行成功 |

脚本目录来自 PixInsight 运行时，不写死不同系统的安装位置。ImageSolver 优先使用 `src/scripts/ImageSolver/ImageSolver.js`，并兼容旧的 `src/scripts/AdP/ImageSolver.js`。

**PixInsight 端继续使用原作者的更新仓库和签名 MCP Watcher。** 本 fork 不发布原生模块，不使用或声称拥有 Certified PixInsight Developer 身份。使用这些新增工具无需重新编译或签名 Watcher。

验证情况：84 项自动测试通过；macOS PixInsight 1.9.4 已实测完整脚本启动、参数传递、日志和异常回传。Windows/Linux 路径行为经过单元测试，尚未实测运行；本次更新尚未重新验证成功的天文解析。详细用法和限制见[脚本执行说明（英文）](docs/script-files.md)。

### 执行可靠性与验收增强（2026-09-15）

新增 `get_command_job`，普通处理支持异步提交、超时后查询及同 UUID 防重复执行；返回真实参数、历史变化和可选全像素对比。历史导出同时保留实时参数 JSON，并修正原生序列化的数值精度。渲染增加解锁 Boost、固定逐通道对照及临时窗口保护。

这些增强通过现有签名 Watcher 工作，无需重编译原生模块。构建后重新连接 MCP 客户端生效。接口用法、测试范围和 ICC/重放限制见[执行与验收说明](docs/reliability-and-review.md)。

### 安装本 fork

需要 PixInsight 1.9.4+（V8 引擎）、Node.js 22.23.4+（22.x）、24.22.1+（24.x，推荐 LTS）或 26.12.1+（26.x），以及支持 MCP 的客户端。最低版本包含 2026-10-21 安全更新；已停止支持的奇数版 Node 不受支持。开发默认版本见 `.node-version`。

**1. 构建 MCP 服务**

```text
git clone https://github.com/Fluorine7/pixinsight-mcp.git
cd pixinsight-mcp
npm ci
npm run build
```

将客户端指向构建后的服务。例如 Codex 的 `~/.codex/config.toml`：

```toml
[mcp_servers.pixinsight]
command = "node"
args = ["/absolute/path/to/pixinsight-mcp/build/index.js"]
```

请替换为本机实际路径。Windows 的 TOML 路径使用正斜杠或转义后的反斜杠。配置后重启或重新连接 MCP 客户端。

**2. 安装原作者的 PixInsight 模块**

在 `Resources > Updates > Manage Repositories` 添加以下地址；已经配置的用户保持不变：

```text
https://raw.githubusercontent.com/pardovot/pixinsight-mcp/dist/
```

然后选择 `Resources > Updates > Check for Updates` 并重启 PixInsight。原作者的签名身份显示为 `OfirPardo`。

**3. 启动连接**

在 `Process > Utilities > MCP Watcher > Start` 启动 Watcher，然后让助手列出当前打开的图像，确认连接正常。

### 只安装原版 MCP

上游 npm 包不包含本 fork 新增的三个工具。如果只需原版，可使用：

```bash
claude mcp add pixinsight -- npx -y @pardovot/pixinsight-mcp
```

Claude Desktop、Cursor、Windsurf 等使用 `mcp.json` 的客户端：

```json
{
  "mcpServers": {
    "pixinsight": { "command": "npx", "args": ["-y", "@pardovot/pixinsight-mcp"] }
  }
}
```

Codex 配置：

```toml
[mcp_servers.pixinsight]
command = "npx"
args = ["-y", "@pardovot/pixinsight-mcp"]
```

Windows 客户端若无法解析 `npx`，可设置 `"command": "cmd"`，参数使用 `["/c", "npx", "-y", "@pardovot/pixinsight-mcp"]`。PixInsight 模块安装和启动步骤与上面相同。

### 工具列表

原有工具全部保留：

| 分类 | 工具 |
|---|---|
| 处理执行 | `run_process`、`get_command_job`、`get_process_parameters`、`run_script` |
| 完整脚本 | `resolve_script`、`run_script_file`、`get_script_job` |
| 图像管理 | `list_open_images`、`open_image`、`save_image`、`close_image`、`get_image_statistics` |
| 测量 | `get_noise`、`get_background_gradient`、`get_background_neutrality`、`get_star_metrics`、`get_structure_color` |
| 渲染 | `render_view`、`render_critic_pack` |
| 历史与备份 | `get_history`、`get_full_history`、`undo`、`redo`、`snapshot`、`restore` |
| 实例 | `list_instances`、`use_instance` |
| 导出 | `export_container` |

`run_process` 按类名调用已安装的处理工具，也支持第三方工具。新增处理工具通常无需增加专用 MCP 封装。

测量应针对实际图像进行：`get_noise` 返回 MRS 噪声估计；天文图像的 `stdDev` 受真实信号影响，不能直接当作噪声指标。拉伸后的 `get_background_neutrality` 应使用 `mode:'poststretch'`。已验证的注意事项见 [docs/facts.md](docs/facts.md)，工具定义位于 `src/tools/*.ts`。

### 工作方式

```text
MCP 客户端
  │ MCP / stdio
Node MCP 服务（src/）
  ├─ 文件桥接 → MCP Watcher 定时器 → 内嵌 JS 处理器 → PixInsight
  └─ 完整脚本工具 → 官方 --execute IPC → PJSR 预处理与执行 → 任务结果文件
```

原有命令经 `~/.pixinsight-mcp/bridge/{commands,results}` 交换。原生 Watcher 使用 PixInsight 事件循环中的 `pcl::Timer`，避免常驻 PJSR 轮询循环持续占用主线程；具体脚本或处理运行期间仍可能占用界面。

> 能向桥接目录写入命令的程序可以在 PixInsight 内执行代码。应将该目录保留在当前用户私有的本地位置，不放在共享或同步目录。

### 平台与原生模块

下列路径相对于 PixInsight 安装根目录：

| 系统 | 模块位置 |
|---|---|
| Windows | `bin/MCPWatcher-pxm.dll` |
| macOS | `MacOS/MCPWatcher-pxm.dylib`，通用 x86_64 + arm64 |
| Linux | `bin/MCPWatcher-pxm.so` |

原生模块由上游构建和发布。本 fork 保留跨平台 MCP 测试，但原生模块构建及发布工作流只允许在原作者仓库运行。

### 从源码构建原生模块（开发者可选）

**使用本 fork 的新增功能不需要执行这一节。** 只有修改原生 Watcher 时才需要 C++ 工具链、CMake，以及自己的签名身份。

| 系统 | 工具链 |
|---|---|
| Windows | Visual Studio 2022 或 Build Tools，安装 C++ 工作负载，通过 `vswhere` 查找 |
| macOS | Xcode Command Line Tools，以及 `brew install cmake ninja` |
| Linux | `build-essential cmake ninja-build` |

```bash
npm run module:pcl       # 首次构建 PixInsight 随附的 PCL
npm run module:build     # 生成处理器并编译
npm run module:sign      # 需要自己的签名身份
npm run module:install   # 需要管理员权限，并关闭 PixInsight
```

`node module/config.mjs` 可显示解析出的路径。安装脚本复制模块及其 `.xsgn`，并拒绝比二进制更旧的签名。PCL 构建会将源码复制至 `$PCL_BUILD_OUT/src`，以兼容只读安装目录；只有安装步骤需要写入 PixInsight 安装目录。

处理器逻辑位于 `pjsr/pixinsight-mcp-watcher.js`；`module/src/BridgeHandlersJS.h` 由它生成，不应手动编辑。各平台开发环境见 [docs/dev-setup.md](docs/dev-setup.md)。

### 配置

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `PIXINSIGHT_EXE` | 自动查找 | 构建脚本使用的 PixInsight 可执行文件 |
| `PIXINSIGHT_MCP_TIMEOUT_MS` | `300000` | 单条命令超时，毫秒 |
| `PIXINSIGHT_MCP_EXTENDED_TIMEOUT_MS` | `3600000` | 长操作超时，毫秒 |
| `PIXINSIGHT_MCP_POLL_INTERVAL_MS` | `200` | 桥接轮询间隔，毫秒 |
| `PI_ROOT` | 自动查找 | PixInsight 安装根目录，供构建脚本使用 |
| `PCL_BUILD_OUT` | `~/pcl-build` | PCL 构建和源码副本目录 |
| `PI_SIGN_KEY`、`PI_SIGN_DEVELOPER_ID` | 无 | 开发者签名所需信息 |
| `PI_SIGN_KEY_FILE` | `~/.pixinsight-mcp/signing-key.json` | 本地签名使用的已导出密钥 |

构建脚本按平台探测 `%ProgramFiles%\PixInsight`、`/Applications/PixInsight` 或 `/opt/PixInsight`。自定义安装可覆盖 `PI_ROOT`；完整脚本工具则从正在运行的 PixInsight 获取实际目录。

例如在 POSIX shell 中：

```bash
PI_ROOT=/opt/PixInsight-1.9.5 node module/build.mjs
```

### 签名与发布

上游模块和仓库索引均有数字签名。签名工具通过 Node 运行；首次导出签名密钥需要 PixInsight。本 fork 继续使用上游签名产物，无需配置签名密钥。

签名实现见 [docs/SIGNING.md](docs/SIGNING.md)，上游发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。

### 目录结构

```text
src/                MCP 服务：tools/、pjsr/、bridge/、scripts/
module/             原生模块及构建、签名、安装工具
pjsr/               Watcher JS 处理器源文件
docs/               架构、协议、签名、发布及脚本工具说明
scripts/            连接检查和仓库构建工具
test/               自动测试
test-scripts/        需要运行 PixInsight 的手动集成测试
```

### 来源与致谢

项目源自 [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp)。[pardovot 的上游项目](https://github.com/pardovot/pixinsight-mcp) 在其基础上增加了原生模块、通用处理执行器、测量层、签名和发布机制。本 fork 增加完整脚本执行功能。

- **Alain Escaffre**（[@aescaffre](https://github.com/aescaffre)）：初始项目、文件桥接、Agent 架构和 PJSR Watcher。开发工作属于 [Astro ARO](https://astrolentejo.fr)，位于葡萄牙 Alentejo 暗夜保护区的远程天文台，Bortle 2–3。
- **Andre Couto**（[@4ndr3c0ut0](https://github.com/4ndr3c0ut0)）：PixInsight 1.9.4+ Watcher 的 V8 移植，见原项目 [PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1)。
- **pardovot**：原生模块、通用执行器、测量与知识层、签名、发布和打包。

### 许可证

MIT © Alain Escaffre（原始工作）及 pardovot。见 [LICENSE](LICENSE)。

---

## English

An MCP server that lets an AI assistant drive PixInsight: open images, measure them, run any
installed process, read the results back. PixInsight stays responsive while it works, so you can
watch and intervene.

Cross-platform: Windows, macOS and Linux.

### This fork: complete script execution

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

### Original upstream installation (without fork additions)

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

Requires PixInsight 1.9.4+ (V8 engine), Node.js 22.23.4+ (22.x), 24.22.1+ (24.x, recommended LTS), or 26.12.1+ (26.x), and an MCP client. These minimums include the 2026-10-21 security fixes; end-of-life odd-numbered Node releases are unsupported. The development default is in `.node-version`.

### Tools

The upstream tools remain available; this fork adds three script-file tools. Bold ones carry the work.

| Category | Tools |
|---|---|
| Script files | `resolve_script`, `run_script_file`, `get_script_job` |
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

### How it works

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

The existing commands use a local file bridge. The new complete-script tools use the
official `--execute` IPC interface after discovering the active installation through that bridge.

The native Watcher uses a timer on PixInsight's event loop instead of a persistent PJSR polling
loop that holds the main thread. Individual scripts and processes may still occupy the UI while
executing.

> Anything that can write to `~/.pixinsight-mcp/bridge/commands` can run arbitrary code inside
> PixInsight. Keep the directory user-private, never on a shared or synced path.

### Platform

| | Module installed as |
|---|---|
| Windows | `bin/MCPWatcher-pxm.dll` |
| macOS | `MacOS/MCPWatcher-pxm.dylib`, universal x86_64 + arm64 |
| Linux | `bin/MCPWatcher-pxm.so` |

The original upstream repository builds and distributes the native modules. In this fork,
native build/release workflows are restricted to the upstream repository; ordinary MCP tests
remain cross-platform. Windows/Linux path behavior is unit-tested, while live execution of the
new script tools has been verified on macOS PixInsight 1.9.4 only. All 84 automated tests passed;
a successful astrometric solve has not been re-tested in this update.

### Building from source

**Optional for native Watcher developers; not required to use this fork's additions.**
Needs a supported Node.js version listed above, a C++ toolchain and CMake:

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

### Configuration

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

### Signing

PixInsight refuses unsigned modules by default. Modules and the repository index are both signed,
in Node, with no PixInsight involved, which is why CI can publish a signed release from a runner
that has none installed. PixInsight is needed once, to export the key.

Both constructions and the security caveats: [`docs/SIGNING.md`](docs/SIGNING.md).
Release process: [`docs/RELEASING.md`](docs/RELEASING.md).

### Layout

```
src/                MCP server: tools/, pjsr/, bridge/, scripts/
module/             native module (the runtime), build/sign/install tooling
pjsr/               JS watcher, source of truth for handler logic
docs/               SIGNING, RELEASING, bridge-protocol, facts, architecture
scripts/            ping-watcher, build-pi-repo
test/               node --test suites
test-scripts/       manual integration tests requiring a running PixInsight
```

### Origins

Began in 2026 as a fork of [aescaffre/pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp),
independent codebase since. The file bridge and the PJSR handler bodies come from there. The native
module, the generic process runner, the measurement layer, signing and the update repository were
added here.

### Credits

- **Alain Escaffre** ([@aescaffre](https://github.com/aescaffre)), originator of the project this
  one grew from: the file bridge, the agentic architecture, and the PJSR watcher whose handler
  logic still runs here. Developed as a member of [**Astro ARO**](https://astrolentejo.fr), a
  remote observatory in the Alentejo Dark Sky Reserve (Portugal), Bortle 2-3.
- **Andre Couto** ([@4ndr3c0ut0](https://github.com/4ndr3c0ut0)), V8 runtime port of the watcher
  for PixInsight 1.9.4+ "Lockhart"
  ([PR #1](https://github.com/aescaffre/pixinsight-mcp/pull/1) on the original repository).
- **pardovot**, native module, generic process runner, measurement and knowledge layer, signing
  and release pipeline, packaging.

### License

MIT © Alain Escaffre (original work) and pardovot. See [LICENSE](LICENSE).

### Local complete-script extension

See [script file tools](docs/script-files.md) for installation discovery, full PJSR file execution and persistent job status.
