import { verifiedProcessScript } from "../pjsr/process-state.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient } from "../bridge/client.js";
import {
  checkProcessCall,
  deadParamsFor,
  formatBlocks,
  formatNotes,
  formatWarnings,
  overrideEnabled,
} from "../facts/guard.js";

function processResult(result: any, successMsg: string) {
  if (result.status === "error") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: true,
    };
  }
  const msg = result.message || successMsg;
  return {
    content: [{ type: "text" as const, text: msg }],
  };
}

export function registerProcessingTools(server: McpServer, bridge: BridgeClient): void {
  server.tool("get_command_job", "Query a durable bridge command on the active instance, including after a wait timeout or server restart. Never resubmits it.",
    { commandId: z.string().uuid() }, async ({ commandId }) => {
      try {
        const job = await bridge.getCommandJob(commandId);
        if (job.outputs?.returnValue) {
          try { job.execution = JSON.parse(job.outputs.returnValue); } catch {}
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(job, null, 2) }],
          isError: job.status === "error" || job.execution?.status === "error" };
      } catch (e) { return { content: [{ type: "text" as const, text: String(e) }], isError: true }; }
    });

  // run_pixelmath was removed as an MCP tool 2026-07-26: a per-process wrapper
  // (the anti-pattern) with a restricted parameter set (no symbols/rescale/...).
  // Use run_process("PixelMath") instead. The bridge verb + handler remain for
  // direct bridge callers (public contract).

  // run_process, generic: run ANY PixInsight process by name
  server.tool(
    "run_process",
    "Run any PixInsight process by its class name (e.g. BlurXTerminator, " +
      "AutomaticBackgroundExtractor, PixelMath). This is the general mechanism, prefer " +
      "it over process-specific tools.\n" +
      "METHOD (do this, don't run blindly):\n" +
      "1. First call get_process_parameters(processId) to see settings + defaults, and " +
      "reason about what they mean (recall or check pixinsight.com/doc).\n" +
      "2. Watch for no-op output defaults: some processes only make a side product unless " +
      "you configure output. E.g. AutomaticBackgroundExtractor defaults to targetCorrection=0 " +
      "(no correction), to actually correct the image pass { targetCorrection: 1, replaceTarget: true }.\n" +
      "3. Pick settings from measuring THIS image (get_image_statistics / run_script), not fixed defaults.\n" +
      "4. After running, inspect execution evidence and re-measure. verifyPixels:true checks all target samples; " +
      "identical summary statistics alone do not prove a no-op. Verify intended outputs before continuing.\n" +
      "Unknown setting names are rejected (checked against get_process_parameters).",
    {
      processId: z.string().describe("Process class name, e.g. 'BlurXTerminator'"),
      viewId: z.string().optional().describe("Target view id (omit for a global process)"),
      verifyPixels: z.boolean().optional().describe("Compare every target sample before/after (extra full-image copy and scan); reports unchanged pixels without guessing from statistics"),
      commandId: z.string().uuid().optional().describe("Optional idempotency UUID. Reuse for the identical request after an uncertain response; never generates a second execution."),
      waitMs: z.number().int().min(0).max(3600000).optional().describe("Wait budget; 0 submits asynchronously. Timeout does not cancel execution."),
      settings: z.record(z.any()).optional().describe("Process parameters as { name: value } (see get_process_parameters)"),
    },
    async ({ processId, viewId, settings, commandId, waitMs, verifyPixels }) => {
      // Verified defects are refused before the call reaches PixInsight. Some of
      // these hang the application, and the no-op ones would otherwise return
      // success with an unchanged image, which is worse than an error.
      const { blocks, warnings } = checkProcessCall({ processId, viewId, settings: settings ?? {} });
      if (blocks.length > 0 && !overrideEnabled()) {
        return {
          content: [{ type: "text" as const, text: formatBlocks(processId, blocks) }],
          isError: true,
        };
      }

      let submittedId: string | undefined;
      try {
        // Freeze the destination for this submission and its wait, even if another
        // request switches the server's active instance in between awaits.
        const commandBridge = new BridgeClient(bridge.getConfig());
        const code = verifiedProcessScript(processId, viewId, settings ?? {}, verifyPixels);
        const id = await commandBridge.submitCommand("run_script", "__script__", { code }, { commandId });
        submittedId = id;
        if (waitMs === 0) return { content: [{ type: "text" as const,
          text: JSON.stringify({ commandId: id, status: "submitted", bridgeDir: commandBridge.getBridgeDir() }) }] };
        const result = await commandBridge.waitForCommand(id, waitMs ?? bridge.getConfig().defaultTimeoutMs);
        if (result.status !== "success") return processResult(result, "");
        const execution = JSON.parse(String(result.outputs.returnValue));
        return { content: [{ type: "text" as const,
          text: JSON.stringify({ commandId: id, bridgeDir: commandBridge.getBridgeDir(), ...execution }, null, 2) + (warnings.length ? formatWarnings(warnings) : "") }],
          isError: execution.status !== "success" };
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: String(err), commandId: submittedId, warning: submittedId ? "Query this job before retrying; execution may have occurred." : undefined }) }], isError: true };
      }
    }
  );

  // get_process_parameters, introspect a process's settable parameters + defaults
  server.tool(
    "get_process_parameters",
    "List the settable parameters (and their default values) of a PixInsight process, " +
      "so you know what 'settings' run_process accepts.",
    {
      processId: z.string().describe("Process class name, e.g. 'BlurXTerminator'"),
    },
    async ({ processId }) => {
      const result = await bridge.sendCommand("get_process_parameters", processId, { processId });
      if (result.status === "error") {
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
      }
      const params = (result as any).outputs?.parameters ?? {};
      // Introspection reports dead aliases as ordinary settable parameters, so
      // mark them here rather than letting a caller trust the raw list.
      const dead = deadParamsFor(processId);
      const lines = Object.keys(params)
        .map((k) => {
          const fact = dead.get(k.toLowerCase());
          const mark = fact ? `   [DEAD, ${fact.id}: setting this is refused, ${fact.fix ?? "no effect"}]` : "";
          return `- ${k} = ${JSON.stringify(params[k])}${mark}`;
        })
        .join("\n");
      return {
        content: [
          { type: "text" as const, text: `**${processId}** parameters:\n${lines}${formatNotes(processId)}` },
        ],
      };
    }
  );

  // run_script
  server.tool(
    "run_script",
    "Execute arbitrary PJSR code inside PixInsight (escape hatch for anything not covered by " +
      "specific tools). Returns the script's final expression value (not console output).",
    {
      code: z.string().describe("PJSR JavaScript code to execute"),
    },
    async ({ code }) => {
      const result = await bridge.sendCommand("run_script", "__script__", { code });
      if (result.status === "error") {
        return {
          content: [{ type: "text" as const, text: `Script error: ${result.error.message}` }],
          isError: true,
        };
      }
      const output = (result as any).outputs?.returnValue ?? (result as any).message ?? "Script executed.";
      return {
        content: [{ type: "text" as const, text: output }],
      };
    }
  );
}
