import { describe, test, expect, mock } from "bun:test";
import { z } from "zod";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  registerCascadeTool,
  buildCascadeToolDescription,
} from "../../../src/tools/helper.js";
import { createResponseCache } from "../../../src/cache.js";
import { CHARACTER_LIMIT } from "../../../src/constants.js";
import type { ToolBlockRule, ToolBlockStore } from "../../../src/toolBlocks.js";

/** Minimal shape we require of McpServer for registerTool. */
interface MockServer {
  registerTool: ReturnType<typeof mock>;
}

function makeMockServer(): MockServer {
  return {
    registerTool: mock(() => ({})),
  };
}

/** Sample schema with response_format for most tests. */
const SampleSchema = z
  .object({
    name: z.string(),
    count: z.number().optional(),
    response_format: z.enum(["markdown", "json"]).default("markdown"),
  })
  .strict();

const SAMPLE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** First text block text accessor. */
function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be type 'text'");
  }
  return block.text;
}

function makeToolBlockStore(rules: ToolBlockRule[]): ToolBlockStore {
  return {
    path: "C:\\tmp\\tool-blocks.json",
    read: mock(async () => rules),
    write: mock(async () => {}),
  };
}

describe("registerCascadeTool", () => {
  test("should call server.registerTool with correct name, title, description, inputSchema (as .shape), and annotations", () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample Tool",
      description: "A sample tool for testing",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    expect(server.registerTool).toHaveBeenCalledTimes(1);
    const call = server.registerTool.mock.calls[0];
    expect(call[0]).toBe("cascade_sample");

    const config = call[1] as {
      title: string;
      description: string;
      inputSchema: unknown;
      annotations: ToolAnnotations;
    };
    expect(config.title).toBe("Sample Tool");
    expect(config.description).toBe("A sample tool for testing");
    // inputSchema must be `.shape` (ZodRawShape), not the full ZodObject
    expect(config.inputSchema).toBe(SampleSchema.shape);
    expect(config.annotations).toEqual(SAMPLE_ANNOTATIONS);

    // Callback must be a function
    expect(typeof call[2]).toBe("function");
  });

  test("should invoke config.handler with input minus response_format", async () => {
    const server = makeMockServer();
    const handler = mock(async (input: unknown) => ({ success: true, got: input }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    await wrapped({ name: "alice", count: 5, response_format: "markdown" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ name: "alice", count: 5 });
  });

  test("should block a denied tool call by asset id before invoking handler", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_remove",
        title: "Remove",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            type: "site",
            id: ["site-123", "site-456"],
            tools: ["cascade_remove", "cascade_edit"],
            reason: "Production site is protected",
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      identifier: { type: "site", id: "site-123" },
      response_format: "markdown",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Tool call denied");
    expect(firstText(result)).toContain("Production site is protected");
  });

  test("should block a denied tool call by asset path", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_remove",
        title: "Remove",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            type: "site",
            path: ["Protected Site", "Archived Site"],
            tools: ["cascade_remove"],
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      identifier: {
        type: "site",
        path: { path: "Protected Site", siteName: "Protected Site" },
      },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test("should block a denied tool call by asset url", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_edit",
        title: "Edit",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            url: [
              "https://college.cascadecms.com/entity/open.act?id=link-1&type=symlink",
              "https://college.cascadecms.com/entity/open.act?id=link-2&type=symlink",
            ],
            tools: ["cascade_edit"],
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      asset: {
        symlink: {
          id: "link-1",
          linkURL: "https://example.edu/protected",
        },
      },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  test("should not treat external published URLs as Cascade URL selectors", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_edit",
        title: "Edit",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            url: "https://example.edu/protected",
            tools: ["cascade_edit"],
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      asset: {
        symlink: {
          id: "link-1",
          linkURL: "https://example.edu/protected",
        },
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).not.toBe(true);
  });

  test("should allow the same tool when asset type does not match the deny rule", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_remove",
        title: "Remove",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            type: "site",
            id: "site-123",
            tools: ["cascade_remove"],
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      identifier: { type: "page", id: "site-123" },
      response_format: "markdown",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).not.toBe(true);
  });

  test("should allow a matched asset when the tool is not in the deny rule tools list", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(
      server as any,
      {
        name: "cascade_read",
        title: "Read",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore: makeToolBlockStore([
          {
            type: "site",
            id: "site-123",
            tools: ["cascade_remove", "cascade_edit"],
          },
        ]),
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      identifier: { type: "site", id: "site-123" },
      response_format: "markdown",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).not.toBe(true);
  });

  test("should fail closed when the tool block repository cannot be read", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));
    const toolBlockStore: ToolBlockStore = {
      path: "C:\\tmp\\tool-blocks.json",
      read: mock(async () => {
        throw new Error("Invalid tool block repository");
      }),
      write: mock(async () => {}),
    };

    registerCascadeTool(
      server as any,
      {
        name: "cascade_edit",
        title: "Edit",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore,
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      asset: { page: { id: "page-1" } },
      response_format: "markdown",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Invalid tool block repository");
  });

  test("should not consult the tool block repository for asset sub-read tools", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));
    const toolBlockStore = makeToolBlockStore([
      {
        type: "page",
        id: "page-1",
        tools: ["cascade_asset_get_value"],
      },
    ]);

    registerCascadeTool(
      server as any,
      {
        name: "cascade_asset_get_value",
        title: "Get Value",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      {
        cache: createResponseCache(),
        toolBlockStore,
      },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({
      asset_handle: "a_123",
      pointer: "/asset",
      response_format: "markdown",
    });

    expect(toolBlockStore.read).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.isError).not.toBe(true);
  });

  test("should return a formatted success response when the handler resolves with a result", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true, message: "hello" }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    expect(result.isError).not.toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.structuredContent).toEqual({ success: true, message: "hello" });
  });

  test("should translate thrown errors into an isError result via translateError", async () => {
    const server = makeMockServer();
    const handler = mock(async () => {
      throw new Error("Request Failed. Request Response: Upstream exploded");
    });

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_sample");
    expect(text).toContain("Upstream exploded");
  });

  test("should default response_format to 'markdown' when not present in input", async () => {
    const server = makeMockServer();
    // Handler returns a simple object so renderJson vs markdown clearly differs
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    // Intentionally omit response_format — SDK would have applied default but helper must default as well
    const result = await wrapped({ name: "x" });

    const text = firstText(result);
    // Markdown form contains the tool name + "succeeded"; JSON would be strict JSON
    expect(text).toContain("cascade_sample");
    expect(text.toLowerCase()).toContain("succeeded");
  });

  test("should use JSON formatting when response_format='json' and produce valid JSON text", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true, id: "abc" }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "json" });

    const text = firstText(result);
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ success: true, id: "abc" });
  });

  test("should invoke the renderMarkdown override when provided in markdown mode", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true, thing: "wumbo" }));
    const renderMarkdown = mock((r: unknown) => {
      const rec = r as { thing: string };
      return `# Custom: ${rec.thing}`;
    });

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
      renderMarkdown,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    expect(renderMarkdown).toHaveBeenCalledTimes(1);
    const text = firstText(result);
    expect(text).toContain("# Custom: wumbo");
  });

  // ---------------------------------------------------------------------------
  // deps threading: verifies that the optional 3rd `deps` param flows the
  // cache all the way into `formatResponse`. Indirect proof: when a handler
  // returns an oversize result, the captured CallToolResult should include
  // the `_cache` envelope that formatResponse only builds when it has a cache.
  // ---------------------------------------------------------------------------

  test("should thread deps.cache into formatResponse (oversize result mints handle)", async () => {
    const server = makeMockServer();
    const huge = "x".repeat(CHARACTER_LIMIT + 5_000);
    // Use a custom renderMarkdown so the raw huge string becomes the rendered text.
    const handler = mock(async () => ({ success: true, payload: huge }));
    const renderMarkdown = (_r: unknown) => huge;
    const cache = createResponseCache();

    registerCascadeTool(
      server as any,
      {
        name: "cascade_sample",
        title: "Sample",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
        renderMarkdown,
      },
      { cache },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    // Proof of threading: formatResponse attached `_cache` envelope to structuredContent.
    const sc = result.structuredContent as Record<string, unknown> | undefined;
    expect(sc).toBeDefined();
    const envelope = sc?._cache as Record<string, unknown> | undefined;
    expect(envelope).toBeDefined();
    expect(typeof envelope?.handle).toBe("string");
    expect((envelope?.handle as string).length).toBeGreaterThan(0);
    expect((envelope?.handle as string).startsWith("h_")).toBe(true);
    expect(envelope?.tool).toBe("cascade_read_response");
    expect(cache.size()).toBe(1);
  });

  test("should NOT attach _cache envelope when deps is omitted (back-compat)", async () => {
    const server = makeMockServer();
    const huge = "y".repeat(CHARACTER_LIMIT + 5_000);
    const handler = mock(async () => ({ success: true, payload: huge }));
    const renderMarkdown = (_r: unknown) => huge;

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: SampleSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
      renderMarkdown,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    const sc = result.structuredContent as Record<string, unknown> | undefined;
    expect(sc).toBeDefined();
    expect(sc?._cache).toBeUndefined();
  });

  test("should NOT mint a handle when deps provided but result fits under limit", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true, small: "ok" }));
    const cache = createResponseCache();

    registerCascadeTool(
      server as any,
      {
        name: "cascade_sample",
        title: "Sample",
        description: "desc",
        inputSchema: SampleSchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      { cache },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "x", response_format: "markdown" });

    const sc = result.structuredContent as Record<string, unknown> | undefined;
    expect(sc?._cache).toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});

describe("buildCascadeToolDescription", () => {
  test("should produce a description that appends consistent footer text about response_format", () => {
    const desc = buildCascadeToolDescription("Do the thing.");

    expect(desc.startsWith("Do the thing.")).toBe(true);
    // Must mention response_format choices
    expect(desc).toContain("response_format");
    expect(desc).toContain("markdown");
    expect(desc).toContain("json");
  });
});
