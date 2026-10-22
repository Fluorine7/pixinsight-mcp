import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { execPjsrJson, jsonContent, jsonErrorContent } from "../pjsr/exec.js";
import { dimsScript, type DisplayOptions } from "../pjsr/render.js";
import { renderToFile } from "../preview/render.js";
import { noiseScript } from "../pjsr/measure-noise.js";
import { gradientScript } from "../pjsr/measure-gradient.js";
import { neutralityScript } from "../pjsr/measure-neutrality.js";
import { starMetricsScript } from "../pjsr/measure-stars.js";

/**
 * Rendering for QA: the render is the judge; metrics corroborate.
 * render_view produces what eyes (human or reviewer subagent) actually evaluate;
 * render_critic_pack emits a standard image set + metrics.json for blind review
 * (pack only, no transcript).
 */
export function registerRenderTools(server: McpServer, bridge: BridgeClient): void {

  server.tool(
    "render_view",
    "Render an open view to PNG/JPEG for visual inspection. stf:'auto' = PI autostretch computed " +
      "on the FULL image (crops share the full-field stretch), use on LINEAR images only; it " +
      "clamps + warns on a degenerate median (never judge a stars-only layer on 'auto'). " +
      "stf:'asis' = no transform (post-stretch images). stf:'view' = the view's own GUI STF. " +
      "boosted-unlinked computes each RGB channel independently (-1.8 sigma, target 0.5); fixed reuses returned HT rows. " +
      "rect = [x0,y0,x1,y1] source crop at 1:1; downsample = integer reduction factor. " +
      "RGB previews default to native PI display colors with verified embedded monitor ICC. colorMode:raw skips color management for diagnostics; monochrome remains unmanaged. Source pixels/history are preserved.",
    {
      viewId: z.string().describe("View ID to render"),
      colorMode: z.enum(["display", "raw"]).default("display"),
      outputPath: z.string().describe("Absolute output path (.png or .jpg)"),
      stf: z.enum(["auto", "auto-unlinked", "boosted-unlinked", "fixed", "asis", "view"]).default("auto").describe("Stretch mode for the render"),
      referenceViewId: z.string().optional().describe("Compute automatic STF from this same-geometry reference view"),
      fixedStretch: z.record(z.array(z.number().finite()).length(5)).optional().describe("Exact HT rows from an earlier render: keys 0..3, values [shadows,midtones,highlights,low,high]; use stf=fixed"),
      shadowsClipping: z.number().min(-20).max(0).optional(),
      targetBackground: z.number().gt(0).lt(1).optional(),
      rect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
        .describe("Source crop [x0,y0,x1,y1] in image pixels"),
      downsample: z.number().int().min(1).max(16).optional().describe("Integer downsample factor"),
      quality: z.number().int().min(10).max(100).optional().describe("JPEG quality, default 100 (ignored for PNG)"),
    },
    async ({ viewId, outputPath, stf, rect, downsample, quality, referenceViewId, fixedStretch, shadowsClipping, targetBackground, colorMode }) => {
      try {
        return jsonContent(
          await renderToFile(bridge, viewId, outputPath, stf, rect, downsample, quality, { referenceViewId, fixedStretch, shadowsClipping, targetBackground, colorMode })
        );
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );

  server.tool(
    "render_critic_pack",
    "Generate the standard critic pack for a view into outputDir: full.png (downsampled), " +
      "corner-{tl,tr,bl,br}.png + core.png (1:1), stars.png (1:1 at the brightest star), and " +
      "metrics.json (noise, gradient, neutrality, star metrics + render manifest). " +
      "phase:'linear' renders with autostretch; 'poststretch'/'final' render as-is. " +
      "Feed the pack directory to a blind reviewer (no transcript).",
    {
      viewId: z.string().describe("View ID to pack"),
      outputDir: z.string().describe("Absolute directory for the pack (created if missing)"),
      phase: z.enum(["linear", "poststretch", "final"])
        .describe("Processing phase, controls stretch mode and which neutrality metric applies"),
      referenceViewId: z.string().optional().describe("Linear comparison reference: freeze its linked and unlinked Boost rows for the entire pack"),
      faintRect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
        .describe("Optional 1:1 crop of a known faint-signal region → faint.png"),
      starsRect: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional()
        .describe("Override the stars.png crop (default: auto at the brightest star). " +
          "REQUIRED for pairwise packs: both packs must crop the same region"),
    },
    async ({ viewId, outputDir, phase, faintRect, starsRect, referenceViewId }) => {
      try {
        return jsonContent(await generateCriticPack(bridge, viewId, outputDir, phase, faintRect, starsRect, referenceViewId));
      } catch (err) {
        return jsonErrorContent(err);
      }
    }
  );
}

/** Pack generation, exported for direct (non-MCP) use by test/gate scripts. */
export async function generateCriticPack(
  bridge: BridgeClient,
  viewId: string,
  outputDir: string,
  phase: "linear" | "poststretch" | "final",
  faintRect?: [number, number, number, number],
  starsRect?: [number, number, number, number],
  referenceViewId?: string
) {
  await mkdir(outputDir, { recursive: true });
  if (referenceViewId && phase !== "linear") throw new Error("referenceViewId applies to linear packs only");
  const stf = phase === "linear" ? "auto" : "asis";
  const dims = await execPjsrJson(bridge, dimsScript(viewId));
  const W = dims.width as number, H = dims.height as number;

  const renders: Record<string, any> = {};
  let frozen: DisplayOptions | undefined;
  const render = async (name: string, rect?: [number, number, number, number], downsample?: number) => {
    renders[name] = await renderToFile(bridge, viewId, join(outputDir, name), frozen ? "fixed" : stf, rect, downsample, undefined, frozen ?? { referenceViewId });
  };

  // Full field, ~1500px long edge.
  await render("full.png", undefined, Math.max(1, Math.ceil(Math.max(W, H) / 1500)));

  if (phase === "linear") frozen = { fixedStretch: renders["full.png"].stretch };

  // 1:1 crops: corners + core (clamped box helper).
  const box = (cx: number, cy: number, bw: number, bh: number): [number, number, number, number] => {
    const x0 = Math.max(0, Math.min(W - bw, Math.round(cx - bw / 2)));
    const y0 = Math.max(0, Math.min(H - bh, Math.round(cy - bh / 2)));
    return [x0, y0, x0 + Math.min(bw, W), y0 + Math.min(bh, H)];
  };
  const cw = Math.min(900, W), ch = Math.min(640, H);
  await render("corner-tl.png", box(cw / 2, ch / 2, cw, ch));
  await render("corner-tr.png", box(W - cw / 2, ch / 2, cw, ch));
  await render("corner-bl.png", box(cw / 2, H - ch / 2, cw, ch));
  await render("corner-br.png", box(W - cw / 2, H - ch / 2, cw, ch));
  await render("edge-top.png", box(W / 2, ch / 2, cw, ch));
  await render("edge-bottom.png", box(W / 2, H - ch / 2, cw, ch));
  await render("edge-left.png", box(cw / 2, H / 2, cw, ch));
  await render("edge-right.png", box(W - cw / 2, H / 2, cw, ch));
  await render("core.png", box(W / 2, H / 2, cw, ch));
  if (faintRect) await render("faint.png", faintRect);

  // Metrics + brightest-star crop.
  const metrics: Record<string, any> = { viewId, phase, width: W, height: H };
  metrics.noise = await execPjsrJson(bridge, noiseScript(viewId));
  metrics.gradient = await execPjsrJson(bridge, gradientScript(viewId, 5, 0.04));
  if (dims.isColor) {
    try {
      metrics.neutrality = await execPjsrJson(
        bridge,
        neutralityScript(viewId, phase === "linear" ? "linear" : "poststretch", "R", 150000)
      );
    } catch (err) {
      metrics.neutrality = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  metrics.stars = await execPjsrJson(bridge, starMetricsScript(viewId, 200), 600000);
  // Pairwise packs must share starsRect, each pack's auto-pick lands on a different
  // star and the critic ends up comparing different fields (found by the critic itself
  // in the v1 calibration run).
  if (starsRect) {
    await render("stars.png", starsRect);
  } else {
    const bright = metrics.stars?.brightestStars?.[0];
    if (bright) await render("stars.png", box(bright.x, bright.y, Math.min(600, W), Math.min(400, H)));
  }

  if (phase === "linear") {
    // Independently calculated diagnostic Boost plus a frozen reference comparison.
    const originals = Object.entries(renders);
    const boost = await renderToFile(bridge, viewId, join(outputDir, "boost-full.png"), "boosted-unlinked",
      undefined, Math.max(1, Math.ceil(Math.max(W, H) / 1500)));
    renders["boost-full.png"] = boost;
    for (const [name, manifest] of originals) {
      if (name === "full.png") continue;
      renders["boost-" + name] = await renderToFile(bridge, viewId, join(outputDir, "boost-" + name), "fixed",
        manifest.sourceRect, manifest.downsample, undefined, { fixedStretch: boost.stretch });
    }
    if (referenceViewId) {
      const comparison = await renderToFile(bridge, viewId, join(outputDir, "comparison-boost-full.png"),
        "boosted-unlinked", undefined, Math.max(1, Math.ceil(Math.max(W,H)/1500)), undefined, { referenceViewId });
      renders["comparison-boost-full.png"] = comparison;
      for (const [name, manifest] of originals) {
        if (name === "full.png") continue;
        renders["comparison-boost-" + name] = await renderToFile(bridge, viewId, join(outputDir, "comparison-boost-" + name),
          "fixed", manifest.sourceRect, manifest.downsample, undefined, { fixedStretch: comparison.stretch });
      }
    }
  }
  metrics.referenceViewId = referenceViewId ?? null;
  metrics.renders = renders;
  const warnings = Object.values(renders).flatMap((r: any) => r?.warnings ?? []);
  if (warnings.length) metrics.warnings = warnings;
  await writeFile(join(outputDir, "metrics.json"), JSON.stringify(metrics, null, 2), "utf-8");

  return {
    packDir: outputDir,
    files: [...Object.keys(renders), "metrics.json"],
    phase,
    stf,
    warnings,
  };
}
