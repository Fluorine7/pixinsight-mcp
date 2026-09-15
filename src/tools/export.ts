import { readFile, writeFile, rename } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { historyStateScript } from "../pjsr/process-state.js";
import { execPjsrJson, jsonContent, jsonErrorContent } from "../pjsr/exec.js";
import { buildVerifiedContainer } from "../export/verified-xml.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";

/**
 * Reproducibility export.
 *
 * A processing session has two artifacts worth persisting:
 *   - per-section ProcessContainer `.xpsm` icons (narrow, one per image/section) -
 *     e.g. a `linear` container on the master, a `starless` container on the starless,
 *     a `stars` container on the stars layer;
 *   - one whole-session `replay.js` (empty -> exact final state), authored from the
 *     same process definitions (see data/_pre-v2/.../replay.js for the reference).
 *
 * This tool covers the first. PixInsight's scripting API CANNOT create process icons
 * (`writeIcon` only overwrites an existing GUI icon), but a `.xpsm` is plain XML we can
 * write directly; opening it in PixInsight materialises the icon. The watcher handler
 * (`handleExportContainer`) reads a view's process-history slice and emits the container.
 *
 * IMPORTANT, capture LIVE, per section: `view.processing` resets on save+reopen, and
 * `createNewImage` outputs start with empty history. Call this at each section boundary
 * while the view is still the live processed view, not after reopening from disk.
 *
 * Logic lives in the watcher handler (project rule: "handler logic in ONE place, the JS").
 */
export function registerExportTools(server: McpServer, bridge: BridgeClient): void {

  function errorContent(message: string) {
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }

  server.tool(
    "export_container",
    "Write a loadable PixInsight ProcessContainer .xpsm from a view's process-history slice " +
      "(the icon appears when you open the file in PixInsight). Use per section: point it at the " +
      "live processed view. Also writes .history.json with exact runtime parameters and mask state. " +
      "Optionally, a [fromIndex,toIndex) range to isolate one section " +
      "(linear / starless / stars / recombine). CAPTURE LIVE, view.processing resets on " +
      "save+reopen and createNewImage outputs start empty, so export before saving/closing the view.",
    {
      viewId: z.string().describe("View ID whose process history to export"),
      outputPath: z.string().describe("Absolute path to write the .xpsm file to"),
      dependencies: z.array(z.object({ path: z.string(), role: z.string() })).optional()
        .describe("Checkpoint, masks, scripts and other replay dependency files to record (must exist)"),
      iconName: z.string().default("ProcessContainer")
        .describe("Name of the container icon shown in PixInsight (e.g. 'RhoOph_Starless')"),
      fromIndex: z.number().int().min(0).optional()
        .describe("First history step to include (default 0 = start of this view's history)"),
      toIndex: z.number().int().min(0).optional()
        .describe("End of the slice, exclusive (default = applied history only; excludes redo steps)"),
    },
    async ({ viewId, outputPath, iconName, fromIndex, toIndex, dependencies }) => {
      let auditPath: string | undefined;
      try {
        if (!isAbsolute(outputPath)) throw new Error("outputPath must be absolute");
        const history = await execPjsrJson(bridge, historyStateScript(viewId, true));
        const { createHash } = await import("node:crypto");
        history.dependencies = await Promise.all((dependencies ?? []).map(async d => {
          if (!isAbsolute(d.path)) throw new Error("Dependency paths must be absolute");
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(d.path)) hash.update(chunk);
          return { ...d, sha256: hash.digest("hex") };
        }));
        history.exportValidation = { status: "pending", fullReplayTested: false };
        auditPath = outputPath + ".history.json";
        const saveAudit = async () => {
          const tmp = auditPath + "." + randomUUID() + ".tmp";
          await writeFile(tmp, JSON.stringify(history, null, 2), "utf8");
          await rename(tmp, auditPath!);
        };
        await saveAudit();
        let container;
        try { container = buildVerifiedContainer(history, iconName, fromIndex, toIndex); }
        catch (err) {
          history.exportValidation = { status: "unsupported", error: String(err), fullReplayTested: false };
          await saveAudit();throw err;
        }
        const tmp = outputPath + "." + randomUUID() + ".tmp";
        await writeFile(tmp, container.xml, "utf8");
        // Verify the serialized bytes survived writing; semantic correction is checked by the serializer.
        if (await readFile(tmp, "utf8") !== container.xml) throw new Error("Export readback mismatch");
        await rename(tmp, outputPath);
        history.exportValidation = { status: "written", corrected: container.corrected,
          nativeEnumMapping: "retained", fullReplayTested: false };
        await saveAudit();
        return jsonContent({ path: outputPath, auditPath, count: container.processes.length,
          processes: container.processes, fromIndex: container.fromIndex, toIndex: container.toIndex,
          corrected: container.corrected, fullReplayTested: false,
          warning: "Dependencies are recorded, not bundled. Full image replay has not been verified." });
      } catch (err) { return jsonErrorContent(String(err) + (auditPath ? `; live parameter audit: ${auditPath}` : "")); }
    }
  );
}
