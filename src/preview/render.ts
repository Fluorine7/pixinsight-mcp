import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";
import type { BridgeClient } from "../bridge/client.js";
import { execPjsrJson } from "../pjsr/exec.js";
import { renderScript, type StretchMode, type DisplayOptions } from "../pjsr/render.js";
import { embedICC, extractICC } from "./icc.js";

export async function renderToFile(bridge: BridgeClient, viewId: string, outputPath: string, stf: StretchMode,
  rect?: [number, number, number, number], downsample?: number, quality?: number, display: DisplayOptions = {}) {
  const extension = extname(outputPath).toLowerCase();
  if (!isAbsolute(outputPath) || ![".png", ".jpg", ".jpeg"].includes(extension))
    throw new Error("Preview output must be an absolute .png, .jpg or .jpeg path");
  const format = extension === ".png" ? "png" : "jpeg";
  await mkdir(dirname(outputPath), { recursive: true });
  const scratch = await mkdtemp(join(dirname(outputPath), ".mcp-preview-"));
  const staged = join(scratch, "preview" + extension);
  try {
    const result = await execPjsrJson(bridge, renderScript(viewId, staged, stf, rect, downsample, quality,
      display));
    const { iccBase64, ...manifest } = result;
    if (result.colorManagement.status === "awaiting-embedding") {
      if (typeof iccBase64 !== "string") throw new Error("PixInsight did not return the display ICC profile");
      const profile = Buffer.from(iccBase64, "base64");
      const tagged = embedICC(await readFile(staged), profile, format);
      await writeFile(staged, tagged);
      if (!extractICC(await readFile(staged), format).equals(profile)) throw new Error("Exported ICC profile does not match the display profile");
      manifest.colorManagement = { ...result.colorManagement, status: "managed-display", outputICCEmbedded: true,
        outputICCVerified: true, profileBytes: profile.length };
    }
    // Publish only a complete, verified result; a failed render preserves an existing output.
    await rename(staged, outputPath);
    return { ...manifest, path: outputPath };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
