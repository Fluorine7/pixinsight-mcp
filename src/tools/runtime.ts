import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient, EXPECTED_HANDLERS_REV } from "../bridge/client.js";
import { LIVE_WINDOW_MS } from "../bridge/discover.js";
import { jsonContent } from "../pjsr/exec.js";

const buildPath = new URL("../build-info.json", import.meta.url);
function readBuild() {
  try { return JSON.parse(readFileSync(buildPath, "utf8")); } catch { return null; }
}
const require = createRequire(import.meta.url);
const sdkPath = new URL("../../../package.json", pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")));
// Snapshots are intentionally captured once: rebuilding on disk does not reload JS.
const loadedBuild = readBuild();
const loadedPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const loadedSDK = JSON.parse(readFileSync(sdkPath, "utf8")).version;
const startedAt = new Date().toISOString();

export function nodeMeetsRequirement(version: string, requirement: string): boolean {
  const actual = version.replace(/^v/, "").split(".").map(Number);
  return requirement.split("||").some((range) => {
    const match = /^\s*\^(\d+)\.(\d+)\.(\d+)\s*$/.exec(range);
    if (!match) return false;
    const [, major, minor, patch] = match.map(Number);
    return actual[0] === major && (actual[1] > minor || actual[1] === minor && actual[2] >= patch);
  });
}

export async function runtimeInfo(bridge: BridgeClient, probeWatcher = false) {
  const diskBuild = readBuild();
  const active = new BridgeClient({ ...bridge.getConfig(), bridgeDir: bridge.getBridgeDir() });
  const bridgeDir = active.getBridgeDir();
  let heartbeat: Record<string, unknown> = { state: "missing" };
  try {
    const path = join(bridgeDir, "heartbeat.json");
    const [data, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const parsed = JSON.parse(data);
    const ageMs = Math.max(0, Date.now() - info.mtimeMs);
    heartbeat = { state: ageMs < LIVE_WINDOW_MS ? "fresh" : "stale", ageMs,
      slot: parsed.slot, pid: parsed.pid, moduleVersion: parsed.version };
  } catch (error) {
    heartbeat = { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable" };
  }
  let probe: Record<string, unknown> = { status: "not-requested" };
  if (probeWatcher) {
    try {
      const result = await active.sendCommand("run_script", "__script__", { code:
        "JSON.stringify({version:CoreApplication.versionMajor+'.'+CoreApplication.versionMinor+'.'+CoreApplication.versionRelease,build:CoreApplication.versionBuild,instance:CoreApplication.instance,pid:String(CoreApplication.pid)})"
      }, { timeoutMs: 5000 });
      probe = result.status === "success"
        ? { status: "responsive", pixInsight: JSON.parse(String(result.outputs.returnValue)) }
        : { status: "unconfirmed", detail: result.status === "error" ? result.error : result.message };
    } catch (error) { probe = { status: "unconfirmed", detail: String(error) }; }
  }
  const revision = active.getObservedHandlersRev();
  return {
    server: { version: loadedPackage.version, sdkVersion: loadedSDK, build: loadedBuild,
      entrypoint: fileURLToPath(new URL("../index.js", import.meta.url)), pid: process.pid, startedAt,
      diskBuild, restartRequired: loadedBuild && diskBuild ? loadedBuild.buildId !== diskBuild.buildId : null },
    node: { version: process.version, executable: process.execPath, platform: process.platform, arch: process.arch,
      required: loadedPackage.engines.node, supported: nodeMeetsRequirement(process.version, loadedPackage.engines.node) },
    bridge: { directory: bridgeDir, heartbeat, probe,
      expectedHandlersRevision: EXPECTED_HANDLERS_REV, observedHandlersRevision: revision,
      revisionStatus: revision === null ? "unknown" : revision === EXPECTED_HANDLERS_REV ? "compatible" : revision < EXPECTED_HANDLERS_REV ? "older" : "newer" },
    notes: ["A stale heartbeat can mean a busy PixInsight main thread; it does not prove the application is stopped.",
      "Build provenance is captured at build time. A dirty or missing build is not an exact Git commit."]
  };
}

export function registerRuntimeTools(server: McpServer, bridge: BridgeClient) {
  server.tool("get_runtime_info", "Inspect this running MCP process: Node, SDK, loaded build versus disk, active bridge and Watcher heartbeat. probeWatcher=true adds a read-only round trip (up to 5 seconds) for actual PixInsight version and handler revision.",
    { probeWatcher: z.boolean().default(false) }, async ({ probeWatcher }) => jsonContent(await runtimeInfo(bridge, probeWatcher)));
}
