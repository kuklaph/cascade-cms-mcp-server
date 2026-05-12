import { describe, test, expect, mock } from "bun:test";
import type { ToolAnnotations, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerCrudTools } from "../../../src/tools/crud.js";
import {
  ReadRequestSchema,
  AssetListFactsRequestSchema,
  AssetSearchValuesRequestSchema,
  AssetSearchKeysRequestSchema,
  AssetGetValueRequestSchema,
  AssetListScalarArtifactsRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
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
    expect(structured.raw_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(structured.index_version).toBe(1);
    expect(structured.audit_complete).toBe(false);
    expect(structured.total_fact_count).toBeGreaterThan(100);
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

  test("read_mode: 'raw' returns bounded cache metadata for oversize raw responses", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");

    const result = await tool.handler({
      identifier: { id: "huge-page-id", type: "page" },
      read_mode: "raw",
    });

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.success).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.asset).toBeUndefined();
    expect(structured._cache.handle).toMatch(/^h_[0-9a-f-]+$/);
  });

  test("SDK-validated omitted read_mode uses preview by default", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_read");
    const parsedInput = (tool.config.inputSchema as any).parse({
      identifier: { id: "huge-page-id", type: "page" },
    });

    const result = await tool.handler(parsedInput);

    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.asset_handle).toMatch(/^a_[0-9a-f-]+$/);
    expect(structured.asset).toBeUndefined();
  });

  test("audit and nodelet follow-up tools inspect the cached asset handle without calling Cascade again", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient({
      read: mock(() => Promise.resolve(READ_PAGE_HUGE)),
    });

    registerCrudTools(server as any, client);
    const read = findTool(tools, "cascade_read");
    const listFacts = findTool(tools, "cascade_asset_list_facts");
    const searchValues = findTool(tools, "cascade_asset_search_values");
    const searchKeys = findTool(tools, "cascade_asset_search_keys");
    const getValue = findTool(tools, "cascade_asset_get_value");
    const listArtifacts = findTool(tools, "cascade_asset_list_scalar_artifacts");
    const listReferences = findTool(tools, "cascade_asset_list_references");
    const listNodelets = findTool(tools, "cascade_asset_list_nodelets");
    const getNodelet = findTool(tools, "cascade_asset_get_nodelet");

    const result = await read.handler({
      identifier: { id: "huge-page-id", type: "page" },
    });
    const handle = (result.structuredContent as Record<string, any>).asset_handle;

    const factsResult = await listFacts.handler({
      asset_handle: handle,
      fact_kind: "scalar",
      limit: 5,
    });
    const valuesResult = await searchValues.handler({
      asset_handle: handle,
      value_contains: "xxxxx",
    });
    const keysResult = await searchKeys.handler({
      asset_handle: handle,
      key: "xhtml",
    });
    const valueResult = await getValue.handler({
      asset_handle: handle,
      pointer: "/asset/page/xhtml",
      offset: 5,
      length: 5,
    });
    const artifactsResult = await listArtifacts.handler({
      asset_handle: handle,
      artifact_kind: "root_path",
    });
    const refsResult = await listReferences.handler({
      asset_handle: handle,
    });
    const listResult = await listNodelets.handler({
      asset_handle: handle,
      pointer: "",
      limit: 5,
    });
    const firstPointer = (listResult.structuredContent as Record<string, any>)
      .nodelets[0].pointer;
    const getResult = await getNodelet.handler({
      asset_handle: handle,
      pointer: firstPointer,
      depth: 0,
    });

    expect(factsResult.isError).not.toBe(true);
    expect(valuesResult.isError).not.toBe(true);
    expect(keysResult.isError).not.toBe(true);
    expect(valueResult.isError).not.toBe(true);
    expect(artifactsResult.isError).not.toBe(true);
    expect(refsResult.isError).not.toBe(true);
    expect((factsResult.structuredContent as Record<string, any>).results).toHaveLength(5);
    expect((valuesResult.structuredContent as Record<string, any>).results[0].pointer).toBe("/asset/page/xhtml");
    expect((keysResult.structuredContent as Record<string, any>).results[0].pointer).toBe("/asset/page/xhtml");
    expect((valueResult.structuredContent as Record<string, any>).value).toBe("xxxxx");
    expect((artifactsResult.structuredContent as Record<string, any>).source_scope).toBe("raw_scalar_artifacts");
    expect((listResult.structuredContent as Record<string, any>).nodelets).toHaveLength(5);
    expect((getResult.structuredContent as Record<string, any>).pointer).toBe(
      firstPointer,
    );
    expect(client.read).toHaveBeenCalledTimes(1);
  });

  test("follow-up tools return actionable errors for missing handles", async () => {
    const { server, tools } = makeMockServer();
    const client = createMockClient();

    registerCrudTools(server as any, client);
    const tool = findTool(tools, "cascade_asset_get_nodelet");

    const result = await tool.handler({
      asset_handle: "a_00000000-0000-0000-0000-000000000000",
      pointer: "",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cascade_asset_get_nodelet");
    expect(firstText(result)).toContain("not found");
  });

  test("asset follow-up schemas require asset_handle", () => {
    expect(AssetListFactsRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetSearchValuesRequestSchema.safeParse({ value_contains: "x" }).success).toBe(false);
    expect(AssetSearchKeysRequestSchema.safeParse({ key: "x" }).success).toBe(false);
    expect(AssetGetValueRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
    expect(AssetListScalarArtifactsRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetListReferencesRequestSchema.safeParse({}).success).toBe(false);
    expect(AssetListNodeletsRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
    expect(AssetGetNodeletRequestSchema.safeParse({ pointer: "" }).success).toBe(false);
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
      "cascade_asset_get_nodelet",
      "cascade_asset_get_value",
      "cascade_asset_list_facts",
      "cascade_asset_list_nodelets",
      "cascade_asset_list_references",
      "cascade_asset_list_scalar_artifacts",
      "cascade_asset_search_keys",
      "cascade_asset_search_values",
      "cascade_copy",
      "cascade_create",
      "cascade_edit",
      "cascade_move",
      "cascade_read",
      "cascade_remove",
    ]);
  });
});
