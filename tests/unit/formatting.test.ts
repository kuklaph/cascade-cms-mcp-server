import { describe, test, expect } from "bun:test";
import { formatResponse } from "../../src/formatting.js";
import { createResponseCache } from "../../src/cache.js";
import { CHARACTER_LIMIT, PREVIEW_LIMIT } from "../../src/constants.js";
import type { CallToolResult } from "@modelcontextprotocol/server";

function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be of type 'text'");
  }
  return block.text;
}

function parsedText(r: CallToolResult): unknown {
  return JSON.parse(firstText(r));
}

describe("formatResponse", () => {
  test("emits JSON text that matches structuredContent for object results", () => {
    const result = { success: true, foo: 42, nested: { a: [1, 2, 3] } };

    const out = formatResponse(result, "tool");

    expect(parsedText(out)).toEqual(result);
    expect(out.structuredContent).toEqual(result);
  });

  test("wraps primitive results in structuredContent.value", () => {
    const out = formatResponse("hello", "tool");

    expect(parsedText(out)).toEqual({ value: "hello" });
    expect(out.structuredContent).toEqual({ value: "hello" });
  });

  test("uses empty structured content for null and undefined results", () => {
    const outNull = formatResponse(null, "tool");
    const outUndef = formatResponse(undefined, "tool");

    expect(parsedText(outNull)).toEqual({});
    expect(parsedText(outUndef)).toEqual({});
    expect(outNull.structuredContent).toEqual({});
    expect(outUndef.structuredContent).toEqual({});
  });

  test("always returns a text content block with valid JSON", () => {
    const cases: unknown[] = [
      null,
      undefined,
      { success: true },
      { success: true, matches: [{ id: "a", type: "page", path: { path: "/" } }] },
      "string result",
      42,
    ];

    for (const c of cases) {
      const out = formatResponse(c, "tool");
      expect(out.content[0]?.type).toBe("text");
      expect(() => JSON.parse(firstText(out))).not.toThrow();
    }
  });

  test("uses JSON preview envelope and cache handle for oversize responses", () => {
    const cache = createResponseCache();
    const big = {
      success: true,
      matches: Array.from({ length: 3000 }, (_, i) => ({
        id: `id-${i}`,
        type: "page",
        path: { path: `/p/${i}` },
      })),
    };

    const out = formatResponse(big, "search", { cache });
    const textPayload = parsedText(out) as Record<string, unknown>;
    const structured = out.structuredContent as Record<string, unknown>;
    const envelope = structured._cache as Record<string, unknown>;

    expect(textPayload.truncated).toBe(true);
    expect(typeof textPayload.preview).toBe("string");
    expect((textPayload.preview as string).length).toBeLessThanOrEqual(PREVIEW_LIMIT);
    expect((textPayload.preview as string).length).toBe(
      textPayload.bytes_returned as number,
    );
    expect(firstText(out).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(textPayload.handle).toEqual(envelope.handle);
    expect(textPayload.tool).toBe("read_response");
    expect(envelope.bytes_total).toBe(cache.get(envelope.handle as string)!.fullText.length);
    expect(structured.success).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.matches).toBeUndefined();
  });

  test("sizes oversize envelopes after JSON encoding so escaped previews stay under the limit", () => {
    const cache = createResponseCache();
    const big = { success: true, text: '"\\\n'.repeat(30000) };

    const out = formatResponse(big, "read_response", { cache });
    const textPayload = parsedText(out) as Record<string, unknown>;

    expect(firstText(out).length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect((textPayload.preview as string).length).toBeLessThan(PREVIEW_LIMIT);
    expect(textPayload.bytes_returned).toBe((textPayload.preview as string).length);
  });

  test("returns JSON preview envelope without handle when oversize and cache is omitted", () => {
    const big = {
      success: true,
      matches: Array.from({ length: 3000 }, (_, i) => ({ id: `id-${i}` })),
    };

    const out = formatResponse(big, "search");
    const textPayload = parsedText(out) as Record<string, unknown>;
    const structured = out.structuredContent as Record<string, unknown>;

    expect(textPayload.truncated).toBe(true);
    expect(textPayload.handle).toBeUndefined();
    expect(structured._cache).toBeDefined();
    expect(structured.matches).toBeUndefined();
  });

  test("does not touch cache or add _cache when text fits under the limit", () => {
    const cache = createResponseCache();
    const small = { success: true, id: "abc" };

    const out = formatResponse(small, "tool", { cache });

    expect(cache.size()).toBe(0);
    expect((out.structuredContent as Record<string, unknown>)._cache).toBeUndefined();
  });
});
