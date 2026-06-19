import { describe, test, expect } from "bun:test";
import { registerReadResponseTool } from "../../../src/tools/readResponse.js";
import { ReadResponseRequestSchema } from "../../../src/schemas/requests.js";
import { createResponseCache } from "../../../src/cache.js";
import { CHARACTER_LIMIT } from "../../../src/constants.js";
import { makeMockServer, findTool, firstText } from "../../fixtures/mock-server.js";

function parsedText(result: { content: Array<{ type: string; text?: string }> }): any {
  return JSON.parse(firstText(result as any));
}

describe("registerReadResponseTool: registration", () => {
  test("registers read_response with read-only annotations", () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.openWorldHint).toBe(false);
    expect(tool.config.description).toContain("read_response");
  });
});

describe("read_response handler", () => {
  test("returns slice_text in JSON text and structuredContent", async () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();
    const fullText = "abcdefghij".repeat(50);
    const handle = cache.put("read", fullText);

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    const result = await tool.handler({ handle, offset: 0, length: 100 });
    const textBody = parsedText(result);
    const sc = result.structuredContent as Record<string, unknown>;

    expect(textBody.slice_text).toBe(fullText.slice(0, 100));
    expect(sc.slice_text).toBe(fullText.slice(0, 100));
    expect(sc.handle).toBe(handle);
    expect(sc.bytes_total).toBe(fullText.length);
    expect(sc.offset).toBe(0);
    expect(sc.bytes_returned).toBe(100);
    expect(sc.has_more).toBe(true);
    expect(sc.next_offset).toBe(100);
    expect(Array.isArray(sc.next_actions)).toBe(true);
  });

  test("supports later chunks and omits next_offset at end", async () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();
    const fullText = "X".repeat(50) + "Y".repeat(50);
    const handle = cache.put("read", fullText);

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    const result = await tool.handler({ handle, offset: 50, length: 50 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.slice_text).toBe("Y".repeat(50));
    expect(sc.bytes_returned).toBe(50);
    expect(sc.has_more).toBe(false);
    expect(sc.next_offset).toBeUndefined();
  });

  test("shrinks large slices so JSON response text stays under the MCP character limit", async () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();
    const fullText = '"\\\n'.repeat(30000);
    const handle = cache.put("read", fullText);

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    const result = await tool.handler({
      handle,
      offset: 0,
      length: CHARACTER_LIMIT,
    });
    const text = firstText(result as any);
    const sc = result.structuredContent as Record<string, unknown>;

    expect(text.length).toBeLessThanOrEqual(CHARACTER_LIMIT);
    expect(sc.bytes_returned).toBeLessThan(CHARACTER_LIMIT);
    expect(sc.slice_text).toBe(fullText.slice(0, sc.bytes_returned as number));
    expect(sc.has_more).toBe(true);
  });

  test("offset past end returns empty slice metadata", async () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();
    const handle = cache.put("read", "small");

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    const result = await tool.handler({ handle, offset: 100, length: 25 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.slice_text).toBe("");
    expect(sc.bytes_returned).toBe(0);
    expect(sc.has_more).toBe(false);
    expect(sc.next_offset).toBeUndefined();
  });

  test("unknown handle returns JSON tool error", async () => {
    const { server, tools } = makeMockServer();
    const cache = createResponseCache();

    registerReadResponseTool(server as any, { cache });

    const tool = findTool(tools, "read_response");
    const result = await tool.handler({
      handle: "h_deadbeef",
      offset: 0,
      length: 100,
    });
    const body = parsedText(result);

    expect(result.isError).toBe(true);
    expect(body.error.message).toContain("h_deadbeef");
    expect(body.error.message.toLowerCase()).toContain("not found");
  });
});

describe("ReadResponseRequestSchema", () => {
  test("accepts a valid request and applies defaults", () => {
    const res = ReadResponseRequestSchema.safeParse({ handle: "h_abc" });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.offset).toBe(0);
      expect(res.data.length).toBe(CHARACTER_LIMIT);
    }
  });

  test("rejects invalid handle, offset, and length", () => {
    expect(ReadResponseRequestSchema.safeParse({ handle: "" }).success).toBe(false);
    expect(
      ReadResponseRequestSchema.safeParse({ handle: "h_abc", offset: -1 }).success,
    ).toBe(false);
    expect(
      ReadResponseRequestSchema.safeParse({
        handle: "h_abc",
        length: CHARACTER_LIMIT + 1,
      }).success,
    ).toBe(false);
  });
});
