import { describe, expect, test } from "bun:test";
import {
  readFileDataRange,
  summarizeFileData,
  toSignedFileData,
  toUnsignedBytes,
} from "../../src/fileData.js";

describe("file data helpers", () => {
  test("normalizes signed Cascade bytes and detects JPEG data by magic bytes", () => {
    const summary = summarizeFileData(
      [-1, -40, -1, -31, 0, 16, 69, 120, 105, 102],
      "/asset/file/data",
      "wrong.pdf",
    );

    expect([...toUnsignedBytes([-1, -40, -1, -31])]).toEqual([
      255,
      216,
      255,
      225,
    ]);
    expect(summary.detected_kind).toBe("jpeg");
    expect(summary.mime_type).toBe("image/jpeg");
    expect(summary.mime_source).toBe("magic");
    expect(summary.byte_preview_hex).toBe("ff d8 ff e1 00 10 45 78 69 66");
    expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("detects PDF data by magic bytes", () => {
    const summary = summarizeFileData(
      [37, 80, 68, 70, 45, 49, 46, 51],
      "/asset/file/data",
      "file.bin",
    );

    expect(summary.detected_kind).toBe("pdf");
    expect(summary.mime_type).toBe("application/pdf");
    expect(summary.mime_source).toBe("magic");
  });

  test("falls back to file extension when magic bytes are unknown", () => {
    const summary = summarizeFileData([1, 2, 3], "/asset/file/data", "hero.png");

    expect(summary.detected_kind).toBe("png");
    expect(summary.mime_type).toBe("image/png");
    expect(summary.mime_source).toBe("extension");
  });

  test("rejects non-integer and out-of-byte-range values when reconstructing bytes", () => {
    expect(() => toUnsignedBytes([1.5])).toThrow("integer");
    expect(() => toUnsignedBytes([256])).toThrow("between -128 and 255");
    expect(() => toUnsignedBytes([-129])).toThrow("between -128 and 255");
    expect(() => toUnsignedBytes([Number.POSITIVE_INFINITY])).toThrow("finite");
  });

  test("normalizes unsigned file bytes to signed Cascade bytes for writes", () => {
    expect(toSignedFileData([255, 216, 255, 225, 128, 127, 0])).toEqual([
      -1,
      -40,
      -1,
      -31,
      -128,
      127,
      0,
    ]);
    expect(toSignedFileData(new Uint8Array([255, 216, 0]))).toEqual([
      -1,
      -40,
      0,
    ]);
  });

  test("preserves existing signed Cascade bytes for writes", () => {
    expect(toSignedFileData([-128, -1, 0, 127])).toEqual([-128, -1, 0, 127]);
  });

  test("rejects invalid values when normalizing file data for writes", () => {
    expect(() => toSignedFileData([1.5])).toThrow("integer");
    expect(() => toSignedFileData([256])).toThrow("between -128 and 255");
    expect(() => toSignedFileData([-129])).toThrow("between -128 and 255");
    expect(() => toSignedFileData([Number.POSITIVE_INFINITY])).toThrow("finite");
  });

  test("reads bounded byte ranges as hex or base64", () => {
    const hex = readFileDataRange([-1, -40, -1, -31], {
      offset: 1,
      length: 2,
      encoding: "hex",
    });
    const base64 = readFileDataRange([-1, -40, -1, -31], {
      offset: 0,
      length: 4,
      encoding: "base64",
    });

    expect(hex).toEqual({
      offset: 1,
      length: 2,
      bytes_total: 4,
      has_more: true,
      next_offset: 3,
      encoding: "hex",
      encoded_bytes: "d8 ff",
    });
    expect(base64).toEqual({
      offset: 0,
      length: 4,
      bytes_total: 4,
      has_more: false,
      encoding: "base64",
      encoded_bytes: "/9j/4Q==",
    });
  });

  test("hex range reads return the complete requested chunk", () => {
    const data = Array.from({ length: 20 }, (_, index) => index);
    const range = readFileDataRange(data, {
      offset: 0,
      length: 20,
      encoding: "hex",
    });

    expect(range.encoded_bytes).toBe(
      "00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13",
    );
    expect(range.length).toBe(20);
  });

  test("range reads only validate bytes inside the requested slice", () => {
    const range = readFileDataRange([1, 2, 999], {
      offset: 0,
      length: 2,
      encoding: "hex",
    });

    expect(range.encoded_bytes).toBe("01 02");
  });
});
