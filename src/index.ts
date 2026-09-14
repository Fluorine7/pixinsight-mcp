#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "./bridge/client.js";
import { discoverInstances } from "./bridge/discover.js";
import { hasExplicitBridgePin } from "./types.js";
import { registerImageManagementTools } from "./tools/image-management.js";
import { registerScriptFileTools } from "./tools/script-files.js";
import { registerProcessingTools } from "./tools/processing.js";
import { registerSessionTools } from "./tools/session.js";
import { registerExportTools } from "./tools/export.js";
import { registerMeasurementTools } from "./tools/measurement.js";
import { registerRenderTools } from "./tools/render.js";
import { registerInstanceTools } from "./tools/instances.js";

// Single version source: package.json (shipped alongside build/ in the npm package).
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
) as { version: string };

async function main() {
  const server = new McpServer({
    name: "pixinsight-mcp",
    version,
  });

  const bridge = new BridgeClient();

  // Auto-detect the live PixInsight instance, unless the user pinned one via env
  // (PIXINSIGHT_MCP_BRIDGE_DIR / PIXINSIGHT_MCP_INSTANCE). Liveness comes from
  // each instance's heartbeat file (see bridge/discover.ts). With one live
  // instance we target it silently; with several we default to the lowest and
  // let a "use instance N" request (use_instance tool) switch.
  if (!hasExplicitBridgePin()) {
    const live = (await discoverInstances()).filter((i) => i.live);
    if (live.length === 1) {
      bridge.setBridgeDir(live[0].bridgeDir);
      console.error(`Auto-detected PixInsight instance ${live[0].slot}`);
    } else if (live.length > 1) {
      bridge.setBridgeDir(live[0].bridgeDir);
      console.error(
        `Multiple live PixInsight instances (${live.map((i) => i.slot).join(", ")}); ` +
          `defaulting to ${live[0].slot}. Say "use instance N" to switch.`
      );
    } else {
      console.error(
        `No live PixInsight instance detected; defaulting to slot 1. ` +
          `Open the MCP Watcher panel in PixInsight.`
      );
    }
  }

  // Ensure bridge directories exist on startup
  await bridge.ensureDirectories();

  // Reap leftovers from dead sessions: stale command files (which the watcher
  // would otherwise execute, minutes or days late, the next time it starts) and
  // orphaned result files (written after a client timed out and stopped reading).
  const reaped = await bridge.cleanStaleCommands();
  if (reaped > 0) console.error(`Cleaned ${reaped} stale bridge file(s)`);

  // Register all tool categories
  registerImageManagementTools(server, bridge);
  registerProcessingTools(server, bridge);
  registerScriptFileTools(server, bridge);
  registerSessionTools(server, bridge);
  registerExportTools(server, bridge);
  registerMeasurementTools(server, bridge);
  registerRenderTools(server, bridge);
  registerInstanceTools(server, bridge);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error("PixInsight MCP Server started (stdio transport)");
  console.error(`Bridge directory: ${bridge.getConfig().bridgeDir}`);
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
