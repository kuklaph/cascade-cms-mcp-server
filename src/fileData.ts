import { createHash } from "node:crypto";

export type FileDataKind =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "pdf"
  | "zip"
  | "unknown";
export type FileDataMimeSource = "magic" | "extension" | "unknown";

export interface BinaryFieldSummary {
  pointer: string;
  bytes_total: number;
  sha256: string;
  detected_kind: FileDataKind;
  mime_type: string;
  mime_source: FileDataMimeSource;
  byte_preview_hex: string;
}

export interface FileDataRange {
  offset: number;
  length: number;
  bytes_total: number;
  has_more: boolean;
  next_offset?: number;
  encoding: "hex" | "base64";
  encoded_bytes: string;
}

export function isFileDataPointer(pointer: string): boolean {
  return pointer === "/asset/file/data" || pointer === "/file/data";
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

export function summarizeFileData(
  data: readonly number[],
  pointer: string,
  filename?: string,
): BinaryFieldSummary {
  const preview = new Uint8Array(Math.min(data.length, 16));
  const hash = createHash("sha256");
  const chunk = new Uint8Array(Math.min(data.length, 8192));
  let chunkLength = 0;

  for (let i = 0; i < data.length; i++) {
    const byte = toUnsignedByte(data[i]!, i);
    if (i < preview.length) preview[i] = byte;
    chunk[chunkLength++] = byte;
    if (chunkLength === chunk.length) {
      hash.update(chunk);
      chunkLength = 0;
    }
  }
  if (chunkLength > 0) {
    hash.update(chunk.subarray(0, chunkLength));
  }

  const detected = detectFileData(preview, filename);
  return {
    pointer,
    bytes_total: data.length,
    sha256: hash.digest("hex"),
    detected_kind: detected.kind,
    mime_type: detected.mimeType,
    mime_source: detected.source,
    byte_preview_hex: hexPreview(preview),
  };
}

export function toUnsignedBytes(data: readonly number[]): Uint8Array {
  return toUnsignedByteSlice(data, 0, data.length);
}

export function toUnsignedByteSlice(
  data: readonly number[],
  offset: number,
  end: number,
): Uint8Array {
  const clampedOffset = clampInteger(offset, 0, data.length);
  const clampedEnd = clampInteger(end, clampedOffset, data.length);
  const bytes = new Uint8Array(clampedEnd - clampedOffset);
  for (let i = clampedOffset; i < clampedEnd; i++) {
    bytes[i - clampedOffset] = toUnsignedByte(data[i]!, i);
  }
  return bytes;
}

export function readFileDataRange(
  data: readonly number[],
  options?: {
    offset?: number;
    length?: number;
    encoding?: "hex" | "base64";
  },
): FileDataRange {
  const offset = clampInteger(options?.offset ?? 0, 0, data.length);
  const requestedLength = clampInteger(options?.length ?? 64, 1, 8192);
  const end = Math.min(data.length, offset + requestedLength);
  const chunk = toUnsignedByteSlice(data, offset, end);
  const encoding = options?.encoding ?? "hex";

  return {
    offset,
    length: chunk.length,
    bytes_total: data.length,
    has_more: end < data.length,
    ...(end < data.length ? { next_offset: end } : {}),
    encoding,
    encoded_bytes:
      encoding === "base64" ? Buffer.from(chunk).toString("base64") : hexEncode(chunk),
  };
}

export function isVerifiedImageSummary(summary: BinaryFieldSummary): boolean {
  return summary.mime_source === "magic" && summary.mime_type.startsWith("image/");
}

function detectFileData(
  bytes: Uint8Array,
  filename: string | undefined,
): { kind: FileDataKind; mimeType: string; source: FileDataMimeSource } {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "jpeg", mimeType: "image/jpeg", source: "magic" };
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { kind: "png", mimeType: "image/png", source: "magic" };
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { kind: "gif", mimeType: "image/gif", source: "magic" };
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { kind: "webp", mimeType: "image/webp", source: "magic" };
  }
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { kind: "pdf", mimeType: "application/pdf", source: "magic" };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return { kind: "zip", mimeType: "application/zip", source: "magic" };
  }

  const lower = filename?.toLowerCase() ?? "";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { kind: "jpeg", mimeType: "image/jpeg", source: "extension" };
  }
  if (lower.endsWith(".png")) {
    return { kind: "png", mimeType: "image/png", source: "extension" };
  }
  if (lower.endsWith(".gif")) {
    return { kind: "gif", mimeType: "image/gif", source: "extension" };
  }
  if (lower.endsWith(".webp")) {
    return { kind: "webp", mimeType: "image/webp", source: "extension" };
  }
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", mimeType: "application/pdf", source: "extension" };
  }

  return { kind: "unknown", mimeType: "application/octet-stream", source: "unknown" };
}

function toUnsignedByte(value: number, index: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`file.data[${index}] must be finite to reconstruct bytes`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`file.data[${index}] must be an integer to reconstruct bytes`);
  }
  if (value < -128 || value > 255) {
    throw new Error(`file.data[${index}] must be between -128 and 255`);
  }
  return value & 0xff;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function hexPreview(bytes: Uint8Array): string {
  return hexEncode(bytes.slice(0, 16));
}

function hexEncode(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}
