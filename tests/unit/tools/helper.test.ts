import { describe, test, expect, mock } from "bun:test";
import { z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  buildCascadeToolDescription,
  registerCascadeTool,
} from "../../../src/tools/helper.js";
import { createResponseCache } from "../../../src/cache.js";
import type { ToolBlockRule, ToolBlockStore } from "../../../src/toolBlocks.js";

interface MockServer {
  registerTool: ReturnType<typeof mock>;
}

function makeMockServer(): MockServer {
  return {
    registerTool: mock(() => ({})),
  };
}

const SampleSchema = z
  .object({
    name: z.string(),
    count: z.number().default(1),
  })
  .strict();

const EnumSchema = z
  .object({
    mode: z.enum(["preview", "raw"]),
  })
  .strict();

const RefinedSchema = z
  .object({
    originalSiteId: z.string().optional(),
    originalSiteName: z.string().optional(),
    newSiteName: z.string(),
  })
  .strict()
  .refine((v) => v.originalSiteId || v.originalSiteName, {
    message: "Either originalSiteId or originalSiteName must be provided",
    path: ["originalSiteId"],
  });

const EntitySchema = z
  .object({
    identifier: z.object({ type: z.string(), id: z.string() }).strict(),
  })
  .strict();

const SAMPLE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function firstText(r: CallToolResult): string {
  const block = r.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected first content block to be type 'text'");
  }
  return block.text;
}

function parsedText(r: CallToolResult): unknown {
  return JSON.parse(firstText(r));
}

function makeToolBlockStore(rules: ToolBlockRule[]): ToolBlockStore {
  return {
    path: "C:\\tmp\\tool-blocks.json",
    read: mock(async () => rules),
    write: mock(async () => {}),
  };
}

describe("registerCascadeTool", () => {
  test("registers loose SDK metadata so project validation owns strict errors", () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "cascade_site_copy",
      title: "Copy Site",
      description: "desc",
      inputSchema: RefinedSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const call = server.registerTool.mock.calls[0];
    expect(call[0]).toBe("cascade_site_copy");
    expect(Object.keys(call[1].inputSchema.shape)).toEqual([
      "originalSiteId",
      "originalSiteName",
      "newSiteName",
    ]);
    expect(
      call[1].inputSchema.safeParse({
        newSiteName: 123,
        response_format: "json",
      }).success,
    ).toBe(true);
  });

  test("passes parsed input with defaults to the handler and emits JSON text", async () => {
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

    const result = await wrapped({ name: "alice" });

    expect(handler).toHaveBeenCalledWith({ name: "alice", count: 1 });
    expect(parsedText(result)).toEqual({
      success: true,
      got: { name: "alice", count: 1 },
    });
  });

  test("rejects unknown top-level fields before handler or tool-block checks", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));
    const toolBlockStore = makeToolBlockStore([]);

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
      { cache: createResponseCache(), toolBlockStore },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ name: "alice", response_format: "markdown" });
    const body = parsedText(result) as Record<string, any>;

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(toolBlockStore.read).not.toHaveBeenCalled();
    expect(body.error.type).toBe("validation_error");
    expect(body.error.valid_fields).toEqual(["name", "count"]);
    expect(body.error.issues[0].code).toBe("unrecognized_keys");
    expect(body.error.issues[0].hint).toContain("response_format");
    expect(result.structuredContent).toEqual(body);
  });

  test("enforces refined schemas before calling the handler", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "cascade_site_copy",
      title: "Copy Site",
      description: "desc",
      inputSchema: RefinedSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ newSiteName: "copy" });
    const body = parsedText(result) as Record<string, any>;

    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(body.error.issues[0].path).toBe("originalSiteId");
  });

  test("redacts secret-like values from validation errors", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));

    registerCascadeTool(server as any, {
      name: "cascade_sample",
      title: "Sample",
      description: "desc",
      inputSchema: EnumSchema,
      annotations: SAMPLE_ANNOTATIONS,
      handler,
    });

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ mode: "sk-testsecret123456" });
    const body = parsedText(result) as Record<string, any>;
    const issue = body.error.issues[0];

    expect(result.isError).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-testsecret123456");
    expect(issue.message).toContain("[REDACTED]");
    expect(handler).not.toHaveBeenCalled();
  });

  test("checks tool-block rules after validation and before handler", async () => {
    const server = makeMockServer();
    const handler = mock(async () => ({ success: true }));
    const toolBlockStore = makeToolBlockStore([
      {
        type: "site",
        id: "site-123",
        tools: ["cascade_remove"],
        reason: "Production site is protected",
      },
    ]);

    registerCascadeTool(
      server as any,
      {
        name: "cascade_remove",
        title: "Remove",
        description: "desc",
        inputSchema: EntitySchema,
        annotations: SAMPLE_ANNOTATIONS,
        handler,
      },
      { cache: createResponseCache(), toolBlockStore },
    );

    const wrapped = server.registerTool.mock.calls[0][2] as (
      input: unknown,
    ) => Promise<CallToolResult>;

    const result = await wrapped({ identifier: { type: "site", id: "site-123" } });

    expect(toolBlockStore.read).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(parsedText(result)).toMatchObject({
      success: false,
      error: { type: "tool_error", tool: "cascade_remove" },
    });
  });

  test("threads deps.cache into JSON-only formatting for oversize results", async () => {
    const server = makeMockServer();
    const payload = "x".repeat(30_000);
    const handler = mock(async () => ({ success: true, payload }));
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

    const result = await wrapped({ name: "x" });
    const sc = result.structuredContent as Record<string, any>;

    expect(sc._cache.handle.startsWith("h_")).toBe(true);
    expect(sc._cache.tool).toBe("cascade_read_response");
    expect(cache.size()).toBe(1);
  });
});

describe("buildCascadeToolDescription", () => {
  test("describes JSON text and structuredContent without response_format", () => {
    const desc = buildCascadeToolDescription("Do the thing.");

    expect(desc).toContain("Responses are JSON text");
    expect(desc).toContain("structuredContent is authoritative");
    expect(desc).not.toContain("response_format");
  });
});
