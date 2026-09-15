import { historyStateScript } from "../pjsr/process-state.js";
import { execPjsrJson, jsonContent, jsonErrorContent } from "../pjsr/exec.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";

/**
 * Session / state-management tools: revert and checkpoint.
 *
 * Run 1 concluded undo was impossible in the watcher context (canUndo=false) and
 * every revert needed the user at the keyboard. That was a MISDIAGNOSIS: scripted
 * `executeOn` accumulates an undoable process history, and `ImageWindow.undo()` /
 * `view.historyIndex` / `view.canGoBackward` all work from PJSR and persist across
 * separate bridge commands (verified live). `canUndo` is simply not an ImageWindow
 * property, the correct signal is `view.canGoBackward`.
 *
 * Two complementary reverts:
 *   - `undo`/`redo`, walk the built-in process history. Cheap; history is bounded
 *     and SXT-style ops that spawn a second window revert only the target's part.
 *   - `snapshot`/`restore`, an explicit, agent-named durable checkpoint (a hidden
 *     duplicate window). Robust for multi-step runs; restore is itself undoable.
 *
 * Logic lives in the watcher handlers (pjsr/pixinsight-mcp-watcher.js →
 * handleUndo/…); these tools just forward the command, matching the project's
 * "handler logic in ONE place" rule.
 */
export function registerSessionTools(server: McpServer, bridge: BridgeClient): void {

  function errorContent(message: string) {
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }

  // get_history, is a revert possible, and where are we in the history?
  server.tool(
    "get_history",
    "Report a view's process-history position: current index and whether undo/redo " +
      "are possible. Use canUndo before calling undo, and to verify a revert landed.",
    { viewId: z.string().describe("View ID (an open image's main view)") },
    async ({ viewId }) => {
      const result = await bridge.sendCommand("get_history", "__internal__", { viewId });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text" as const,
          text: `**${viewId}** history: index=${o.historyIndex}, canUndo=${o.canUndo}, canRedo=${o.canRedo}`,
        }],
      };
    }
  );

  // get_full_history, every step's process name AND settings (History Explorer + hidden params)
  server.tool(
    "get_full_history",
    "List a view's FULL process history: every step's process name and its settings, what " +
      "the GUI History Explorer shows, plus the settings it hides. Read-only (walks the " +
      "cumulative process container; no undo/redo, no pixel change). Step 0 is the base " +
      "(integration); steps ahead of the current index are flagged redo-able. Note: PixInsight " +
      "prunes the redo branch when a process is applied after an undo, so pruned steps are gone " +
      "and never appear here.",
    {
      viewId: z.string().describe("View ID (an open image's main view)"),
      maxParamLines: z.number().int().min(1).max(200).default(12)
        .describe("Deprecated compatibility option: full live values are returned without truncation"),
    },
    async ({ viewId, maxParamLines }) => {
      try {
        const history = await execPjsrJson(bridge, historyStateScript(viewId));
        // Full runtime values are returned; maxParamLines is retained for API compatibility.
        return jsonContent(history);
      } catch (err) { return jsonErrorContent(err); }
    }
  );

  // undo, walk back N process-history steps
  server.tool(
    "undo",
    "Revert the last N steps of a view's process history (built-in undo). Stops early " +
      "if the history runs out. For a durable checkpoint you control, prefer snapshot/restore.",
    {
      viewId: z.string().describe("View ID to revert"),
      steps: z.number().int().min(1).default(1).describe("Number of history steps to undo"),
    },
    async ({ viewId, steps }) => {
      const result = await bridge.sendCommand("undo", "__internal__", { viewId, steps });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      const note = o.undone < steps ? ` (history exhausted after ${o.undone})` : "";
      return {
        content: [{
          type: "text" as const,
          text: `Undid ${o.undone} step(s) on **${viewId}**${note}. Now index=${o.historyIndex}, canUndo=${o.canUndo}, canRedo=${o.canRedo}.`,
        }],
      };
    }
  );

  // redo, replay N steps forward
  server.tool(
    "redo",
    "Replay the next N steps forward in a view's process history (companion to undo).",
    {
      viewId: z.string().describe("View ID"),
      steps: z.number().int().min(1).default(1).describe("Number of history steps to redo"),
    },
    async ({ viewId, steps }) => {
      const result = await bridge.sendCommand("redo", "__internal__", { viewId, steps });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text" as const,
          text: `Redid ${o.redone} step(s) on **${viewId}**. Now index=${o.historyIndex}, canUndo=${o.canUndo}, canRedo=${o.canRedo}.`,
        }],
      };
    }
  );

  // snapshot, durable named checkpoint (hidden duplicate window)
  server.tool(
    "snapshot",
    "Checkpoint a view into a hidden duplicate window you can restore later. Take one " +
      "BEFORE a risky/irreversible step (e.g. StarXTerminator). Re-using a snapshotId " +
      "overwrites it. The snapshot stays open (hidden) until you close_image it.",
    {
      viewId: z.string().describe("View ID to checkpoint"),
      snapshotId: z.string().optional().describe("Name for the snapshot window (default '<viewId>_snap')"),
    },
    async ({ viewId, snapshotId }) => {
      const result = await bridge.sendCommand("snapshot", "__internal__", { viewId, snapshotId });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text" as const,
          text: `Snapshot **${o.snapshotId}** taken from **${viewId}** (${o.width}x${o.height}, ${o.channels}ch). Restore with restore(viewId="${viewId}", snapshotId="${o.snapshotId}").`,
        }],
      };
    }
  );

  // restore, copy a snapshot back into a view (as an undoable step)
  server.tool(
    "restore",
    "Restore a snapshot's pixels back into a view. Geometry must match. The restore is " +
      "itself registered as an undoable history step.",
    {
      viewId: z.string().describe("View ID to restore into"),
      snapshotId: z.string().describe("Snapshot window id from a prior snapshot() call"),
    },
    async ({ viewId, snapshotId }) => {
      const result = await bridge.sendCommand("restore", "__internal__", { viewId, snapshotId });
      if (result.status === "error") return errorContent(result.error.message);
      const o = (result as any).outputs ?? {};
      return {
        content: [{
          type: "text" as const,
          text: `Restored **${viewId}** from snapshot **${snapshotId}** (now history index=${o.historyIndex}; undo to reverse).`,
        }],
      };
    }
  );
}
