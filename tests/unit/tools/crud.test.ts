import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { registerCrudTools } from "../../../src/tools/crud.js";
import {
  ReadRequestSchema,
  AssetSearchPathsRequestSchema,
  AssetListChildrenRequestSchema,
  AssetGetNodeRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
} from "../../../src/schemas/requests.js";
import { createMockClient } from "../../fixtures/mock-client.js";
import {
  makeMockServer,
  findTool,
  firstText,
} from "../../fixtures/mock-server.js";
import {
  OK_RESULT,
  CREATE_OK,
  READ_PAGE_OK,
  READ_PAGE_HUGE,
} from "../../fixtures/cascade-responses.js";


// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const ID_PAGE = { id: "abc123", type: "page" as const };
const VALID_ASSET = {
  page: {
    type: "page" as const,
    name: "index",
    parentFolderPath: "/",
    siteName: "my-site",
    contentTypePath: "/content-types/default",
  },
};

// =============================================================================
// cascade_read
// =============================================================================

describe("cascade_read tool", () => {
  test("preview default: calls client.read and returns compact handle-based preview", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);

    const tool = findTool(tools, "cascade_read");
    expect(tool.config.annotations.readOnlyHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
      response_format: "markdown",
    });

    expect(client.read).toHaveBeenCalledTimes(1);
    expect(client.read.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset_type).toBe("page");
    expect(structured.raw_resource_uri).toBe(
      `cascade://asset/${structured.asset_handle}/raw`,
    );
    expect(structured.node_count).toBe(100);
    expect(structured.asset).toBeUndefined();
    expect(structured.root_outline).toHaveLength(20);

    const link = result.content.find((block) => block.type === "resource_link");
    expect(link).toMatchObject({
      type: "resource_link",
      uri: structured.raw_resource_uri,
      name: "Cascade raw asset JSON",
      mimeType: "application/json",
    });
  });

  test("schema validation: rejects input missing required identifier field", () => {
    const parsed = ReadRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError result via translateError", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.reject(new Error("Request Failed. Request Response: Not Found"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain("cascade_read");
    expect(text).toContain("Not Found");
  });

  test("read_mode: 'raw' returns identical raw response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");

    const result = await tool.handler({
      identifier: { id: "huge-page-id", type: "page" },
      read_mode: "raw",
      response_format: "json",
    });

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset).toEqual(READ_PAGE_HUGE.asset);
  });

  test("SDK-validated omitted read_mode uses preview by default", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");
    const parsedInput = z.object(tool.config.inputSchema as any).parse({
      identifier: { id: "huge-page-id", type: "page" },
      response_format: "json",
    });

    const result = await tool.handler(parsedInput);

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset).toBeUndefined();
  });

  test("follow-up tools inspect the cached asset handle without calling Cascade again", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const read = findTool(tools, "cascade_read");
    const search = findTool(tools, "cascade_asset_search_paths");
    const list = findTool(tools, "cascade_asset_list_children");
    const get = findTool(tools, "cascade_asset_get_node");

    const result = await read.handler({
      identifier: { id: "huge-page-id", type: "page" },
      response_format: "markdown",
    });
    const handle = (result.structuredContent as Record<string, any>).asset_handle;

    const searchResult = await search.handler({
      asset_handle: handle,
      query: "node-1",
      response_format: "json",
    });
    const listResult = await list.handler({
      asset_handle: handle,
      pointer: "",
      limit: 5,
      response_format: "json",
    });
    const firstPointer = (listResult.structuredContent as Record<string, any>)
      .children[0].pointer;
    const getResult = await get.handler({
      asset_handle: handle,
      pointer: firstPointer,
      depth: 0,
      response_format: "json",
    });

    expect(searchResult.isError).not.toBe(true);
    expect(
      typeof (searchResult.structuredContent as Record<string, any>).matches[0]
        .pointer,
    ).toBe("string");
    expect((listResult.structuredContent as Record<string, any>).children).toHaveLength(5);
    expect((getResult.structuredContent as Record<string, any>).pointer).toBe(
      firstPointer,
    );
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  test("follow-up tools return actionable errors for missing handles", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_asset_get_node");

    const result = await tool.handler({
      asset_handle: "a_00000000-0000-0000-0000-000000000000",
      pointer: "",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_asset_get_node");
    expect(firstText(result)).toContain("not found");
  });

  test("asset follow-up schemas require asset_handle", () => {
    expect(AssetSearchPathsRequestSchema.safeParse({ query: "x" }).success).toBe(
      false,
    );
    expect(AssetListChildrenRequestSchema.safeParse({ pointer: "" }).success).toBe(
      false,
    );
    expect(AssetGetNodeRequestSchema.safeParse({ pointer: "" }).success).toBe(
      false,
    );
  });
});

// =============================================================================
// cascade_create
// =============================================================================

describe("cascade_create tool", () => {
  test("happy path: calls client.create and returns created id", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      create: mock(() => Promise.resolve(CREATE_OK)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_create");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const result = await tool.handler({
      asset: VALID_ASSET,
      response_format: "markdown",
    });

    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.create.mock.calls[0][0]).toEqual({ asset: VALID_ASSET });
    expect(result.structuredContent).toEqual(CREATE_OK);
  });

  test("schema validation: rejects input with missing asset", () => {
    const parsed = CreateRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      create: mock(() => Promise.reject(new Error("Request Failed. Request Response: Duplicate"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_create");

    const result = await tool.handler({ asset: VALID_ASSET });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_create");
  });
});

// =============================================================================
// cascade_edit
// =============================================================================

describe("cascade_edit tool", () => {
  test("happy path: calls client.edit with asset wrapper", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      edit: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_edit");

    expect(tool.config.annotations.readOnlyHint).toBe(false);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const assetWithId = { page: { ...VALID_ASSET.page, id: "page-001" } };
    const result = await tool.handler({
      asset: assetWithId,
      response_format: "json",
    });

    expect(client.edit).toHaveBeenCalledTimes(1);
    expect(client.edit.mock.calls[0][0]).toEqual({ asset: assetWithId });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects empty body", () => {
    const parsed = EditRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      edit: mock(() => Promise.reject(new Error("Request Failed. Request Response: Forbidden"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_edit");

    const result = await tool.handler({ asset: { page: { ...VALID_ASSET.page, id: "p1" } } });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_edit");
  });
});

// =============================================================================
// cascade_remove
// =============================================================================

describe("cascade_remove tool", () => {
  test("happy path: calls client.remove with identifier", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    expect(tool.config.annotations.destructiveHint).toBe(true);
    expect(tool.config.annotations.idempotentHint).toBe(true);

    const result = await tool.handler({
      identifier: ID_PAGE,
      response_format: "markdown",
    });

    expect(client.remove).toHaveBeenCalledTimes(1);
    expect(client.remove.mock.calls[0][0]).toEqual({ identifier: ID_PAGE });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing identifier", () => {
    const parsed = RemoveRequestSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      remove: mock(() => Promise.reject(new Error("Request Failed. Request Response: Locked"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_remove");

    const result = await tool.handler({ identifier: ID_PAGE });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_remove");
  });
});

// =============================================================================
// cascade_move
// =============================================================================

describe("cascade_move tool", () => {
  test("happy path: calls client.move with identifier + moveParameters", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      move: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_move");

    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const moveParameters = {
      destinationContainerIdentifier: { id: "folder-1", type: "folder" as const },
      doWorkflow: false,
      newName: "new-index",
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      moveParameters,
      response_format: "markdown",
    });

    expect(client.move).toHaveBeenCalledTimes(1);
    expect(client.move.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      moveParameters,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing moveParameters", () => {
    const parsed = MoveRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      move: mock(() => Promise.reject(new Error("Request Failed. Request Response: Name Collision"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_move");

    const result = await tool.handler({
      identifier: ID_PAGE,
      moveParameters: { doWorkflow: false },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_move");
  });
});

// =============================================================================
// cascade_copy
// =============================================================================

describe("cascade_copy tool", () => {
  test("happy path: calls client.copy with identifier + copyParameters", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      copy: mock(() => Promise.resolve(OK_RESULT)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_copy");

    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(false);

    const copyParameters = {
      destinationContainerIdentifier: { id: "folder-2", type: "folder" as const },
      doWorkflow: false,
      newName: "index-copy",
    };
    const result = await tool.handler({
      identifier: ID_PAGE,
      copyParameters,
      response_format: "markdown",
    });

    expect(client.copy).toHaveBeenCalledTimes(1);
    expect(client.copy.mock.calls[0][0]).toEqual({
      identifier: ID_PAGE,
      copyParameters,
    });
    expect(result.isError).not.toBe(true);
  });

  test("schema validation: rejects missing copyParameters", () => {
    const parsed = CopyRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(parsed.success).toBe(false);
  });

  test("library throws: returns isError response", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      copy: mock(() => Promise.reject(new Error("Request Failed. Request Response: Quota Exceeded"))),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_copy");

    const result = await tool.handler({
      identifier: ID_PAGE,
      copyParameters: {
        destinationContainerIdentifier: { id: "f", type: "folder" },
        doWorkflow: false,
        newName: "dup",
      },
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_copy");
  });
});

// =============================================================================
// Registration coverage: CRUD tools plus handle-based asset follow-ups
// =============================================================================

describe("registerCrudTools coverage", () => {
  test("registers CRUD tools and asset follow-up tools with cascade_ prefix", () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "cascade_asset_get_node",
      "cascade_asset_list_children",
      "cascade_asset_search_paths",
      "cascade_copy",
      "cascade_create",
      "cascade_edit",
      "cascade_move",
      "cascade_read",
      "cascade_remove",
    ]);
  });
});
