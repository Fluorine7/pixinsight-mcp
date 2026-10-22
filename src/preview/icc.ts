import { crc32, deflateSync, inflateSync } from "node:zlib";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegICC = Buffer.from("ICC_PROFILE\0", "ascii");
const maxProfileBytes = 4 * 1024 * 1024;

export function validateICC(profile: Buffer): void {
  if (profile.length < 132 || profile.length > maxProfileBytes || profile.readUInt32BE(0) !== profile.length ||
      profile.toString("ascii", 36, 40) !== "acsp" || profile.toString("ascii", 16, 20) !== "RGB ")
    throw new Error("Invalid RGB ICC profile from PixInsight");
}

function pngChunks(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(pngSignature)) throw new Error("Invalid PNG signature");
  const chunks: { type: string; bytes: Buffer; data: Buffer }[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error("PNG CRC mismatch");
    chunks.push({ type, bytes: bytes.subarray(offset, end), data: bytes.subarray(offset + 8, end - 4) });
    offset = end;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length || chunks[0]?.type !== "IHDR" || chunks.at(-1)?.type !== "IEND") throw new Error("Incomplete PNG");
  return chunks;
}

function chunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4, "ascii"); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}

function jpegSegments(bytes: Buffer) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Invalid JPEG signature");
  const segments: { marker: number; bytes: Buffer; data: Buffer }[] = [];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG marker");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) {
      segments.push({ marker, bytes: bytes.subarray(start), data: Buffer.alloc(0) });
      return segments;
    }
    if (offset + 2 > bytes.length) throw new Error("Truncated JPEG");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment size");
    segments.push({ marker, bytes: bytes.subarray(start, offset + length), data: bytes.subarray(offset + 2, offset + length) });
    offset += length;
  }
  throw new Error("Incomplete JPEG");
}

/** Preserve encoded pixels; replace only color metadata after PI applied its display transformation. */
export function embedICC(bytes: Buffer, profile: Buffer, format: "png" | "jpeg"): Buffer {
  validateICC(profile);
  if (format === "png") {
    const chunks = pngChunks(bytes).filter((c) => !["iCCP", "sRGB", "gAMA", "cHRM", "cICP", "mDCv", "cLLi"].includes(c.type));
    const iccp = chunk("iCCP", Buffer.concat([Buffer.from("PixInsight display\0\0", "ascii"), deflateSync(profile)]));
    return Buffer.concat([pngSignature, chunks[0].bytes, iccp, ...chunks.slice(1).map((c) => c.bytes)]);
  }
  const segments = jpegSegments(bytes).filter((s) => !(s.marker === 0xe2 && s.data.subarray(0, 12).equals(jpegICC)));
  const payload = 65519, count = Math.ceil(profile.length / payload), app2: Buffer[] = [];
  for (let index = 0; index < count; index++) {
    const data = Buffer.concat([jpegICC, Buffer.from([index + 1, count]), profile.subarray(index * payload, (index + 1) * payload)]);
    const segment = Buffer.alloc(data.length + 4);
    segment[0] = 0xff; segment[1] = 0xe2; segment.writeUInt16BE(data.length + 2, 2); data.copy(segment, 4); app2.push(segment);
  }
  // Keep JFIF/Exif identification immediately after SOI, as their formats require.
  let insertion = 0;
  while (insertion < segments.length && [0xe0, 0xe1].includes(segments[insertion].marker)) insertion++;
  return Buffer.concat([bytes.subarray(0, 2), ...segments.slice(0, insertion).map((s) => s.bytes),
    ...app2, ...segments.slice(insertion).map((s) => s.bytes)]);
}

/** Read the actual output container for the verification step. */
export function extractICC(bytes: Buffer, format: "png" | "jpeg"): Buffer {
  if (format === "png") {
    const profiles = pngChunks(bytes).filter((c) => c.type === "iCCP");
    if (profiles.length !== 1) throw new Error("Expected exactly one PNG ICC profile");
    const data = profiles[0].data, end = data.indexOf(0);
    if (end < 1 || end > 79 || data[end + 1] !== 0) throw new Error("Invalid PNG ICC header");
    return inflateSync(data.subarray(end + 2), { maxOutputLength: maxProfileBytes });
  }
  const parts = jpegSegments(bytes).filter((s) => s.marker === 0xe2 && s.data.subarray(0, 12).equals(jpegICC))
    .map((s) => s.data).sort((a, b) => a[12] - b[12]);
  if (!parts.length || parts.some((p, i) => p[12] !== i + 1 || p[13] !== parts.length)) throw new Error("Incomplete JPEG ICC profile");
  return Buffer.concat(parts.map((p) => p.subarray(14)));
}
